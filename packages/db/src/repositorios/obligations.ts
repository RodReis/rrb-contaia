import { calcularOcorrencia, prioridadeDoAlerta } from '@contaia/domain';
import type { Feriado, RegraDeObrigacao, EstadoDaObrigacao } from '@contaia/domain';
import type { PoolClient } from 'pg';

export type RegraPersistida = RegraDeObrigacao & Readonly<{ id: string; estado: 'RASCUNHO' | 'PUBLICADA' | 'ARQUIVADA'; conteudoHash: string | null }>;
export type FiltroAgenda = Readonly<{ empresaId?: string; codigo?: string; competencia?: string; estado?: EstadoDaObrigacao; prioridade?: string; limite: number; deslocamento: number }>;
export type OcorrenciaPersistida = Readonly<{ id: string; empresaId: string; empresaNome: string; cnpj: string; codigo: string; nome: string; competencia: string; vencimentoNominal: string | null; vencimentoAjustado: string | null; estado: EstadoDaObrigacao; motivo: string | null; dependenciasPendentes: readonly string[]; prioridade: string; versao: number }>;

export const listarRegrasDeObrigacao = async (cliente: PoolClient): Promise<readonly RegraPersistida[]> => {
  const { rows } = await cliente.query<Record<string, unknown>>('select * from app.obligation_rule_list()');
  return rows.map((r) => ({ id: String(r['id']), codigo: String(r['codigo']), nome: String(r['nome']), versao: Number(r['versao']), regimes: r['regimes'] as string[], ufs: r['ufs'] as string[], cnaes: r['cnaes'] as string[], periodicidade: 'MENSAL', diaNominal: Number(r['dia_nominal']), ajustarDiaUtil: r['ajustar_dia_util'] as 'ANTECEDENTE' | 'NENHUM', exigeFeriadoEstadual: Boolean(r['exige_feriado_estadual']), exigeFeriadoMunicipal: Boolean(r['exige_feriado_municipal']), dependencias: r['dependencias'] as string[], vigenteDe: String(r['vigente_de']).slice(0, 10), vigenteAte: r['vigente_ate'] === null ? null : String(r['vigente_ate']).slice(0, 10), estado: r['estado'] as RegraPersistida['estado'], conteudoHash: r['conteudo_hash'] as string | null }));
};

export const criarRegraDeObrigacao = async (cliente: PoolClient, entrada: Omit<RegraDeObrigacao, 'versao'>, _tenantId: string, autorId: string, correlationId = 'obligation-catalog'): Promise<RegraPersistida> => {
  const { rows } = await cliente.query<Record<string, unknown>>('select (app.obligation_rule_create($1::jsonb,$2::uuid,$3::text)).*', [JSON.stringify(entrada), autorId, correlationId]);
  const r = rows[0];
  if (!r) throw new Error('Não foi possível criar a regra.');
  return { id: String(r['id']), codigo: String(r['codigo']), nome: String(r['nome']), versao: Number(r['versao']), regimes: r['regimes'] as string[], ufs: r['ufs'] as string[], cnaes: r['cnaes'] as string[], periodicidade: 'MENSAL', diaNominal: Number(r['dia_nominal']), ajustarDiaUtil: r['ajustar_dia_util'] as 'ANTECEDENTE' | 'NENHUM', exigeFeriadoEstadual: Boolean(r['exige_feriado_estadual']), exigeFeriadoMunicipal: Boolean(r['exige_feriado_municipal']), dependencias: r['dependencias'] as string[], vigenteDe: String(r['vigente_de']).slice(0,10), vigenteAte: r['vigente_ate'] === null ? null : String(r['vigente_ate']).slice(0,10), estado: r['estado'] as RegraPersistida['estado'], conteudoHash: r['conteudo_hash'] as string | null };
};

export const publicarRegraDeObrigacao = async (cliente: PoolClient, _tenantId: string, regraId: string, versaoEsperada: number, autorId: string, correlationId = 'obligation-catalog'): Promise<void> => {
  await cliente.query('select app.obligation_rule_publish($1::uuid,$2::integer,$3::uuid,$4::text)', [regraId, versaoEsperada, autorId, correlationId]);
};

