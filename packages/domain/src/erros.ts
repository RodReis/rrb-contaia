/**
 * Erro de domínio com código estável (CONVENTION.md §9).
 *
 * O código é a chave de tradução do frontend (FRONTEND.md §14) e não muda sem
 * quebra de contrato: a mensagem pode ser reescrita, o código não.
 */

export const CODIGOS_DE_ERRO = {
  CNPJ_INVALIDO: 'CNPJ_INVALIDO',
  CNPJ_JA_UTILIZADO: 'CNPJ_JA_UTILIZADO',
  // A empresa cliente é única por tenant, não globalmente (SPEC-002 §4.5).
  // Código próprio para o front distinguir "já existe neste escritório, abra a
  // que existe" de `CNPJ_JA_UTILIZADO`, que é o escritório em si (global).
  CNPJ_JA_CADASTRADO_NO_TENANT: 'CNPJ_JA_CADASTRADO_NO_TENANT',
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
  // Dados fiscais da empresa cliente (SPEC-002 §4.3).
  REGIME_INVALIDO: 'REGIME_INVALIDO',
  ENQUADRAMENTO_OBRIGATORIO: 'ENQUADRAMENTO_OBRIGATORIO',
  CNAE_OBRIGATORIO: 'CNAE_OBRIGATORIO',
  INSCRICAO_INVALIDA: 'INSCRICAO_INVALIDA',
  INSCRICAO_NUMERO_OBRIGATORIO: 'INSCRICAO_NUMERO_OBRIGATORIO',
  EMPRESA_NAO_ENCONTRADA: 'EMPRESA_NAO_ENCONTRADA',
  TENANT_NAO_ENCONTRADO: 'TENANT_NAO_ENCONTRADO',
  TENANT_DIVERGENTE: 'TENANT_DIVERGENTE',
  CADASTRO_INCOMPLETO: 'CADASTRO_INCOMPLETO',
  CONFLITO_DE_VERSAO: 'CONFLITO_DE_VERSAO',
  // Manutenção da empresa já ativada (SPEC-003 §4.2).
  CNPJ_IMUTAVEL: 'CNPJ_IMUTAVEL',
  VIGENCIA_FUTURA: 'VIGENCIA_FUTURA',
  VIGENCIA_OBRIGATORIA: 'VIGENCIA_OBRIGATORIA',
  FINALIDADE_INVALIDA: 'FINALIDADE_INVALIDA',
  FINALIDADE_DUPLICADA: 'FINALIDADE_DUPLICADA',
  DESCRICAO_OBRIGATORIA: 'DESCRICAO_OBRIGATORIA',
  ENDERECO_FISCAL_OBRIGATORIO: 'ENDERECO_FISCAL_OBRIGATORIO',
  ENDERECO_NAO_ENCONTRADO: 'ENDERECO_NAO_ENCONTRADO',
  JUSTIFICATIVA_OBRIGATORIA: 'JUSTIFICATIVA_OBRIGATORIA',
  EMPRESA_ARQUIVADA: 'EMPRESA_ARQUIVADA',
  EMPRESA_NAO_ARQUIVADA: 'EMPRESA_NAO_ARQUIVADA',
  // Documentos da empresa (SPEC-004 secao 2 e 3).
  EXIGENCIA_NAO_ENCONTRADA: 'EXIGENCIA_NAO_ENCONTRADA',
  EXIGENCIA_NAO_APLICAVEL: 'EXIGENCIA_NAO_APLICAVEL',
  EXIGENCIA_DUPLICADA: 'EXIGENCIA_DUPLICADA',
  NOME_DA_EXIGENCIA_OBRIGATORIO: 'NOME_DA_EXIGENCIA_OBRIGATORIO',
  TRANSICAO_DOCUMENTAL_INVALIDA: 'TRANSICAO_DOCUMENTAL_INVALIDA',
  DOCUMENTO_SEM_ARQUIVO: 'DOCUMENTO_SEM_ARQUIVO',
  VERSAO_NAO_VIGENTE: 'VERSAO_NAO_VIGENTE',
  VERSAO_NAO_ENCONTRADA: 'VERSAO_NAO_ENCONTRADA',
  ARQUIVO_INDISPONIVEL: 'ARQUIVO_INDISPONIVEL',
  VALIDADE_INVALIDA: 'VALIDADE_INVALIDA',
  // Central de pendências (SPEC-005).
  PENDENCIA_NAO_ENCONTRADA: 'PENDENCIA_NAO_ENCONTRADA',
  PENDENCIA_JA_RESOLVIDA: 'PENDENCIA_JA_RESOLVIDA',
  SEM_AUTORIZACAO: 'SEM_AUTORIZACAO',
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
