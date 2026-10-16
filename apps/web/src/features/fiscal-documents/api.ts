import { ler } from '../importacao/api';
import { requisitar } from '@/lib/http';
import { z } from 'zod';

const EstadoDocumentoFiscalSchema = z.enum([
  'PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'PENDENTE_LAYOUT', 'PENDENTE_IBS_CBS', 'XML_INVALIDO', 'CONFLITO', 'FALHA',
]);
const DocumentoFiscalSchema = z.object({
  id: z.string().uuid(), especie: z.enum(['NFE_55', 'CTE']), chave_acesso: z.string().nullable(), hash_sha256: z.string().nullable(),
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
const DocumentoFiscalDetalheSchema = z.object({
  id: z.string().uuid(), especie: z.enum(['NFE_55', 'CTE']), chave_acesso: z.string().nullable(), hash_sha256: z.string(), tamanho_bytes: z.number().int().nonnegative(),
  estado: EstadoDocumentoFiscalSchema.exclude(['PENDENTE', 'PROCESSANDO']), emitido_em: z.string().nullable(), emitente: z.string().nullable(), destinatario: z.string().nullable(),
  total: z.string().nullable(), base_ibs_cbs: z.string().nullable(), total_ibs: z.string().nullable(), total_cbs: z.string().nullable(), itens: z.array(ItemFiscalSchema),
  protocolo: z.string().nullable(), protocolo_recebido_em: z.string().nullable(), referencias: z.array(z.object({ tipo: z.string(), chave: z.string() })),
  partes: z.array(ParteFiscalSchema),
  tributos: z.array(TributoFiscalSchema),
  origens: z.array(z.object({ nsu: z.string(), capturado_em: z.string() })),
  eventos: z.array(z.object({ tipo: z.string(), codigo: z.string().nullable(), ocorrido_em: z.string() })),
});
export type DocumentoFiscalDetalhe = z.infer<typeof DocumentoFiscalDetalheSchema>;
const ListaDeDocumentosFiscaisSchema = z.object({ pagina: z.number().int().positive(), temProximaPagina: z.boolean(), itens: z.array(DocumentoFiscalSchema) });
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
export const obterDocumentoFiscal = async (empresaId: string, documentId: string) =>
  DocumentoFiscalDetalheSchema.parse(await ler(`/companies/${empresaId}/fiscal-documents/${documentId}`));
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
