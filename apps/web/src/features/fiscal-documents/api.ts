import { ler } from '../importacao/api';
import { requisitar } from '@/lib/http';
import { z } from 'zod';

const EstadoDocumentoFiscalSchema = z.enum([
  'PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'PENDENTE_LAYOUT', 'PENDENTE_IBS_CBS', 'XML_INVALIDO', 'CONFLITO', 'FALHA',
]);
const UuidPersistidoSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
export const ApuracaoIcmsStSchema=z.object({id:UuidPersistidoSchema,revision:z.number().int(),status:z.enum(['BLOCKED','PENDING_REVIEW','APPROVED','REJECTED','STALE']),review_action:z.string().nullable().optional(),competence:z.string(),gross_restitution_cents:z.string().nullable(),gross_complement_cents:z.string().nullable(),net_amount_cents:z.string().nullable(),blocked_line_count:z.number().int(),line_count:z.number().int(),line_page:z.number().int().positive(),line_page_size:z.number().int().positive(),line_total_pages:z.number().int().nonnegative(),facts:z.record(z.string(),z.unknown()),processed_at:z.string(),lines:z.array(z.record(z.string(),z.unknown())),events:z.array(z.record(z.string(),z.unknown())),returnEvents:z.array(z.record(z.string(),z.unknown())).default([]),c002Lines:z.array(z.string()).default([])});
export const ResultadoApuracaoIcmsStSchema=z.object({id:UuidPersistidoSchema,revision:z.number().int(),status:z.enum(['BLOCKED','PENDING_REVIEW']),reused:z.boolean(),blockedLineCount:z.number().int().optional(),packageId:UuidPersistidoSchema.nullable()});
const DocumentoFiscalSchema = z.object({
  id: UuidPersistidoSchema, especie: z.enum(['NFE_55', 'CTE', 'NFCE_65']), chave_acesso: z.string().nullable(), hash_sha256: z.string().nullable(),
  emitido_em: z.string().nullable(), emitente: z.string().nullable(), destinatario: z.string().nullable(), total: z.string().nullable(),
  estado: EstadoDocumentoFiscalSchema, versao_layout: z.string().nullable(), criado_em: z.string(), nsu: z.string().nullable(),
  capturado_em: z.string().nullable(), atividade_em: z.string().nullable(), origens: z.number().int().nonnegative(),
});
export type DocumentoFiscal = z.infer<typeof DocumentoFiscalSchema>;
const ItemFiscalSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const ParteFiscalSchema = z.object({
  papel: z.enum(['EMITENTE', 'DESTINATARIO']), identificador: z.string().nullable(), nome: z.string().nullable(), inscricao_estadual: z.string().nullable(),
  logradouro: z.string().nullable(), numero: z.string().nullable(), complemento: z.string().nullable(), bairro: z.string().nullable(),
  codigo_municipio: z.string().nullable(), municipio: z.string().nullable(), uf: z.string().nullable(), cep: z.string().nullable(),
  codigo_pais: z.string().nullable(), pais: z.string().nullable(),
});
const TributoFiscalSchema = z.object({
  escopo: z.enum(['DOCUMENTO', 'ITEM']), numero_item: z.number().int().nullable(), codigo: z.enum(['ICMS', 'ICMS_ST', 'IPI', 'II', 'PIS', 'COFINS', 'IBS', 'CBS']),
  base_calculo: z.string().nullable(), aliquota: z.string().nullable(), valor: z.string().nullable(), situacao: z.string().nullable(), classificacao: z.string().nullable(),
});
// A função de IDs do banco preserva a forma UUID, mas não marca os bits RFC de versão/variante.
const DocumentoFiscalDetalheSchema = z.object({
  id: z.string().uuid(), especie: z.enum(['NFE_55', 'CTE']), parser_version: z.string(), chave_acesso: z.string().nullable(), hash_sha256: z.string(), tamanho_bytes: z.number().int().nonnegative(),
  estado: EstadoDocumentoFiscalSchema.exclude(['PENDENTE', 'PROCESSANDO']), emitido_em: z.string().nullable(), emitente: z.string().nullable(), destinatario: z.string().nullable(),
  total: z.string().nullable(), base_ibs_cbs: z.string().nullable(), total_ibs: z.string().nullable(), total_cbs: z.string().nullable(), itens: z.array(ItemFiscalSchema),
  protocolo: z.string().nullable(), protocolo_recebido_em: z.string().nullable(), referencias: z.array(z.object({ tipo: z.string(), chave: z.string() })),
  partes: z.array(ParteFiscalSchema),
  tributos: z.array(TributoFiscalSchema),
  origens: z.array(z.object({ nsu: z.string(), capturado_em: z.string() })),
  eventos: z.array(z.object({ tipo: z.string(), codigo: z.string().nullable(), ocorrido_em: z.string() })),
});
export type DocumentoFiscalDetalhe = z.infer<typeof DocumentoFiscalDetalheSchema>;
const HistoricalLiabilitySchema=z.enum(['ICMS_ST_RECIPIENT_DUE','ICMS_ENTRY_ADVANCE','ICMS_ST_JOINT_LIABILITY']);
const DecisaoTributariaSchema=z.object({tax:z.enum(['ICMS','PIS','COFINS','IBS_UF','IBS_MUN','CBS','ICMS_HISTORICAL']),liabilityKind:HistoricalLiabilitySchema.optional(),relation:z.string().nullable().optional(),amountDueCents:z.string().nullable().optional(),memory:z.record(z.string(),z.unknown()).nullable().optional(),approvalStatus:z.enum(['NOT_SUBMITTED','PENDING','APPROVED','REJECTED']).nullable().optional(),status:z.enum(['APPLICABLE','NOT_APPLICABLE','INDETERMINATE']),creditEligibility:z.enum(['ALLOWED','BLOCKED','INDETERMINATE','NOT_RELEVANT']),ruleId:z.string().nullable(),reasons:z.array(z.string()),checks:z.array(z.object({code:z.string(),status:z.enum(['VALID','INVALID','NOT_CHECKED']),fields:z.array(z.string()),reasons:z.array(z.string())})).optional(),declaredEvidence:z.record(z.string(),z.unknown()).nullable().optional(),missingInputs:z.array(z.string()),sourceIds:z.array(z.string()),rationale:z.string()});
const HumanReviewEventSchema=z.object({action:z.enum(['SUBMITTED','APPROVED','REJECTED']),actor_id:UuidPersistidoSchema,occurred_at:z.union([z.string(),z.date()]),rejection_reason:z.string().nullable().optional()}).passthrough();
const HumanReviewSchema=z.object({id:UuidPersistidoSchema,snapshot_id:UuidPersistidoSchema,tenant_id:UuidPersistidoSchema,empresa_id:UuidPersistidoSchema,document_id:UuidPersistidoSchema,item_number:z.number().int().positive(),revision:z.number().int().positive(),liability_kind:HistoricalLiabilitySchema,status:z.enum(['PENDING_REVIEW','APPROVED','REJECTED']),submitted_by:UuidPersistidoSchema,submitted_at:z.union([z.string(),z.date()]),decided_by:UuidPersistidoSchema.nullable(),decided_at:z.union([z.string(),z.date()]).nullable(),rejection_reason:z.string().nullable(),lock_version:z.number().int().positive(),events:z.array(HumanReviewEventSchema).optional()});
const SnapshotTributarioSchema=z.object({id:UuidPersistidoSchema,tenant_id:UuidPersistidoSchema,empresa_id:UuidPersistidoSchema,document_id:UuidPersistidoSchema,item_number:z.number().int().positive(),parser_version:z.string(),revision:z.number().int().positive(),idempotency_key:z.string(),input_sha256:z.string(),package_id:UuidPersistidoSchema.nullable(),package_sha256:z.string().nullable(),facts:z.record(z.string(),z.unknown()),decisions:z.array(DecisaoTributariaSchema),human_reviews:z.array(HumanReviewSchema).optional(),reprocessing_reason:z.string().nullable(),actor_id:UuidPersistidoSchema,correlation_id:z.string(),processed_at:z.union([z.string(),z.date()]).transform((value)=>value instanceof Date?value.toISOString():value)});
export type SnapshotTributarioUI = z.infer<typeof SnapshotTributarioSchema>;
const SnapshotsTributariosSchema=z.object({itens:z.array(SnapshotTributarioSchema)});
const PacoteCuradoResumoSchema=z.object({id:z.string().uuid(),packageId:z.string(),semanticVersion:z.string(),status:z.enum(['IMPORTED','VALIDATED','REVIEWED','PUBLISHED','ARCHIVED']),jurisdiction:z.enum(['BR','GO']),regimes:z.array(z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO'])),validFrom:z.string(),validUntil:z.string().nullable(),coverage:z.array(z.string()),exclusions:z.array(z.string()),sha256:z.string(),importedBy:z.string().uuid(),importedAt:z.string(),reviewedBy:z.string().uuid().nullable(),reviewedAt:z.string().nullable(),publishedBy:z.string().uuid().nullable(),publishedAt:z.string().nullable(),archivedAt:z.string().nullable()});
const PacotesCuradosSchema=z.object({canAdminister:z.boolean(),actorId:z.string().uuid(),items:z.array(PacoteCuradoResumoSchema)});
const PacoteComandoSchema=z.object({id:z.string().uuid(),packageId:z.string(),semanticVersion:z.string(),status:z.enum(['IMPORTED','VALIDATED','REVIEWED','PUBLISHED','ARCHIVED']),sha256:z.string()});
const ResultadoValidacaoPacoteSchema=PacoteComandoSchema.extend({validation:z.object({valid:z.boolean(),errors:z.array(z.string())})}).or(PacoteComandoSchema);
const ResultadoResolucaoTributariaSchema=z.object({revision:z.number().int().positive(),reused:z.boolean(),snapshots:z.array(SnapshotTributarioSchema)});
const ComparacaoTributariaSchema=z.object({fromRevision:z.number().int().positive(),toRevision:z.number().int().positive(),diff:z.array(z.object({itemNumber:z.number().int().positive(),changed:z.boolean(),from:SnapshotTributarioSchema.nullable(),to:SnapshotTributarioSchema.nullable()})),from:z.array(SnapshotTributarioSchema),to:z.array(SnapshotTributarioSchema)});
const ListaDeDocumentosFiscaisSchema = z.object({ pagina: z.number().int().positive(), temProximaPagina: z.boolean(), itens: z.array(DocumentoFiscalSchema) });
const FilaResolucaoTributariaSchema=z.object({pagina:z.number().int().positive(),temProximaPagina:z.boolean(),total:z.number().int().nonnegative(),itens:z.array(z.object({
  id:UuidPersistidoSchema,chave_acesso:z.string().nullable(),emitido_em:z.union([z.string(),z.date()]).transform((value)=>value instanceof Date?value.toISOString():value),
  emitente:z.string().nullable(),destinatario:z.string().nullable(),modelo:z.string(),protocolo:z.string(),item_count:z.number().int().nonnegative(),
  regime:z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']).nullable(),revision:z.number().int().positive().nullable(),package_id:UuidPersistidoSchema.nullable(),
  has_indeterminate:z.boolean().nullable(),resolution_state:z.enum(['SEM_PROCESSAMENTO','INDETERMINADO','RESOLVIDO']),
}))});
const IntegridadeFiscalSchema = z.object({ documentId: z.string().uuid(), estado: z.literal('INTEGRO'), verificadoEm: z.string() });
const ReprocessamentoFiscalSchema = z.object({ documentId: z.string().uuid(), status: z.literal('QUEUED') });
const EstadoDaCienciaSchema=z.enum(['RESUMO_CAPTURADO','CIENCIA_PENDENTE','CIENCIA_EM_ENVIO','CIENCIA_REGISTRADA','XML_COMPLETO_PENDENTE','XML_COMPLETO_OBTIDO','PARSEADO','JA_MANIFESTADO','XML_COMPLETO_JA_DISPONIVEL','RESULTADO_INCERTO','RETRY_AGENDADO','REJEITADO','IMPEDIDO','DLQ']);
const CienciaDaEmissaoSchema=z.object({id:z.string().uuid(),staging_id:z.string().uuid(),xml_staging_id:z.string().uuid().nullable(),chave_acesso:z.string().nullable(),estado:EstadoDaCienciaSchema,
  tentativas:z.number().int(),tentativas_ciencia:z.number().int(),tentativas_xml:z.number().int(),protocolo:z.string().nullable(),ambiente:z.string().nullable(),codigo:z.string().nullable(),motivo_sanitizado:z.string().nullable(),
  proxima_tentativa_em:z.string().nullable(),solicitada_em:z.string(),atualizado_em:z.string(),nsu_resumo:z.string(),nsu_xml:z.string().nullable()});
const ListaCienciasSchema=z.object({itens:z.array(CienciaDaEmissaoSchema)});
const DetalheCienciaSchema=z.object({ciencia:CienciaDaEmissaoSchema,historico:z.array(z.record(z.string(),z.unknown())),tentativas:z.array(z.record(z.string(),z.unknown()))});
const RetomadaCienciaSchema=z.object({acknowledgementId:z.string().uuid(),status:z.literal('SCHEDULED')});

const FornecedorAprovadoSchema=z.object({id:z.string().uuid(),cnpj:z.string(),nome_exibicao:z.string(),situacao:z.enum(['ATIVO','ARQUIVADO']),motivo:z.string(),ator_id:z.string().uuid(),criado_em:z.string()});
const ConfiguracaoDeRiscoSchema=z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),empresa_id:z.string().uuid(),versao:z.number().int(),limite_centavos:z.string(),motivo:z.string(),ator_id:z.string().uuid(),criado_em:z.string(),fornecedores:z.array(FornecedorAprovadoSchema)});
export const ConfiguracaoDeRiscoRespostaSchema=z.object({configuracao:ConfiguracaoDeRiscoSchema.nullable(),historico:z.array(ConfiguracaoDeRiscoSchema)});
export type ConfiguracaoDeRiscoUI=z.infer<typeof ConfiguracaoDeRiscoSchema>;
const AnaliseRiscoSchema=z.object({id:z.string().uuid(),tipo_manifestacao:z.enum(['210200','210220','210240','ABSTER_SE']),confianca:z.union([z.string(),z.number()]),faixa_confianca:z.string(),justificativa:z.string(),riscos:z.array(z.unknown()),evidencias:z.array(z.unknown()),lacunas:z.array(z.unknown()),origem:z.string(),provedor:z.string().nullable(),modelo:z.string().nullable(),versao_prompt:z.string().nullable(),versao_schema:z.string(),fallback:z.boolean(),tokens_entrada:z.number().nullable(),tokens_saida:z.number().nullable(),custo_microusd:z.string().nullable(),duracao_ms:z.number(),analisado_em:z.string().nullable()}).passthrough();
const ExecucaoRiscoSchema=z.object({id:z.string().uuid(),estado:z.enum(['AGUARDANDO','PROCESSANDO','CONCLUIDA','INELEGIVEL','ABSTER_SE','FALHA','DLQ']),tentativas:z.number().int(),codigo_erro:z.string().nullable(),parser_version:z.string(),classifier_version:z.string(),configuration_id:z.string().uuid(),correlation_id:z.string(),solicitado_em:z.string(),atualizado_em:z.string(),analysis_id:z.string().uuid().nullable(),tipo_manifestacao:z.enum(['210200','210220','210240','ABSTER_SE']).nullable(),confianca:z.union([z.string(),z.number()]).nullable(),faixa_confianca:z.string().nullable(),justificativa:z.string().nullable(),riscos:z.array(z.unknown()).nullable(),evidencias:z.array(z.unknown()).nullable(),lacunas:z.array(z.unknown()).nullable(),origem:z.string().nullable(),provedor:z.string().nullable(),modelo:z.string().nullable(),versao_prompt:z.string().nullable(),versao_schema:z.string().nullable(),fallback:z.boolean().nullable(),tokens_entrada:z.number().nullable(),tokens_saida:z.number().nullable(),custo_microusd:z.string().nullable(),duracao_ms:z.number().nullable(),analisado_em:z.string().nullable()});
export const AnalisesDeRiscoSchema=z.object({documento:z.record(z.string(),z.unknown()),execucoes:z.array(ExecucaoRiscoSchema)});
export type ExecucaoDeRiscoUI=z.infer<typeof ExecucaoRiscoSchema>;
const ReprocessamentoDeRiscoSchema=z.object({documentId:z.string().uuid(),executionId:z.string().uuid(),status:z.literal('QUEUED')});
const InboxManifestacaoSchema=z.object({itens:z.array(z.object({document_id:z.string().uuid(),chave_acesso:z.string(),emitente:z.string().nullable(),total:z.union([z.string(),z.number()]).nullable(),analysis_id:z.string().uuid(),tipo_manifestacao:z.enum(['210200','210220','210240']),confianca:z.union([z.string(),z.number()]),faixa_confianca:z.string(),riscos:z.array(z.unknown()),evidencias:z.array(z.unknown()),lacunas:z.array(z.unknown()),proposta:z.string(),dias_restantes:z.number().int(),risco_alto:z.number().int()})),pagina:z.number().int().optional()});
export type ItemInboxManifestacao=z.infer<typeof InboxManifestacaoSchema>['itens'][number];
export const listarInboxManifestacoes=async(empresaId:string,filtros:URLSearchParams)=>InboxManifestacaoSchema.parse(await ler(`/companies/${empresaId}/fiscal-manifestations/inbox?${filtros.toString()}`));
export const decidirManifestacao=async(empresaId:string,body:Readonly<{documentId:string;analysisId:string;chaveAcesso:string;tipo:'210200'|'210220'|'210240';rejeitada:boolean;motivoTroca:string|null;categoria:string|null;nota:string|null;xJust:string|null}>)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-manifestations/decisions`,{method:'POST',body:JSON.stringify(body)});
export const aprovarLote210200=async(empresaId:string,items:readonly Readonly<{documentId:string;analysisId:string;chaveAcesso:string;tipo:'210200'}>[] )=>requisitar<unknown>(`/companies/${empresaId}/fiscal-manifestations/batch-210200`,{method:'POST',body:JSON.stringify({items})});
const HistoricoManifestacaoSchema=z.object({itens:z.array(z.object({id:z.string().uuid(),document_id:z.string().uuid(),chave_acesso:z.string(),tipo:z.string(),estado:z.string(),aprovador_id:z.string().uuid(),criado_em:z.string(),atualizado_em:z.string(),evento_estado:z.string().nullable(),codigo:z.string().nullable(),detalhe_sanitizado:z.string().nullable(),protocolo:z.string().nullable(),ocorrido_em:z.string().nullable()}))});
export const listarHistoricoManifestacoes=async(empresaId:string,pagina=1)=>HistoricoManifestacaoSchema.parse(await ler(`/companies/${empresaId}/fiscal-manifestations/history?pagina=${pagina}`));
export const reconciliarManifestacao=async(empresaId:string,manifestationId:string)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-manifestations/${manifestationId}/reconciliation`,{method:'POST',body:JSON.stringify({})});