export const arquivarRegraDeObrigacao = async (cliente: PoolClient, _tenantId: string, regraId: string, versaoEsperada: number, autorId: string, correlationId = 'obligation-catalog'): Promise<void> => {
  await cliente.query('select app.obligation_rule_archive($1::uuid,$2::integer,$3::uuid,$4::text)', [regraId, versaoEsperada, autorId, correlationId]);
};

export const salvarFeriado = async (cliente: PoolClient, entrada: Feriado & Readonly<{ nome: string; fonte: string; vigenteDe: string; vigenteAte: string | null; autorId: string }>): Promise<void> => {
  await cliente.query('select app.obligation_holiday_save($1::jsonb,$2::uuid)', [JSON.stringify(entrada), entrada.autorId]);
};

export const salvarCoberturaDoCalendario = async (cliente: PoolClient, entrada: Readonly<{ abrangencia: 'ESTADUAL' | 'MUNICIPAL'; uf: string; municipio: string | null; cobertoDe: string; cobertoAte: string; fonte: string; autorId: string }>): Promise<void> => {
  await cliente.query('select app.obligation_calendar_save_coverage($1::jsonb,$2::uuid)', [JSON.stringify(entrada), entrada.autorId]);
};

export const listarFeriados = async (cliente: PoolClient, _tenantId: string, competencia: string): Promise<readonly Feriado[]> => {
  const { rows } = await cliente.query<{ data: string; abrangencia: Feriado['abrangencia']; uf: string | null; municipio: string | null }>('select distinct on (data, abrangencia, uf, municipio) data::text,abrangencia,uf,municipio from app.obligation_holiday_list(($1||\'-01\')::date, (($1||\'-01\')::date + interval \'1 month - 1 day\')::date) order by data,abrangencia,uf,municipio', [competencia]);
  return rows;
};

