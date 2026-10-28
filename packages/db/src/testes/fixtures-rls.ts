/**
 * Uma fixture por tabela do schema `app`, para a matriz de RLS (SPEC-010 §9).
 *
 * `preparar` cria as dependências (pais) pelo papel administrativo; `inserir`
 * é UMA instrução sobre a tabela sob prova. A mesma `inserir` roda como semeador
 * (para ter a linha-alvo) e como papel da aplicação, em contexto errado: assim a
 * negação observada é a da RLS na própria tabela, e não de um pai ausente.
 *
 * Tabela nova precisa de fixture aqui — sem ela o teste de cobertura reprova.
 */
import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

export type Consultavel = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type Escopo = Readonly<{
  tenantId: string;
  empresaId: string;
  /** Usuário do tenant, para colunas de autoria. */
  autorId: string;
  sufixo: string;
}>;

export type Referencias = Readonly<Record<string, string>>;

export type FixtureDeTabela = Readonly<{
  preparar?: (admin: Consultavel, escopo: Escopo) => Promise<Referencias>;
  inserir: (banco: Consultavel, escopo: Escopo, referencias: Referencias) => Promise<string>;
  /** Coluna do UPDATE sem efeito (`set c = c`). Padrão: `id`. */
  colunaDeLeitura?: string;
  colunaDeChave?: string;
  colunaDeAtualizacao?: string;
  /** UPDATE que a própria tabela aceita, quando `set c = c` não serve (ex.: só arquivar). */
  atualizacao?: string;
}>;

let contador = 0;
const proximo = (): number => {
  contador += 1;

  return contador;
};

const unico = async (banco: Consultavel, sql: string, parametros: unknown[]): Promise<string> => {
  const { rows } = await banco.query<{ id: string }>(sql, parametros);
  const linha = rows[0];

  if (linha === undefined) {
    throw new Error(`a fixture não devolveu id: ${sql}`);
  }

  return linha.id;
};

const regraObrigacao = async (admin: Consultavel): Promise<Readonly<{ id: string; codigo: string; versao: number }>> => {
  const { rows } = await admin.query<{ id: string; codigo: string; versao: number }>(
    `select id,codigo,versao from app.obligation_rule where codigo='DAS_SIMPLES' and estado='PUBLICADA' limit 1`,
  );
  const regra = rows[0];
  if (!regra) throw new Error('regra global da fixture F22 ausente');
  return regra;
};

const prepararRegraObrigacao = async (admin: Consultavel): Promise<Referencias> => {
  const regra = await regraObrigacao(admin);
  const competencia = `2098-${String((proximo() % 12) + 1).padStart(2,'0')}-01`;
  return { ruleId: regra.id, codigo: regra.codigo, versao: String(regra.versao + proximo()), competencia };
};

const prepararDossieF35 = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const sourcePackageId = await unico(admin, `insert into app.tax_st_history_package
    (tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
    values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,repeat(md5($4||'s'),2),repeat(md5($4||'c'),2),'READY_FOR_INTERNAL_REVIEW','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f35-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${randomUUID()}`]);
  await admin.query(`insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id)
    values($1,$2,$3,'APPROVED',$4,now(),'f35-rls-fixture')`,[e.tenantId,e.empresaId,sourcePackageId,e.autorId]);
  const accrualResultId = await unico(admin, `insert into app.tax_st_legal_accrual_result
    (tenant_id,empresa_id,source_package_id,reference_date,contract_version,idempotency_sha256,canonical_json,content_sha256,status,requested_by,generated_at,correlation_id)
    values($1,$2,$3,'2017-01-31',1,repeat(md5($4),2),'{}'::jsonb,repeat(md5($4||'content'),2),'INDETERMINATE',$5,now(),'f35-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,sourcePackageId,`${e.sufixo}/${randomUUID()}`,e.autorId]);
  const dossierId = await unico(admin, `insert into app.tax_st_internal_decision_dossier
    (tenant_id,empresa_id,source_package_id,accrual_result_id,revision,idempotency_sha256,content_sha256,canonical_json,status,prepared_by,generated_at,correlation_id)
    values($1,$2,$3,$4,1,repeat(md5($5),2),repeat(md5($5||'content'),2),'{}'::jsonb,'BLOCKED_INDETERMINATE',$6,now(),'f35-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,sourcePackageId,accrualResultId,`${e.sufixo}/${randomUUID()}`,e.autorId]);
  return { sourcePackageId, accrualResultId, dossierId };
};

const prepararApuracaoMensalF37 = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const marker = `${e.sufixo}-${proximo()}`;
  const packageId = await unico(admin, `insert into app.tax_monthly_rule_package
    (tenant_id,empresa_id,kind,version,valid_from,valid_through,consulted_at,official_basis,source_url,source_storage_key,
      source_sha256,content_sha256,canonical_json,requested_by,created_at)
    values($1,$2,'LUCRO_PRESUMIDO_PIS_COFINS',$3,'2026-01-01',null,'2026-01-01','Fixture RLS F37',
      'https://example.invalid/f37','fixture/f37/'||$3,repeat(md5($3||'s'),2),repeat(md5($3||'c'),2),'{}'::jsonb,$4,now()) returning id`,
  [e.tenantId,e.empresaId,`f37-${marker}`,e.autorId]);
  const declarationId = await unico(admin, `insert into app.tax_monthly_declaration
    (tenant_id,empresa_id,competence,kind,revision,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at,correlation_id)
    values($1,$2,'2026-01-01','LUCRO_PRESUMIDO_PIS_COFINS',$3,repeat(md5($4||'d'),2),repeat(md5($4||'h'),2),
      '{}'::jsonb,$5,now(),'f37-rls-fixture') returning id`, [e.tenantId,e.empresaId,proximo(),marker,e.autorId]);
  return { packageId, declarationId, marker };
};

const prepararApuracaoCorporativaF38 = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const marker = `f38-${e.sufixo}-${proximo()}-${randomUUID()}`;
  const packageId = await unico(admin, `insert into app.corporate_tax_rule_package
    (tenant_id,empresa_id,version,valid_from,valid_through,consulted_at,official_basis,source_url,source_storage_key,source_sha256,content_sha256,canonical_json,requested_by,created_at)
    values($1,$2,$3,'2026-01-01','2026-12-31','2026-01-01','Fixture RLS F38','https://example.invalid/f38',$4,repeat(md5($5||'s'),2),repeat(md5($5||'c'),2),'{}'::jsonb,$6,now()) returning id`,
  [e.tenantId,e.empresaId,`package-${marker}`,`fiscal/f38/${marker}`,marker,e.autorId]);
  const declarationId = await unico(admin, `insert into app.corporate_tax_declaration
    (tenant_id,empresa_id,quarter,recognition,revision,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at,correlation_id)
    values($1,$2,'2026-Q1','ACCRUAL',$3,repeat(md5($4||'d'),2),repeat(md5($4||'h'),2),'{}'::jsonb,$5,now(),'f38-rls-fixture') returning id`,
  [e.tenantId,e.empresaId,proximo(),marker,e.autorId]);
  const assessmentId = await unico(admin, `insert into app.corporate_tax_assessment
    (tenant_id,empresa_id,quarter,revision,status,recognition,package_id,declaration_id,installment_count,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at)
    values($1,$2,'2026-Q1',$3,'INDETERMINATE','ACCRUAL',$4,$5,1,repeat(md5($6||'a'),2),repeat(md5($6||'c'),2),'{}'::jsonb,$7,now()) returning id`,
  [e.tenantId,e.empresaId,proximo(),packageId,declarationId,marker,e.autorId]);
  return { packageId, declarationId, assessmentId, marker };
};

const prepararOcorrenciaObrigacao = async (admin: Consultavel,e: Escopo): Promise<Referencias> => {
  const regra = await prepararRegraObrigacao(admin);
  const occurrenceId = await unico(admin,
    `insert into app.obligation_occurrence(tenant_id,empresa_id,regra_id,codigo,competencia,versao_regra,estado)
     values($1,$2,$3,$4,$5::date,$6,'PENDENTE') returning id`,
    [e.tenantId,e.empresaId,regra['ruleId'],regra['codigo'],regra['competencia'],regra['versao']],
  );
  return { occurrenceId };
};

const prepararStagingFiscal = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const cnpj = String(proximo()).padStart(14, '0').slice(-14);
  const stateId = await unico(admin,
    `insert into app.dfe_capture_state(tenant_id,empresa_id,cnpj) values($1,$2,$3) returning id`, [e.tenantId,e.empresaId,cnpj]);
  const runId = await unico(admin,
    `insert into app.dfe_capture_run(tenant_id,empresa_id,estado_id,cnpj,origem,chave_idempotente,correlation_id,ult_nsu_entrada)
     values($1,$2,$3,$4,'MANUAL',$5,'fiscal-rls-fixture','0') returning id`,
    [e.tenantId,e.empresaId,stateId,cnpj,`fiscal-fixture-${proximo()}-${e.sufixo}`]);
  const stagingId = await unico(admin,
    `insert into app.dfe_capture_staging(tenant_id,empresa_id,run_id,cnpj,nsu,especie,conteudo_bruto,capturado_em,correlation_id)
     values($1,$2,$3,$4,'1','NFE_55',decode('3c78','hex'),now(),'fiscal-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,runId,cnpj]);
  return { stagingId, cnpj };
};

const prepararDocumentoFiscal = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const staging = await prepararStagingFiscal(admin,e);
  const documentId = await unico(admin,
    `insert into app.fiscal_document(tenant_id,empresa_id,primary_staging_id,especie,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,estado,parser_version)
     values($1,$2,$3,'NFE_55',repeat('a',64),$4,3,'55','4.00','PROCESSADO','fixture') returning id`,
    [e.tenantId,e.empresaId,staging['stagingId'],`fiscal/${e.sufixo}/${proximo()}.xml`]);
  return { ...staging, documentId };
};

const prepararCancelamentoTributario = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const documento = await prepararDocumentoFiscal(admin, e);
  const snapshotId=await unico(admin,
    `insert into app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence,revision,idempotency_key,input_sha256,status,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
     values($1,$2,'2017-01-01',$3,$4,repeat('c',64),'BLOCKED',0,0,'{}'::jsonb,$5,'f32-cancellation-fixture',now()) returning id`,
    [e.tenantId,e.empresaId,proximo(),randomUUID(),e.autorId]);
  await admin.query(`insert into app.tax_st_settlement_review_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
    values($1,$2,$3,'SUBMITTED',$4,'f32-cancellation-fixture',now(),'{}'::jsonb)`,[e.tenantId,e.empresaId,snapshotId,e.autorId]);
  const accessKey=String(proximo()).padStart(44,'1').slice(-44);
  const protocol='135260000000001';
  const eventHash='d'.repeat(64);
  const sourceBatchId=await unico(admin,`insert into app.nfce_import_batch(tenant_id,empresa_id,actor_id,correlation_id,origem,status,total) values($1,$2,$3,'f32-cancellation-fixture','ERP','COMPLETED',1) returning id`,[e.tenantId,e.empresaId,e.autorId]);
  const sourceItemId=await unico(admin,`insert into app.nfce_import_item(tenant_id,empresa_id,batch_id,nome_sanitizado,tamanho_bytes,hash_sha256,original_key,status,document_id,parser_version,schema_version,correlation_id)
    values($1,$2,$3,'cancelamento.xml',1,$4,$5,'IMPORTED',$6,'fixture','fixture','f32-cancellation-fixture') returning id`,
    [e.tenantId,e.empresaId,sourceBatchId,eventHash,`fiscal/${e.sufixo}/cancelamento.xml`,documento['documentId']]);
  const sourceId=await unico(admin,`insert into app.nfce_import_source(tenant_id,empresa_id,item_id,cnpj,origem,correlation_id)
    values($1,$2,$3,$4,'ERP','f32-cancellation-fixture') returning id`,[e.tenantId,e.empresaId,sourceItemId,documento['cnpj']]);
  await admin.query(`insert into app.nfce_import_event(tenant_id,empresa_id,item_id,source_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,tamanho_bytes,correlation_id)
    values($1,$2,$3,$4,$5,$6,'PRODUCAO','110111','1',$7,$8,$9,1,'f32-cancellation-fixture')`,
    [e.tenantId,e.empresaId,sourceItemId,sourceId,accessKey,documento['cnpj'],protocol,eventHash,`fiscal/${e.sufixo}/cancelamento.xml`]);
  await admin.query(`update app.fiscal_document set especie='NFCE_65',modelo='65',chave_acesso=$2,emitido_em='2017-01-01',estado='CANCELLED',cancelado_em='2017-02-01T12:00:00Z',protocolo_cancelamento=$3 where id=$1`,
    [documento['documentId'],accessKey,protocol]);
  const forgedEventId=await unico(admin,
    `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,nfce_source_id,tipo,codigo,parser_version,hash_sha256,ator_id,correlation_id)
     values($1,$2,$3,$4,'CANCELAMENTO','110111','fixture',repeat('e',64),$5,'f32-cancellation-invalid-fixture') returning id`,
    [e.tenantId,e.empresaId,documento['documentId'],sourceId,e.autorId]);
  const forged=await admin.query(`select 1 from app.tax_st_authorized_cancellation where source_event_id=$1`,[forgedEventId]);
  if(forged.rows.length)throw new Error('trigger F32 aceitou hash de evento diferente da origem validada');
  const sourceEventId = await unico(admin,
    `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,nfce_source_id,tipo,codigo,parser_version,hash_sha256,ator_id,correlation_id)
     values($1,$2,$3,$4,'CANCELAMENTO','110111','fixture',$5,$6,'f32-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,documento['documentId'],sourceId,eventHash,e.autorId]);
  const cancellation=await admin.query<{id:string}>(`select id from app.tax_st_authorized_cancellation where source_event_id=$1`,[sourceEventId]);
  const stale=await admin.query<{id:string}>(`select id from app.tax_st_settlement_event where snapshot_id=$1 and action='DOCUMENT_SET_CHANGED' and details->>'eventId'=$2`,[snapshotId,sourceEventId]);
  if(!cancellation.rows[0]||!stale.rows[0])throw new Error('trigger F32 não registrou cancelamento autorizado e invalidação da revisão');
  return { ...documento, sourceEventId, cancellationId:cancellation.rows[0].id };
};

