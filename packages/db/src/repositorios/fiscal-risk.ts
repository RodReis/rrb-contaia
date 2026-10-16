import type { PoolClient } from 'pg';

export type ConfiguracaoDeRiscoFiscal = Readonly<{
  id: string; tenant_id: string; empresa_id: string; versao: number; limite_centavos: string;
  motivo: string; ator_id: string; criado_em: Date;
  fornecedores: readonly Readonly<{ id: string; cnpj: string; nome_exibicao: string; situacao: 'ATIVO' | 'ARQUIVADO'; motivo: string; ator_id: string; criado_em: Date }>[];
}>;

export type FornecedorDeRiscoInput = Readonly<{ cnpj: string; nomeExibicao: string; situacao?: 'ATIVO' | 'ARQUIVADO'; motivo: string }>;

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