export const gerarOcorrenciasPublicadas = async (cliente: PoolClient, tenantId: string, competencia: string, referencia: string): Promise<number> => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(competencia)) throw new Error('Competência mensal inválida.');
  const { rows: companies } = await cliente.query<{ id:string; regime_tributario:string|null; uf:string|null; municipio:string|null; cnae_principal:string|null; cnaes_secundarios:string[] }>(`select e.id,e.regime_tributario,ed.uf,ed.municipio,e.cnae_principal,coalesce(array_agg(c.codigo) filter(where c.codigo is not null),'{}') cnaes_secundarios from app.empresa e left join lateral (select uf,municipio from app.empresa_endereco where empresa_id=e.id and tenant_id=e.tenant_id and situacao='ativo' and principal limit 1) ed on true left join app.empresa_cnae_secundario c on c.empresa_id=e.id and c.tenant_id=e.tenant_id and c.situacao='ativo' where e.tenant_id=$1 and e.situacao='ativo' and e.status='ATIVA' and app.empresa_autorizada(e.id) group by e.id,ed.uf,ed.municipio`,[tenantId]);
  const { rows: rawRules } = await cliente.query<Record<string, unknown>>(`select * from app.obligation_published_rules(($1||'-01')::date)`,[competencia]);
  const feriados = await listarFeriados(cliente,tenantId,competencia);
  let criadas=0;
  for(const empresa of companies){
    const contexto={regime:empresa.regime_tributario,uf:empresa.uf,municipio:empresa.municipio,cnaes:[...(empresa.cnae_principal?[empresa.cnae_principal]:[]),...empresa.cnaes_secundarios]};
    const cobertura = await cliente.query<{ estadual: boolean; municipal: boolean }>(`select app.obligation_calendar_has_coverage('ESTADUAL',$1,null,($2||'-01')::date) estadual, app.obligation_calendar_has_coverage('MUNICIPAL',$1,$3,($2||'-01')::date) municipal`, [empresa.uf, competencia, empresa.municipio]);
    for(const raw of rawRules){
      const regra:RegraDeObrigacao={codigo:String(raw['codigo']),nome:String(raw['nome']),versao:Number(raw['versao']),regimes:raw['regimes'] as string[],ufs:raw['ufs'] as string[],cnaes:raw['cnaes'] as string[],periodicidade:'MENSAL',diaNominal:Number(raw['dia_nominal']),ajustarDiaUtil:raw['ajustar_dia_util'] as RegraDeObrigacao['ajustarDiaUtil'],exigeFeriadoEstadual:Boolean(raw['exige_feriado_estadual']),exigeFeriadoMunicipal:Boolean(raw['exige_feriado_municipal']),dependencias:raw['dependencias'] as string[],vigenteDe:String(raw['vigente_de']).slice(0,10),vigenteAte:raw['vigente_ate']===null?null:String(raw['vigente_ate']).slice(0,10)};
      const estados=await cliente.query<{codigo:string;estado:EstadoDaObrigacao}>(`select codigo,estado from app.obligation_occurrence where tenant_id=$1 and empresa_id=$2 and competencia=($3||'-01')::date`,[tenantId,empresa.id,competencia]);
      const calculada=calcularOcorrencia({regra,competencia,referencia,empresa:contexto,feriados,coberturaEstadualCompleta:cobertura.rows[0]?.estadual===true,coberturaMunicipalCompleta:cobertura.rows[0]?.municipal===true,estadosDasDependencias:Object.fromEntries(estados.rows.map(x=>[x.codigo,x.estado]))});
      const ins=await cliente.query<{id:string}>(`insert into app.obligation_occurrence(tenant_id,empresa_id,regra_id,codigo,competencia,versao_regra,vencimento_nominal,vencimento_ajustado,estado,motivo,dependencias_pendentes) values($1,$2,$3,$4,($5||'-01')::date,$6,$7,$8,$9,$10,$11) on conflict(tenant_id,empresa_id,codigo,competencia,versao_regra) do nothing returning id`,[tenantId,empresa.id,raw['id'],regra.codigo,competencia,regra.versao,calculada.vencimentoNominal,calculada.vencimentoAjustado,calculada.estado,calculada.motivo,calculada.dependenciasPendentes]);
      let occurrenceId=ins.rows[0]?.id;
      if(occurrenceId){criadas+=1;await cliente.query(`insert into app.obligation_event(tenant_id,empresa_id,occurrence_id,sequencia,acao,estado_novo,correlation_id) values($1,$2,$3,1,'GERADA',$4,$5)`,[tenantId,empresa.id,occurrenceId,calculada.estado,`obligation-${tenantId}-${empresa.id}-${competencia}`]);}
      else {const existing=await cliente.query<{id:string;estado:string;versao:number}>('select id,estado,versao from app.obligation_occurrence where tenant_id=$1 and empresa_id=$2 and codigo=$3 and competencia=($4||\'-01\')::date and versao_regra=$5',[tenantId,empresa.id,regra.codigo,competencia,regra.versao]); const current=existing.rows[0]; if(!current)continue; occurrenceId=current.id;
        if(current.estado==='PENDENTE'||current.estado==='BLOQUEADA_POR_DEPENDENCIA'||current.estado==='VENCIDA'){
          const updated=await cliente.query(`update app.obligation_occurrence set vencimento_nominal=$2,vencimento_ajustado=$3,estado=$4,motivo=$5,dependencias_pendentes=$6,prioridade=$7,versao=versao+1,atualizado_em=now() where id=$1 and versao=$8 returning id`,[occurrenceId,calculada.vencimentoNominal,calculada.vencimentoAjustado,calculada.estado,calculada.motivo,calculada.dependenciasPendentes,calculada.vencimentoAjustado?prioridadeDoAlerta(calculada.vencimentoAjustado,referencia)??'NORMAL':'NORMAL',current.versao]);
          if(updated.rowCount)await cliente.query(`insert into app.obligation_event(tenant_id,empresa_id,occurrence_id,sequencia,acao,estado_anterior,estado_novo,correlation_id) select $1,$2,$3,coalesce(max(sequencia),0)+1,'REAVALIADA',$4,$5,$6 from app.obligation_event where occurrence_id=$3`,[tenantId,empresa.id,occurrenceId,current.estado,calculada.estado,`obligation-${tenantId}-${empresa.id}-${competencia}`]);
        }
      }
      if(!calculada.vencimentoAjustado||!['PENDENTE','BLOQUEADA_POR_DEPENDENCIA','VENCIDA'].includes(calculada.estado))continue;
      const prioridade=prioridadeDoAlerta(calculada.vencimentoAjustado,referencia);if(prioridade===null)continue;
      const alert=await cliente.query<{id:string}>(`insert into app.obligation_alert(tenant_id,empresa_id,occurrence_id,identidade,prioridade,dias_restantes) values($1,$2,$3,'D3_EVOLUTIVO',$4,($5::date-$6::date)) on conflict(occurrence_id,identidade) do update set prioridade=excluded.prioridade,dias_restantes=excluded.dias_restantes,ativo=true,encerrado_em=null,atualizado_em=now() returning id`,[tenantId,empresa.id,occurrenceId,prioridade,calculada.vencimentoAjustado,referencia]);
      const alertId=alert.rows[0]?.id;if(!alertId)continue;
      const recipients=await cliente.query<{usuario_id:string;papel:string;vinculo_id:string|null}>('select distinct u.id usuario_id,p.papel,cv.id vinculo_id from app.usuario u join app.usuario_papel p on p.usuario_id=u.id and p.tenant_id=u.tenant_id and p.removido_em is null left join app.carteira_vinculo cv on cv.usuario_id=u.id and cv.tenant_id=u.tenant_id and cv.empresa_id=$2 and cv.encerrado_em is null where u.tenant_id=$1 and u.estado=\'ATIVO\' and (p.papel=\'admin_escritorio\' or (p.papel in (\'contador\',\'auxiliar\') and cv.id is not null))',[tenantId,empresa.id]);
      for(const recipient of recipients.rows){
        await cliente.query('insert into app.obligation_alert_recipient(tenant_id,empresa_id,alert_id,usuario_id,papel_snapshot,carteira_vinculo_id) values($1,$2,$3,$4,$5,$6) on conflict(alert_id,usuario_id) do nothing',[tenantId,empresa.id,alertId,recipient.usuario_id,recipient.papel,recipient.vinculo_id]);
        await cliente.query('insert into app.obligation_in_app_notification(tenant_id,empresa_id,alert_id,usuario_id) values($1,$2,$3,$4) on conflict(alert_id,usuario_id) do nothing',[tenantId,empresa.id,alertId,recipient.usuario_id]);
        for(const canal of ['EMAIL_LOCAL','WHATSAPP_LOCAL'] as const){await cliente.query(`insert into app.obligation_channel_outbox(tenant_id,empresa_id,alert_id,usuario_id,canal,payload,idempotency_key,correlation_id) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(alert_id,usuario_id,canal) do nothing`,[tenantId,empresa.id,alertId,recipient.usuario_id,canal,JSON.stringify({versao:1,codigo:regra.codigo,competencia,vencimento:calculada.vencimentoAjustado,prioridade}),`obrigacao:${alertId}:${recipient.usuario_id}:${canal}`,`obligation-${tenantId}-${empresa.id}-${competencia}`]);}
      }
    }
  }
  return criadas;
};

