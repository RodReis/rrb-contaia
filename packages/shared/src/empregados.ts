import { z } from 'zod';

import {
  OPCOES_DE_VALIDACAO_PLANO_CONTAS,
  criarPaginaDeRejeicoesSchema,
  criarPreviaDaImportacaoSchema,
  criarRejeicaoDaImportacaoSchema,
  identificador,
} from './plano-contas.js';

/**
 * Contrato da importação de empregados (SPEC-014). O envelope de prévia, histórico, comando de
 * fila e estados é o da F13 (`plano-contas.ts`); aqui ficam o que é próprio de empregado: códigos
 * de erro de linha, identificação da linha rejeitada (CPF + matrícula), a base consultável e a fila.
 * Sem segredos, sem URLs; todos os schemas são `.strict()`.
 */

/**
 * Códigos estáveis de rejeição de linha. A lista do domínio é a fonte; um teste daqui garante que
 * as duas são iguais.
 */
export const CODIGOS_DE_ERRO_DE_EMPREGADO = [
  'CAMPO_OBRIGATORIO_AUSENTE',
  'CPF_INVALIDO',
  'DATA_NASCIMENTO_INVALIDA',
  'DATA_ADMISSAO_INVALIDA',
  'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
  'CHAVE_DUPLICADA_NO_ARQUIVO',
  'EMPREGADO_ARQUIVADO',
] as const;
export type CodigoDeErroDeEmpregado = (typeof CODIGOS_DE_ERRO_DE_EMPREGADO)[number];

/**
 * Rejeição de empregado: CPF e matrícula como vieram no arquivo, quando disponíveis (SPEC-014
 * §3.4). É dado pessoal servido só a quem tem `consultar`; a mensagem nunca repete o CPF.
 */
export const RejeicaoDeEmpregadoSchema = criarRejeicaoDaImportacaoSchema(CODIGOS_DE_ERRO_DE_EMPREGADO, {
  cpf: z.string().nullable(),
  matricula: z.string().nullable(),
});
export type RejeicaoDeEmpregado = z.infer<typeof RejeicaoDeEmpregadoSchema>;

export const PreviaDaImportacaoDeEmpregadosSchema = criarPreviaDaImportacaoSchema(RejeicaoDeEmpregadoSchema);
export type PreviaDaImportacaoDeEmpregados = z.infer<typeof PreviaDaImportacaoDeEmpregadosSchema>;

export const PaginaDeRejeicoesDeEmpregadosSchema = criarPaginaDeRejeicoesSchema(RejeicaoDeEmpregadoSchema);
export type PaginaDeRejeicoesDeEmpregados = z.infer<typeof PaginaDeRejeicoesDeEmpregadosSchema>;

const dataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** Empregado da base, em modo de consulta (SPEC-014 §3.9). `cpf` vem em 11 dígitos; a máscara é da UI. */
export const EmpregadoDaBaseSchema = z.strictObject({
  id: identificador,
  cpf: z.string().regex(/^\d{11}$/u),
  nome: z.string().min(1),
  matricula: z.string().min(1),
  dataNascimento: dataCivil,
  dataAdmissao: dataCivil,
  arquivado: z.boolean(),
});
export type EmpregadoDaBase = z.infer<typeof EmpregadoDaBaseSchema>;

export const PaginaDeEmpregadosSchema = z.strictObject({
  pagina: z.number().int().min(1),
  itensPorPagina: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  itens: z.array(EmpregadoDaBaseSchema),
});
export type PaginaDeEmpregados = z.infer<typeof PaginaDeEmpregadosSchema>;

// Nomes de fila. O BullMQ 6 recusa ":" no nome da fila e no id de job customizado. O comando
// (`ComandoValidarImportacaoSchema`) e o id do job (`idDoJobDeValidacao`) são os da F13.
export const FILA_DE_VALIDACAO_EMPREGADOS = 'empregados-validacao';
export const FILA_DE_VALIDACAO_EMPREGADOS_MORTA = 'empregados-validacao-morta';
export const NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS = 'validar-importacao';

/** Mesmas opções de retry/backoff do plano de contas: 5 tentativas, backoff exponencial de 2000 ms. */
export const OPCOES_DE_VALIDACAO_EMPREGADOS = OPCOES_DE_VALIDACAO_PLANO_CONTAS;
