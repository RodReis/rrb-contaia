import type { CodigoDeErro } from '@contaia/domain';

/** O teste manual em andamento é recusa da API (409 na tela); o Signer nunca a emite. */
type CodigoDaApi = 'SIGNER_TESTE_EM_ANDAMENTO';

export type CodigoDoSigner =
  | Exclude<Extract<CodigoDeErro, `SIGNER_${string}`>, CodigoDaApi>
  | 'ROTA_NAO_ENCONTRADA'
  | 'REQUISICAO_INVALIDA';

/** Status HTTP padrão de cada código; o chamador pode sobrepor quando o contexto exige. */
export const STATUS_POR_CODIGO: Readonly<Record<CodigoDoSigner, number>> = {
  SIGNER_IDENTIDADE_INVALIDA: 401,
  SIGNER_ALCADA_NEGADA: 403,
  SIGNER_CONTEXTO_INVALIDO: 400,
  SIGNER_FINALIDADE_INVALIDA: 400,
  SIGNER_CERTIFICADO_AUSENTE: 409,
  SIGNER_CERTIFICADO_DESATIVADO: 409,
  SIGNER_CERTIFICADO_VENCIDO: 409,
  SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE: 409,
  SIGNER_XML_INVALIDO: 422,
  SIGNER_ASSINATURA_INVALIDA: 422,
  SIGNER_VAULT_INDISPONIVEL: 503,
  SIGNER_MTLS_RECUSADO: 502,
  SIGNER_DESTINO_INDISPONIVEL: 504,
  SIGNER_IDEMPOTENCIA_CONFLITO: 409,
  SIGNER_OPERACAO_EM_ANDAMENTO: 409,
  SIGNER_INDISPONIVEL: 503,
  ROTA_NAO_ENCONTRADA: 404,
  REQUISICAO_INVALIDA: 400,
};

/**
 * Erro de domínio do Signer: código estável + status. A mensagem nunca carrega dado externo —
 * é só o código; o texto ao chamador vem de `problema.ts`.
 */
export class ErroDoSigner extends Error {
  readonly codigo: CodigoDoSigner;
  readonly status: number;

  constructor(codigo: CodigoDoSigner, status: number = STATUS_POR_CODIGO[codigo]) {
    super(codigo);
    this.name = 'ErroDoSigner';
    this.codigo = codigo;
    this.status = status;
  }
}