export const listarAgenda = async (cliente: PoolClient, tenantId: string, usuarioId: string, filtro: FiltroAgenda): Promise<Readonly<{ ocorrencias: readonly OcorrenciaPersistida[]; total: number }>> => {
  const params = [tenantId, usuarioId, filtro.empresaId ?? null, filtro.codigo ?? null, filtro.competencia ?? null, filtro.estado ?? null, filtro.prioridade ?? null];
  const where = `o.tenant_id=$1::uuid and $2::uuid=app.usuario_atual() and app.empresa_autorizada(o.empresa_id) and ($3::uuid is null or o.empresa_id=$3::uuid) and ($4::text is null or o.codigo=$4::text) and ($5::text is null or o.competencia=date_trunc('month',($5::text||'-01')::date)::date) and ($6::text is null or o.estado=$6::text) and ($7::text is null or o.prioridade=$7::text)`;
  const total = await cliente.query<{ total: string }>(`select count(*) total from app.obligation_occurrence o where ${where}`, params);
  const { rows } = await cliente.query<Record<string, unknown>>(`select o.id,o.empresa_id,coalesce(e.nome_fantasia,e.razao_social,e.cnpj) empresa_nome,e.cnpj,o.codigo,app.obligation_rule_name(o.regra_id) nome,o.competencia::text,o.vencimento_nominal::text,o.vencimento_ajustado::text,o.estado,o.motivo,o.dependencias_pendentes,o.prioridade,o.versao from app.obligation_occurrence o join app.empresa e on e.id=o.empresa_id where ${where} order by o.vencimento_ajustado nulls last,o.prioridade desc,o.codigo,o.empresa_id limit $8 offset $9`, [...params, filtro.limite, filtro.deslocamento]);
  return { total: Number(total.rows[0]?.total ?? 0), ocorrencias: rows.map((r) => ({ id: String(r['id']), empresaId: String(r['empresa_id']), empresaNome: String(r['empresa_nome']), cnpj: String(r['cnpj']), codigo: String(r['codigo']), nome: String(r['nome']), competencia: String(r['competencia']).slice(0,10), vencimentoNominal: r['vencimento_nominal'] as string | null, vencimentoAjustado: r['vencimento_ajustado'] as string | null, estado: r['estado'] as EstadoDaObrigacao, motivo: r['motivo'] as string | null, dependenciasPendentes: r['dependencias_pendentes'] as string[], prioridade: String(r['prioridade']), versao: Number(r['versao']) })) };
};

