/**
 * `application/problem+json` do cofre (CLAUDE.md, convenções; SPEC-011 §7).
 * Só código estável e mensagem de `MENSAGEM_DA_RECUSA`: nunca detalhe criptográfico,
 * valor de campo, token ou conteúdo do arquivo.
 */
import { MENSAGEM_DA_RECUSA } from '@contaia/shared';
import type { CodigoDeRecusaDaIngestao } from '@contaia/shared';

const TIPO_BASE = 'https://contaia.local/erros';

export type CodigoDoCofre = CodigoDeRecusaDaIngestao | 'ROTA_NAO_ENCONTRADA' | 'NAO_AUTORIZADO' | 'REQUISICAO_INVALIDA' | 'ORIGEM_NAO_PERMITIDA';

export const STATUS_POR_CODIGO: Readonly<Record<CodigoDoCofre, number>> = {
  CERTIFICADO_TICKET_INVALIDO: 401,
  CERTIFICADO_EXTENSAO_INVALIDA: 400,
  CERTIFICADO_TAMANHO_EXCEDIDO: 413,
  CERTIFICADO_ARQUIVO_VAZIO: 400,
  CERTIFICADO_CONTEINER_INVALIDO: 400,
  CERTIFICADO_SENHA_INCORRETA: 400,
  CERTIFICADO_EXPIRADO: 422,
  CERTIFICADO_AINDA_NAO_VIGENTE: 422,
  CERTIFICADO_TIPO_INCOMPATIVEL: 422,
  CERTIFICADO_CNPJ_DIVERGENTE: 422,
  CERTIFICADO_RESPONSAVEL_INVALIDO: 422,
  COFRE_INDISPONIVEL: 503,
  ROTA_NAO_ENCONTRADA: 404,
  NAO_AUTORIZADO: 401,
  REQUISICAO_INVALIDA: 400,
  ORIGEM_NAO_PERMITIDA: 403,
};

const MENSAGENS_PROPRIAS: Readonly<Record<string, string>> = {
  ROTA_NAO_ENCONTRADA: 'Rota inexistente.',
  NAO_AUTORIZADO: 'Credencial de serviço ausente ou inválida.',
  REQUISICAO_INVALIDA: 'A requisição está malformada.',
  ORIGEM_NAO_PERMITIDA: 'Origem não permitida.',
};

export const ehCodigoDeRecusa = (codigo: string | null): codigo is CodigoDeRecusaDaIngestao =>
  codigo !== null && codigo in MENSAGEM_DA_RECUSA;

export type CorpoDoProblema = Readonly<{
  type: string;
  title: string;
  status: number;
  code: string;
  correlationId: string;
  detail: string;
}>;

export const montarProblema = (codigo: CodigoDoCofre, correlationId: string): CorpoDoProblema => {
  const detalhe = ehCodigoDeRecusa(codigo) ? MENSAGEM_DA_RECUSA[codigo] : (MENSAGENS_PROPRIAS[codigo] ?? '');
  return {
    type: `${TIPO_BASE}/${codigo}`,
    title: detalhe,
    status: STATUS_POR_CODIGO[codigo],
    code: codigo,
    correlationId,
    detail: detalhe,
  };
};
