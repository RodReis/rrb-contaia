import { ler } from '../importacao/api';
import { requisitar } from '@/lib/http';

export type DocumentoFiscal = Readonly<{
  id: string; especie: 'NFE_55' | 'CTE'; chave_acesso: string | null; hash_sha256: string;
  emitido_em: string | null; emitente: string | null; destinatario: string | null; total: string | null;
  estado: 'PROCESSADO' | 'PENDENTE_LAYOUT' | 'PENDENTE_IBS_CBS' | 'XML_INVALIDO' | 'CONFLITO' | 'FALHA';
  versao_layout: string; criado_em: string; nsu: string | null; capturado_em: string | null; origens: number;
}>;
export type DocumentoFiscalDetalhe = Readonly<{
  id: string; especie: 'NFE_55' | 'CTE'; chave_acesso: string | null; hash_sha256: string; tamanho_bytes: number;
  estado: DocumentoFiscal['estado']; emitido_em: string | null; emitente: string | null; destinatario: string | null;
  total: string | null; itens: readonly Readonly<Record<string, string | number | null>>[];
  origens: readonly Readonly<{ nsu: string; capturado_em: string }>[];
  eventos: readonly Readonly<{ tipo: string; codigo: string | null; ocorrido_em: string }>[];
}>;

export const listarDocumentosFiscais = async (empresaId: string, pagina: number) =>
  await ler(`/companies/${empresaId}/fiscal-documents?pagina=${pagina}`) as Readonly<{ pagina: number; itens: readonly DocumentoFiscal[] }>;
export const obterDocumentoFiscal = async (empresaId: string, documentId: string) =>
  await ler(`/companies/${empresaId}/fiscal-documents/${documentId}`) as DocumentoFiscalDetalhe;
export const verificarIntegridadeFiscal = (empresaId: string, documentId: string) => requisitar<{ documentId: string; estado: 'INTEGRO'; verificadoEm: string }>(
  `/companies/${empresaId}/fiscal-documents/${documentId}/integrity-checks`, { method: 'POST', body: JSON.stringify({}) },
);
export const reprocessarDocumentoFiscal = (empresaId: string, documentId: string) => requisitar<{ documentId: string; status: 'QUEUED' }>(
  `/companies/${empresaId}/fiscal-documents/${documentId}/reprocessing`, { method: 'POST', body: JSON.stringify({}) },
);
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
