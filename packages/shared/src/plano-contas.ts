import { z } from 'zod';

/**
 * Contrato interno da importação de plano de contas (SPEC-013).
 *
 * Sem segredos, sem URLs, sem configuração de infraestrutura.
 * Todos schemas `.strict()` — campo extra = recusa.
 */

export const VERSAO_DO_CONTRATO_DO_PLANO_CONTAS = 'v1';

export const ESTADOS_DA_IMPORTACAO = [
  'RECEBIDA',
  'VALIDANDO',
  'AGUARDANDO_CONFIRMACAO',
  'APLICANDO',
  'CONCLUIDA',
  'CONCLUIDA_COM_REJEICOES',
  'REJEITADA',
  'CANCELADA',
  'FALHA',
] as const;
export type EstadoDaImportacao = (typeof ESTADOS_DA_IMPORTACAO)[number];

export const TIPOS_DE_CONTA = ['analitica', 'sintetica'] as const;
export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number];

export const NATUREZAS_DE_CONTA = ['devedora', 'credora'] as const;
export type NaturezaDeConta = (typeof NATUREZAS_DE_CONTA)[number];

export const CODIGOS_DE_ERRO_DA_LINHA = [
  'CAMPO_OBRIGATORIO_AUSENTE',
  'VALOR_FORA_DO_DOMINIO',
  'CODIGO_DUPLICADO_NO_ARQUIVO',
  'CONTA_PAI_INEXISTENTE',
  'CONTA_PAI_REJEITADA',
  'CICLO_HIERARQUICO',
  'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA',
  'CONTA_ARQUIVADA',
] as const;
export type CodigoDeErroDaLinha = (typeof CODIGOS_DE_ERRO_DA_LINHA)[number];

const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const chaveTextual = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);

const linhaDeEntradaSchema = z.strictObject({
  numeroDaLinha: z.number().int().min(1),
  codigo: z.string().min(1).max(64),
  nome: z.string().min(1).max(255),
  tipo: z.enum(TIPOS_DE_CONTA),
  natureza: z.enum(NATUREZAS_DE_CONTA),
  contaPai: z.string().max(64).nullable(),
});

export const LinhaDeEntradaSchema = linhaDeEntradaSchema;
export type LinhaDeEntrada = z.infer<typeof LinhaDeEntradaSchema>;

export const ContaVigenteSchema = z.strictObject({
  codigo: z.string().min(1).max(64),
  tipo: z.enum(TIPOS_DE_CONTA),
  arquivada: z.boolean(),
  temFilhas: z.boolean(),
});
export type ContaVigente = z.infer<typeof ContaVigenteSchema>;

export const LinhaRejeitadaSchema = z.strictObject({
  numeroDaLinha: z.number().int().min(1),
  codigo: z.string().max(64).nullable(),
  campo: z.string().max(64).nullable(),
  codigoDeErro: z.enum(CODIGOS_DE_ERRO_DA_LINHA),
});
export type LinhaRejeitada = z.infer<typeof LinhaRejeitadaSchema>;

export const LinhaAceitaSchema = z.strictObject({
  numeroDaLinha: z.number().int().min(1),
  codigo: z.string().min(1).max(64),
  nome: z.string().min(1).max(255),
  tipo: z.enum(TIPOS_DE_CONTA),
  natureza: z.enum(NATUREZAS_DE_CONTA),
  contaPai: z.string().max(64).nullable(),
});
export type LinhaAceita = z.infer<typeof LinhaAceitaSchema>;

/** Rejeição como a API a mostra (amostra da prévia e páginas): com a mensagem acionável. */
export const RejeicaoDaImportacaoSchema = z.strictObject({
  numeroDaLinha: z.number().int().min(1),
  // Valor cru do arquivo: a linha pode ter sido rejeitada justamente por exceder o limite.
  codigo: z.string().nullable(),
  campo: z.string().max(64).nullable(),
  codigoDeErro: z.enum(CODIGOS_DE_ERRO_DA_LINHA),
  mensagem: z.string().nullable(),
});
export type RejeicaoDaImportacao = z.infer<typeof RejeicaoDaImportacaoSchema>;

const totaisSchema = z.strictObject({
  lidas: z.number().int().min(0),
  novas: z.number().int().min(0),
  atualizadas: z.number().int().min(0),
  rejeitadas: z.number().int().min(0),
});

export const DiagnosticoDaImportacaoSchema = z.strictObject({
  codigo: z.string().regex(/^[A-Z][A-Z0-9_]*$/u).max(64),
  mensagem: z.string().min(1).max(500),
});
export type DiagnosticoDaImportacao = z.infer<typeof DiagnosticoDaImportacaoSchema>;

/**
 * Visão da tentativa que a API devolve no envio, na prévia, na confirmação e no cancelamento.
 * `totais` e `versaoDaPrevia` são nulos até a validação terminar; `amostraRejeicoes` é a primeira
 * página das rejeições. As flags `pode*` e `relatorioDisponivel` saem do estado, calculadas no
 * servidor (a permissão continua sendo conferida em cada rota).
 */