export type CienciaDaEmissaoUI=z.infer<typeof CienciaDaEmissaoSchema>;

export const listarDocumentosFiscais = async (empresaId: string, pagina: number, estado: string) => {
  const consulta = new URLSearchParams({ pagina: String(pagina) });
  if (estado !== 'TODOS') consulta.set('estado', estado);
  return ListaDeDocumentosFiscaisSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents?${consulta.toString()}`));
};
export const listarFilaResolucaoTributaria=async(empresaId:string,filtros:Readonly<{pagina:number;de:string;ate:string;regime:string;estado:string;indeterminados:string}>)=>{
  const query=new URLSearchParams({pagina:String(filtros.pagina)});
  if(filtros.de)query.set('de',filtros.de);if(filtros.ate)query.set('ate',filtros.ate);
  if(filtros.regime!=='TODOS')query.set('regime',filtros.regime);
  if(filtros.estado!=='TODOS')query.set('estadoResolucao',filtros.estado);
  if(filtros.indeterminados!=='TODOS')query.set('indeterminados',filtros.indeterminados==='SIM'?'true':'false');
  return FilaResolucaoTributariaSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/tax-treatment-resolutions/queue?${query.toString()}`));
};
export const obterDocumentoFiscal = async (empresaId: string, documentId: string) =>
  DocumentoFiscalDetalheSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/${documentId}`));
export const listarResolucaoTributaria = async (empresaId:string,documentId:string) => SnapshotsTributariosSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/${documentId}/tax-treatment-resolutions`));
export const submeterRevisaoHistorica=async(empresaId:string,snapshotId:string,liabilityKind:z.infer<typeof HistoricalLiabilitySchema>)=>HumanReviewSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/${snapshotId}/historical-reviews`,{method:'POST',body:JSON.stringify({liabilityKind})}));
export const decidirRevisaoHistorica=async(empresaId:string,reviewId:string,input:Readonly<{expectedVersion:number;action:'APPROVED'|'REJECTED';reason:string|null}>)=>HumanReviewSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/tax-treatment-resolutions/historical-reviews/${reviewId}/decision`,{method:'POST',body:JSON.stringify(input)}));
export type PacotesCuradosUI=z.infer<typeof PacotesCuradosSchema>;
export const listarPacotesTributarios = async ():Promise<PacotesCuradosUI> => PacotesCuradosSchema.parse(await ler('/tax-packages'));
export const importarPacoteTributario = async (body:unknown) => PacoteComandoSchema.parse(await requisitar<unknown>('/tax-packages',{method:'POST',body:JSON.stringify(body)}));
export const validarPacoteTributario = async (id:string) => ResultadoValidacaoPacoteSchema.parse(await requisitar<unknown>(`/tax-packages/${id}/validate`,{method:'POST',body:JSON.stringify({})}));
export const revisarPacoteTributario = async (id:string,declaration:string) => PacoteComandoSchema.parse(await requisitar<unknown>(`/tax-packages/${id}/review`,{method:'POST',body:JSON.stringify({declaration})}));
export const publicarPacoteTributario = async (id:string) => PacoteComandoSchema.parse(await requisitar<unknown>(`/tax-packages/${id}/publish`,{method:'POST',body:JSON.stringify({})}));
export const arquivarPacoteTributario = async (id:string) => PacoteComandoSchema.parse(await requisitar<unknown>(`/tax-packages/${id}/archive`,{method:'POST',body:JSON.stringify({})}));
export const processarResolucaoTributaria = async (empresaId:string,documentId:string,input:Readonly<{expectedDocumentRevision:string;packageId?:string;resaleItemNumbers:readonly number[];idempotencyKey:string;reprocessingReason?:string}>) => {
  const resposta = await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/${documentId}/tax-treatment-resolutions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  const resultado = ResultadoResolucaoTributariaSchema.safeParse(resposta);
  if (!resultado.success) throw new Error(`Resposta de resolução tributária inválida: ${resultado.error.message}`);
  return resultado.data;
};
export const processarApuracaoIcmsSt=async(empresaId:string,input:Readonly<{competence:string;idempotencyKey:string;reprocessingReason?:string}>)=>ResultadoApuracaoIcmsStSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-settlements`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
export const revisarApuracaoIcmsSt=async(empresaId:string,id:string,input:Readonly<{expectedRevision:number;action:'SUBMITTED'|'APPROVED'|'REJECTED';reason?:string}>)=>z.object({snapshotId:UuidPersistidoSchema,revision:z.number().int(),action:z.enum(['SUBMITTED','APPROVED','REJECTED'])}).parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-settlements/${id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
export const obterApuracaoIcmsSt=async(empresaId:string,id:string,pagina=1,modelo?:'55'|'65')=>ApuracaoIcmsStSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-settlements/${id}?pagina=${pagina}${modelo?`&modelo=${modelo}`:''}`));
export const listarApuracoesIcmsSt=async(empresaId:string,modelo?:'55'|'65')=>z.object({itens:z.array(z.object({id:UuidPersistidoSchema,competence:z.string(),revision:z.number().int(),status:z.enum(['BLOCKED','PENDING_REVIEW','APPROVED','REJECTED','STALE']),processed_at:z.string(),gross_restitution_cents:z.string().nullable(),gross_complement_cents:z.string().nullable(),net_amount_cents:z.string().nullable(),line_count:z.number().int(),blocked_line_count:z.number().int(),review_action:z.string().nullable()}))}).parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-settlements${modelo?`?modelo=${modelo}`:''}`));
export const gerarPacoteHistoricoIcmsSt=async(empresaId:string,input:Readonly<{regime:'SIMPLES_NACIONAL'|'LUCRO_PRESUMIDO';periodStart:string;periodEnd:string}>)=>z.object({id:UuidPersistidoSchema,hash:z.string().regex(/^[0-9a-f]{64}$/u),reused:z.boolean(),package:z.record(z.string(),z.unknown())}).parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-history-packages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
const FontesAcrescimosF34Schema=z.object({itens:z.array(z.object({id:UuidPersistidoSchema,regime:z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']),periodStart:z.string(),periodEnd:z.string(),status:z.string(),hash:z.string(),periodComplete:z.boolean(),approved:z.boolean(),superseded:z.boolean()}))});
const PacotesNormativosF34Schema=z.object({itens:z.array(z.object({id:UuidPersistidoSchema,version:z.string(),coverageThrough:z.string(),hash:z.string(),status:z.string()}))});
const AtosFormaisF34Schema=z.object({itens:z.array(z.object({id:UuidPersistidoSchema,issuer:z.string(),actNumber:z.string(),actType:z.string(),actDate:z.string(),periodStart:z.string(),periodEnd:z.string(),hash:z.string(),status:z.string(),components:z.array(z.string())}))});
const ResultadosAcrescimosF34Schema=z.object({itens:z.array(z.object({id:UuidPersistidoSchema,referenceDate:z.string(),status:z.enum(['READY_FOR_INTERNAL_REVIEW','INDETERMINATE','SUPERSEDED']),hash:z.string(),generatedAt:z.string()}))});
export const listarFontesAcrescimosF34=async(empresaId:string)=>FontesAcrescimosF34Schema.parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-legal-accrual-sources`));
export const aprovarFonteF33ParaF34=async(empresaId:string,packageId:string)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-history-packages/${packageId}/legal-approval`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
export const listarPacotesNormativosF34=async(empresaId:string)=>PacotesNormativosF34Schema.parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-legal-rule-packages`));
export const importarPacoteNormativoF34=async(empresaId:string,manifest:Readonly<Record<string,unknown>>,sources:readonly File[])=>{
  const form=new FormData();form.set('manifest',JSON.stringify(manifest));for(const file of sources)form.append('sources',file,file.name);
  return requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-legal-rule-packages`,{method:'POST',body:form});
};
export const decidirPacoteNormativoF34=async(empresaId:string,id:string,action:'APPROVED'|'REJECTED',reason?:string)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-legal-rule-packages/${id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,reason:reason??null})});
export const listarAtosFormaisF34=async(empresaId:string,packageId:string)=>AtosFormaisF34Schema.parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-history-packages/${packageId}/legal-acts`));
export const importarAtoFormalF34=async(empresaId:string,packageId:string,input:Readonly<{issuer:string;actNumber:string;actType:'ASSESSMENT_NOTICE'|'SUMMONS'|'DECISION'|'OTHER';actDate:string;periodStart:string;periodEnd:string;officialBasis:string;canonicalFacts:Readonly<Record<string,unknown>>;arquivo:File}>)=>{
  const form=new FormData();for(const [key,value] of Object.entries(input))if(key!=='arquivo')form.set(key,typeof value==='string'?value:JSON.stringify(value));form.set('arquivo',input.arquivo,input.arquivo.name);
  return requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-history-packages/${packageId}/legal-acts`,{method:'POST',body:form});
};
export const decidirAtoFormalF34=async(empresaId:string,id:string,action:'APPROVED'|'REJECTED',reason?:string)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-legal-acts/${id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,reason:reason??null})});
export const calcularAcrescimosLegaisF34=async(empresaId:string,input:Readonly<{sourcePackageId:string;referenceDate:string;rulePackageId:string|null;formalActIds:readonly string[]}>)=>z.object({id:UuidPersistidoSchema,hash:z.string().regex(/^[0-9a-f]{64}$/u),reused:z.boolean(),result:z.record(z.string(),z.unknown())}).parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-legal-accruals`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
export const listarResultadosAcrescimosF34=async(empresaId:string,sourcePackageId:string)=>ResultadosAcrescimosF34Schema.parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-legal-accruals?sourcePackageId=${sourcePackageId}`));
export const revisarAcrescimosLegaisF34=async(empresaId:string,resultId:string,reason:string)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-legal-accruals/${resultId}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason})});
export const obterResultadoAcrescimosF34=async(empresaId:string,resultId:string)=>z.object({id:UuidPersistidoSchema,hash:z.string().regex(/^[0-9a-f]{64}$/u),result:z.record(z.string(),z.unknown())}).parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-legal-accruals/${resultId}/detail`));
export const baixarAcrescimosLegaisF34=async(empresaId:string,resultId:string,format:'PDF'|'CSV'|'JSON')=>{
  const response=await fetch(`/api/proxy/companies/${empresaId}/fiscal-documents/icms-st-legal-accruals/${resultId}?format=${format}`,{credentials:'include'});
  if(!response.ok)throw new Error('Não foi possível exportar os acréscimos legais.');
  return {blob:await response.blob(),filename:`icms-st-acrescimos-${resultId}.${format.toLocaleLowerCase('en-US')}`,hash:response.headers.get('X-Content-SHA256')};
};
export const baixarPacoteHistoricoIcmsSt=async(empresaId:string,packageId:string,format:'PDF'|'CSV'|'JSON')=>{
  const response=await fetch(`/api/proxy/companies/${empresaId}/fiscal-documents/icms-st-history-packages/${packageId}?format=${format}`,{headers:{accept:format==='PDF'?'application/pdf':format==='CSV'?'text/csv':'application/json'}});
  if(!response.ok)throw new Error('Não foi possível baixar o dossiê histórico.');
  return {blob:await response.blob(),filename:`icms-st-historico-${packageId}.${format.toLocaleLowerCase('en-US')}`,hash:response.headers.get('X-Content-SHA256')};
};
export const registrarDevolucaoIcmsSt=async(empresaId:string,input:Readonly<{originalSnapshotId:string;originalLineId:string;returnDocumentIdentity:string;returnItemIdentity:string;eventDate:string;unit:string;returnedQuantityScaled:string;returnedQuantity:string;returnDocumentNumber:string;returnAccessKey:string;returnModel:'55'|'65';returnSeries:string;returnCfop:string;ncm:string|null;productCode:string;productDescription:string;unitPrice:string;total:string;efdDate:string|null;evidenceOrigin:'MANUAL_DOCUMENT'|'EFD'|'NORMALIZED_NFE';idempotencyKey:string;arquivo:File}>)=>{
  const data=new FormData();for(const [key,value] of Object.entries(input))if(key!=='arquivo')data.set(key,String(value));data.set('arquivo',input.arquivo);
  return z.object({id:UuidPersistidoSchema,status:z.enum(['SUBMITTED','APPROVED','REJECTED']),competence:z.string(),returnedQuantityScaled:z.string(),remainingQuantityScaled:z.string(),reversedRestitutionCents:z.number().int().nullable(),reversedComplementCents:z.number().int().nullable(),evidenceSha256:z.string().length(64),reused:z.boolean().optional()})
    .parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-returns`,{method:'POST',body:data}));
};
export const revisarDevolucaoIcmsSt=async(empresaId:string,eventId:string,input:Readonly<{action:'APPROVED'|'REJECTED';reason?:string}>)=>z.object({eventId:UuidPersistidoSchema,action:z.enum(['APPROVED','REJECTED']),competence:z.string().optional(),remainingQuantityScaled:z.string().optional(),reversedRestitutionCents:z.number().int().optional(),reversedComplementCents:z.number().int().optional(),c002:z.string().nullable().optional()}).parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-returns/${eventId}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
export const compararResolucaoTributaria = async (empresaId:string,documentId:string,fromRevision:number,toRevision:number) => ComparacaoTributariaSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/${documentId}/tax-treatment-resolutions/compare?fromRevision=${fromRevision}&toRevision=${toRevision}`));
export const verificarIntegridadeFiscal = async (empresaId: string, documentId: string) =>
  IntegridadeFiscalSchema.parse(await requisitar<unknown>(
    `/companies/${empresaId}/fiscal-documents/${documentId}/integrity-checks`, { method: 'POST', body: JSON.stringify({}) },
  ));
