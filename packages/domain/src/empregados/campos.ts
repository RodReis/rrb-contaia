/**
 * Contrato do CSV de empregados (SPEC-014 §3.3): os cinco campos obrigatórios e os códigos
 * estáveis de rejeição por linha. O `@contaia/shared` repete a lista de códigos (a prévia é lida
 * com parse estrito no web); um teste do shared garante que as duas são iguais.
 */
import { CODIGOS_DE_REJEICAO_ESTRUTURAL } from '../planilhas/rejeicao-estrutural.js';

export const CAMPOS_DE_EMPREGADO = ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'] as const;
export type CampoDeEmpregado = (typeof CAMPOS_DE_EMPREGADO)[number];

/** Campo do contrato → nome da coluna de origem no cabeçalho do arquivo. */
export type MapeamentoDeEmpregados = Readonly<Record<CampoDeEmpregado, string>>;

export const CODIGOS_DE_ERRO_DE_EMPREGADO = [
  'CAMPO_OBRIGATORIO_AUSENTE',
  'CPF_INVALIDO',
  'DATA_NASCIMENTO_INVALIDA',
  'DATA_ADMISSAO_INVALIDA',
  'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
  'CHAVE_DUPLICADA_NO_ARQUIVO',
  'EMPREGADO_ARQUIVADO',
] as const;

/**
 * Os sete códigos acima são o contrato de conteúdo da SPEC-014 (valem em qualquer formato). Em
 * planilha a linha também pode ser rejeitada por fórmula ou mescla (SPEC-015): este é o conjunto
 * completo que a prévia e o relatório podem trazer.
 */
export const CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO = [
  ...CODIGOS_DE_ERRO_DE_EMPREGADO,
  ...CODIGOS_DE_REJEICAO_ESTRUTURAL,
] as const;
export type CodigoDeErroDeEmpregado = (typeof CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO)[number];