export const PreviaDaImportacaoSchema = z.strictObject({
  tentativaId: identificador,
  estado: z.enum(ESTADOS_DA_IMPORTACAO),
  arquivo: z.strictObject({
    nome: z.string().min(1).max(255),
    tamanho: z.number().int().min(0).max(10_485_760),
    hash: z.string().min(32).max(64),
  }),
  mapeamento: z.record(z.string(), z.string()),
  totais: totaisSchema.nullable(),
  amostraRejeicoes: z.array(RejeicaoDaImportacaoSchema).max(50),
  criadoEm: z.string().datetime(),
  finalizadoEm: z.string().datetime().nullable(),
  correlationId: chaveTextual,
  /** Versão do plano validada: o corpo da confirmação a devolve (`CONFLITO_DE_VERSAO` se mudou). */
  versaoDaPrevia: z.number().int().min(0).nullable(),
  reutilizadaPorIdempotencia: z.boolean(),
  podeConfirmar: z.boolean(),
  podeCancelar: z.boolean(),
  relatorioDisponivel: z.boolean(),
  /**
   * Desfecho acionável (aditivo, v1): em FALHA e na REJEITADA do arquivo inteiro, o código estável
   * do último evento de falha/rejeição e a mensagem PT-BR fechada que a API associa a ele. Nulo ou
   * ausente nos demais casos. Nunca a mensagem crua de uma exceção.
   */
  diagnostico: DiagnosticoDaImportacaoSchema.nullable().optional(),
});
export type PreviaDaImportacao = z.infer<typeof PreviaDaImportacaoSchema>;

export const PaginaDeRejeicoesDaImportacaoSchema = z.strictObject({
  pagina: z.number().int().min(1),
  itensPorPagina: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  itens: z.array(RejeicaoDaImportacaoSchema),
});
export type PaginaDeRejeicoesDaImportacao = z.infer<typeof PaginaDeRejeicoesDaImportacaoSchema>;

export const ContaDoPlanoDeContasSchema = z.strictObject({
  id: identificador,
  codigo: z.string().min(1),
  nome: z.string().min(1),
  tipo: z.enum(TIPOS_DE_CONTA),
  natureza: z.enum(NATUREZAS_DE_CONTA),
  contaPai: z.string().nullable(),
  arquivada: z.boolean(),
  atualizadoEm: z.string().datetime(),
});
export type ContaDoPlanoDeContas = z.infer<typeof ContaDoPlanoDeContasSchema>;

export const PaginaDoPlanoDeContasSchema = z.strictObject({
  pagina: z.number().int().min(1),
  itensPorPagina: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  itens: z.array(ContaDoPlanoDeContasSchema),
});
export type PaginaDoPlanoDeContas = z.infer<typeof PaginaDoPlanoDeContasSchema>;

export const TentativaDoHistoricoSchema = z.strictObject({
  id: identificador,
  arquivo: z.strictObject({
    nome: z.string().min(1).max(255),
    tamanho: z.number().int().min(0),
    hash: z.string().min(32).max(64),
  }),
  mapeamento: z.record(z.string(), z.string()),
  usuarioIniciador: z.strictObject({
    id: identificador,
    nome: z.string().min(1).max(255),
  }),
  usuarioConfirmadorOuCancelador: z
    .strictObject({
      id: identificador,
      nome: z.string().min(1).max(255),
    })
    .nullable(),
  estado: z.enum(ESTADOS_DA_IMPORTACAO),
  totais: z.strictObject({
    lidas: z.number().int().min(0),
    novas: z.number().int().min(0),
    atualizadas: z.number().int().min(0),
    rejeitadas: z.number().int().min(0),
  }),
  inicioEm: z.string().datetime(),
  fimEm: z.string().datetime().nullable(),
  correlationId: chaveTextual,
  reutilizadaPorIdempotencia: z.boolean(),
});
export type TentativaDoHistorico = z.infer<typeof TentativaDoHistoricoSchema>;

export const HistoricoDeImportacoesSchema = z.strictObject({
  pagina: z.number().int().min(1),
  itensPorPagina: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  itens: z.array(TentativaDoHistoricoSchema),
});
export type HistoricoDeImportacoes = z.infer<typeof HistoricoDeImportacoesSchema>;

// Payload de fila (worker de validação). Só identificadores: o worker relê a tentativa (arquivo,
// hash e mapeamento) do banco, dentro do contexto técnico da empresa.
export const ComandoValidarImportacaoSchema = z.strictObject({
  tenantId: identificador,
  empresaId: identificador,
  tentativaId: identificador,
  correlationId: chaveTextual,
});
export type ComandoValidarImportacao = z.infer<typeof ComandoValidarImportacaoSchema>;

// Nomes de fila. O BullMQ 6 recusa ":" no nome da fila e no id de job customizado.
export const FILA_DE_VALIDACAO_PLANO_CONTAS = 'plano-contas-validacao';
export const FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA = 'plano-contas-validacao-morta';
export const NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS = 'validar-importacao';

/**
 * Id determinístico do job (API e worker usam este mesmo): reenfileirar a mesma tentativa não
 * cria um segundo job enquanto o primeiro existir.
 */
export const idDoJobDeValidacao = (tentativaId: string): string => `validacao-${tentativaId}`;

// Opções de job (retry/backoff)
export const OPCOES_DE_VALIDACAO_PLANO_CONTAS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 50,
} as const;
