/**
 * Erro de domínio com código estável (CONVENTION.md §9).
 *
 * O código é a chave de tradução do frontend (FRONTEND.md §14) e não muda sem
 * quebra de contrato: a mensagem pode ser reescrita, o código não.
 */

export const CODIGOS_DE_ERRO = {
  CNPJ_INVALIDO: 'CNPJ_INVALIDO',
  CNPJ_JA_UTILIZADO: 'CNPJ_JA_UTILIZADO',
  CPF_INVALIDO: 'CPF_INVALIDO',
  EMAIL_INVALIDO: 'EMAIL_INVALIDO',
  TELEFONE_INVALIDO: 'TELEFONE_INVALIDO',
  CEP_INVALIDO: 'CEP_INVALIDO',
  UF_INVALIDA: 'UF_INVALIDA',
  CAMPO_OBRIGATORIO: 'CAMPO_OBRIGATORIO',
  ETAPA_INCOMPLETA: 'ETAPA_INCOMPLETA',
  LOGO_OBRIGATORIO: 'LOGO_OBRIGATORIO',
  DOCUMENTO_OBRIGATORIO: 'DOCUMENTO_OBRIGATORIO',
  ENDERECO_PRINCIPAL_OBRIGATORIO: 'ENDERECO_PRINCIPAL_OBRIGATORIO',
  ARQUIVO_INVALIDO: 'ARQUIVO_INVALIDO',
  TENANT_NAO_ENCONTRADO: 'TENANT_NAO_ENCONTRADO',
  TENANT_DIVERGENTE: 'TENANT_DIVERGENTE',
  CADASTRO_INCOMPLETO: 'CADASTRO_INCOMPLETO',
  CONFLITO_DE_VERSAO: 'CONFLITO_DE_VERSAO',
} as const;

export type CodigoDeErro = (typeof CODIGOS_DE_ERRO)[keyof typeof CODIGOS_DE_ERRO];

export type CampoInvalido = Readonly<{ campo: string; codigo: CodigoDeErro }>;

export class ErroDeDominio extends Error {
  readonly codigo: CodigoDeErro;
  readonly campos: readonly CampoInvalido[];

  constructor(codigo: CodigoDeErro, mensagem: string, campos: readonly CampoInvalido[] = []) {
    super(mensagem);
    this.name = 'ErroDeDominio';
    this.codigo = codigo;
    this.campos = campos;
  }
}

/** Erro de validação de entrada: vira `422` com os campos associados. */
export class ErroDeValidacao extends ErroDeDominio {
  constructor(campos: readonly CampoInvalido[]) {
    super(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO, 'Há campos inválidos na etapa.', campos);
    this.name = 'ErroDeValidacao';
  }
}

/** Conflito com registro existente: vira `409`, sem revelar dado de outro tenant. */
export class ErroDeConflito extends ErroDeDominio {
  constructor(codigo: CodigoDeErro, mensagem: string) {
    super(codigo, mensagem);
    this.name = 'ErroDeConflito';
  }
}
