/** Chamadas ao backend dos documentos da empresa (SPEC-004). */
import type { CodigoDoChecklist, EstadoDoDocumento } from '@contaia/domain';

import { requisitar } from '@/lib/http';

export type VersaoDoDocumento = Readonly<{
  id: string;
  numero: number;
  nomeOriginal: string;
  tipoConteudo: string;
  tamanhoBytes: number;
  validade: string | null;
  vigente: boolean;
  criadoEm: string;
}>;

export type ExigenciaDocumental = Readonly<{
  id: string;
  codigo: CodigoDoChecklist | null;
  nome: string;
  descricao: string | null;
  dataLimite: string | null;
  estado: EstadoDoDocumento;
  justificativa: string | null;
  aplicavel: boolean;
  versao: number;
  versoes: readonly VersaoDoDocumento[];
}>;

export type VisaoDosDocumentos = Readonly<{
  empresaId: string;
  exigencias: readonly ExigenciaDocumental[];
}>;

export type AcaoDocumental =
  | 'EXIGENCIA_CRIADA'
  | 'ENVIO'
  | 'SUBSTITUICAO'
  | 'APROVACAO'
  | 'REJEICAO'
  | 'DISPENSA'
  | 'VENCIMENTO'
  | 'VISUALIZACAO'
  | 'DOWNLOAD';

export type EventoDocumental = Readonly<{
  id: string;
  exigenciaId: string;
  exigenciaNome: string;
  versaoNumero: number | null;
  acao: AcaoDocumental;
  estadoAnterior: EstadoDoDocumento | null;
  estadoNovo: EstadoDoDocumento | null;
  justificativa: string | null;
  usuarioNome: string | null;
  ocorridoEm: string;
}>;

export type PaginaDoHistoricoDocumental = Readonly<{
  eventos: readonly EventoDocumental[];
  total: number;
}>;

const base = (empresaId: string): string => `/empresas/${empresaId}/documentos`;

export const consultarDocumentos = async (empresaId: string): Promise<VisaoDosDocumentos> =>
  requisitar<VisaoDosDocumentos>(base(empresaId));

export const criarExigencia = async (
  empresaId: string,
  entrada: Readonly<{ nome: string; descricao: string | null; dataLimite: string | null }>,
): Promise<VisaoDosDocumentos> =>
  requisitar<VisaoDosDocumentos>(`${base(empresaId)}/exigencias`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entrada),
  });

/**
 * Envio e substituição. `FormData` sem `content-type` explícito: o navegador
 * precisa definir o boundary do multipart, e fixar o cabeçalho à mão quebra o
 * parse no servidor.
 */
export const enviarArquivo = async (
  empresaId: string,
  exigenciaId: string,
  entrada: Readonly<{ arquivo: File; validade: string | null; versao: number }>,
): Promise<VisaoDosDocumentos> => {
  const corpo = new FormData();
  corpo.append('arquivo', entrada.arquivo);
  corpo.append('versao', String(entrada.versao));

  if (entrada.validade !== null) {
    corpo.append('validade', entrada.validade);
  }

  return requisitar<VisaoDosDocumentos>(
    `${base(empresaId)}/exigencias/${exigenciaId}/versoes`,
    { method: 'POST', body: corpo },
  );
};

const analisar = async (
  empresaId: string,
  exigenciaId: string,
  acao: 'aprovacao' | 'rejeicao' | 'dispensa',
  corpo: Readonly<Record<string, unknown>>,
): Promise<VisaoDosDocumentos> =>
  requisitar<VisaoDosDocumentos>(`${base(empresaId)}/exigencias/${exigenciaId}/${acao}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });

export const aprovarDocumento = async (
  empresaId: string,
  exigenciaId: string,
  versao: number,
): Promise<VisaoDosDocumentos> => analisar(empresaId, exigenciaId, 'aprovacao', { versao });

export const rejeitarDocumento = async (
  empresaId: string,
  exigenciaId: string,
  entrada: Readonly<{ justificativa: string; versao: number }>,
): Promise<VisaoDosDocumentos> => analisar(empresaId, exigenciaId, 'rejeicao', entrada);

export const dispensarExigencia = async (
  empresaId: string,
  exigenciaId: string,
  entrada: Readonly<{ justificativa: string; versao: number }>,
): Promise<VisaoDosDocumentos> => analisar(empresaId, exigenciaId, 'dispensa', entrada);

export const consultarHistoricoDocumental = async (
  empresaId: string,
  paginacao: Readonly<{ limite: number; deslocamento: number }>,
): Promise<PaginaDoHistoricoDocumental> => {
  const busca = new URLSearchParams({
    limite: String(paginacao.limite),
    deslocamento: String(paginacao.deslocamento),
  });

  return requisitar<PaginaDoHistoricoDocumental>(
    `${base(empresaId)}/historico?${busca.toString()}`,
  );
};

/**
 * Endereço do conteúdo da versão. Não é `fetch`: a visualização abre a URL
 * numa aba e o download usa `<a download>`, para o navegador tratar o arquivo
 * como arquivo. O proxy já carrega a sessão em cookie `httpOnly`.
 */
export const enderecoDoConteudo = (
  empresaId: string,
  exigenciaId: string,
  versaoId: string,
  modo: 'conteudo' | 'download',
): string =>
  `/api/proxy${base(empresaId)}/exigencias/${exigenciaId}/versoes/${versaoId}/${modo}`;