export const reprocessarDocumentoFiscal = async (empresaId: string, documentId: string) =>
  ReprocessamentoFiscalSchema.parse(await requisitar<unknown>(
    `/companies/${empresaId}/fiscal-documents/${documentId}/reprocessing`, { method: 'POST', body: JSON.stringify({}) },
  ));
export const listarCienciasDaEmissao=async(empresaId:string)=>ListaCienciasSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/acknowledgements`));
export const obterCienciaDaEmissao=async(empresaId:string,id:string)=>DetalheCienciaSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/acknowledgements/${id}`));
export const retomarCienciaDaEmissao=async(empresaId:string,id:string)=>RetomadaCienciaSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/acknowledgements/${id}/reprocessing`,{method:'POST',body:JSON.stringify({})}));
const LoteNfceSchema=z.object({id:z.string().uuid(),status:z.enum(['QUEUED','PROCESSING','COMPLETED','COMPLETED_WITH_REJECTIONS','REJECTED','FAILED']),total:z.number().int().nonnegative(),origem:z.enum(['PORTAL_GO','ERP','EMISSOR']),totais:z.record(z.string(),z.number().int()),itens:z.array(z.object({id:z.string().uuid(),nome_sanitizado:z.string(),status:z.enum(['QUEUED','PROCESSING','IMPORTED','REUSED','PENDING_LINK','REJECTED','CONFLICT','FAILED']),codigo:z.string().nullable(),detalhe_sanitizado:z.string().nullable(),document_id:z.string().uuid().nullable(),modelo:z.string().nullable(),versao_layout:z.string().nullable(),ambiente:z.string().nullable(),chave_acesso:z.string().nullable()}))});
export type LoteNfceUI=z.infer<typeof LoteNfceSchema>;
export const enviarLoteNfce=async(empresaId:string,files:readonly File[],origem:'PORTAL_GO'|'ERP'|'EMISSOR')=>{
  const form=new FormData();form.set('origem',origem);for(const file of files)form.append('arquivos',file,file.name);
  return z.object({batchId:z.string().uuid(),status:z.literal('QUEUED'),reused:z.boolean()}).parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/nfce-imports`,{method:'POST',body:form}));
};
export const obterLoteNfce=async(empresaId:string,batchId:string)=>LoteNfceSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/nfce-imports/${batchId}`));
export const baixarRelatorioNfce=async(empresaId:string,batchId:string)=>{const response=await fetch(`/api/proxy/companies/${empresaId}/fiscal-documents/nfce-imports/${batchId}/report`,{credentials:'include'});if(!response.ok)throw new Error('Não foi possível baixar o relatório NFC-e.');const href=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=href;link.download='nfce-importacao.csv';link.click();URL.revokeObjectURL(href);};
export const obterConfiguracaoDeRiscoFiscal=async(empresaId:string)=>ConfiguracaoDeRiscoRespostaSchema.parse(await ler(`/companies/${empresaId}/fiscal-risk-settings`));
export const salvarConfiguracaoDeRiscoFiscal=async(empresaId:string,body:Readonly<{limite:string;motivo:string;fornecedores:readonly Readonly<{cnpj:string;nome_exibicao:string;situacao:'ATIVO'|'ARQUIVADO';motivo:string}>[]}>)=>ConfiguracaoDeRiscoRespostaSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-risk-settings`,{method:'PUT',body:JSON.stringify(body)}));
export const listarAnalisesDeRiscoFiscal=async(empresaId:string,documentId:string)=>AnalisesDeRiscoSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/${documentId}/risk-analyses`));
export const obterAnaliseDeRiscoFiscal=async(empresaId:string,documentId:string,analysisId:string)=>z.object({analise:AnaliseRiscoSchema}).parse(await ler(`/companies/${empresaId}/fiscal-documents/${documentId}/risk-analyses/${analysisId}`));
export const reprocessarAnaliseDeRiscoFiscal=async(empresaId:string,documentId:string)=>ReprocessamentoDeRiscoSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/${documentId}/risk-analyses/reprocessing`,{method:'POST',body:JSON.stringify({})}));
export const baixarOriginalFiscal = async (empresaId: string, documentId: string) => {
  const response = await fetch(`/api/proxy/companies/${empresaId}/fiscal-documents/${documentId}/original`, { credentials: 'include' });
  if (!response.ok) throw new Error('Não foi possível baixar o XML original.');
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = 'documento-fiscal.xml';
  link.click();
  URL.revokeObjectURL(href);
};