export const obterOcorrencia = async (cliente: PoolClient, tenantId: string, id: string): Promise<OcorrenciaPersistida | null> => {
  const r = await cliente.query<Record<string, unknown>>(`select o.id,o.empresa_id,coalesce(e.nome_fantasia,e.razao_social,e.cnpj) empresa_nome,e.cnpj,o.codigo,app.obligation_rule_name(o.regra_id) nome,o.competencia::text,o.vencimento_nominal::text,o.vencimento_ajustado::text,o.estado,o.motivo,o.dependencias_pendentes,o.prioridade,o.versao from app.obligation_occurrence o join app.empresa e on e.id=o.empresa_id where o.tenant_id=$1 and o.id=$2`, [tenantId,id]);
  const row=r.rows[0]; if(!row) return null; return { id:String(row['id']), empresaId:String(row['empresa_id']), empresaNome:String(row['empresa_nome']), cnpj:String(row['cnpj']), codigo:String(row['codigo']), nome:String(row['nome']), competencia:String(row['competencia']).slice(0,10), vencimentoNominal:row['vencimento_nominal'] as string|null, vencimentoAjustado:row['vencimento_ajustado'] as string|null, estado:row['estado'] as EstadoDaObrigacao, motivo:row['motivo'] as string|null, dependenciasPendentes:row['dependencias_pendentes'] as string[], prioridade:String(row['prioridade']), versao:Number(row['versao']) };
};

export const listarEventosDaObrigacao = async (cliente: PoolClient, tenantId: string, occurrenceId: string) => {
  const r = await cliente.query('select id,sequencia,acao,estado_anterior,estado_novo,data_entrega::text,referencia_evidencia,motivo,autor_id,correlation_id,criado_em from app.obligation_event where tenant_id=$1 and occurrence_id=$2 order by sequencia', [tenantId,occurrenceId]); return r.rows;
};