const prepararDocumentoParaSnapshot = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const documento = await prepararDocumentoFiscal(admin,e);
  await admin.query(
    `insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,descricao)
     values($1,$2,$3,'fixture',1,'ITEM','Item da matriz')`,
    [e.tenantId,e.empresaId,documento['documentId']],
  );
  return documento;
};

const prepararSnapshotIcmsSt = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const documento = await prepararDocumentoFiscal(admin, e);
  const snapshotId = await unico(admin,
    `insert into app.tax_st_settlement_snapshot
       (tenant_id,empresa_id,competence,revision,idempotency_key,input_sha256,status,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
     values($1,$2,'2098-01-01',$3,$4,repeat('c',64),'BLOCKED',0,0,'{}'::jsonb,$5,'f29-rls-fixture',now()) returning id`,
    [e.tenantId,e.empresaId,proximo(),randomUUID(),e.autorId]);
  return { ...documento, snapshotId };
};

const prepararDevolucaoIcmsSt = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const base = await prepararSnapshotIcmsSt(admin, e);
  const lineId = await unico(admin,
    `insert into app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,facts,calculation,recovery_memory)
     values($1,$2,$3,$4,$5,'RESTITUTION','{}'::jsonb,'{}'::jsonb,'{}'::jsonb) returning id`,
    [e.tenantId,e.empresaId,base['snapshotId'],base['documentId'],`fixture:${e.sufixo}`]);
  return { ...base, lineId };
};

const inserirEventoDevolucaoIcmsSt = async (admin: Consultavel, e: Escopo, r: Referencias): Promise<string> => unico(admin,
  `insert into app.tax_st_return_event(tenant_id,empresa_id,original_snapshot_id,original_line_id,origin,return_document_identity,return_item_identity,event_date,idempotency_key,normalized_unit,returned_quantity_scaled,evidence_sha256,evidence_facts,actor_id,correlation_id,occurred_at)
   values($1,$2,$3,$4,'MANUAL_DOCUMENT',$5,$6,'2017-02-01',$7,'UN',1,repeat('f',64),'{"formulaVersion":"F32_FIXTURE","sourceIds":["fixture"]}'::jsonb,$8,'f32-rls-fixture',now()) returning id`,
  [e.tenantId,e.empresaId,r['snapshotId'],r['lineId'],`return-event-${randomUUID()}`,`item-event-${randomUUID()}`,randomUUID(),e.autorId]);

const prepararRevisaoDevolucaoIcmsSt = async (admin:Consultavel,e:Escopo,r:Referencias):Promise<Referencias> => {
  const eventId=await inserirEventoDevolucaoIcmsSt(admin,e,r);
  const reviewId=await unico(admin,`insert into app.tax_st_return_review_event(tenant_id,empresa_id,return_event_id,action,actor_id,occurred_at,correlation_id)
    values($1,$2,$3,'APPROVED',$4,now(),'f32-rls-fixture') returning id`,[e.tenantId,e.empresaId,eventId,e.autorId]);
  return {...r,eventId,reviewId};
};

const prepararConfiguracaoRiscoFiscal = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const configurationId = await unico(admin,
    `insert into app.fiscal_risk_configuration(tenant_id,empresa_id,versao,limite_centavos,motivo,ator_id)
     values($1,$2,$3,100000,'Configuração da matriz RLS',$4) returning id`,
    [e.tenantId,e.empresaId,proximo(),e.autorId]);
  return { configurationId };
};

const prepararExecucaoRiscoFiscal = async (admin: Consultavel, e: Escopo): Promise<Referencias> => {
  const configuration = await prepararConfiguracaoRiscoFiscal(admin,e);
  const document = await prepararDocumentoFiscal(admin,e);
  const executionId = await unico(admin,
    `insert into app.fiscal_risk_execution(tenant_id,empresa_id,document_id,configuration_id,parser_version,classifier_version,estado,correlation_id,ator_id)
     values($1,$2,$3,$4,'fixture','fixture','AGUARDANDO','fiscal-risk-rls-fixture',$5) returning id`,
    [e.tenantId,e.empresaId,document['documentId'],configuration['configurationId'],e.autorId]);
  return { ...configuration, ...document, executionId };
};

const prepararAnaliseParaManifestacao = async (admin: Consultavel,e: Escopo): Promise<Referencias> => {
  const execucao=await prepararExecucaoRiscoFiscal(admin,e);
  const analysisId=await unico(admin,
    `insert into app.fiscal_risk_analysis(tenant_id,empresa_id,execution_id,document_id,configuration_id,parser_version,classifier_version,tipo_manifestacao,confianca,faixa_confianca,justificativa,origem,versao_schema,duracao_ms,correlation_id)
     values($1,$2,$3,$4,$5,'fixture','fixture','210200',0.9,'PRONTA_PARA_REVISAO','Fixture para manifestação RLS','ABSTENCAO','fixture',0,$6) returning id`,
    [e.tenantId,e.empresaId,execucao['executionId'],execucao['documentId'],execucao['configurationId'],`fiscal-manifestation-${e.sufixo}-${proximo()}`]);
  return {...execucao,analysisId};
};

const exigencia = (admin: Consultavel, escopo: Escopo): Promise<string> =>
  unico(
    admin,
    `insert into app.empresa_exigencia_documental (tenant_id, empresa_id, nome)
     values ($1, $2, $3) returning id`,
    [escopo.tenantId, escopo.empresaId, `Exigência ${escopo.sufixo}-${proximo()}`],
  );

const papel = (admin: Consultavel, escopo: Escopo): Promise<string> =>
  unico(
    admin,
    `insert into app.papel_personalizado (tenant_id, nome, papel_base)
     values ($1, $2, 'auxiliar') returning id`,
    [escopo.tenantId, `Papel ${escopo.sufixo}-${proximo()}`],
  );

