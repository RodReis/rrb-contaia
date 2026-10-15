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
  protocolo: z.string().nullable(), referencias: z.array(z.object({ tipo: z.string(), chave: z.string() })),
  partes: z.array(ParteFiscalSchema),
  tributos: z.array(TributoFiscalSchema),
  origens: z.array(z.object({ nsu: z.string(), capturado_em: z.string() })),
  eventos: z.array(z.object({ tipo: z.string(), codigo: z.string().nullable(), ocorrido_em: z.string() })),
});
export type DocumentoFiscalDetalhe = z.infer<typeof DocumentoFiscalDetalheSchema>;
const ListaDeDocumentosFiscaisSchema = z.object({ pagina: z.number().int().positive(), temProximaPagina: z.boolean(), itens: z.array(DocumentoFiscalSchema) });
const IntegridadeFiscalSchema = z.object({ documentId: z.string().uuid(), estado: z.literal('INTEGRO'), verificadoEm: z.string() });
const ReprocessamentoFiscalSchema = z.object({ documentId: z.string().uuid(), status: z.literal('QUEUED') });

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
