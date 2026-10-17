import { FONTES_DA_SAUDE, projetarSaudeEmpresa, type CorDaSaude, type FonteDaSaude, type MotivoDeSaude, type ResultadoDaSaude, type SinalDeSaude } from '@contaia/domain';
import type { PoolClient } from 'pg';

type IdentidadeEmpresa = Readonly<{ tenantId: string; empresaId: string }>;

const dataCivil = (valor: Date | string | null): string | null => {
  if (valor === null) return null;
  return typeof valor === 'string' ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);
};

const estaAtrasada = (processadoEm: Date | null, agora: Date): boolean =>
  processadoEm === null || agora.getTime() - processadoEm.getTime() > 15 * 60_000;

/** Adapta fatos das fontes para sinais do projetor; nenhum texto de XML/segredo entra aqui. */
export const coletarSinaisDaSaude = async (
  cliente: PoolClient,
  empresa: IdentidadeEmpresa,
  agora: Date,
  fontesHabilitadas: readonly FonteDaSaude[] = FONTES_DA_SAUDE,
): Promise<Readonly<{ resultado: ResultadoDaSaude; revisoes: Readonly<Record<FonteDaSaude, string>> }>> => {
  const { tenantId, empresaId } = empresa;
  const sinais: SinalDeSaude[] = [];
  const incompletas = new Set<FonteDaSaude>();
  const revisoes: Record<FonteDaSaude, string> = {
    PENDENCIAS: '0', CERTIFICADOS: '0', CAPTURA: '0', MANIFESTACOES: '0', OBRIGACOES: '0',
  };
  const estadoEmpresa = await cliente.query<{ status: string; situacao: string; atualizado_em: Date; regime_tributario:string|null; uf:string|null; municipio:string|null;cnae_principal:string|null }>(
    `select e.status,e.situacao,e.atualizado_em,e.regime_tributario,e.cnae_principal,ed.uf,ed.municipio from app.empresa e
      left join lateral(select uf,municipio from app.empresa_endereco where tenant_id=e.tenant_id and empresa_id=e.id and situacao='ativo' and principal limit 1) ed on true
      where e.tenant_id=$1 and e.id=$2`, [tenantId, empresaId],
  );
  const empresaRow = estadoEmpresa.rows[0];
  if (!empresaRow || empresaRow.situacao !== 'ativo' || empresaRow.status !== 'ATIVA') {
    return { resultado: projetarSaudeEmpresa({ sinais: [], fontesIncompletas: ['PENDENCIAS','CERTIFICADOS','CAPTURA','MANIFESTACOES','OBRIGACOES'] }), revisoes };
  }

  const pendencias = fontesHabilitadas.includes('PENDENCIAS') ? await cliente.query<{ id: string; tipo: string; origem: string; data_limite: Date | null; atualizado_em: Date }>(
    `select p.id,p.tipo,p.origem,p.data_limite,coalesce(e.ocorrido_em,p.criado_em) as atualizado_em from app.empresa_pendencia p
      left join lateral(select ocorrido_em from app.empresa_evento_de_pendencia ep where ep.tenant_id=p.tenant_id and ep.empresa_id=p.empresa_id and ep.pendencia_id=p.id order by ep.sequencia desc limit 1)e on true
      where p.tenant_id=$1 and p.empresa_id=$2 and p.estado='ABERTA' order by p.id`, [tenantId, empresaId],
  ) : { rows: [] as Array<{ id: string; tipo: string; origem: string; data_limite: Date | null; atualizado_em: Date }> };
  for (const row of pendencias.rows) sinais.push({ fonte:'PENDENCIAS',codigo:`${row.origem}_${row.tipo}`,gravidade:'AMARELO',origemId:row.id,descricao:'Pendência cadastral ou documental aberta.',dataReferencia:dataCivil(row.data_limite),atualizadoEm:row.atualizado_em });
  const revisaoPendencias=fontesHabilitadas.includes('PENDENCIAS') ? await cliente.query<{valor:string}>(`select coalesce(max(ep.sequencia),0)::text||':'||count(*)::text valor from app.empresa_evento_de_pendencia ep where ep.tenant_id=$1 and ep.empresa_id=$2`,[tenantId,empresaId]) : { rows: [] as Array<{valor:string}> };
  revisoes.PENDENCIAS = revisaoPendencias.rows[0]?.valor??'0:0';

  const certificados = fontesHabilitadas.includes('CERTIFICADOS') ? await cliente.query<{ id: string; estado: string; valido_de: Date; valido_ate: Date; cadastrado_em: Date; invalido:boolean }>(
    `select c.id,c.estado,c.valido_de,c.valido_ate,c.cadastrado_em,(c.cnpj_titular<>e.cnpj) invalido from app.empresa_certificado c join app.empresa e on e.id=c.empresa_id and e.tenant_id=c.tenant_id
      where c.tenant_id=$1 and c.empresa_id=$2 and c.estado<>'SUBSTITUIDO' order by c.versao desc,c.id desc limit 1`, [tenantId, empresaId],
  ) : { rows: [] as Array<{ id: string; estado: string; valido_de: Date; valido_ate: Date; cadastrado_em: Date; invalido:boolean }> };
  const cert = certificados.rows[0];
  const hoje = dataCivil(agora) ?? '';
  if (!cert && fontesHabilitadas.includes('CERTIFICADOS')) sinais.push({ fonte:'CERTIFICADOS',codigo:'CERTIFICADO_AUSENTE',gravidade:'VERMELHO',origemId:empresaId,descricao:'Certificado A1 ausente.',dataReferencia:null,atualizadoEm:null });
  else if (cert) {
    const de = dataCivil(cert.valido_de) ?? '';
    const ate = dataCivil(cert.valido_ate) ?? '';
    if (cert.invalido) sinais.push({ fonte:'CERTIFICADOS',codigo:'CERTIFICADO_INVALIDO',gravidade:'VERMELHO',origemId:cert.id,descricao:'Certificado A1 não corresponde ao CNPJ da empresa.',dataReferencia:ate,atualizadoEm:cert.cadastrado_em });
    else if (cert.estado !== 'VIGENTE') sinais.push({ fonte:'CERTIFICADOS',codigo:'CERTIFICADO_DESATIVADO',gravidade:'VERMELHO',origemId:cert.id,descricao:'Certificado A1 desativado.',dataReferencia:ate,atualizadoEm:cert.cadastrado_em });
    else if (hoje < de) sinais.push({ fonte:'CERTIFICADOS',codigo:'CERTIFICADO_FUTURO',gravidade:'VERMELHO',origemId:cert.id,descricao:'Certificado A1 ainda não está vigente.',dataReferencia:de,atualizadoEm:cert.cadastrado_em });
    else if (ate < hoje) sinais.push({ fonte:'CERTIFICADOS',codigo:'CERTIFICADO_EXPIRADO',gravidade:'VERMELHO',origemId:cert.id,descricao:'Certificado A1 expirado.',dataReferencia:ate,atualizadoEm:cert.cadastrado_em });
    else if (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`) < 30 * 86_400_000) sinais.push({ fonte:'CERTIFICADOS',codigo:'CERTIFICADO_PROXIMO_VENCIMENTO',gravidade:'AMARELO',origemId:cert.id,descricao:'Certificado A1 válido com menos de 30 dias para vencer.',dataReferencia:ate,atualizadoEm:cert.cadastrado_em });
  }
  const revisaoCertificados=fontesHabilitadas.includes('CERTIFICADOS') ? await cliente.query<{valor:string}>(`select coalesce(max(e.sequencia),0)::text||':'||count(*)::text valor from app.empresa_certificado_evento e where e.tenant_id=$1 and e.empresa_id=$2`,[tenantId,empresaId]) : { rows: [] as Array<{valor:string}> };
  revisoes.CERTIFICADOS=revisaoCertificados.rows[0]?.valor??'0:0';

  const captura = fontesHabilitadas.includes('CAPTURA') ? await cliente.query<{ id:string; estado:string; versao:number; atualizado_em:Date }>(
    `select id,estado,versao,atualizado_em from app.dfe_capture_state where tenant_id=$1 and empresa_id=$2 order by atualizado_em desc,id desc`, [tenantId,empresaId],
  ) : { rows: [] as Array<{id:string;estado:string;versao:number;atualizado_em:Date}> };
  for(const row of captura.rows){
    if(row.estado==='BLOCKED_656')sinais.push({fonte:'CAPTURA',codigo:'CAPTURA_BLOQUEADA_656',gravidade:'VERMELHO',origemId:row.id,descricao:'Captura DF-e bloqueada por Rejeição 656.',dataReferencia:null,atualizadoEm:row.atualizado_em});
    else if(row.estado==='FAILED')sinais.push({fonte:'CAPTURA',codigo:'CAPTURA_FALHA',gravidade:'VERMELHO',origemId:row.id,descricao:'Captura DF-e em falha operacional.',dataReferencia:null,atualizadoEm:row.atualizado_em});
  }
  revisoes.CAPTURA=`${captura.rows.length}:${captura.rows.map(row=>`${row.id}:${row.versao}`).join(',')}`;

  const manifestacoes=fontesHabilitadas.includes('MANIFESTACOES') ? await cliente.query<{id:string;estado:string;atualizado_em:Date}>(
    `select id,estado,atualizado_em from app.fiscal_manifestation where tenant_id=$1 and empresa_id=$2
      and estado in ('APROVADA','ENFILEIRADA','ASSINADA','RESULTADO_INCERTO','FALHA_RETRY','DLQ') order by id`,[tenantId,empresaId],
  ) : { rows: [] as Array<{id:string;estado:string;atualizado_em:Date}> };
  for(const row of manifestacoes.rows)sinais.push({fonte:'MANIFESTACOES',codigo:`MANIFESTACAO_${row.estado}`,gravidade:'AMARELO',origemId:row.id,descricao:'Manifestação conclusiva pendente de decisão ou intervenção.',dataReferencia:null,atualizadoEm:row.atualizado_em});
  revisoes.MANIFESTACOES=`${manifestacoes.rows.length}:${manifestacoes.rows.at(-1)?.id??'0'}`;
  const revisaoManifestacoes=fontesHabilitadas.includes('MANIFESTACOES') ? await cliente.query<{valor:string}>(`select coalesce(max(id::text),'0') valor from app.fiscal_manifestation where tenant_id=$1 and empresa_id=$2`,[tenantId,empresaId]) : { rows: [] as Array<{valor:string}> };
  revisoes.MANIFESTACOES=revisaoManifestacoes.rows[0]?.valor??'0';

  const obrigacoes=fontesHabilitadas.includes('OBRIGACOES') ? await cliente.query<{id:string;estado:string;codigo:string;vencimento_ajustado:Date|null;atualizado_em:Date}>(
    `select id,estado,codigo,vencimento_ajustado,atualizado_em from app.obligation_occurrence
      where tenant_id=$1 and empresa_id=$2 and estado<>'ENTREGUE' and estado<>'NAO_EXIGIVEL' order by id`,[tenantId,empresaId],
  ) : { rows: [] as Array<{id:string;estado:string;codigo:string;vencimento_ajustado:Date|null;atualizado_em:Date}> };
  let prazoIncompleto=false;
  for(const row of obrigacoes.rows){
    const vencimento=dataCivil(row.vencimento_ajustado);
    if(row.estado==='COBERTURA_INCOMPLETA'){prazoIncompleto=true;continue;}
    if(row.estado==='VENCIDA'||(vencimento!==null&&vencimento<hoje))sinais.push({fonte:'OBRIGACOES',codigo:'OBRIGACAO_VENCIDA',gravidade:'VERMELHO',origemId:row.id,descricao:'Obrigação vencida.',dataReferencia:vencimento,atualizadoEm:row.atualizado_em});
    else if(row.estado==='PENDENTE'||row.estado==='BLOQUEADA_POR_DEPENDENCIA')sinais.push({fonte:'OBRIGACOES',codigo:'OBRIGACAO_PENDENTE',gravidade:'AMARELO',origemId:row.id,descricao:'Obrigação pendente ou bloqueada.',dataReferencia:vencimento,atualizadoEm:row.atualizado_em});
    if(vencimento!==null&&vencimento>=hoje&&vencimento<=new Date(Date.parse(`${hoje}T00:00:00Z`)+3*86_400_000).toISOString().slice(0,10))sinais.push({fonte:'OBRIGACOES',codigo:'OBRIGACAO_D3_D0',gravidade:'AMARELO',origemId:row.id,descricao:'Obrigação em D-3 até D0.',dataReferencia:vencimento,atualizadoEm:row.atualizado_em});
  }
  if(prazoIncompleto)sinais.push({fonte:'OBRIGACOES',codigo:'COBERTURA_INCOMPLETA',gravidade:'AMARELO',origemId:empresaId,descricao:'Cobertura do calendário de obrigações incompleta.',dataReferencia:null,atualizadoEm:null});
  const revisaoObrigacoes=fontesHabilitadas.includes('OBRIGACOES') ? await cliente.query<{valor:string}>(`select coalesce(max(id::text),'0')||':'||count(*)::text valor from app.obligation_occurrence where tenant_id=$1 and empresa_id=$2`,[tenantId,empresaId]) : { rows: [] as Array<{valor:string}> };
  revisoes.OBRIGACOES=revisaoObrigacoes.rows[0]?.valor??'0:0';

  const cobertura=fontesHabilitadas.includes('OBRIGACOES') ? await cliente.query<{cobertura_estadual:boolean;cobertura_municipal:boolean}>(`select app.obligation_calendar_has_coverage('ESTADUAL',$1,null,($2||'-01')::date) cobertura_estadual,app.obligation_calendar_has_coverage('MUNICIPAL',$1,$3,($2||'-01')::date) cobertura_municipal`,[empresaRow.uf,hoje.slice(0,7),empresaRow.municipio]) : { rows: [] as Array<{cobertura_estadual:boolean;cobertura_municipal:boolean}> };
  const regrasObrigacao=fontesHabilitadas.includes('OBRIGACOES') ? await cliente.query<{exige_feriado_estadual:boolean;exige_feriado_municipal:boolean;regimes:string[];ufs:string[];cnaes:string[];vigente_de:Date;vigente_ate:Date|null}>(`select exige_feriado_estadual,exige_feriado_municipal,regimes,ufs,cnaes,vigente_de,vigente_ate from app.obligation_published_rules(($1||'-01')::date)`,[hoje.slice(0,7)]) : { rows: [] as Array<{exige_feriado_estadual:boolean;exige_feriado_municipal:boolean;regimes:string[];ufs:string[];cnaes:string[];vigente_de:Date;vigente_ate:Date|null}> };
  const empresaCnaes=fontesHabilitadas.includes('OBRIGACOES') ? await cliente.query<{codigo:string}>(`select codigo from app.empresa_cnae_secundario where tenant_id=$1 and empresa_id=$2 and situacao='ativo'`,[tenantId,empresaId]) : { rows: [] as Array<{codigo:string}> };
  const cnaes=new Set([...(empresaRow.cnae_principal?[empresaRow.cnae_principal]:[]),...empresaCnaes.rows.map(row=>row.codigo)]);
  const aplicavel=regrasObrigacao.rows.filter(regra=>(empresaRow.regime_tributario===null||regra.regimes.includes(empresaRow.regime_tributario))&&(regra.ufs.length===0||(empresaRow.uf!==null&&regra.ufs.includes(empresaRow.uf)))&&(regra.cnaes.length===0||regra.cnaes.some(cnae=>cnaes.has(cnae))));
  if(aplicavel.some(regra=>(regra.exige_feriado_estadual&&cobertura.rows[0]?.cobertura_estadual!==true)||(regra.exige_feriado_municipal&&cobertura.rows[0]?.cobertura_municipal!==true)))sinais.push({fonte:'OBRIGACOES',codigo:'COBERTURA_INCOMPLETA',gravidade:'AMARELO',origemId:empresaId,descricao:'Cobertura do calendário de obrigações incompleta.',dataReferencia:null,atualizadoEm:null});

  const checkPoints=await cliente.query<{fonte:FonteDaSaude;revisao:string;processado_em:Date}>(
    `select fonte,revisao,processado_em from app.dashboard_health_source_checkpoint where tenant_id=$1 and empresa_id=$2`,[tenantId,empresaId]);
  const porFonte=new Map(checkPoints.rows.map(row=>[row.fonte,row]));
  const revisaoEmpresa=`${empresaRow.atualizado_em.toISOString()}:${empresaRow.regime_tributario??''}:${empresaRow.uf??''}:${empresaRow.municipio??''}`;
  revisoes.PENDENCIAS=`${revisoes.PENDENCIAS}:${revisaoEmpresa}`;
  revisoes.CERTIFICADOS=`${revisoes.CERTIFICADOS}:${revisaoEmpresa}`;
  revisoes.CAPTURA=`${revisoes.CAPTURA}:${revisaoEmpresa}`;
  revisoes.MANIFESTACOES=`${revisoes.MANIFESTACOES}:${revisaoEmpresa}`;
  revisoes.OBRIGACOES=`${revisoes.OBRIGACOES}:${revisaoEmpresa}`;
  const revisaoAtual:Readonly<Record<FonteDaSaude,string>>={...revisoes};
  const fontesDisponiveis = new Set<FonteDaSaude>(fontesHabilitadas);
  for(const fonte of fontesDisponiveis){
    const checkPoint=porFonte.get(fonte);
    if(!checkPoint||estaAtrasada(checkPoint.processado_em,agora)||checkPoint.revisao!==revisaoAtual[fonte])incompletas.add(fonte);
  }
  for (const fonte of FONTES_DA_SAUDE) if (!fontesDisponiveis.has(fonte)) { revisoes[fonte] = 'NAO_CONFIGURADA'; incompletas.add(fonte); }
  return {resultado:projetarSaudeEmpresa({sinais,fontesIncompletas:[...incompletas]}),revisoes};
};

export const substituirProjecaoDaSaude = async (
  cliente: PoolClient,
  empresa: IdentidadeEmpresa,
  resultado: ResultadoDaSaude,
  revisoes: Readonly<Record<FonteDaSaude,string>>,
  agora: Date,
  correlationId: string,
): Promise<void> => {
  const {tenantId,empresaId}=empresa;
  const atualizadoEm=resultado.atualizadoEm??agora;
  const resumo=resultado.motivoPrioritario?{fonte:resultado.motivoPrioritario.fonte,codigo:resultado.motivoPrioritario.codigo,gravidade:resultado.motivoPrioritario.gravidade,descricao:resultado.motivoPrioritario.descricao}:null;
  await cliente.query(`select app.dashboard_health_projection_replace($1::jsonb)`,[JSON.stringify({tenantId,empresaId,correlationId,cor:resultado.cor,resumo,
    contagensFontes:resultado.contagensPorFonte,contagensGravidade:resultado.contagensPorGravidade,revisoesFontes:revisoes,atualizadoEm:atualizadoEm.toISOString(),
    motivos:resultado.motivos.map(m=>({fonte:m.fonte,codigo:m.codigo,gravidade:m.gravidade,origem_id:m.origemId,descricao:m.descricao,data_referencia:m.dataReferencia,atualizado_em:m.atualizadoEm?.toISOString()??null}))})]);
};

export type FiltroDoDashboard = Readonly<{
  busca:string|null; cor:CorDaSaude|null; regime:string|null; fonte:FonteDaSaude|null; codigo:string|null; ordem:'URGENCIA'|'NOME'; limite:number; deslocamento:number;
}>;

export const listarDashboardDaSaude = async (cliente:PoolClient,tenantId:string,usuarioId:string,filtro:FiltroDoDashboard)=>{
  const busca=filtro.busca?.trim()??'';
  const condicao=`e.tenant_id=$1 and e.status='ATIVA' and e.situacao='ativo' and $2::uuid=app.usuario_atual()
    and p.tenant_id=e.tenant_id and p.empresa_id=e.id
    and exists(select 1 from app.carteira_vinculo v where v.tenant_id=e.tenant_id and v.empresa_id=e.id and v.usuario_id=$2 and v.encerrado_em is null)
    and ($3::text is null or p.cor=$3) and ($4::text is null or e.regime_tributario=$4)
    and ($5::text is null or exists(select 1 from app.dashboard_health_reason r where r.tenant_id=e.tenant_id and r.empresa_id=e.id and r.ativo and r.fonte=$5))
    and ($6::text is null or exists(select 1 from app.dashboard_health_reason r where r.tenant_id=e.tenant_id and r.empresa_id=e.id and r.ativo and r.codigo=$6))
    and ($7::text is null or e.razao_social ilike $7 or e.nome_fantasia ilike $7 or e.cnpj like $7
      or ($8::text is not null and regexp_replace(e.cnpj,'[^0-9]','','g') like $8))`;
  const termo=busca?`%${busca.replace(/[\\%_]/gu,c=>`\\${c}`)}%`:null;
  const termoCnpj=busca.replace(/\\D/gu,'');
  const args=[tenantId,usuarioId,filtro.cor,filtro.regime,filtro.fonte,filtro.codigo,termo,termoCnpj.length>=2?`%${termoCnpj}%`:null];
  const elegiveis=`with elegiveis as (select e.tenant_id,e.id,p.cor,e.regime_tributario,e.razao_social,e.nome_fantasia,e.cnpj,e.status,e.situacao
    from app.empresa e join app.dashboard_health_projection p on p.tenant_id=e.tenant_id and p.empresa_id=e.id
    where ${condicao})`;
  const summarySql=`${elegiveis}, motivos as materialized (select r.* from app.dashboard_health_reason r
       where r.tenant_id=$1 and r.ativo and r.empresa_id=any(array(select id from elegiveis)))
     select count(distinct e.id)::int total,
      count(distinct e.id) filter(where e.cor='VERMELHO')::int vermelho,
      count(distinct e.id) filter(where e.cor='AMARELO')::int amarelo,
      count(distinct e.id) filter(where e.cor='VERDE')::int verde,
      count(r.id) filter(where r.fonte='OBRIGACOES' and r.codigo='OBRIGACAO_VENCIDA')::int vencidas,
      count(r.id) filter(where r.fonte='OBRIGACOES' and r.codigo='OBRIGACAO_D3_D0')::int d3,
      count(r.id) filter(where r.fonte='MANIFESTACOES')::int manifestacoes,
      count(r.id) filter(where r.fonte='CAPTURA' and r.gravidade='VERMELHO')::int capturas,
      count(distinct e.id) filter(where r.fonte='CERTIFICADOS')::int certificados
     from elegiveis e left join motivos r on r.tenant_id=e.tenant_id and r.empresa_id=e.id`;
  const summary=await cliente.query<{total:number;vermelho:number;amarelo:number;verde:number;vencidas:number;d3:number;manifestacoes:number;capturas:number;certificados:number}>(summarySql, args);
  const {rows}=await cliente.query(`select * from (select e.id empresa_id,e.cnpj,coalesce(e.nome_fantasia,e.razao_social,e.cnpj) nome,e.regime_tributario regime,p.cor,p.contagens_fontes,p.contagens_gravidade,p.atualizado_em,p.resumo,
    (select jsonb_build_object('fonte',r.fonte,'codigo',r.codigo,'gravidade',r.gravidade,'descricao',r.descricao) from app.dashboard_health_reason r where r.tenant_id=e.tenant_id and r.empresa_id=e.id and r.ativo order by case r.gravidade when 'VERMELHO' then 0 else 1 end,case r.fonte when 'OBRIGACOES' then 0 when 'CAPTURA' then 1 when 'CERTIFICADOS' then 2 when 'MANIFESTACOES' then 3 else 4 end,r.data_referencia nulls last,r.codigo limit 1) motivo_prioritario,
    (select count(*)::int from app.dashboard_health_reason r where r.tenant_id=e.tenant_id and r.empresa_id=e.id and r.ativo) total_motivos,
    (select min(r.data_referencia)::text from app.dashboard_health_reason r where r.tenant_id=e.tenant_id and r.empresa_id=e.id and r.ativo and r.data_referencia>=current_date) proxima_data,
    (select min(r.data_referencia) from app.dashboard_health_reason r where r.tenant_id=e.tenant_id and r.empresa_id=e.id and r.ativo and r.gravidade='VERMELHO') data_critica
   from app.empresa e join app.dashboard_health_projection p on p.tenant_id=e.tenant_id and p.empresa_id=e.id where ${condicao}
  ) dashboard
   order by case when $9::text='NOME' then 0 else case dashboard.cor when 'VERMELHO' then 0 when 'AMARELO' then 1 else 2 end end,
    case when $9::text='NOME' then lower(dashboard.nome) end asc nulls last,
    case when $9::text='URGENCIA' and dashboard.cor='VERMELHO' then dashboard.data_critica end nulls last,
    case when $9::text='URGENCIA' then dashboard.proxima_data end nulls last,
    case when $9::text='URGENCIA' then dashboard.total_motivos end desc nulls last,
    lower(dashboard.nome),dashboard.empresa_id limit $10 offset $11`,[...args,filtro.ordem,filtro.limite,filtro.deslocamento]);
  const resumo=summary.rows[0]??{total:0,vermelho:0,amarelo:0,verde:0,vencidas:0,d3:0,manifestacoes:0,capturas:0,certificados:0};
  return {resumo,empresas:rows,total:Number(resumo.total??0)};
};

export const listarMotivosDaSaude = async(cliente:PoolClient,tenantId:string,usuarioId:string,empresaId:string):Promise<readonly MotivoDeSaude[]>=>{
 const {rows}=await cliente.query(`select r.fonte,r.codigo,r.gravidade,r.origem_id,r.descricao,r.data_referencia::text,r.atualizado_em,r.fonte||':'||r.codigo||':'||r.origem_id identidade,coalesce(c.revisao,'desconhecida') revisao_fonte,c.processado_em
 from app.dashboard_health_reason r join app.empresa e on e.id=r.empresa_id and e.tenant_id=r.tenant_id
 left join app.dashboard_health_source_checkpoint c on c.tenant_id=r.tenant_id and c.empresa_id=r.empresa_id and c.fonte=r.fonte
 where r.tenant_id=$1 and r.empresa_id=$3 and r.ativo and $2::uuid=app.usuario_atual() and e.status='ATIVA' and e.situacao='ativo'
 and exists(select 1 from app.carteira_vinculo v where v.tenant_id=e.tenant_id and v.empresa_id=e.id and v.usuario_id=$2 and v.encerrado_em is null)
 order by case r.gravidade when 'VERMELHO' then 0 else 1 end,r.fonte,r.data_referencia nulls last,r.id`,[tenantId,usuarioId,empresaId]);
 return rows as MotivoDeSaude[];
};

export type { CorDaSaude };
