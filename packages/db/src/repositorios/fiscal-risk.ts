import type { PoolClient } from 'pg';

export type ConfiguracaoDeRiscoFiscal = Readonly<{
  id: string; tenant_id: string; empresa_id: string; versao: number; limite_centavos: string;
  motivo: string; ator_id: string; criado_em: Date;
  fornecedores: readonly Readonly<{ id: string; cnpj: string; nome_exibicao: string; situacao: 'ATIVO' | 'ARQUIVADO'; motivo: string; ator_id: string; criado_em: Date }>[];
}>;

export type FornecedorDeRiscoInput = Readonly<{ cnpj: string; nomeExibicao: string; situacao?: 'ATIVO' | 'ARQUIVADO'; motivo: string }>;

export const listarInboxManifestacoes=async(client:PoolClient,input:Readonly<{tenantId:string;empresaId:string;filtros?:Readonly<{estado?:string;tipo?:string;confianca?:string;risco?:string;prazo?:string;emitente?:string;valor?:string;busca?:string;pagina?:number;ordenacao?:string}>}>)=>{
 const filtros=input.filtros??{};const pagina=Math.max(1,filtros.pagina??1);const where:string[]=[];const values:unknown[]=[input.tenantId,input.empresaId];const add=(sql:string,value:unknown)=>{values.push(value);where.push(sql.replace('?',`$${values.length}`));};
 if(filtros.tipo)add('a.tipo_manifestacao=?',filtros.tipo);
 if(filtros.confianca==='ALTA')where.push('a.faixa_confianca=\'PRONTA_PARA_REVISAO\'');else if(filtros.confianca==='MEDIA')where.push('a.faixa_confianca=\'ATENCAO\'');else if(filtros.confianca==='BAIXA')where.push('a.faixa_confianca in (\'INCONCLUSIVA\',\'ABSTER_SE\')');
 if(filtros.risco==='ALTO')where.push("coalesce((select bool_or(r->>'severidade'='alta') from jsonb_array_elements(a.riscos) r),false)");else if(filtros.risco==='NORMAL')where.push("not coalesce((select bool_or(r->>'severidade'='alta') from jsonb_array_elements(a.riscos) r),false)");
 if(filtros.prazo==='7')where.push('greatest(0,90-(current_date-d.emitido_em::date))<=7');else if(filtros.prazo==='30')where.push('greatest(0,90-(current_date-d.emitido_em::date))<=30');else if(filtros.prazo==='MAIS_30')where.push('greatest(0,90-(current_date-d.emitido_em::date))>30');
 if(filtros.emitente)add('d.emitente ilike ?',`%${filtros.emitente}%`);
 if(filtros.busca){values.push(`%${filtros.busca}%`,`%${filtros.busca}%`,`%${filtros.busca}%`);where.push(`(d.chave_acesso like $${values.length-2} or d.emitente ilike $${values.length-1} or exists(select 1 from app.fiscal_document_party pbusca where pbusca.document_id=d.id and pbusca.papel='EMITENTE' and pbusca.parser_version=d.parser_version and pbusca.identificador like $${values.length}))`);}
 if(filtros.valor==='ATE_1000')where.push('d.total<=1000');else if(filtros.valor==='1000_10000')where.push('d.total>1000 and d.total<=10000');else if(filtros.valor==='ACIMA_10000')where.push('d.total>10000');
 if(filtros.estado==='RESULTADO_INCERTO'||filtros.estado==='DLQ')add("exists(select 1 from app.fiscal_manifestation fm where fm.tenant_id=d.tenant_id and fm.empresa_id=d.empresa_id and fm.chave_acesso=d.chave_acesso and fm.estado=?)",filtros.estado);
 const offset=(pagina-1)*50;values.push(offset);const offsetParam=`$${values.length}`;
 const result=await client.query(`select d.id document_id,d.chave_acesso,d.emitido_em,d.emitente,d.total,
   a.id analysis_id,a.tipo_manifestacao,a.confianca,a.faixa_confianca,a.riscos,a.evidencias,a.lacunas,a.justificativa proposta,
   greatest(0,90-(current_date-d.emitido_em::date))::int dias_restantes,
   coalesce((select bool_or(r->>'severidade'='alta')::int from jsonb_array_elements(a.riscos) r),0) risco_alto
   from app.fiscal_document d join app.fiscal_document_party emitente on emitente.document_id=d.id and emitente.papel='EMITENTE' and emitente.parser_version=d.parser_version
   join lateral(select a.* from app.fiscal_risk_analysis a join app.fiscal_risk_execution x on x.id=a.execution_id and x.tenant_id=a.tenant_id and x.empresa_id=a.empresa_id
    where a.document_id=d.id and a.tenant_id=d.tenant_id and a.empresa_id=d.empresa_id and x.estado in ('CONCLUIDA','ABSTER_SE') order by a.criado_em desc,a.id desc limit 1)a on true
   join app.empresa e on e.id=d.empresa_id and e.tenant_id=d.tenant_id
   where d.tenant_id=$1 and d.empresa_id=$2 and d.especie='NFE_55' and d.modelo='55' and d.estado='PROCESSADO'
    and exists(select 1 from app.fiscal_document_party destinatario where destinatario.document_id=d.id and destinatario.papel='DESTINATARIO' and destinatario.parser_version=d.parser_version and destinatario.identificador=e.cnpj) and d.emitido_em::date>=current_date-90 and not exists(select 1 from app.fiscal_document_event ev where ev.tenant_id=d.tenant_id and ev.empresa_id=d.empresa_id and ev.document_id=d.id and ev.tipo in ('CONFLITO','FALHA','XML_INVALIDO'))
    and a.tipo_manifestacao in ('210200','210220','210240')
    and ${filtros.estado==='RESULTADO_INCERTO'||filtros.estado==='DLQ'?'true':`not exists(select 1 from app.fiscal_manifestation m where m.tenant_id=d.tenant_id and m.empresa_id=d.empresa_id and m.chave_acesso=d.chave_acesso and m.estado not in ('REJEITADA_PELO_HUMANO','REJEITADA_SEFAZ'))`}
    and not exists(select 1 from app.fiscal_acknowledgement ack where ack.tenant_id=d.tenant_id and ack.empresa_id=d.empresa_id and ack.chave_acesso=d.chave_acesso and ack.estado in ('JA_MANIFESTADO','CIENCIA_REGISTRADA'))
    ${where.length?`and ${where.join(' and ')}`:''}
   order by ${filtros.ordenacao==='RISCO'?'risco_alto desc,dias_restantes asc,d.total desc,d.chave_acesso':filtros.ordenacao==='VALOR'?'d.total desc,dias_restantes asc,risco_alto desc,d.chave_acesso':'dias_restantes asc,risco_alto desc,d.total desc,d.chave_acesso'} offset ${offsetParam} limit 50`,values);
 return result.rows;
};