export const registrarBaixaDaObrigacao = async (cliente: PoolClient, entrada: Readonly<{ tenantId:string; occurrenceId:string; versao:number; dataEntrega:string; referencia:string; autorId:string; correlationId:string }>): Promise<void> => {
  const r = await cliente.query<{ id:string; empresa_id:string; estado:string; versao:number }>('select id,empresa_id,estado,versao from app.obligation_occurrence where tenant_id=$1 and id=$2 for update',[entrada.tenantId,entrada.occurrenceId]); const o=r.rows[0];
  if(!o) throw new Error('OCORRENCIA_NAO_ENCONTRADA'); if(o.versao!==entrada.versao) throw new Error('VERSAO_DESATUALIZADA'); if(!['PENDENTE','BLOQUEADA_POR_DEPENDENCIA','VENCIDA'].includes(o.estado)) throw new Error('ESTADO_INVALIDO');
  const seq=await cliente.query<{ n:number }>('select coalesce(max(sequencia),0)+1 n from app.obligation_event where occurrence_id=$1',[o.id]);
  await cliente.query('update app.obligation_occurrence set estado=\'ENTREGUE\',versao=versao+1,atualizado_em=now() where id=$1',[o.id]);
  await cliente.query(`insert into app.obligation_event (tenant_id,empresa_id,occurrence_id,sequencia,acao,estado_anterior,estado_novo,data_entrega,referencia_evidencia,autor_id,correlation_id) values ($1,$2,$3,$4,'BAIXA_REGISTRADA',$5,'ENTREGUE',$6,$7,$8,$9)`,[entrada.tenantId,o.empresa_id,o.id,seq.rows[0]?.n,o.estado,entrada.dataEntrega,entrada.referencia,entrada.autorId,entrada.correlationId]);
  await cliente.query('update app.obligation_alert set ativo=false,encerrado_em=now(),atualizado_em=now() where occurrence_id=$1 and ativo=true',[o.id]);
};

export const registrarReaberturaDaObrigacao = async (cliente: PoolClient, entrada: Readonly<{ tenantId:string; occurrenceId:string; versao:number; motivo:string; autorId:string; correlationId:string }>): Promise<void> => {
  const r = await cliente.query<{ id:string; empresa_id:string; estado:string; versao:number; vencimento_ajustado:string|null }>('select id,empresa_id,estado,versao,vencimento_ajustado::text from app.obligation_occurrence where tenant_id=$1 and id=$2 for update',[entrada.tenantId,entrada.occurrenceId]); const o=r.rows[0];
  if(!o) throw new Error('OCORRENCIA_NAO_ENCONTRADA'); if(o.versao!==entrada.versao) throw new Error('VERSAO_DESATUALIZADA'); if(o.estado!=='ENTREGUE') throw new Error('ESTADO_INVALIDO');
  const seq=await cliente.query<{ n:number }>('select coalesce(max(sequencia),0)+1 n from app.obligation_event where occurrence_id=$1',[o.id]);
  await cliente.query('update app.obligation_occurrence set estado=\'PENDENTE\',versao=versao+1,atualizado_em=now() where id=$1',[o.id]);
  await cliente.query(`insert into app.obligation_event (tenant_id,empresa_id,occurrence_id,sequencia,acao,estado_anterior,estado_novo,motivo,autor_id,correlation_id) values ($1,$2,$3,$4,'REABERTA','ENTREGUE','PENDENTE',$5,$6,$7)`,[entrada.tenantId,o.empresa_id,o.id,seq.rows[0]?.n,entrada.motivo,entrada.autorId,entrada.correlationId]);
  await cliente.query(`update app.obligation_alert set ativo=true,encerrado_em=null,atualizado_em=now() where tenant_id=$1 and occurrence_id=$2`,[entrada.tenantId,o.id]);
};

export const listarAlertasDaObrigacao = async (cliente: PoolClient, tenantId: string, occurrenceId: string) => {
  const r=await cliente.query('select a.id,a.prioridade,a.dias_restantes,a.ativo,a.atualizado_em,coalesce(json_agg(json_build_object(\'usuarioId\',r.usuario_id,\'papel\',r.papel_snapshot)) filter(where r.id is not null),\'[]\') destinatarios,coalesce(json_agg(json_build_object(\'canal\',o.canal,\'estado\',o.estado,\'tentativas\',o.tentativas) ) filter(where o.id is not null),\'[]\') canais from app.obligation_alert a left join app.obligation_alert_recipient r on r.alert_id=a.id left join app.obligation_channel_outbox o on o.alert_id=a.id and o.usuario_id=r.usuario_id where a.tenant_id=$1 and a.occurrence_id=$2 group by a.id order by a.criado_em desc',[tenantId,occurrenceId]); return r.rows;
};