const DossieSchema=z.object({dossierId:z.string(),tenantId:z.string(),companyId:z.string(),sourceReconstructionPackageId:z.string(),sourceLegalAccrualResultId:z.string(),regime:z.string(),restitution:z.record(z.string(),z.unknown()),complement:z.record(z.string(),z.unknown()),status:z.string(),contractVersion:z.string(),generatedAtUtc:z.string()}).passthrough();
const DossieRespostaSchema=z.object({id:z.string(),hash:z.string(),reused:z.boolean().optional(),dossier:DossieSchema});
export type DossieIcmsStUI=z.infer<typeof DossieRespostaSchema>;
export const listarDossiesIcmsSt=async(empresaId:string)=>z.object({items:z.array(z.object({id:z.string(),sourcePackageId:z.string(),accrualResultId:z.string(),revision:z.number(),status:z.string(),hash:z.string(),dossier:DossieSchema,generatedAt:z.string()}))}).parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers`));
export const criarDossieIcmsSt=async(empresaId:string,sourcePackageId:string,accrualResultId:string)=>DossieRespostaSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourcePackageId,accrualResultId})}));
export const listarRegrasDestinoIcmsSt=async(empresaId:string)=>z.object({items:z.array(z.object({id:z.string(),version:z.string(),destination:z.string(),regime:z.string(),valid_from:z.string(),valid_through:z.string(),official_basis:z.string(),source_url:z.string(),consulted_at:z.string(),source_sha256:z.string(),conditions:z.array(z.string()),status:z.string()}))}).parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers/destination-rules`));
export const importarRegraDestinoIcmsSt=async(empresaId:string,input:Readonly<{version:string;destination:string;regime:string;validFrom:string;validThrough:string;officialBasis:string;sourceUrl:string;consultedAt:string;conditions:readonly string[];source:File}>)=>{const form=new FormData();for(const [k,v] of Object.entries(input))if(k!=='source')form.set(k,Array.isArray(v)?JSON.stringify(v):String(v));form.set('source',input.source,input.source.name);return requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers/destination-rules`,{method:'POST',body:form});};
export const decidirRegraDestinoIcmsSt=async(empresaId:string,id:string,action:'APPROVED'|'REJECTED',reason:string)=>requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers/destination-rules/${id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,reason})});
export const decidirDossieIcmsSt=async(empresaId:string,id:string,track:'RESTITUTION'|'COMPLEMENT',body:Readonly<{action:'APPROVED'|'REJECTED'|'RETURNED_FOR_EVIDENCE';reason:string;evidenceIds:readonly string[];conditionConfirmations:readonly number[];destination:string|null;rulePackageId:string|null}>)=>DossieRespostaSchema.parse(await requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers/${id}/${track}/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
export const listarEvidenciasDossieIcmsSt=async(empresaId:string,id:string)=>z.object({items:z.array(z.object({id:z.string(),track:z.enum(['RESTITUTION','COMPLEMENT','DOSSIER']),kind:z.string(),description:z.string(),fileName:z.string(),sha256:z.string(),createdAt:z.string()}))}).parse(await ler(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers/${id}/evidence`));
export const anexarEvidenciaDossieIcmsSt=async(empresaId:string,id:string,input:Readonly<{track:'RESTITUTION'|'COMPLEMENT';kind:string;description:string;file:File}>)=>{const form=new FormData();form.set('track',input.track);form.set('kind',input.kind);form.set('description',input.description);form.set('evidence',input.file,input.file.name);return requisitar<unknown>(`/companies/${empresaId}/fiscal-documents/icms-st-dossiers/${id}/evidence`,{method:'POST',body:form});};
export const exportarDossieIcmsSt=async(empresaId:string,id:string,format:'PDF'|'CSV'|'JSON')=>{const response=await fetch(`/api/proxy/companies/${empresaId}/fiscal-documents/icms-st-dossiers/${id}/export?format=${format}`,{credentials:'include'});if(!response.ok)throw new Error('Não foi possível exportar o dossiê.');return {blob:await response.blob(),filename:`dossie-icms-st-${id}.${format.toLowerCase()}`,hash:response.headers.get('X-Content-SHA256')??''};};