export const registrarDecisaoManifestacao=async(client:PoolClient,input:Readonly<{tenantId:string;empresaId:string;documentId:string;analysisId:string;chaveAcesso:string;tipo:string;tipoOriginal:string;justificativa:string|null;motivoTroca:string|null;aprovadorId:string;payload:unknown;payloadSha256:string;chaveIdempotente:string;correlationId:string}> )=>{
 const locked=await client.query(`select d.id from app.fiscal_document d join app.fiscal_risk_analysis a on a.document_id=d.id and a.id=$4 and a.tenant_id=d.tenant_id and a.empresa_id=d.empresa_id join app.fiscal_risk_execution x on x.id=a.execution_id and x.tenant_id=a.tenant_id and x.empresa_id=a.empresa_id and x.estado in ('CONCLUIDA','ABSTER_SE') join app.empresa e on e.id=d.empresa_id and e.tenant_id=d.tenant_id join app.fiscal_document_party p on p.document_id=d.id and p.papel='DESTINATARIO' and p.parser_version=d.parser_version and p.identificador=e.cnpj where d.id=$3 and d.tenant_id=$1 and d.empresa_id=$2 and d.especie='NFE_55' and d.modelo='55' and d.estado='PROCESSADO' and d.chave_acesso=$5 and d.emitido_em::date>=current_date-90 and a.id=(select a2.id from app.fiscal_risk_analysis a2 where a2.tenant_id=d.tenant_id and a2.empresa_id=d.empresa_id and a2.document_id=d.id order by a2.criado_em desc,a2.id desc limit 1) and a.tipo_manifestacao in ('210200','210220','210240') and not exists(select 1 from app.fiscal_document_event ev where ev.tenant_id=d.tenant_id and ev.empresa_id=d.empresa_id and ev.document_id=d.id and ev.tipo in ('CONFLITO','FALHA','XML_INVALIDO')) and not exists(select 1 from app.fiscal_manifestation m where m.tenant_id=d.tenant_id and m.empresa_id=d.empresa_id and m.chave_acesso=d.chave_acesso and m.estado not in ('REJEITADA_PELO_HUMANO','REJEITADA_SEFAZ')) and not exists(select 1 from app.fiscal_acknowledgement ack where ack.tenant_id=d.tenant_id and ack.empresa_id=d.empresa_id and ack.chave_acesso=d.chave_acesso and ack.estado in ('JA_MANIFESTADO','CIENCIA_REGISTRADA')) for update of d`,[input.tenantId,input.empresaId,input.documentId,input.analysisId,input.chaveAcesso]);
 if(!locked.rows[0]) throw new Error('FISCAL_MANIFESTATION_CONFLICT');
 const result=await client.query(`insert into app.fiscal_manifestation(tenant_id,empresa_id,document_id,analysis_id,chave_acesso,tipo,estado,justificativa,motivo_troca,decisao_original,aprovador_id,payload,payload_sha256,chave_idempotente,correlation_id)
 values($1,$2,$3,$4,$5,$6,'APROVADA',$7,$8,$9,$10,$11::jsonb,$12,$13,$14) on conflict(tenant_id,empresa_id,chave_acesso,tipo,sequencia) where estado NOT IN ('REJEITADA_PELO_HUMANO','REJEITADA_SEFAZ') do nothing returning id`,[input.tenantId,input.empresaId,input.documentId,input.analysisId,input.chaveAcesso,input.tipo,input.justificativa,input.motivoTroca,input.tipoOriginal,input.aprovadorId,JSON.stringify(input.payload),input.payloadSha256,input.chaveIdempotente,input.correlationId]);
 let id=result.rows[0]?.id as string|undefined;let reused=false;
 if(!id){const existing=await client.query(`select id,payload_sha256 from app.fiscal_manifestation where tenant_id=$1 and empresa_id=$2 and chave_idempotente=$3`,[input.tenantId,input.empresaId,input.chaveIdempotente]);
  if(existing.rows[0]?.payload_sha256!==input.payloadSha256)throw new Error('FISCAL_MANIFESTATION_DUPLICATE');id=existing.rows[0]?.id as string|undefined;reused=true;}
 if(!id)throw new Error('FISCAL_MANIFESTATION_DUPLICATE');
 await client.query(`insert into app.fiscal_manifestation_outbox(tenant_id,empresa_id,manifestation_id) values($1,$2,$3) on conflict(manifestation_id) do nothing`,[input.tenantId,input.empresaId,id]);
 if(!reused)await client.query(`insert into app.fiscal_manifestation_event(tenant_id,empresa_id,manifestation_id,estado,detalhe_sanitizado,correlation_id) values($1,$2,$3,'APROVADA','Aprovação humana registrada; payload fiscal selado.',$4)`,[input.tenantId,input.empresaId,id,input.correlationId]);
 return {id,reused};
};