const usuarioLivre = (admin: Consultavel, escopo: Escopo): Promise<string> => {
  const n = proximo();

  return unico(
    admin,
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, $4, 'CONVIDADO') returning id`,
    [escopo.tenantId, `livre-${escopo.sufixo}-${n}`, `livre${n}.${escopo.sufixo}@matriz.local`, `Livre ${n}`],
  );
};


/** Versão DESATIVADA: várias coexistem por empresa, ao contrário do vigente (índice único parcial). */
const SQL_CERTIFICADO = `insert into app.empresa_certificado
   (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
    numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo,
    cadastrado_por, encerrado_em, encerrado_por, motivo_encerramento, justificativa)
 values ($1, $2, $3, 'DESATIVADO', 'Titular da Prova', '00000000000000', 'AC da Prova',
         array['AC da Prova'], $4, $5, '2026-01-01', '2027-01-01', $6, $7, $6,
         now(), $6, 'DESATIVACAO', 'prova da matriz')
 returning id`;

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const parametrosDoCertificado = (e: Escopo, n: number): unknown[] => [
  e.tenantId,
  e.empresaId,
  1_000 + n,
  `serie-${e.sufixo}-${n}`,
  `impressao-${e.sufixo}-${n}`,
  e.autorId,
  randomUUID(),
];

const certificado = (banco: Consultavel, e: Escopo): Promise<string> =>
  unico(banco, SQL_CERTIFICADO, parametrosDoCertificado(e, proximo()));

/** Tentativa de importação do plano de contas ($1 tenant, $2 empresa, $3 autor, $4 hash, $5 chave). */
const SQL_TENTATIVA_DO_PLANO = `insert into app.importacao_plano_contas
   (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
    usuario_iniciador_id, correlation_id)
 values ($1, $2, $4, '{"codigo":"codigo"}'::jsonb, 'plano.csv', 10, $5, $3, 'matriz-rls')
 returning id, empresa_id, tenant_id`;

const parametrosDaTentativa = (e: Escopo): unknown[] => [
  e.tenantId,
  e.empresaId,
  e.autorId,
  hex64(),
  `plano-contas/${e.sufixo}/${proximo()}.csv`,
];

/** Tentativa de importação de empregados (mesmos parâmetros da do plano). */
const SQL_TENTATIVA_DE_EMPREGADOS = `insert into app.importacao_empregados
   (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
    usuario_iniciador_id, correlation_id)
 values ($1, $2, $4, '{"cpf":"cpf"}'::jsonb, 'empregados.csv', 10, $5, $3, 'matriz-rls')
 returning id, empresa_id, tenant_id`;

const inserirEventoDeAuditoria = (banco: Consultavel, e: Escopo, payloadHash: string | null = null) =>
  unico(banco, `insert into app.audit_event(tenant_id,empresa_id,event_type,origin,occurred_at,actor_kind,source_type,source_id,
    correlation_id,idempotency_key,envelope,envelope_sha256,payload_sha256)
    values($1,$2,'fixture.audit','fixture',now(),'SYSTEM','fixture',app.uuid_v7(),$3,$4,'{}'::jsonb,repeat('a',64),$5) returning id`,
  [e.tenantId,e.empresaId,'audit-fixture-'+e.sufixo,'audit-fixture-'+e.sufixo+'-'+proximo(),payloadHash]);

export const FIXTURES: Readonly<Record<string, FixtureDeTabela>> = {
  'app.tenant': {
    inserir: (banco, escopo) =>
      unico(banco, `insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
        `Fixture tenant ${escopo.sufixo}-${proximo()}`,
        `X${String(proximo()).padStart(13, '0')}`,
      ]),
  },
  'app.empresa': {
    inserir: (banco, escopo) =>
      unico(
        banco,
        `insert into app.empresa (tenant_id, cnpj, razao_social, status)
         values ($1, $2, $3, 'ATIVA') returning id`,
        [escopo.tenantId, `F${String(proximo()).padStart(5, '0')}${escopo.sufixo}`.slice(0, 14), `Fixture empresa ${proximo()}`],
      ),
  },
  'app.empresa_cnae_secundario': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_cnae_secundario (tenant_id, empresa_id, codigo)
         values ($1, $2, $3) returning id`,
        [e.tenantId, e.empresaId, String(2_000_000 + proximo())],
      ),
  },
  'app.empresa_endereco': {
    // Uma finalidade ativa por empresa: a semente e a tentativa usam finalidades diferentes.
    preparar: async () => ({
      finalidade: ['COBRANCA', 'CORRESPONDENCIA', 'OUTRO'][proximo() % 3] ?? 'OUTRO',
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_endereco
           (tenant_id, empresa_id, principal, finalidade, descricao, cep, logradouro, numero,
            bairro, municipio, uf)
         values ($1, $2, false, $3, $4, '74000000', 'Rua da Prova', '1', 'Centro', 'Goiânia', 'GO')
         returning id`,
        [e.tenantId, e.empresaId, r['finalidade'], r['finalidade'] === 'OUTRO' ? 'Prova' : null],
      ),
  },
  'app.empresa_evento_de_historico': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_evento_de_historico
           (tenant_id, empresa_id, aba, acao, campo, usuario_id)
         values ($1, $2, 'DADOS_CADASTRAIS', 'ALTERACAO', 'razao_social', $3) returning id`,
        [e.tenantId, e.empresaId, e.autorId],
      ),
  },
  'app.empresa_exigencia_documental': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_exigencia_documental (tenant_id, empresa_id, nome)
         values ($1, $2, $3) returning id`,
        [e.tenantId, e.empresaId, `Exigência ${proximo()}`],
      ),
  },
  'app.empresa_documento_versao': {
    preparar: async (admin, e) => ({ exigenciaId: await exigencia(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_documento_versao
           (tenant_id, empresa_id, exigencia_id, numero, chave_storage, nome_original,
            tipo_conteudo, tamanho_bytes, vigente, enviado_por)
         values ($1, $2, $3, $4, $5, 'prova.pdf', 'application/pdf', 10, true, $6) returning id`,
        [e.tenantId, e.empresaId, r['exigenciaId'], proximo(), `chave/${e.sufixo}/${proximo()}`, e.autorId],
      ),
    // A versão é somente leitura: o único UPDATE aceito é arquivá-la (vigente true -> false).
    atualizacao: 'vigente = false',
  },
  'app.empresa_evento_documental': {
    preparar: async (admin, e) => ({ exigenciaId: await exigencia(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_evento_documental
           (tenant_id, empresa_id, exigencia_id, acao, usuario_id)
         values ($1, $2, $3, 'VISUALIZACAO', $4) returning id`,
        [e.tenantId, e.empresaId, r['exigenciaId'], e.autorId],
      ),
  },
  'app.empresa_pendencia': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
         values ($1, $2, 'CADASTRAL', 'CAMPO_AUSENTE', $3) returning id`,
        [e.tenantId, e.empresaId, `campo-${e.sufixo}-${proximo()}`],
      ),
  },
  'app.empresa_evento_de_pendencia': {
    preparar: async (admin, e) => ({
      pendenciaId: await unico(
        admin,
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
         values ($1, $2, 'CADASTRAL', 'CAMPO_AUSENTE', $3) returning id`,
        [e.tenantId, e.empresaId, `base-${e.sufixo}-${proximo()}`],
      ),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_evento_de_pendencia (tenant_id, empresa_id, pendencia_id, acao)
         values ($1, $2, $3, 'CRIACAO') returning id`,
        [e.tenantId, e.empresaId, r['pendenciaId']],
      ),
  },
  'app.empresa_notificacao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_notificacao (tenant_id, empresa_id, tipo, chave)
         values ($1, $2, 'NOVA_PENDENCIA', $3) returning id`,
        [e.tenantId, e.empresaId, `chave-${e.sufixo}-${proximo()}`],
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.empresa_evento_de_notificacao': {
    preparar: async (admin, e) => ({
      notificacaoId: await unico(
        admin,
        `insert into app.empresa_notificacao (tenant_id, empresa_id, tipo, chave)
         values ($1, $2, 'NOVA_PENDENCIA', $3) returning id`,
        [e.tenantId, e.empresaId, `base-${e.sufixo}-${proximo()}`],
      ),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_evento_de_notificacao (tenant_id, empresa_id, notificacao_id, acao)
         values ($1, $2, $3, 'CRIACAO') returning id`,
        [e.tenantId, e.empresaId, r['notificacaoId']],
      ),
  },
  'app.empresa_certificado': {
    inserir: (banco, e) => certificado(banco, e),
    // Colunas atualizáveis são só as de encerramento e o responsável; a versão desativada não muda.
    colunaDeAtualizacao: 'responsavel_id',
  },
  'app.empresa_certificado_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_certificado_evento
           (tenant_id, empresa_id, acao, resultado, codigo, usuario_id, identidade_tecnica, correlation_id)
         values ($1, $2, 'RECUSA', 'RECUSADO', 'CERTIFICADO_SENHA_INCORRETA', $3, 'matriz-rls', 'matriz-rls')
         returning id`,
        [e.tenantId, e.empresaId, e.autorId],
      ),
  },
  'app.empresa_certificado_ingestao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_certificado_ingestao
           (tenant_id, empresa_id, usuario_id, operacao, responsavel_id, correlation_id, expira_em)
         values ($1, $2, $3, 'CADASTRO', $3, 'matriz-rls', now() + interval '5 minutes')
         returning id`,
        [e.tenantId, e.empresaId, e.autorId],
      ),
    colunaDeAtualizacao: 'estado',
  },
  'app.empresa_certificado_notificacao': {
    // O certificado-pai nasce na mesma instrução, na empresa da própria tentativa: a FK composta
    // (certificado, empresa, tenant) recusaria um pai de outra empresa, e a matriz repete a
    // tentativa em empresas diferentes (arquivada, outro tenant) com as mesmas referências.
    inserir: (banco, e) => {
      const n = proximo();

      return unico(
        banco,
        `with certificado as (${SQL_CERTIFICADO})
         insert into app.empresa_certificado_notificacao
           (tenant_id, empresa_id, certificado_id, usuario_id, marco)
         select $1, $2, certificado.id, $6, 'D30' from certificado
         returning id`,
        parametrosDoCertificado(e, n),
      );
    },
    colunaDeAtualizacao: 'lida',
  },
  'app.signer_operacao': {
    // O certificado-pai nasce na mesma instrução e na empresa da própria tentativa: a FK composta
    // (certificado, empresa, tenant) recusaria um pai de outra empresa, e a matriz repete a
    // tentativa em empresas diferentes com as mesmas referências.
    inserir: (banco, e) => {
      const n = proximo();

      return unico(
        banco,
        `with certificado as (${SQL_CERTIFICADO})
         insert into app.signer_operacao
           (tenant_id, empresa_id, finalidade, tipo, chave_hmac, hash_conteudo, certificado_id,
            referencia_segredo, identidade_tecnica, correlation_id)
         select $1, $2, 'DFE_TESTE', 'MTLS', $8, $9, certificado.id, $7::uuid, 'matriz-rls', 'matriz-rls'
           from certificado
         returning id`,
        [...parametrosDoCertificado(e, n), hex64(), hex64()],
      );
    },
    colunaDeAtualizacao: 'tentativas',
  },
  'app.signer_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.signer_evento
           (tenant_id, empresa_id, finalidade, identidade_tecnica, iniciado_em, finalizado_em, latencia_ms,
            resultado, codigo, correlation_id)
         values ($1, $2, 'DFE_TESTE', 'matriz-rls', now(), now(), 5, 'FALHA', 'SIGNER_DESTINO_INDISPONIVEL',
                 'matriz-rls')
         returning id`,
        [e.tenantId, e.empresaId],
      ),
  },
  'app.dfe_capture_state': {
    inserir: (banco, e) => unico(banco,
      `insert into app.dfe_capture_state (tenant_id, empresa_id, cnpj)
       values ($1,$2,$3) returning id`, [e.tenantId, e.empresaId, `9${String(proximo()).padStart(13, '0')}`]),
    colunaDeAtualizacao: 'versao',
  },
  'app.dfe_capture_run': {
    preparar: async (admin, e) => {
      const cnpj = `8${String(proximo()).padStart(13, '0')}`;
      return { cnpj, stateId: await unico(admin,
        `insert into app.dfe_capture_state (tenant_id, empresa_id, cnpj)
         values ($1,$2,$3) returning id`, [e.tenantId, e.empresaId, cnpj]) };
    },
    inserir: (banco, e, refs) => unico(banco,
      `insert into app.dfe_capture_run
         (tenant_id, empresa_id, estado_id, cnpj, origem, chave_idempotente, correlation_id, ult_nsu_entrada)
       values ($1,$2,$3,$4,'MANUAL',$5,'matriz-rls','0') returning id`,
      [e.tenantId, e.empresaId, refs['stateId'], refs['cnpj'], `idemp-${proximo()}-${e.sufixo}`]),
    colunaDeAtualizacao: 'tentativa',
  },
  'app.dfe_capture_staging': {
    preparar: async (admin, e) => {
      const cnpj = `7${String(proximo()).padStart(13, '0')}`;
      const stateId = await unico(admin,
        `insert into app.dfe_capture_state (tenant_id, empresa_id, cnpj) values ($1,$2,$3) returning id`,
        [e.tenantId, e.empresaId, cnpj]);
      const runId = await unico(admin,
        `insert into app.dfe_capture_run (tenant_id, empresa_id, estado_id, cnpj, origem, chave_idempotente, correlation_id, ult_nsu_entrada)
         values ($1,$2,$3,$4,'MANUAL',$5,'matriz-rls','0') returning id`,
        [e.tenantId, e.empresaId, stateId, cnpj, `idemp-${proximo()}-${e.sufixo}`]);
      return { runId, cnpj };
    },
    inserir: (banco, e, refs) => unico(banco,
      `insert into app.dfe_capture_staging (tenant_id, empresa_id, run_id, cnpj, nsu, especie, conteudo_bruto, capturado_em, correlation_id)
       values ($1,$2,$3,$4,$5,'NFE_55',decode('3c78','hex'),now(),'matriz-rls') returning id`,
      [e.tenantId, e.empresaId, refs['runId'], refs['cnpj'], String(proximo())]),
  },
  'app.dfe_capture_event': {
    preparar: async (admin, e) => {
      const cnpj = `6${String(proximo()).padStart(13, '0')}`;
      const stateId = await unico(admin,
        `insert into app.dfe_capture_state (tenant_id, empresa_id, cnpj) values ($1,$2,$3) returning id`,
        [e.tenantId, e.empresaId, cnpj]);
      const runId = await unico(admin,
        `insert into app.dfe_capture_run (tenant_id, empresa_id, estado_id, cnpj, origem, chave_idempotente, correlation_id, ult_nsu_entrada)
         values ($1,$2,$3,$4,'MANUAL',$5,'matriz-rls','0') returning id`,
        [e.tenantId, e.empresaId, stateId, cnpj, `idemp-${proximo()}-${e.sufixo}`]);
      return { runId, cnpj };
    },
    inserir: (banco, e, refs) => unico(banco,
      `insert into app.dfe_capture_event (tenant_id, empresa_id, run_id, cnpj, tipo, tentativa, correlation_id, ocorrido_em)
       values ($1,$2,$3,$4,'QUEUED',0,'matriz-rls',now()) returning id`,
      [e.tenantId, e.empresaId, refs['runId'], refs['cnpj']]),
  },
  'app.dfe_capture_alert_event': {
    preparar: async (admin, e) => {
      const cnpj = `5${String(proximo()).padStart(13, '0')}`;
      const stateId = await unico(admin,
        `insert into app.dfe_capture_state (tenant_id, empresa_id, cnpj) values ($1,$2,$3) returning id`,
        [e.tenantId, e.empresaId, cnpj]);
      const runId = await unico(admin,
        `insert into app.dfe_capture_run (tenant_id, empresa_id, estado_id, cnpj, origem, chave_idempotente, correlation_id, ult_nsu_entrada)
         values ($1,$2,$3,$4,'MANUAL',$5,'matriz-rls','0') returning id`,
        [e.tenantId, e.empresaId, stateId, cnpj, `idemp-${proximo()}-${e.sufixo}`]);
      return { runId, cnpj };
    },
    inserir: (banco, e, refs) => unico(banco,
      `insert into app.dfe_capture_alert_event
         (tenant_id, empresa_id, run_id, cnpj, tipo, causa, codigo, correlation_id, ocorrido_em)
       values ($1,$2,$3,$4,'OPENED','DLQ','DFE_PROVIDER_UNAVAILABLE','matriz-rls',now()) returning id`,
      [e.tenantId, e.empresaId, refs['runId'], refs['cnpj']]),
  },
  'app.signer_notificacao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.signer_notificacao (tenant_id, usuario_id, incidente_id, tipo)
         values ($1, $2, gen_random_uuid(), 'INDISPONIBILIDADE') returning id`,
        [e.tenantId, e.autorId],
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.conta_contabil': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.conta_contabil (tenant_id, empresa_id, codigo, nome, tipo, natureza)
         values ($1, $2, $3, 'Conta da prova', 'sintetica', 'devedora') returning id`,
        [e.tenantId, e.empresaId, `matriz-${e.sufixo}-${proximo()}`],
      ),
    colunaDeAtualizacao: 'nome',
  },
  'app.centro_custo': {
    inserir: (banco, e) => unico(
      banco,
      `insert into app.centro_custo (tenant_id,empresa_id,codigo,nome,tipo)
       values ($1,$2,$3,'Centro da prova','analitica') returning id`,
      [e.tenantId,e.empresaId,`matriz-${e.sufixo}-${proximo()}`],
    ),
    colunaDeAtualizacao: 'nome',
  },
  'app.catalogo_contabil_evento': {
    inserir: (banco, e) => unico(
      banco,
      `insert into app.catalogo_contabil_evento
        (tenant_id,empresa_id,catalogo,codigo_item,acao,resultado,usuario_id,correlation_id)
       values ($1,$2,'CENTRO_CUSTO',$3,'CRIACAO','SUCESSO',$4,'rls-f39-fixture') returning id`,
      [e.tenantId,e.empresaId,`matriz-${e.sufixo}-${proximo()}`,e.autorId],
    ),
    colunaDeAtualizacao: 'acao',
  },
  'app.lancamento_contabil': {
    inserir: (banco,e) => unico(banco, `insert into app.lancamento_contabil
      (tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
      values($1,$2,2026,'2026-01-15','2026-01','Fixture F40',$3) returning id`, [e.tenantId,e.empresaId,e.autorId]),
    colunaDeAtualizacao: 'historico',
    atualizacao: "historico='Fixture F40 atualizada',atualizado_em=now()",
  },
  'app.lancamento_contabil_partida': {
    preparar: async(admin,e) => {
      const contaId = await unico(admin, `insert into app.conta_contabil
        (tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo)
        values($1,$2,$3,'Conta analítica F40','analitica','devedora','ASSET','OPTIONAL') returning id`,
        [e.tenantId,e.empresaId,`f40-${e.sufixo}-${proximo()}`]);
      const lancamentoId = await unico(admin, `insert into app.lancamento_contabil
        (tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
        values($1,$2,2026,'2026-01-15','2026-01','Fixture F40',$3) returning id`, [e.tenantId,e.empresaId,e.autorId]);
      return { contaId,lancamentoId };
    },
    inserir: (banco,e,r) => unico(banco, `insert into app.lancamento_contabil_partida
      (tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao)
      values($1,$2,$3,$4,'DEBIT',100,0) returning id`, [e.tenantId,e.empresaId,r['lancamentoId'],r['contaId']]),
    colunaDeAtualizacao: 'valor_centavos',
    atualizacao: 'valor_centavos=valor_centavos',
  },
  'app.lancamento_contabil_sequencia': {
    inserir: (banco,e) => unico(banco, `insert into app.lancamento_contabil_sequencia
      (tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,2026,1)
      on conflict(tenant_id,empresa_id,exercicio) do update set ultimo_numero=app.lancamento_contabil_sequencia.ultimo_numero
      returning empresa_id as id`, [e.tenantId,e.empresaId]),
    colunaDeLeitura: 'empresa_id', colunaDeChave: 'empresa_id',
    colunaDeAtualizacao: 'ultimo_numero', atualizacao: 'ultimo_numero=ultimo_numero',
  },
  'app.lancamento_contabil_evento': {
    preparar: async(admin,e) => ({ lancamentoId: await unico(admin, `insert into app.lancamento_contabil
      (tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
      values($1,$2,2026,'2026-01-15','2026-01','Fixture F40',$3) returning id`, [e.tenantId,e.empresaId,e.autorId]) }),
    inserir: (banco,e,r) => unico(banco, `insert into app.lancamento_contabil_evento
      (tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,usuario_id,correlation_id)
      values($1,$2,$3,'CRIADO',null,'DRAFT',$4,'f40-rls-fixture') returning id`, [e.tenantId,e.empresaId,r['lancamentoId'],e.autorId]),
    colunaDeAtualizacao: 'acao',
  },
  'app.empresa_plano_versao': {
    // Uma linha por empresa, e a matriz grava várias vezes na mesma (semente e tentativas, todas
    // revertidas): o upsert sem efeito mantém o controle positivo. Os negativos não chegam ao
    // conflito — a política de INSERT barra antes — e a linha com tenant trocado não colide com a
    // chave (empresa_id, tenant_id): cai na FK composta, como nas demais tabelas.
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_plano_versao (tenant_id, empresa_id) values ($1, $2)
         on conflict (empresa_id, tenant_id) do update set versao = app.empresa_plano_versao.versao
         returning id`,
        [e.tenantId, e.empresaId],
      ),
    colunaDeAtualizacao: 'versao',
  },
  'app.importacao_plano_contas': {
    inserir: (banco, e) => unico(banco, SQL_TENTATIVA_DO_PLANO, parametrosDaTentativa(e)),
    colunaDeAtualizacao: 'estado',
  },
  // As filhas criam a tentativa-pai na mesma instrução e na empresa da própria tentativa: a FK
  // composta (tentativa, empresa, tenant) recusaria um pai de outra empresa (ver certificado).
  'app.importacao_plano_contas_linha': {
    inserir: (banco, e) =>
      unico(
        banco,
        `with tentativa as (${SQL_TENTATIVA_DO_PLANO})
         insert into app.importacao_plano_contas_linha
           (tenant_id, empresa_id, tentativa_id, numero_linha, codigo, status, codigo_de_erro, campo)
         select $1, $2, tentativa.id, 1, null, 'REJEITADA', 'CAMPO_OBRIGATORIO_AUSENTE', 'codigo'
           from tentativa
         returning id`,
        parametrosDaTentativa(e),
      ),
  },
  'app.importacao_plano_contas_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `with tentativa as (${SQL_TENTATIVA_DO_PLANO})
         insert into app.importacao_plano_contas_evento
           (tenant_id, empresa_id, tentativa_id, acao, estado_novo, usuario_id, correlation_id)
         select $1, $2, tentativa.id, 'CRIACAO', 'RECEBIDA', $3, 'matriz-rls' from tentativa
         returning id`,
        parametrosDaTentativa(e),
      ),
  },
  'app.importacao_plano_contas_notificacao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `with tentativa as (${SQL_TENTATIVA_DO_PLANO})
         insert into app.importacao_plano_contas_notificacao (tenant_id, empresa_id, tentativa_id, usuario_id)
         select $1, $2, tentativa.id, $3 from tentativa
         returning id`,
        parametrosDaTentativa(e),
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.empregado': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empregado (tenant_id, empresa_id, cpf, nome, matricula, data_nascimento, data_admissao)
         values ($1, $2, '52998224725', 'Empregado da prova', $3, '1990-01-01', '2015-01-01') returning id`,
        [e.tenantId, e.empresaId, `matriz-${e.sufixo}-${proximo()}`],
      ),
    colunaDeAtualizacao: 'nome',
  },
  'app.empresa_empregados_versao': {
    // Uma por empresa, como empresa_plano_versao: upsert sem efeito (ver acima).
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_empregados_versao (tenant_id, empresa_id) values ($1, $2)
         on conflict (empresa_id, tenant_id) do update set versao = app.empresa_empregados_versao.versao
         returning id`,
        [e.tenantId, e.empresaId],
      ),
    colunaDeAtualizacao: 'versao',
  },
  'app.importacao_empregados': {
    inserir: (banco, e) => unico(banco, SQL_TENTATIVA_DE_EMPREGADOS, parametrosDaTentativa(e)),
    colunaDeAtualizacao: 'estado',
  },
  // As filhas criam a tentativa-pai na mesma instrução (FK composta; ver as do plano de contas).
  'app.importacao_empregados_linha': {
    inserir: (banco, e) =>
      unico(
        banco,
        `with tentativa as (${SQL_TENTATIVA_DE_EMPREGADOS})
         insert into app.importacao_empregados_linha
           (tenant_id, empresa_id, tentativa_id, numero_linha, cpf, status, codigo_de_erro, campo)
         select $1, $2, tentativa.id, 1, null, 'REJEITADA', 'CAMPO_OBRIGATORIO_AUSENTE', 'cpf'
           from tentativa
         returning id`,
        parametrosDaTentativa(e),
      ),
  },
  'app.importacao_empregados_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `with tentativa as (${SQL_TENTATIVA_DE_EMPREGADOS})
         insert into app.importacao_empregados_evento
           (tenant_id, empresa_id, tentativa_id, acao, estado_novo, usuario_id, correlation_id)
         select $1, $2, tentativa.id, 'CRIACAO', 'RECEBIDA', $3, 'matriz-rls' from tentativa
         returning id`,
        parametrosDaTentativa(e),
      ),
  },
  'app.importacao_empregados_notificacao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `with tentativa as (${SQL_TENTATIVA_DE_EMPREGADOS})
         insert into app.importacao_empregados_notificacao (tenant_id, empresa_id, tentativa_id, usuario_id)
         select $1, $2, tentativa.id, $3 from tentativa
         returning id`,
        parametrosDaTentativa(e),
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.carteira_vinculo': {
    preparar: async (admin, e) => ({ usuarioId: await usuarioLivre(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id)
         values ($1, $2, $3) returning id`,
        [e.tenantId, r['usuarioId'], e.empresaId],
      ),
  },
  'app.usuario': {
    inserir: (banco, e) => {
      const n = proximo();

      return unico(
        banco,
        `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
         values ($1, $2, $3, $4, 'CONVIDADO') returning id`,
        [e.tenantId, `ins-${e.sufixo}-${n}`, `ins${n}.${e.sufixo}@matriz.local`, `Inserido ${n}`],
      );
    },
  },
  'app.usuario_papel': {
    preparar: async (admin, e) => ({ usuarioId: await usuarioLivre(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.usuario_papel (tenant_id, usuario_id, papel)
         values ($1, $2, 'auxiliar') returning id`,
        [e.tenantId, r['usuarioId']],
      ),
  },
  'app.usuario_convite': {
    preparar: async (admin, e) => ({ usuarioId: await usuarioLivre(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.usuario_convite (tenant_id, usuario_id, token_hash, expira_em)
         values ($1, $2, $3, now() + interval '1 day') returning id`,
        [e.tenantId, r['usuarioId'], `hash-${e.sufixo}-${proximo()}`],
      ),
  },
  'app.usuario_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.usuario_evento (tenant_id, tipo, usuario_afetado_id, autor_id)
         values ($1, 'REATIVADO', $2, $2) returning id`,
        [e.tenantId, e.autorId],
      ),
  },
  'app.papel_personalizado': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.papel_personalizado (tenant_id, nome, papel_base)
         values ($1, $2, 'auxiliar') returning id`,
        [e.tenantId, `Papel ${e.sufixo}-${proximo()}`],
      ),
  },
  'app.papel_personalizado_revisao': {
    preparar: async (admin, e) => ({ papelId: await papel(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.papel_personalizado_revisao (tenant_id, papel_id, revisao, permissoes)
         values ($1, $2, $3, array['empresas.consultar']::text[]) returning id`,
        [e.tenantId, r['papelId'], 100 + proximo()],
      ),
  },
  'app.usuario_papel_personalizado': {
    preparar: async (admin, e) => ({
      papelId: await papel(admin, e),
      usuarioId: await usuarioLivre(admin, e),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.usuario_papel_personalizado (tenant_id, usuario_id, papel_id)
         values ($1, $2, $3) returning id`,
        [e.tenantId, r['usuarioId'], r['papelId']],
      ),
  },
  'app.escritorio_endereco': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.escritorio_endereco
           (tenant_id, cep, logradouro, numero, bairro, municipio, uf)
         values ($1, '74000000', 'Rua da Prova', '1', 'Centro', 'Goiânia', 'GO') returning id`,
        [e.tenantId],
      ),
  },
  'app.escritorio_arquivo': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.escritorio_arquivo
           (tenant_id, tipo, chave_storage, nome_original, tipo_conteudo, tamanho_bytes)
         values ($1, 'DOCUMENTO', $2, 'prova.pdf', 'application/pdf', 10) returning id`,
        [e.tenantId, `escritorio/${e.sufixo}/${proximo()}`],
      ),
  },
  'app.carteira_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.carteira_evento (tenant_id, origem, afetados, usuarios_afetados, empresas_afetadas)
         values ($1, 'INDIVIDUAL', '[{}]'::jsonb, array[$2]::uuid[], array[$3]::uuid[]) returning id`,
        [e.tenantId, e.autorId, e.empresaId],
      ),
  },
  'app.carteira_notificacao': {
    preparar: async (admin, e) => ({
      eventoId: await unico(
        admin,
        `insert into app.carteira_evento (tenant_id, origem, afetados, usuarios_afetados, empresas_afetadas)
         values ($1, 'INDIVIDUAL', '[{}]'::jsonb, array[$2]::uuid[], array[$3]::uuid[]) returning id`,
        [e.tenantId, e.autorId, e.empresaId],
      ),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.carteira_notificacao (tenant_id, usuario_id, evento_id, adicionadas)
         values ($1, $2, $3, '[{}]'::jsonb) returning id`,
        [e.tenantId, e.autorId, r['eventoId']],
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.fiscal_document_outbox': {
    preparar: prepararStagingFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_outbox(staging_id,tenant_id,empresa_id) values($1,$2,$3) returning id`,
      [r['stagingId'],e.tenantId,e.empresaId]),
    colunaDeAtualizacao: 'tentativas',
  },
  'app.fiscal_document': {
    preparar: prepararStagingFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document(tenant_id,empresa_id,primary_staging_id,especie,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,estado,parser_version)
       values($1,$2,$3,'NFE_55',repeat('b',64),$4,3,'55','4.00','PROCESSADO','fixture') returning id`,
      [e.tenantId,e.empresaId,r['stagingId'],`fiscal/${e.sufixo}/${proximo()}.xml`]),
    colunaDeAtualizacao: 'estado',
  },
  'app.fiscal_document_party': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,nome)
       values($1,$2,$3,'fixture','EMITENTE','Fixture') returning id`, [e.tenantId,e.empresaId,r['documentId']]),
  },
  'app.fiscal_document_origin': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
       values($1,$2,$3,$4,$5,'1','fiscal-rls-fixture',now()) returning id`,
      [e.tenantId,e.empresaId,r['documentId'],r['stagingId'],r['cnpj']]),
  },
  'app.fiscal_document_item': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,descricao)
       values($1,$2,$3,'fixture',1,'Fixture') returning id`, [e.tenantId,e.empresaId,r['documentId']]),
  },
  'app.fiscal_document_tax': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_tax(tenant_id,empresa_id,document_id,parser_version,escopo,codigo,valor)
       values($1,$2,$3,'fixture','DOCUMENTO','IBS',0.10) returning id`, [e.tenantId,e.empresaId,r['documentId']]),
  },
  'app.fiscal_document_reference': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_reference(tenant_id,empresa_id,document_id,parser_version,tipo,chave)
       values($1,$2,$3,'fixture','NFE',repeat('1',44)) returning id`, [e.tenantId,e.empresaId,r['documentId']]),
  },
  'app.fiscal_document_event': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,parser_version,correlation_id)
       values($1,$2,$3,$4,'PROCESSADO','fixture','fiscal-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['documentId'],r['stagingId']]),
  },
  'app.fiscal_document_payment': {
    preparar: prepararDocumentoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_payment(tenant_id,empresa_id,document_id,parser_version,numero,meio,valor)
       values($1,$2,$3,'fixture',1,'DINHEIRO',1) returning id`, [e.tenantId,e.empresaId,r['documentId']]),
  },
  'app.nfce_import_batch': {
    inserir: (banco,e) => unico(banco,
      `insert into app.nfce_import_batch(tenant_id,empresa_id,actor_id,correlation_id,origem,status,total)
       values($1,$2,$3,'f30-rls-fixture','ERP','PROCESSING',1) returning id`, [e.tenantId,e.empresaId,e.autorId]),
  },
  'app.nfce_import_item': {
    preparar: async (admin,e) => {
      const batchId=await unico(admin,
        `insert into app.nfce_import_batch(tenant_id,empresa_id,actor_id,correlation_id,origem,status,total)
          values($1,$2,$3,'f30-rls-fixture','ERP','PROCESSING',1) returning id`, [e.tenantId,e.empresaId,e.autorId]);
      return {batchId};
    },
    inserir: (banco,e,r) => unico(banco,
      `insert into app.nfce_import_item(tenant_id,empresa_id,batch_id,nome_sanitizado,tamanho_bytes,hash_sha256,original_key,status,parser_version,schema_version,correlation_id)
       values($1,$2,$3,'fixture.xml',1,$4,$5,'QUEUED','fixture','fixture','f30-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['batchId'],hex64(),`fiscal/nfce/${e.sufixo}/${proximo()}.xml`]),
  },
  'app.nfce_import_source': {
    preparar: async (admin,e) => {
      const batchId=await unico(admin,
        `insert into app.nfce_import_batch(tenant_id,empresa_id,actor_id,correlation_id,origem,status,total)
         values($1,$2,$3,'f30-rls-fixture','ERP','PROCESSING',1) returning id`, [e.tenantId,e.empresaId,e.autorId]);
      const itemId=await unico(admin,
        `insert into app.nfce_import_item(tenant_id,empresa_id,batch_id,nome_sanitizado,tamanho_bytes,hash_sha256,original_key,status,parser_version,schema_version,correlation_id)
         values($1,$2,$3,'fixture.xml',1,$4,$5,'QUEUED','fixture','fixture','f30-rls-fixture') returning id`,
        [e.tenantId,e.empresaId,batchId,hex64(),`fiscal/nfce/${e.sufixo}/${proximo()}.xml`]);
      return {itemId};
    },
    inserir: (banco,e,r) => unico(banco,
      `insert into app.nfce_import_source(tenant_id,empresa_id,item_id,cnpj,origem,correlation_id)
       values($1,$2,$3,'00000000000000','ERP','f30-rls-fixture') returning id`, [e.tenantId,e.empresaId,r['itemId']]),
  },
  'app.nfce_import_event': {
    preparar: async (admin,e) => {
      const batchId=await unico(admin,
        `insert into app.nfce_import_batch(tenant_id,empresa_id,actor_id,correlation_id,origem,status,total)
         values($1,$2,$3,'f30-rls-fixture','ERP','PROCESSING',1) returning id`, [e.tenantId,e.empresaId,e.autorId]);
      const itemId=await unico(admin,
        `insert into app.nfce_import_item(tenant_id,empresa_id,batch_id,nome_sanitizado,tamanho_bytes,hash_sha256,original_key,status,parser_version,schema_version,correlation_id)
         values($1,$2,$3,'evento.xml',1,$4,$5,'PENDING_LINK','fixture','fixture','f30-rls-fixture') returning id`,
        [e.tenantId,e.empresaId,batchId,hex64(),`fiscal/nfce/${e.sufixo}/${proximo()}.xml`]);
      const sourceId=await unico(admin,
        `insert into app.nfce_import_source(tenant_id,empresa_id,item_id,cnpj,origem,correlation_id)
         values($1,$2,$3,'11222333000181','ERP','f30-rls-fixture') returning id`,[e.tenantId,e.empresaId,itemId]);
      return {itemId,sourceId};
    },
    inserir: (banco,e,r) => unico(banco,
      `insert into app.nfce_import_event(tenant_id,empresa_id,item_id,source_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,tamanho_bytes,correlation_id)
       values($1,$2,$3,$4,lpad($5::text,44,'1'),'11222333000181','PRODUCAO','110111','1','135260000000001',$6,$7,1,'f30-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['itemId'],r['sourceId'],proximo(),hex64(),`fiscal/nfce/${e.sufixo}/${proximo()}.xml`]),
  },
  'app.tax_st_settlement_snapshot': {
    inserir: (banco,e) => unico(banco,
      `insert into app.tax_st_settlement_snapshot
         (tenant_id,empresa_id,competence,revision,idempotency_key,input_sha256,status,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
       values($1,$2,'2098-01-01',$3,$4,repeat('d',64),'BLOCKED',0,0,'{}'::jsonb,$5,'f29-rls-fixture',now()) returning id`,
      [e.tenantId,e.empresaId,proximo(),randomUUID(),e.autorId]),
  },
  'app.tax_st_authorized_cancellation': {
    preparar: prepararCancelamentoTributario,
    inserir: async (banco,e,r) => {
      const role=await banco.query<{name:string}>('select current_user name');
      if(role.rows[0]?.name==='contaia_app')return unico(banco,
        `insert into app.tax_st_authorized_cancellation(tenant_id,empresa_id,output_document_id,source_event_id,output_competence,authorized_at,evidence_sha256,actor_id,correlation_id,occurred_at)
         values($1,$2,$3,$4,'2017-01-01','2017-02-01T12:00:00Z',repeat('e',64),$5,'f32-rls-fixture',now()) returning id`,
        [e.tenantId,e.empresaId,r['documentId'],r['sourceEventId'],e.autorId]);
      return r['cancellationId']!;
    },
  },
  'app.fiscal_document_verified_event': {
    preparar: prepararStagingFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_document_verified_event(tenant_id,empresa_id,staging_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,ocorrido_em,tamanho_bytes,correlation_id)
       values($1,$2,$3,lpad($4::text,44,'2'),$5,'PRODUCAO','110111','1','135260000000001',repeat('f',64),'fiscal/verified-event.xml','2017-02-01T12:00:00Z',1,'f32-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['stagingId'],proximo(),r['cnpj']]),
  },
  'app.tax_st_return_event': {
    preparar: prepararDevolucaoIcmsSt,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.tax_st_return_event(tenant_id,empresa_id,original_snapshot_id,original_line_id,origin,return_document_identity,return_item_identity,event_date,idempotency_key,normalized_unit,returned_quantity_scaled,evidence_sha256,actor_id,correlation_id,occurred_at)
       values($1,$2,$3,$4,'MANUAL_DOCUMENT',$5,$6,'2017-02-02',$7,'UN',1,repeat('e',64),$8,'f32-rls-fixture',now()) returning id`,
      [e.tenantId,e.empresaId,r['snapshotId'],r['lineId'],`return-${randomUUID()}`,`item-${randomUUID()}`,randomUUID(),e.autorId]),
  },
  'app.tax_st_return_reversal': {
    preparar: async (admin,e) => {
      const base = await prepararDevolucaoIcmsSt(admin,e);
      return await prepararRevisaoDevolucaoIcmsSt(admin,e,base);
    },
    inserir: (banco,e,r) => unico(banco,
      `insert into app.tax_st_return_reversal(tenant_id,empresa_id,event_id,original_snapshot_id,original_line_id,competence,returned_quantity_scaled,remaining_quantity_scaled,reversed_restitution_cents,reversed_complement_cents,formula_version,source_ids,actor_id,correlation_id,occurred_at)
       values($1,$2,$3,$4,$5,'2017-02-01',1,0,0,0,'fixture',array['fixture']::text[],$6,'f32-rls-fixture',now()) returning id`,
      [e.tenantId,e.empresaId,r['eventId'],r['snapshotId'],r['lineId'],e.autorId]),
  },
  'app.tax_st_return_review_event': {
    preparar:async(admin,e)=>{
      const base=await prepararDevolucaoIcmsSt(admin,e);
      const eventId=await inserirEventoDevolucaoIcmsSt(admin,e,base);
      return {...base,eventId};
    },
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_return_review_event(tenant_id,empresa_id,return_event_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'SUBMITTED',$4,now(),'f32-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['eventId'],e.autorId]),
  },
  'app.tax_st_history_package': {
    preparar: prepararDocumentoParaSnapshot,
    inserir: (banco,e) => unico(banco,
      `insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
       values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,md5($4)||md5($4||'selection'),md5($4||'content')||md5($4||'payload'),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f33-rls-fixture') returning id`,[e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${randomUUID()}`]),
  },
  'app.tax_st_history_package_line': {
    preparar: async(admin,e) => {
      const base=await prepararDevolucaoIcmsSt(admin,e);
      const packageId=await unico(admin,
        `insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
         values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,md5($5||$6)||md5($5||$6||'selection'),md5($5||$6||'content')||md5($5||$6||'payload'),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS',ARRAY[$3]::uuid[],'[]'::jsonb,'{}'::jsonb,$4,now(),'f33-rls-line-fixture') returning id`,[e.tenantId,e.empresaId,base['snapshotId'],e.autorId,`${e.sufixo}/${randomUUID()}`,e.autorId]);
      return {...base,packageId};
    },
    inserir:(banco,e,r)=>unico(banco,
      `insert into app.tax_st_history_package_line(tenant_id,empresa_id,package_id,source_kind,source_revision_id,source_line_id,competence,document_id,item_id,document_model,access_key,source_ids,rule_id,formula_version,memory_sha256,document_sha256,restitution_principal_cents,complement_principal_cents,facts)
       values($1,$2,$3,'APPROVED_SETTLEMENT',$4,$5,'2017-01-01',$6,'fixture','55',repeat('1',44),ARRAY['fixture'],'fixture','fixture',repeat('e',64),repeat('f',64),0,0,'{}'::jsonb) returning id`,
      [e.tenantId,e.empresaId,r['packageId'],r['snapshotId'],r['lineId'],r['documentId']]),
  },
  'app.tax_st_history_package_event': {
    preparar: async(admin,e) => {
      const doc=await prepararDocumentoParaSnapshot(admin,e);
      const packageId=await unico(admin,
        `insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
         values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,md5($4||$5)||md5($4||$5||'selection'),md5($4||$5||'content')||md5($4||$5||'payload'),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f33-rls-event-fixture') returning id`,[e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${randomUUID()}`,e.autorId]);
      return {...doc,packageId};
    },
    inserir:(banco,e,r)=>unico(banco,
      `insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
       values($1,$2,$3,'GENERATED',$4,now(),'f33-rls-event-fixture','{}'::jsonb) returning id`,[e.tenantId,e.empresaId,r['packageId'],e.autorId]),
  },
  'app.tax_st_legal_rule_package': {
    inserir:(banco,e)=>unico(banco,`insert into app.tax_st_legal_rule_package(tenant_id,empresa_id,version,coverage_through,content_sha256,canonical_json,requested_by,created_at)
      values($1,$2,$3,'2018-02-28',repeat(md5($4),2),'{}'::jsonb,$5,now()) returning id`,[e.tenantId,e.empresaId,`fixture-${proximo()}`,`${e.sufixo}/${proximo()}`,e.autorId]),
  },
  'app.tax_st_legal_rule_package_event': {
    preparar:async(admin,e)=>{
      const packageId=await unico(admin,`insert into app.tax_st_legal_rule_package(tenant_id,empresa_id,version,coverage_through,content_sha256,canonical_json,requested_by,created_at)
        values($1,$2,$3,'2018-02-28',repeat(md5($4),2),'{}'::jsonb,$5,now()) returning id`,[e.tenantId,e.empresaId,`fixture-${proximo()}`,`${e.sufixo}/${proximo()}`,e.autorId]);
      return {packageId};
    },
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_legal_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'IMPORTED',$4,now(),'f34-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['packageId'],e.autorId]),
  },
  'app.tax_st_legal_formal_act': {
    preparar:async(admin,e)=>{
      const packageId=await unico(admin,`insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
        values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,repeat(md5($4||'s'),2),repeat(md5($4||'c'),2),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f34-rls-source') returning id`,[e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${proximo()}`]);
      return {sourcePackageId:packageId};
    },
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_legal_formal_act(tenant_id,empresa_id,source_package_id,issuer,act_number,act_type,act_date,period_start,period_end,official_basis,storage_key,content_sha256,canonical_facts,requested_by,created_at)
      values($1,$2,$3,'SEFAZ-GO',$4,'ASSESSMENT_NOTICE','2018-02-01','2017-01-01','2017-12-31','Fixture oficial','${'fixture/f34/act.pdf'}',repeat(md5($4),2),'{}'::jsonb,$5,now()) returning id`,[e.tenantId,e.empresaId,r['sourcePackageId'],`${e.sufixo}/${proximo()}`,e.autorId]),
    colunaDeAtualizacao:'issuer',
  },
  'app.tax_st_legal_formal_act_event': {
    preparar:async(admin,e)=>{
      const sourcePackageId=await unico(admin,`insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
        values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,repeat(md5($4||'s'),2),repeat(md5($4||'c'),2),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f34-rls-source') returning id`,[e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${proximo()}`]);
      const actId=await unico(admin,`insert into app.tax_st_legal_formal_act(tenant_id,empresa_id,source_package_id,issuer,act_number,act_type,act_date,period_start,period_end,official_basis,storage_key,content_sha256,canonical_facts,requested_by,created_at)
        values($1,$2,$3,'SEFAZ-GO',$4,'ASSESSMENT_NOTICE','2018-02-01','2017-01-01','2017-12-31','Fixture oficial','fixture/f34/act.pdf',repeat(md5($4),2),'{}'::jsonb,$5,now()) returning id`,[e.tenantId,e.empresaId,sourcePackageId,`${e.sufixo}/${proximo()}`,e.autorId]);
      return {actId};
    },
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_legal_formal_act_event(tenant_id,empresa_id,act_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'IMPORTED',$4,now(),'f34-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['actId'],e.autorId]),
  },
  'app.tax_st_legal_accrual_result': {
    preparar:async(admin,e)=>{
      const sourcePackageId=await unico(admin,`insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
        values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,repeat(md5($4||'s'),2),repeat(md5($4||'c'),2),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f34-rls-source') returning id`,[e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${proximo()}`]);
      return {sourcePackageId};
    },
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_legal_accrual_result(tenant_id,empresa_id,source_package_id,reference_date,contract_version,idempotency_sha256,canonical_json,content_sha256,status,requested_by,generated_at,correlation_id)
      values($1,$2,$3,'2018-02-28',1,repeat(md5($4),2),'{}'::jsonb,repeat(md5($4||'content'),2),'INDETERMINATE',$5,now(),'f34-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['sourcePackageId'],`${e.sufixo}/${proximo()}`,e.autorId]),
  },
  'app.tax_st_legal_accrual_event': {
    preparar:async(admin,e)=>{
      const sourcePackageId=await unico(admin,`insert into app.tax_st_history_package(tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
        values($1,$2,'SIMPLES_NACIONAL','2017-01-01','2017-01-01',1,repeat(md5($4||'s'),2),repeat(md5($4||'c'),2),'BLOQUEADO_POR_ACRESCIMOS_LEGAIS','{}'::uuid[],'[]'::jsonb,'{}'::jsonb,$3,now(),'f34-rls-source') returning id`,[e.tenantId,e.empresaId,e.autorId,`${e.sufixo}/${proximo()}`]);
      const resultId=await unico(admin,`insert into app.tax_st_legal_accrual_result(tenant_id,empresa_id,source_package_id,reference_date,contract_version,idempotency_sha256,canonical_json,content_sha256,status,requested_by,generated_at,correlation_id)
        values($1,$2,$3,'2018-02-28',1,repeat(md5($4),2),'{}'::jsonb,repeat(md5($4||'content'),2),'INDETERMINATE',$5,now(),'f34-rls-fixture') returning id`,[e.tenantId,e.empresaId,sourcePackageId,`${e.sufixo}/${proximo()}`,e.autorId]);
      return {resultId};
    },
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'CALCULATED',$4,now(),'f34-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['resultId'],e.autorId]),
  },
  'app.tax_st_destination_rule_package': {
    inserir:(banco,e)=>unico(banco,`insert into app.tax_st_destination_rule_package(tenant_id,empresa_id,version,destination,regime,valid_from,valid_through,official_basis,source_url,consulted_at,source_sha256,storage_key,conditions,requested_by,created_at)
      values($1,$2,$3,'REFUND_REQUEST','SIMPLES_NACIONAL','2016-10-01','2018-02-28','Fixture formal','https://example.gov.br/fixture','2018-02-28',repeat(md5($4),2),$5,'["fixture"]'::jsonb,$6,now()) returning id`,[e.tenantId,e.empresaId,`fixture-${proximo()}`,`${e.sufixo}/${proximo()}`,`fixture/${e.sufixo}/f35.pdf`,e.autorId]),
  },
  'app.tax_st_destination_rule_event': {
    preparar:async(admin,e)=>({ruleId:await unico(admin,`insert into app.tax_st_destination_rule_package(tenant_id,empresa_id,version,destination,regime,valid_from,valid_through,official_basis,source_url,consulted_at,source_sha256,storage_key,conditions,requested_by,created_at)
      values($1,$2,$3,'REFUND_REQUEST','SIMPLES_NACIONAL','2016-10-01','2018-02-28','Fixture formal','https://example.gov.br/fixture','2018-02-28',repeat(md5($4),2),'fixture/f35.pdf','["fixture"]'::jsonb,$5,now()) returning id`,[e.tenantId,e.empresaId,`fixture-${proximo()}`,`${e.sufixo}/${proximo()}`,e.autorId])}),
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_destination_rule_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id) values($1,$2,$3,'FAILED',$4,now(),'f35-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['ruleId'],e.autorId]),
  },
  'app.tax_st_internal_decision_dossier': {
    preparar:prepararDossieF35,
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_internal_decision_dossier(tenant_id,empresa_id,source_package_id,accrual_result_id,revision,idempotency_sha256,content_sha256,canonical_json,status,prepared_by,generated_at,correlation_id)
      values($1,$2,$3,$4,2,repeat(md5($5),2),repeat(md5($5||'content'),2),'{}'::jsonb,'BLOCKED_INDETERMINATE',$6,now(),'f35-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['sourcePackageId'],r['accrualResultId'],`${e.sufixo}/${randomUUID()}`,e.autorId]),
  },
  'app.tax_st_internal_decision_evidence': {
    preparar:prepararDossieF35,
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_internal_decision_evidence(tenant_id,empresa_id,dossier_id,track,kind,description,file_name,storage_key,content_sha256,requested_by,created_at)
      values($1,$2,$3,'RESTITUTION','FIXTURE','Evidência sintética','fixture.pdf',$4,repeat(md5($4),2),$5,now()) returning id`,[e.tenantId,e.empresaId,r['dossierId'],`fixture/${e.sufixo}/evidence.pdf`,e.autorId]),
  },
  'app.tax_st_internal_decision_event': {
    preparar:prepararDossieF35,
    inserir:(banco,e,r)=>unico(banco,`insert into app.tax_st_internal_decision_event(tenant_id,empresa_id,dossier_id,track,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'DOSSIER','CREATED',$4,now(),'f35-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['dossierId'],e.autorId]),
  },
  'app.tax_st_settlement_line': {
    preparar: prepararSnapshotIcmsSt,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.tax_st_settlement_line
         (tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,facts,calculation,recovery_memory)
       values($1,$2,$3,$4,$5,'INDETERMINATE','{}'::jsonb,'{}'::jsonb,'{}'::jsonb) returning id`,
      [e.tenantId,e.empresaId,r['snapshotId'],r['documentId'],`fixture:${proximo()}`]),
  },
  'app.tax_st_settlement_event': {
    preparar: prepararSnapshotIcmsSt,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.tax_st_settlement_event
         (tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
       values($1,$2,$3,'BLOCKED',$4,'f29-rls-fixture',now(),'{}'::jsonb) returning id`,
      [e.tenantId,e.empresaId,r['snapshotId'],e.autorId]),
  },
  'app.tax_st_settlement_review_event': {
    preparar: prepararSnapshotIcmsSt,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.tax_st_settlement_review_event
         (tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
       values($1,$2,$3,'SUBMITTED',$4,'f29-rls-fixture',now(),'{}'::jsonb) returning id`,
      [e.tenantId,e.empresaId,r['snapshotId'],e.autorId]),
  },
  'app.fiscal_acknowledgement': {
    preparar: prepararStagingFiscal,
    inserir: (banco, e, r) => unico(banco,
      `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,correlation_id)
       values($1,$2,$3,$4,'RESUMO_CAPTURADO','fiscal-ack-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['stagingId'],String(proximo()).padStart(44,'0')]),
    colunaDeAtualizacao: 'estado',
  },
  'app.fiscal_acknowledgement_event': {
    preparar: async (admin, e) => {
      const staging = await prepararStagingFiscal(admin, e);
      const acknowledgementId = await unico(admin,
        `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,correlation_id)
         values($1,$2,$3,$4,'RESUMO_CAPTURADO','fiscal-ack-rls-fixture') returning id`,
        [e.tenantId,e.empresaId,staging['stagingId'],String(proximo()).padStart(44,'0')]);
      return { acknowledgementId };
    },
    inserir: (banco, e, r) => unico(banco,
      `insert into app.fiscal_acknowledgement_event(tenant_id,empresa_id,acknowledgement_id,estado,tentativa,correlation_id)
       values($1,$2,$3,'RESUMO_CAPTURADO',0,'fiscal-ack-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['acknowledgementId']]),
  },
  'app.fiscal_acknowledgement_attempt': {
    preparar: async (admin, e) => {
      const staging = await prepararStagingFiscal(admin, e);
      const acknowledgementId = await unico(admin,
        `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,correlation_id)
         values($1,$2,$3,$4,'RESUMO_CAPTURADO','fiscal-ack-rls-fixture') returning id`,
        [e.tenantId,e.empresaId,staging['stagingId'],String(proximo()).padStart(44,'0')]);
      return { acknowledgementId };
    },
    inserir: (banco, e, r) => unico(banco,
      `insert into app.fiscal_acknowledgement_attempt(tenant_id,empresa_id,acknowledgement_id,etapa,tentativa,resultado,correlation_id)
       values($1,$2,$3,'CIENCIA',1,'INCERTO','fiscal-ack-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['acknowledgementId']]),
  },
  'app.fiscal_acknowledgement_outbox': {
    preparar: async (admin, e) => {
      const staging = await prepararStagingFiscal(admin, e);
      const acknowledgementId = await unico(admin,
        `insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,correlation_id)
         values($1,$2,$3,$4,'RESUMO_CAPTURADO','fiscal-ack-rls-fixture') returning id`,
        [e.tenantId,e.empresaId,staging['stagingId'],String(proximo()).padStart(44,'0')]);
      return { acknowledgementId };
    },
    inserir: (banco, e, r) => unico(banco,
      `insert into app.fiscal_acknowledgement_outbox(tenant_id,empresa_id,acknowledgement_id)
       values($1,$2,$3) returning id`,
      [e.tenantId,e.empresaId,r['acknowledgementId']]),
    colunaDeAtualizacao: 'tentativas',
  },
  'app.fiscal_risk_configuration': {
    inserir: (banco,e) => unico(banco,
      `insert into app.fiscal_risk_configuration(tenant_id,empresa_id,versao,limite_centavos,motivo,ator_id)
       values($1,$2,$3,100000,'Configuração da matriz RLS',$4) returning id`,
      [e.tenantId,e.empresaId,proximo(),e.autorId]),
  },
  'app.fiscal_risk_supplier': {
    preparar: prepararConfiguracaoRiscoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_risk_supplier(tenant_id,empresa_id,configuration_id,cnpj,nome_exibicao,situacao,motivo,ator_id)
       values($1,$2,$3,$4,'Fornecedor da matriz','ATIVO','Cadastro da matriz RLS',$5) returning id`,
      [e.tenantId,e.empresaId,r['configurationId'],`00000000000${String(proximo()).padStart(3,'0')}`,e.autorId]),
  },
  'app.fiscal_risk_execution': {
    preparar: async (admin,e) => {
      const configuration = await prepararConfiguracaoRiscoFiscal(admin,e);
      const document = await prepararDocumentoFiscal(admin,e);
      return { ...configuration, ...document };
    },
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_risk_execution(tenant_id,empresa_id,document_id,configuration_id,parser_version,classifier_version,estado,correlation_id,ator_id)
       values($1,$2,$3,$4,'fixture','fixture','AGUARDANDO','fiscal-risk-rls-fixture',$5) returning id`,
      [e.tenantId,e.empresaId,r['documentId'],r['configurationId'],e.autorId]),
    colunaDeAtualizacao: 'estado',
    atualizacao: "estado = 'PROCESSANDO'",
  },
  'app.fiscal_risk_analysis': {
    preparar: prepararExecucaoRiscoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_risk_analysis(tenant_id,empresa_id,execution_id,document_id,configuration_id,parser_version,classifier_version,tipo_manifestacao,confianca,faixa_confianca,justificativa,origem,versao_schema,duracao_ms,correlation_id)
       values($1,$2,$3,$4,$5,'fixture','fixture','ABSTER_SE',0,'ABSTER_SE','Fixture da matriz RLS','ABSTENCAO','fixture',0,'fiscal-risk-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['executionId'],r['documentId'],r['configurationId']]),
  },
  'app.fiscal_risk_attempt': {
    preparar: prepararExecucaoRiscoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_risk_attempt(tenant_id,empresa_id,execution_id,numero,etapa,resultado,duracao_ms,correlation_id,iniciado_em)
       values($1,$2,$3,1,'DETERMINISTICA','SUCESSO',0,'fiscal-risk-rls-fixture',now()) returning id`,
      [e.tenantId,e.empresaId,r['executionId']]),
  },
  'app.fiscal_risk_event': {
    preparar: prepararExecucaoRiscoFiscal,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.fiscal_risk_event(tenant_id,empresa_id,execution_id,estado,codigo,correlation_id)
       values($1,$2,$3,'AGUARDANDO','FISCAL_RISK_QUEUED','fiscal-risk-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,r['executionId']]),
  },
  'app.fiscal_manifestation': {
    preparar: prepararAnaliseParaManifestacao,
    inserir: async (banco,e,r) => unico(banco,`insert into app.fiscal_manifestation(tenant_id,empresa_id,document_id,analysis_id,chave_acesso,tipo,estado,decisao_original,aprovador_id,payload,payload_sha256,chave_idempotente,correlation_id) values($1,$2,$3,$4,$5,'210200','APROVADA','210200',$6,'{}'::jsonb,repeat('a',64),$7,'fiscal-manifestation-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['documentId'],r['analysisId'],String(proximo()).padStart(44,'0'),e.autorId,`rls-manifestation-${e.sufixo}-${proximo()}`]),
    colunaDeAtualizacao:'estado',atualizacao:"estado='ENFILEIRADA'",
  },
  'app.fiscal_manifestation_outbox': {
    preparar: async(admin,e)=>{const execucao=await prepararAnaliseParaManifestacao(admin,e);const manifestation=await unico(admin,`insert into app.fiscal_manifestation(tenant_id,empresa_id,document_id,analysis_id,chave_acesso,tipo,estado,decisao_original,aprovador_id,payload,payload_sha256,chave_idempotente,correlation_id) values($1,$2,$3,$4,$5,'210200','APROVADA','210200',$6,'{}'::jsonb,repeat('b',64),$7,'fiscal-manifestation-rls-fixture') returning id`,[e.tenantId,e.empresaId,execucao['documentId'],execucao['analysisId'],String(proximo()).padStart(44,'0'),e.autorId,`rls-outbox-${e.sufixo}-${proximo()}`]);return{...execucao,manifestationId:manifestation};},
    inserir:(banco,e,r)=>unico(banco,`insert into app.fiscal_manifestation_outbox(tenant_id,empresa_id,manifestation_id) values($1,$2,$3) returning id`,[e.tenantId,e.empresaId,r['manifestationId']]),colunaDeAtualizacao:'estado',atualizacao:"estado='PUBLICADO'",
  },
  'app.fiscal_manifestation_event': {
    preparar: async(admin,e)=>{const execucao=await prepararAnaliseParaManifestacao(admin,e);const manifestation=await unico(admin,`insert into app.fiscal_manifestation(tenant_id,empresa_id,document_id,analysis_id,chave_acesso,tipo,estado,decisao_original,aprovador_id,payload,payload_sha256,chave_idempotente,correlation_id) values($1,$2,$3,$4,$5,'210200','APROVADA','210200',$6,'{}'::jsonb,repeat('c',64),$7,'fiscal-manifestation-rls-fixture') returning id`,[e.tenantId,e.empresaId,execucao['documentId'],execucao['analysisId'],String(proximo()).padStart(44,'0'),e.autorId,`rls-event-${e.sufixo}-${proximo()}`]);return{...execucao,manifestationId:manifestation};},
    inserir:(banco,e,r)=>unico(banco,`insert into app.fiscal_manifestation_event(tenant_id,empresa_id,manifestation_id,estado,detalhe_sanitizado,correlation_id) values($1,$2,$3,'APROVADA','fixture','fiscal-manifestation-rls-fixture') returning id`,[e.tenantId,e.empresaId,r['manifestationId']]),
  },
  'app.obligation_occurrence': {
    preparar: prepararRegraObrigacao,
    inserir: (banco,e,r) => unico(banco, `insert into app.obligation_occurrence(tenant_id,empresa_id,regra_id,codigo,competencia,versao_regra,estado) values($1,$2,$3,$4,$5::date,$6,'PENDENTE') returning id`, [e.tenantId,e.empresaId,r['ruleId'],r['codigo'],r['competencia'],r['versao']]),
  },
  'app.dashboard_health_projection': {
    inserir: (banco,e) => unico(banco,
      `insert into app.dashboard_health_projection(tenant_id,empresa_id,cor,atualizado_em,correlation_id)
       values($1,$2,'AMARELO',now(),'rls-dashboard-fixture')
       on conflict(tenant_id,empresa_id) do update set cor=excluded.cor returning id`, [e.tenantId,e.empresaId]),
    colunaDeAtualizacao: 'cor', atualizacao: "cor='VERMELHO'",
  },
  'app.dashboard_health_reason': {
    inserir: (banco,e) => unico(banco,
      `insert into app.dashboard_health_reason(tenant_id,empresa_id,fonte,codigo,gravidade,origem_id,descricao)
       values($1,$2,'PENDENCIAS','PENDENCIA_ABERTA','AMARELO',$3,'Fixture da matriz RLS') returning id`,
      [e.tenantId,e.empresaId,`rls-${e.sufixo}-${proximo()}`]),
    colunaDeAtualizacao: 'ativo', atualizacao: 'ativo=false',
  },
  'app.dashboard_health_source_checkpoint': {
    inserir: (banco,e) => unico(banco,
      `insert into app.dashboard_health_source_checkpoint(tenant_id,empresa_id,fonte,revisao,processado_em)
       values($1,$2,'PENDENCIAS','fixture',now())
       on conflict(tenant_id,empresa_id,fonte) do update set revisao=excluded.revisao returning id`, [e.tenantId,e.empresaId]),
    colunaDeAtualizacao: 'revisao', atualizacao: "revisao='updated'",
  },
  'app.obligation_event': {
    preparar: prepararOcorrenciaObrigacao,
    inserir: (banco,e,r) => unico(banco, `insert into app.obligation_event(tenant_id,empresa_id,occurrence_id,sequencia,acao,estado_novo,autor_id,correlation_id) values($1,$2,$3,1,'GERADA','PENDENTE',$4,'rls-obligation') returning id`, [e.tenantId,e.empresaId,r['occurrenceId'],e.autorId]),
  },
  'app.obligation_alert': {
    preparar: prepararOcorrenciaObrigacao,
    inserir: (banco,e,r) => unico(banco, `insert into app.obligation_alert(tenant_id,empresa_id,occurrence_id,identidade,prioridade,dias_restantes) values($1,$2,$3,'D3_EVOLUTIVO','ALTA',3) returning id`, [e.tenantId,e.empresaId,r['occurrenceId']]),
    colunaDeAtualizacao: 'dias_restantes', atualizacao: 'dias_restantes=2',
  },
  'app.obligation_alert_recipient': {
    preparar: async(admin,e) => {
      const occurrence = await prepararOcorrenciaObrigacao(admin,e);
      const alertId = await unico(admin, `insert into app.obligation_alert(tenant_id,empresa_id,occurrence_id,identidade,prioridade,dias_restantes) values($1,$2,$3,'D3_EVOLUTIVO','ALTA',3) returning id`, [e.tenantId,e.empresaId,occurrence['occurrenceId']]);
      return { alertId };
    },
    inserir: (banco,e,r) => unico(banco, `insert into app.obligation_alert_recipient(tenant_id,empresa_id,alert_id,usuario_id,papel_snapshot) values($1,$2,$3,$4,'contador') returning id`, [e.tenantId,e.empresaId,r['alertId'],e.autorId]),
  },
  'app.obligation_in_app_notification': {
    preparar: async(admin,e) => {
      const occurrence = await prepararOcorrenciaObrigacao(admin,e);
      return { alertId: await unico(admin, `insert into app.obligation_alert(tenant_id,empresa_id,occurrence_id,identidade,prioridade,dias_restantes) values($1,$2,$3,'D3_EVOLUTIVO','ALTA',3) returning id`, [e.tenantId,e.empresaId,occurrence['occurrenceId']]) };
    },
    inserir: (banco,e,r) => unico(banco, `insert into app.obligation_in_app_notification(tenant_id,empresa_id,alert_id,usuario_id) values($1,$2,$3,$4) returning id`, [e.tenantId,e.empresaId,r['alertId'],e.autorId]),
    colunaDeAtualizacao: 'lida', atualizacao: 'lida=true,lida_em=now()',
  },
  'app.obligation_channel_outbox': {
    preparar: async(admin,e) => {
      const occurrence = await prepararOcorrenciaObrigacao(admin,e);
      return { alertId: await unico(admin, `insert into app.obligation_alert(tenant_id,empresa_id,occurrence_id,identidade,prioridade,dias_restantes) values($1,$2,$3,'D3_EVOLUTIVO','ALTA',3) returning id`, [e.tenantId,e.empresaId,occurrence['occurrenceId']]) };
    },
    inserir: (banco,e,r) => unico(banco, `insert into app.obligation_channel_outbox(tenant_id,empresa_id,alert_id,usuario_id,canal,payload,idempotency_key,correlation_id) values($1,$2,$3,$4,'EMAIL_LOCAL','{}'::jsonb,$5,'rls-obligation') returning id`, [e.tenantId,e.empresaId,r['alertId'],e.autorId,`rls-outbox-${e.sufixo}-${proximo()}`]),
    colunaDeAtualizacao: 'tentativas', atualizacao: 'tentativas=tentativas+1',
  },
  'app.audit_event': {
    inserir: (banco,e) => inserirEventoDeAuditoria(banco,e),
  },
  'app.audit_payload': {
    preparar: async(admin,e) => ({ eventId: await inserirEventoDeAuditoria(admin,e,'b'.repeat(64)) }),
    inserir: (banco,e,r) => unico(banco,"insert into app.audit_payload(event_id,tenant_id,empresa_id,payload,payload_sha256) values($1,$2,$3,'{}'::jsonb,$4) returning event_id as id",[r['eventId'],e.tenantId,e.empresaId,'b'.repeat(64)]),
    colunaDeLeitura: 'event_id',
    colunaDeChave: 'event_id',
    colunaDeAtualizacao: 'event_id',
  },
  'app.audit_export_manifest': {
    preparar: async(admin,e) => {
      const jobId = await unico(admin,"insert into app.audit_export_job(tenant_id,empresa_id,requested_by,format,filters,empresas_autorizadas,correlation_id,estado,storage_key,artifact_sha256,item_count,expires_at) values($1,$2,$3,'JSON','{}'::jsonb,ARRAY[$2]::uuid[],'rls-audit-export','CONCLUIDA','test/audit.json',repeat('c',64),0,now()+interval '24 hours') returning id",[e.tenantId,e.empresaId,e.autorId]);
      return { jobId };
    },
    inserir: (banco,e,r) => unico(banco,"insert into app.audit_export_manifest(tenant_id,empresa_id,job_id,requested_by,format,filters,item_count,schema_version,artifact_sha256,expires_at) values($1,$2,$3,$4,'JSON','{}'::jsonb,0,1,repeat('c',64),now()+interval '24 hours') returning id",[e.tenantId,e.empresaId,r['jobId'],e.autorId]),
  },
  'app.audit_export_job': {
    inserir: (banco,e,r) => unico(banco,"insert into app.audit_export_job(tenant_id,empresa_id,requested_by,format,filters,empresas_autorizadas,correlation_id) values($1,$2,$3,'JSON','{}'::jsonb,ARRAY[$4::uuid]::uuid[],'rls-audit-export') returning id",[e.tenantId,e.empresaId,e.autorId,r['empresaAutorizada'] ?? e.empresaId]),
    colunaDeAtualizacao: 'estado', atualizacao: "estado='PROCESSANDO',storage_key=NULL,artifact_sha256=NULL,item_count=NULL,expires_at=NULL,atualizado_em=now()",
  },
  'app.audit_export_download': {
    preparar: async(admin,e) => ({ jobId: await unico(admin,"insert into app.audit_export_job(tenant_id,empresa_id,requested_by,format,filters,empresas_autorizadas,correlation_id,estado,storage_key,artifact_sha256,item_count,expires_at) values($1,$2,$3,'JSON','{}'::jsonb,ARRAY[$2]::uuid[],'rls-audit-export','CONCLUIDA','test/audit.json',repeat('c',64),0,now()+interval '24 hours') returning id",[e.tenantId,e.empresaId,e.autorId]) }),
    inserir: (banco,e,r) => unico(banco,"insert into app.audit_export_download(tenant_id,empresa_id,job_id,requested_by,correlation_id) values($1,$2,$3,$4,'rls-audit-download') returning id",[e.tenantId,e.empresaId,r['jobId'],e.autorId]),
  },
  'app.rfb_procuracao': {
    preparar: async(admin,e) => ({
      empresaCnpj: await unico(admin,"select cnpj id from app.empresa where id=$1 and tenant_id=$2",[e.empresaId,e.tenantId]),
      escritorioCnpj: await unico(admin,"select cnpj id from app.tenant where id=$1",[e.tenantId]),
    }),
    inserir: (banco,e,r) => unico(banco,
      `insert into app.rfb_procuracao(tenant_id,empresa_id,outorgante_cnpj,outorgado_cnpj,valid_from,valid_until,version_number,powers,created_by) values($1,$2,$3,$4,date '2098-01-01',date '2098-12-31',$5,'["RFB_CNPJ_STATUS_READ"]'::jsonb,$6) returning id`,
      [e.tenantId,e.empresaId,r['empresaCnpj'],r['escritorioCnpj'],1000+proximo(),e.autorId]),
  },
  'app.rfb_procuracao_evento': {
    preparar: async(admin,e) => ({procuracaoId:await unico(admin,
      `insert into app.rfb_procuracao(tenant_id,empresa_id,outorgante_cnpj,outorgado_cnpj,valid_from,valid_until,version_number,powers,created_by)
       select t.id,em.id,em.cnpj,t.cnpj,date '2098-01-01',date '2098-12-31',$3,'["RFB_CNPJ_STATUS_READ"]'::jsonb,$4
         from app.tenant t join app.empresa em on em.tenant_id=t.id where t.id=$1 and em.id=$2 returning id`,
      [e.tenantId,e.empresaId,2000+proximo(),e.autorId])}),
    inserir:(banco,e,r)=>unico(banco,
      `insert into app.rfb_procuracao_evento(tenant_id,empresa_id,procuracao_id,acao,correlation_id,idempotency_key) values($1,$2,$3,'CRIADA','rls-rfb-fixture',$4) returning id`,
      [e.tenantId,e.empresaId,r['procuracaoId'],`rfb-rls-${e.sufixo}-${proximo()}`]),
  },
  'app.rfb_procuracao_operacao': {
    preparar: async(admin,e) => ({procuracaoId:await unico(admin,
      `insert into app.rfb_procuracao(tenant_id,empresa_id,outorgante_cnpj,outorgado_cnpj,valid_from,valid_until,version_number,powers,created_by)
       select t.id,em.id,em.cnpj,t.cnpj,date '2098-01-01',date '2098-12-31',$3,'["RFB_CNPJ_STATUS_READ"]'::jsonb,$4
         from app.tenant t join app.empresa em on em.tenant_id=t.id where t.id=$1 and em.id=$2 returning id`,
      [e.tenantId,e.empresaId,3000+proximo(),e.autorId])}),
    inserir:(banco,e,r)=>unico(banco,
      `insert into app.rfb_procuracao_operacao(tenant_id,empresa_id,procuracao_id,poder,idempotency_key,resultado_codigo,resultado_resumo,correlation_id,ator_id) values($1,$2,$3,'RFB_CNPJ_STATUS_READ',$4,'FIXTURE','{}'::jsonb,'rls-rfb-op',$5) returning id`,
      [e.tenantId,e.empresaId,r['procuracaoId'],`rfb-op-${e.sufixo}-${proximo()}`,e.autorId]),
  },
  'app.rfb_procuracao_notificacao': {
    preparar: async(admin,e) => ({procuracaoId:await unico(admin,
      `insert into app.rfb_procuracao(tenant_id,empresa_id,outorgante_cnpj,outorgado_cnpj,valid_from,valid_until,version_number,powers,created_by)
       select t.id,em.id,em.cnpj,t.cnpj,date '2098-01-01',date '2098-12-31',$3,'["RFB_CNPJ_STATUS_READ"]'::jsonb,$4
         from app.tenant t join app.empresa em on em.tenant_id=t.id where t.id=$1 and em.id=$2 returning id`,
      [e.tenantId,e.empresaId,4000+proximo(),e.autorId])}),
    inserir:(banco,e,r)=>unico(banco,
      `insert into app.rfb_procuracao_notificacao(tenant_id,empresa_id,procuracao_id,usuario_id,marco) values($1,$2,$3,$4,'D30') returning id`,[e.tenantId,e.empresaId,r['procuracaoId'],e.autorId]),
    colunaDeAtualizacao:'lida',atualizacao:'lida=true,lida_em=now()',
  },
  'app.audit_payload_revelation': {
    preparar: async(admin,e) => ({ eventId: await inserirEventoDeAuditoria(admin,e,'d'.repeat(64)) }),
    inserir: (banco,e,r) => unico(banco,"insert into app.audit_payload_revelation(tenant_id,empresa_id,event_id,ator_id,justificativa,correlation_id) values($1,$2,$3,$4,'Justificativa de teste para revelar payload',$5) returning id",[e.tenantId,e.empresaId,r['eventId'],e.autorId,'rls-audit-revelation']),
  },
  'app.tax_entry_resolution_snapshot': {
    preparar: prepararDocumentoParaSnapshot,
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.tax_entry_resolution_snapshot
           (tenant_id,empresa_id,document_id,item_number,parser_version,revision,idempotency_key,input_sha256,facts,decisions,actor_id,correlation_id)
         values($1,$2,$3,1,'fixture',1,$4,repeat('a',64),'{}'::jsonb,'[]'::jsonb,$5,'rls-f26-fixture') returning id`,
        [e.tenantId,e.empresaId,r['documentId'],`f26-${e.sufixo}-${proximo()}`,e.autorId],
      ),
  },
  'app.tax_entry_resolution_event': {
    preparar: prepararDocumentoParaSnapshot,
    inserir: (banco,e,r) => unico(banco,
      `insert into app.tax_entry_resolution_event
        (tenant_id,empresa_id,document_id,actor_id,correlation_id,action,revision,package_id,item_count,indeterminate_count,idempotency_key)
       values($1,$2,$3,$4,'rls-f26-event','ABSTAINED',1,null,1,1,$5) returning id`,
      [e.tenantId,e.empresaId,r['documentId'],e.autorId,`f26-event-${e.sufixo}-${proximo()}`]),
  },
  'app.tax_entry_resolution_human_review': {
    preparar: async(admin,e)=>{
      const refs=await prepararDocumentoParaSnapshot(admin,e);
      const snapshotId=await unico(admin,
        `insert into app.tax_entry_resolution_snapshot (tenant_id,empresa_id,document_id,item_number,parser_version,revision,idempotency_key,input_sha256,facts,decisions,actor_id,correlation_id)
         values($1,$2,$3,1,'fixture',1,$4,repeat('b',64),'{}'::jsonb,$5::jsonb,$6,'rls-f28-review-fixture') returning id`,
        [e.tenantId,e.empresaId,refs['documentId'],`f28-review-${e.sufixo}-${proximo()}`,
          JSON.stringify([{tax:'ICMS_HISTORICAL',liabilityKind:'ICMS_ENTRY_ADVANCE',status:'APPLICABLE',amountDueCents:'100'}]),e.autorId]);
      return {...refs,snapshotId};
    },
    inserir: async (banco,e,r) => {
      return unico(banco,
        `insert into app.tax_entry_resolution_human_review(tenant_id,empresa_id,document_id,snapshot_id,item_number,revision,liability_kind,status,submitted_by,submitted_at,correlation_id)
         values($1,$2,$3,$4,1,1,'ICMS_ENTRY_ADVANCE','PENDING_REVIEW',$5,now(),'rls-f28-fixture') returning id`,
        [e.tenantId,e.empresaId,r['documentId'],r['snapshotId'],e.autorId]);
    },
    colunaDeAtualizacao:'status',
  },
  'app.tax_entry_resolution_human_review_event': {
    preparar: async(admin,e)=>{
      const refs=await prepararDocumentoParaSnapshot(admin,e);
      const snapshotId=await unico(admin,
        `insert into app.tax_entry_resolution_snapshot (tenant_id,empresa_id,document_id,item_number,parser_version,revision,idempotency_key,input_sha256,facts,decisions,actor_id,correlation_id)
         values($1,$2,$3,1,'fixture',1,$4,repeat('c',64),'{}'::jsonb,$5::jsonb,$6,'rls-f28-event-fixture') returning id`,
        [e.tenantId,e.empresaId,refs['documentId'],`f28-event-${e.sufixo}-${proximo()}`,
          JSON.stringify([{tax:'ICMS_HISTORICAL',liabilityKind:'ICMS_ENTRY_ADVANCE',status:'APPLICABLE',amountDueCents:'100'}]),e.autorId]);
      return {...refs,snapshotId};
    },
    inserir: async (banco,e,r) => {
      const reviewId=await unico(banco,
        `insert into app.tax_entry_resolution_human_review(tenant_id,empresa_id,document_id,snapshot_id,item_number,revision,liability_kind,status,submitted_by,submitted_at,correlation_id)
         values($1,$2,$3,$4,1,1,'ICMS_ENTRY_ADVANCE','PENDING_REVIEW',$5,now(),'rls-f28-fixture') returning id`,
        [e.tenantId,e.empresaId,r['documentId'],r['snapshotId'],e.autorId]);
      return unico(banco,
        `insert into app.tax_entry_resolution_human_review_event(tenant_id,empresa_id,review_id,action,actor_id,correlation_id,occurred_at,lock_version)
         values($1,$2,$3,'SUBMITTED',$4,'rls-f28-event',now(),1) returning id`,[e.tenantId,e.empresaId,reviewId,e.autorId]);
    },
  },
  'app.tax_monthly_rule_package': {
    inserir: (banco,e) => unico(banco, `insert into app.tax_monthly_rule_package
      (tenant_id,empresa_id,kind,version,valid_from,valid_through,consulted_at,official_basis,source_url,source_storage_key,
        source_sha256,content_sha256,canonical_json,requested_by,created_at)
      values($1,$2,'LUCRO_PRESUMIDO_PIS_COFINS',$3,'2026-01-01',null,'2026-01-01','Fixture RLS F37',
        'https://example.invalid/f37','fixture/f37/'||$3,repeat(md5($3||'s'),2),repeat(md5($3||'c'),2),'{}'::jsonb,$4,now()) returning id`,
    [e.tenantId,e.empresaId,`f37-${e.sufixo}-${proximo()}`,e.autorId]),
  },
  'app.tax_monthly_rule_package_event': {
    preparar: prepararApuracaoMensalF37,
    inserir: (banco,e,r) => unico(banco, `insert into app.tax_monthly_rule_package_event
      (tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'IMPORTED',$4,now(),'f37-rls-fixture') returning id`, [e.tenantId,e.empresaId,r['packageId'],e.autorId]),
  },
  'app.tax_monthly_declaration': {
    inserir: (banco,e) => unico(banco, `insert into app.tax_monthly_declaration
      (tenant_id,empresa_id,competence,kind,revision,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at,correlation_id)
      values($1,$2,'2026-01-01','LUCRO_PRESUMIDO_PIS_COFINS',$3,repeat(md5($4||'d'),2),repeat(md5($4||'h'),2),
        '{}'::jsonb,$5,now(),'f37-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,proximo(),`f37-${e.sufixo}-${proximo()}`,e.autorId]),
  },
  'app.tax_monthly_declaration_event': {
    preparar: prepararApuracaoMensalF37,
    inserir: (banco,e,r) => unico(banco, `insert into app.tax_monthly_declaration_event
      (tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'DECLARED',$4,now(),'f36-rls-fixture') returning id`, [e.tenantId,e.empresaId,r['declarationId'],e.autorId]),
  },
  'app.tax_monthly_evidence': {
    preparar: prepararApuracaoMensalF37,
    inserir: (banco,e,r) => unico(banco, `insert into app.tax_monthly_evidence
      (tenant_id,empresa_id,declaration_id,kind,description,file_name,storage_key,content_sha256,requested_by,created_at)
      values($1,$2,$3,'DECLARACAO','Fixture RLS F37','fixture.pdf','fixture/f37/'||$4,repeat(md5($4||'e'),2),$5,now()) returning id`,
    [e.tenantId,e.empresaId,r['declarationId'],r['marker'],e.autorId]),
  },
  'app.tax_monthly_assessment': {
    preparar: prepararApuracaoMensalF37,
    inserir: (banco,e,r) => unico(banco, `insert into app.tax_monthly_assessment
      (tenant_id,empresa_id,competence,kind,revision,rule_package_id,declaration_id,idempotency_sha256,content_sha256,status,
        canonical_json,prepared_by,revision_created_at,correlation_id)
      values($1,$2,'2026-01-01','LUCRO_PRESUMIDO_PIS_COFINS',$3,$4,$5,repeat(md5($6||'a'),2),repeat(md5($6||'b'),2),
        'DRAFT','{}'::jsonb,$7,now(),'f37-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,proximo(),r['packageId'],r['declarationId'],r['marker'],e.autorId]),
  },
  'app.tax_monthly_assessment_event': {
    preparar: async(admin,e) => {
      const refs=await prepararApuracaoMensalF37(admin,e);
      const assessmentId=await unico(admin, `insert into app.tax_monthly_assessment
        (tenant_id,empresa_id,competence,kind,revision,rule_package_id,declaration_id,idempotency_sha256,content_sha256,status,
          canonical_json,prepared_by,revision_created_at,correlation_id)
        values($1,$2,'2026-01-01','LUCRO_PRESUMIDO_PIS_COFINS',$3,$4,$5,repeat(md5($6||'a'),2),repeat(md5($6||'b'),2),
          'DRAFT','{}'::jsonb,$7,now(),'f37-rls-fixture') returning id`,
      [e.tenantId,e.empresaId,proximo(),refs['packageId'],refs['declarationId'],refs['marker'],e.autorId]);
      return {...refs,assessmentId};
    },
    inserir: (banco,e,r) => unico(banco, `insert into app.tax_monthly_assessment_event
      (tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id)
      values($1,$2,$3,'CREATED',$4,now(),'f37-rls-fixture') returning id`, [e.tenantId,e.empresaId,r['assessmentId'],e.autorId]),
  },
  'app.corporate_tax_rule_package': {
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_rule_package
      (tenant_id,empresa_id,version,valid_from,valid_through,consulted_at,official_basis,source_url,source_storage_key,source_sha256,content_sha256,canonical_json,requested_by,created_at)
      values($1,$2,$3,'2026-01-01','2026-12-31','2026-01-01','Fixture RLS F38','https://example.invalid/f38',$4,repeat(md5($5||'s'),2),repeat(md5($5||'c'),2),'{}'::jsonb,$6,now()) returning id`,
    [e.tenantId,e.empresaId,`package-${r['marker']}-${proximo()}`,`fiscal/f38/${r['marker']}/${proximo()}`,`${r['marker']}-${proximo()}`,e.autorId]),
  },
  'app.corporate_tax_rule_package_event': {
    preparar: prepararApuracaoCorporativaF38,
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_rule_package_event
      (tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
      values($1,$2,$3,'IMPORTED',$4,now(),'f38-rls-fixture','{}'::jsonb) returning id`, [e.tenantId,e.empresaId,r['packageId'],e.autorId]),
  },
  'app.corporate_tax_declaration': {
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_declaration
      (tenant_id,empresa_id,quarter,recognition,revision,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at,correlation_id)
      values($1,$2,'2026-Q1','ACCRUAL',$3,repeat(md5($4||'d'),2),repeat(md5($4||'h'),2),'{}'::jsonb,$5,now(),'f38-rls-fixture') returning id`,
    [e.tenantId,e.empresaId,proximo(),`${r['marker']}-${proximo()}`,e.autorId]),
  },
  'app.corporate_tax_declaration_event': {
    preparar: prepararApuracaoCorporativaF38,
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_declaration_event
      (tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
      values($1,$2,$3,'DECLARED',$4,now(),'f38-rls-fixture','{}'::jsonb) returning id`, [e.tenantId,e.empresaId,r['declarationId'],e.autorId]),
  },
  'app.corporate_tax_evidence': {
    preparar: prepararApuracaoCorporativaF38,
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_evidence
      (tenant_id,empresa_id,declaration_id,kind,description,file_name,storage_key,content_sha256,requested_by,created_at)
      values($1,$2,$3,'FIXTURE','Fixture RLS F38','fixture.pdf',$4,repeat(md5($5),2),$6,now()) returning id`,
    [e.tenantId,e.empresaId,r['declarationId'],`fiscal/f38/evidence/${proximo()}`,`${r['marker']}-${proximo()}`,e.autorId]),
  },
  'app.corporate_tax_assessment': {
    preparar: prepararApuracaoCorporativaF38,
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_assessment
      (tenant_id,empresa_id,quarter,revision,status,recognition,package_id,declaration_id,installment_count,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at)
      values($1,$2,'2026-Q1',$3,'INDETERMINATE','ACCRUAL',$4,$5,1,repeat(md5($6||'a'),2),repeat(md5($6||'c'),2),'{}'::jsonb,$7,now()) returning id`,
    [e.tenantId,e.empresaId,proximo(),r['packageId'],r['declarationId'],`${r['marker']}-${proximo()}`,e.autorId]),
  },
  'app.corporate_tax_assessment_event': {
    preparar: prepararApuracaoCorporativaF38,
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_assessment_event
      (tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
      values($1,$2,$3,'PREPARED',$4,now(),'f38-rls-fixture','{}'::jsonb) returning id`, [e.tenantId,e.empresaId,r['assessmentId'],e.autorId]),
  },
  'app.corporate_tax_artifact': {
    preparar: prepararApuracaoCorporativaF38,
    inserir: (banco,e,r) => unico(banco, `insert into app.corporate_tax_artifact
      (tenant_id,empresa_id,assessment_id,format,storage_key,artifact_sha256,canonical_sha256,created_by,created_at)
      values($1,$2,$3,'PDF',$4,repeat(md5($5||'a'),2),repeat(md5($5||'c'),2),$6,now()) returning id`,
    [e.tenantId,e.empresaId,r['assessmentId'],`fiscal/f38/artifact/${proximo()}`,`${r['marker']}-${proximo()}`,e.autorId]),
  },
};