/** Snapshot completo por versão: nenhuma configuração publicada é editada ou apagada. */
export const obterConfiguracaoDeRiscoFiscal = async (client: PoolClient, empresaId: string, tenantId: string) => {
  const result = await client.query<ConfiguracaoDeRiscoFiscal>(
    `select c.*, coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cnpj',s.cnpj,'nome_exibicao',s.nome_exibicao,
       'situacao',s.situacao,'motivo',s.motivo,'ator_id',s.ator_id,'criado_em',s.criado_em)
       order by s.nome_exibicao,s.id) filter(where s.id is not null),'[]'::jsonb) fornecedores
       from app.fiscal_risk_configuration c left join app.fiscal_risk_supplier s
         on s.configuration_id=c.id and s.empresa_id=c.empresa_id and s.tenant_id=c.tenant_id
      where c.empresa_id=$1 and c.tenant_id=$2 group by c.id order by c.versao desc limit 1`, [empresaId,tenantId]);
  return result.rows[0] ?? null;
};

export const listarHistoricoDeConfiguracoesDeRiscoFiscal=async(client:PoolClient,empresaId:string,tenantId:string)=>{
  const result=await client.query<ConfiguracaoDeRiscoFiscal>(
    `select c.*,coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cnpj',s.cnpj,'nome_exibicao',s.nome_exibicao,
      'situacao',s.situacao,'motivo',s.motivo,'ator_id',s.ator_id,'criado_em',s.criado_em)
      order by s.nome_exibicao,s.id) filter(where s.id is not null),'[]'::jsonb) fornecedores
      from app.fiscal_risk_configuration c left join app.fiscal_risk_supplier s
        on s.configuration_id=c.id and s.empresa_id=c.empresa_id and s.tenant_id=c.tenant_id
     where c.empresa_id=$1 and c.tenant_id=$2 group by c.id order by c.versao desc`,[empresaId,tenantId]);
  return result.rows;
};

export const publicarConfiguracaoDeRiscoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; limiteCentavos: string; motivo: string; atorId: string;
  fornecedores: readonly FornecedorDeRiscoInput[];
}>): Promise<ConfiguracaoDeRiscoFiscal> => {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`fiscal-risk:${input.tenantId}:${input.empresaId}`]);
  const current = await client.query<{ versao: number }>(
    `select versao from app.fiscal_risk_configuration where tenant_id=$1 and empresa_id=$2 order by versao desc limit 1 for update`, [input.tenantId,input.empresaId]);
  const version = (current.rows[0]?.versao ?? 0) + 1;
  const inserted = await client.query<ConfiguracaoDeRiscoFiscal>(
    `insert into app.fiscal_risk_configuration(tenant_id,empresa_id,versao,limite_centavos,motivo,ator_id)
     values($1,$2,$3,$4,$5,$6) returning *`, [input.tenantId,input.empresaId,version,input.limiteCentavos,input.motivo,input.atorId]);
  const configuration = inserted.rows[0];
  if (!configuration) throw new Error('FISCAL_RISK_CONFIGURATION_INVALID');
  for (const supplier of input.fornecedores) {
    await client.query(
      `insert into app.fiscal_risk_supplier(tenant_id,empresa_id,configuration_id,cnpj,nome_exibicao,situacao,motivo,ator_id)
       values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.tenantId,input.empresaId,configuration.id,supplier.cnpj,supplier.nomeExibicao,supplier.situacao ?? 'ATIVO',supplier.motivo,input.atorId]);
  }
  const suppliers = await client.query<NonNullable<ConfiguracaoDeRiscoFiscal['fornecedores']>[number]>(
    `select id,cnpj,nome_exibicao,situacao,motivo,ator_id,criado_em from app.fiscal_risk_supplier
      where configuration_id=$1 and empresa_id=$2 and tenant_id=$3 order by nome_exibicao,id`, [configuration.id,input.empresaId,input.tenantId]);
  return { ...configuration, fornecedores: suppliers.rows };
};

export const obterDocumentoParaRiscoFiscal = async (client: PoolClient, input: Readonly<{ tenantId: string; empresaId: string; documentId: string }>) => {
  const result = await client.query(
    `select d.id,d.tenant_id,d.empresa_id,d.especie,d.modelo,d.chave_acesso,d.hash_sha256,d.original_key,d.tamanho_bytes,
       d.emitido_em,d.emitente,d.destinatario,d.total,d.parser_version,d.estado,d.primary_staging_id,
       o.staging_id,o.cnpj as cnpj_origem,o.nsu,o.capturado_em,(s.conteudo_bruto is not null) original_staging_presente,
       exists(select 1 from app.fiscal_acknowledgement a where a.tenant_id=d.tenant_id and a.empresa_id=d.empresa_id
         and a.chave_acesso=d.chave_acesso and a.estado in ('JA_MANIFESTADO','CIENCIA_REGISTRADA')) ja_manifestado,
       exists(select 1 from app.fiscal_document_event e where e.tenant_id=d.tenant_id and e.empresa_id=d.empresa_id
         and e.document_id=d.id and e.tipo in ('CONFLITO','FALHA','XML_INVALIDO')) inconsistencia_aberta,
       coalesce((select jsonb_agg(jsonb_build_object('numero',i.numero,'codigo',i.codigo,'descricao',i.descricao,'quantidade',i.quantidade,
         'unidade',i.unidade,'valor',i.valor,'ibs',i.ibs,'cbs',i.cbs) order by i.numero)
         from app.fiscal_document_item i where i.document_id=d.id and i.parser_version=d.parser_version),'[]'::jsonb) itens
       from app.fiscal_document d join app.fiscal_document_origin o on o.document_id=d.id and o.empresa_id=d.empresa_id and o.tenant_id=d.tenant_id
       join app.dfe_capture_staging s on s.id=o.staging_id and s.empresa_id=o.empresa_id and s.tenant_id=o.tenant_id
      where d.id=$1 and d.empresa_id=$2 and d.tenant_id=$3 order by o.capturado_em limit 1`,
    [input.documentId,input.empresaId,input.tenantId]);
  return result.rows[0] ?? null;
};

/** Apenas worker: lê bytes do staging sob escopo técnico para verificar o hash F18 antes de analisar. */
export const obterOriginalDeRiscoFiscal = async(client:PoolClient,input:Readonly<{tenantId:string;empresaId:string;stagingId:string}>)=>{
  const result=await client.query<{conteudo_bruto:Buffer}>(
    `select conteudo_bruto from app.dfe_capture_staging where id=$1 and tenant_id=$2 and empresa_id=$3`,
    [input.stagingId,input.tenantId,input.empresaId]);
  return result.rows[0]?.conteudo_bruto??null;
};

export const obterHistoricoDeComprasParaRiscoFiscal=async(client:PoolClient,input:Readonly<{tenantId:string;empresaId:string;cnpjEmitente:string;dataEmissao:string;documentId:string}>)=>{
  const result=await client.query<{quantidade:number;primeira_emissao:string|null;ultima_emissao:string|null;total_centavos:string|null;menor_valor:string|null;maior_valor:string|null}>(
    `select count(distinct d.id)::int quantidade,min(d.emitido_em)::text primeira_emissao,max(d.emitido_em)::text ultima_emissao,
       coalesce(sum(round(d.total*100))::text,'0') total_centavos,min(d.total)::text menor_valor,max(d.total)::text maior_valor
       from app.fiscal_document d join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id
      where d.tenant_id=$1 and d.empresa_id=$2 and d.id<>$5 and d.especie='NFE_55' and d.modelo='55' and d.estado='PROCESSADO'
        and d.emitido_em>=($4::date-interval '12 months')::date and d.emitido_em<$4::date and p.papel='EMITENTE' and p.identificador=$3
        and not exists(select 1 from app.fiscal_document_event e where e.document_id=d.id and e.tenant_id=d.tenant_id
          and e.empresa_id=d.empresa_id and e.tipo in ('CONFLITO','FALHA','XML_INVALIDO'))`,
    [input.tenantId,input.empresaId,input.cnpjEmitente,input.dataEmissao,input.documentId]);
  return result.rows[0]??null;
};

export const criarExecucaoDeRiscoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; documentId: string; configurationId: string; parserVersion: string;
  classifierVersion: string; correlationId: string; actorId: string; reprocessamentoDe?: string | null;
}> ) => {
  const result = await client.query(
    `insert into app.fiscal_risk_execution(tenant_id,empresa_id,document_id,configuration_id,parser_version,classifier_version,estado,correlation_id,ator_id,reprocessamento_de)
     values($1,$2,$3,$4,$5,$6,'AGUARDANDO',$7,$8,$9)
     on conflict(tenant_id,empresa_id,document_id,parser_version,classifier_version,configuration_id) do nothing returning *`,
    [input.tenantId,input.empresaId,input.documentId,input.configurationId,input.parserVersion,input.classifierVersion,input.correlationId,input.actorId,input.reprocessamentoDe ?? null]);
  if (result.rows[0]) return result.rows[0];
  const existing = await client.query(
    `select * from app.fiscal_risk_execution where tenant_id=$1 and empresa_id=$2 and document_id=$3
       and parser_version=$4 and classifier_version=$5 and configuration_id=$6`,
    [input.tenantId,input.empresaId,input.documentId,input.parserVersion,input.classifierVersion,input.configurationId]);
  return existing.rows[0] ?? null;
};

export const obterExecucoesDeRiscoFiscal = async (client: PoolClient, input: Readonly<{ tenantId: string; empresaId: string; documentId: string }>) => {
  const result = await client.query(
    `select x.id,x.estado,x.tentativas,x.codigo_erro,x.parser_version,x.classifier_version,x.configuration_id,
       x.correlation_id,x.solicitado_em,x.atualizado_em,
       a.id as analysis_id,a.tipo_manifestacao,a.confianca,a.faixa_confianca,a.justificativa,a.riscos,a.evidencias,a.lacunas,
       a.origem,a.provedor,a.modelo,a.versao_prompt,a.versao_schema,a.fallback,a.tokens_entrada,a.tokens_saida,
       a.custo_microusd,a.duracao_ms,a.criado_em as analisado_em
       from app.fiscal_risk_execution x left join app.fiscal_risk_analysis a on a.execution_id=x.id
      where x.tenant_id=$1 and x.empresa_id=$2 and x.document_id=$3 order by x.solicitado_em desc,x.id`,
    [input.tenantId,input.empresaId,input.documentId]);
  return result.rows;
};

export const obterAnaliseDeRiscoFiscal = async (client: PoolClient, input: Readonly<{ tenantId: string; empresaId: string; documentId: string; analysisId: string }>) => {
  const result = await client.query(
    `select a.*,x.estado,x.tentativas,x.codigo_erro,x.solicitado_em,x.atualizado_em,
       coalesce((select jsonb_agg(jsonb_build_object('numero',t.numero,'etapa',t.etapa,'resultado',t.resultado,
         'provedor',t.provedor,'modelo',t.modelo,'codigo_erro',t.codigo_erro,'tokens_entrada',t.tokens_entrada,
         'tokens_saida',t.tokens_saida,'custo_microusd',t.custo_microusd,'duracao_ms',t.duracao_ms,
         'iniciado_em',t.iniciado_em,'finalizado_em',t.finalizado_em) order by t.numero)
         from app.fiscal_risk_attempt t where t.execution_id=x.id and t.tenant_id=x.tenant_id and t.empresa_id=x.empresa_id),'[]'::jsonb) tentativas_detalhe,
       coalesce((select jsonb_agg(jsonb_build_object('estado',e.estado,'codigo',e.codigo,'detalhe_sanitizado',e.detalhe_sanitizado,
         'ocorrido_em',e.ocorrido_em,'sequencia',e.sequencia) order by e.ocorrido_em,e.sequencia)
         from app.fiscal_risk_event e where e.execution_id=x.id and e.tenant_id=x.tenant_id and e.empresa_id=x.empresa_id),'[]'::jsonb) historico
       from app.fiscal_risk_analysis a join app.fiscal_risk_execution x on x.id=a.execution_id and x.tenant_id=a.tenant_id and x.empresa_id=a.empresa_id
      where a.id=$1 and a.document_id=$2 and a.empresa_id=$3 and a.tenant_id=$4`,
    [input.analysisId,input.documentId,input.empresaId,input.tenantId]);
  return result.rows[0] ?? null;
};

export const registrarEventoDeRiscoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; executionId: string; state: string; code: string | null; detail: string | null; correlationId: string;
}>) => {
  await client.query(
    `insert into app.fiscal_risk_event(tenant_id,empresa_id,execution_id,estado,codigo,detalhe_sanitizado,correlation_id)
     values($1,$2,$3,$4,$5,$6,$7)`, [input.tenantId,input.empresaId,input.executionId,input.state,input.code,input.detail?.slice(0,256) ?? null,input.correlationId]);
};

export const atualizarEstadoDeRiscoFiscal = async (client:PoolClient,input:Readonly<{
  tenantId:string;empresaId:string;executionId:string;state:'INELEGIVEL'|'DLQ'|'FALHA';code:string;correlationId:string;
}>)=>{
  await client.query(`update app.fiscal_risk_execution set estado=$1,codigo_erro=$2,atualizado_em=now() where id=$3 and tenant_id=$4 and empresa_id=$5`,
    [input.state,input.code,input.executionId,input.tenantId,input.empresaId]);
  await registrarEventoDeRiscoFiscal(client,{tenantId:input.tenantId,empresaId:input.empresaId,executionId:input.executionId,
    state:input.state,code:input.code,detail:null,correlationId:input.correlationId});
};

export const iniciarTentativaDeRiscoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; executionId: string; etapa: 'DETERMINISTICA' | 'LLM' | 'FALLBACK'; correlationId: string; iniciadoEm: Date;
}>) => {
  const locked = await client.query<{ estado: string; tentativas: number }>(
    `select estado,tentativas from app.fiscal_risk_execution where id=$1 and tenant_id=$2 and empresa_id=$3 for update`,
    [input.executionId,input.tenantId,input.empresaId]);
  const execution = locked.rows[0];
  if (!execution || !['AGUARDANDO','PROCESSANDO'].includes(execution.estado) || execution.tentativas >= 3) return null;
  const number = execution.tentativas + 1;
  await client.query(`update app.fiscal_risk_execution set estado='PROCESSANDO',tentativas=$1,atualizado_em=now() where id=$2`,[number,input.executionId]);
  const result = await client.query(
    `insert into app.fiscal_risk_attempt(tenant_id,empresa_id,execution_id,numero,etapa,resultado,correlation_id,iniciado_em)
     values($1,$2,$3,$4,$5,'FALHA',$6,$7) returning id,numero`,
    [input.tenantId,input.empresaId,input.executionId,number,input.etapa,input.correlationId,input.iniciadoEm]);
  return result.rows[0] ?? null;
};

export const finalizarTentativaDeRiscoFiscal = async (client: PoolClient, input: Readonly<{
  tenantId: string; empresaId: string; executionId: string; attemptId: string;
  result: 'SUCESSO' | 'TIMEOUT' | 'INDISPONIVEL' | 'SAIDA_INVALIDA' | 'CONFLITO' | 'FALHA';
  provider?: string | null; model?: string | null; errorCode?: string | null; tokensIn?: number | null; tokensOut?: number | null;
  costMicroUsd?: string | null; durationMs: number; correlationId: string; proposal?: Readonly<{
    tipo: string; confidence: string; band: string; justification: string; risks: unknown; evidence: unknown; gaps: unknown;
    origin: string; provider?: string | null; model?: string | null; promptVersion?: string | null; schemaVersion: string;
    fallback: boolean; tokensIn?: number | null; tokensOut?: number | null; costMicroUsd?: string | null;
  }>;
}> ) => {
  await client.query(
    `update app.fiscal_risk_attempt set resultado=$1,provedor=$2,modelo=$3,codigo_erro=$4,tokens_entrada=$5,tokens_saida=$6,
       custo_microusd=$7,duracao_ms=$8,finalizado_em=now() where id=$9 and execution_id=$10 and tenant_id=$11 and empresa_id=$12`,
    [input.result,input.provider ?? null,input.model ?? null,input.errorCode ?? null,input.tokensIn ?? null,input.tokensOut ?? null,
      input.costMicroUsd ?? null,input.durationMs,input.attemptId,input.executionId,input.tenantId,input.empresaId]);
  if (input.proposal) {
    await client.query(
      `insert into app.fiscal_risk_analysis(tenant_id,empresa_id,execution_id,document_id,configuration_id,parser_version,classifier_version,
        tipo_manifestacao,confianca,faixa_confianca,justificativa,riscos,evidencias,lacunas,origem,provedor,modelo,versao_prompt,versao_schema,
        fallback,tokens_entrada,tokens_saida,custo_microusd,duracao_ms,correlation_id)
       select x.tenant_id,x.empresa_id,x.id,x.document_id,x.configuration_id,x.parser_version,x.classifier_version,
        $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
       from app.fiscal_risk_execution x where x.id=$19 and x.tenant_id=$20 and x.empresa_id=$21
       on conflict(execution_id) do nothing`,
      [input.proposal.tipo,input.proposal.confidence,input.proposal.band,input.proposal.justification,
        JSON.stringify(input.proposal.risks),JSON.stringify(input.proposal.evidence),JSON.stringify(input.proposal.gaps),input.proposal.origin,
        input.proposal.provider ?? null,input.proposal.model ?? null,input.proposal.promptVersion ?? null,input.proposal.schemaVersion,
        input.proposal.fallback,input.proposal.tokensIn ?? null,input.proposal.tokensOut ?? null,input.proposal.costMicroUsd ?? null,
        input.durationMs,input.correlationId,input.executionId,input.tenantId,input.empresaId]);
    await client.query(`update app.fiscal_risk_execution set estado=$1,codigo_erro=null,atualizado_em=now() where id=$2 and tenant_id=$3 and empresa_id=$4`,
      [input.proposal.tipo === 'ABSTER_SE' ? 'ABSTER_SE' : 'CONCLUIDA',input.executionId,input.tenantId,input.empresaId]);
    return;
  }
  const finalState=input.result==='CONFLITO'?'ABSTER_SE':'PROCESSANDO';
  if(input.result==='CONFLITO'){
    await client.query(
      `insert into app.fiscal_risk_analysis(tenant_id,empresa_id,execution_id,document_id,configuration_id,parser_version,classifier_version,
        tipo_manifestacao,confianca,faixa_confianca,justificativa,riscos,evidencias,lacunas,origem,versao_schema,fallback,duracao_ms,correlation_id)
       select x.tenant_id,x.empresa_id,x.id,x.document_id,x.configuration_id,x.parser_version,x.classifier_version,
        'ABSTER_SE',0,'ABSTER_SE','Regras e resultado automatizado entraram em conflito; análise suspensa.',
        '[]'::jsonb,'[]'::jsonb,jsonb_build_array($1),'ABSTENCAO','f20-risk-v1',true,$2,$3
       from app.fiscal_risk_execution x where x.id=$4 and x.tenant_id=$5 and x.empresa_id=$6 on conflict(execution_id) do nothing`,
      [input.errorCode??'CONFLICT',input.durationMs,input.correlationId,input.executionId,input.tenantId,input.empresaId]);
  }
  await client.query(`update app.fiscal_risk_execution set estado=$1,codigo_erro=$2,atualizado_em=now() where id=$3 and tenant_id=$4 and empresa_id=$5`,
    [finalState,input.errorCode ?? input.result,input.executionId,input.tenantId,input.empresaId]);
};
