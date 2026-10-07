import { z } from 'zod';

/**
 * Contrato interno do Signer, versionado (SPEC-012 §6.2).
 *
 * O Signer não é proxy: nenhum DTO possui URL, host, porta, caminho do Vault,
 * PKCS#12, senha, chave privada ou token. Protocolo, destino, CA e algoritmo
 * pertencem à configuração controlada da finalidade. Todo schema é `.strict()`,
 * de modo que um campo extra é recusado, nunca ignorado.
 */

export const VERSAO_DO_CONTRATO_DO_SIGNER = 'v1';

/** Espelho de `FINALIDADES` do domínio; um teste garante que não se separam. */
export const FINALIDADES = ['DFE_TESTE', 'ESOCIAL_TESTE'] as const;
export type Finalidade = (typeof FINALIDADES)[number];

export const RESULTADOS_DO_HISTORICO = ['SUCESSO', 'FALHA', 'RECUSA'] as const;
export type ResultadoDoHistorico = (typeof RESULTADOS_DO_HISTORICO)[number];

export const ITENS_POR_PAGINA_DO_HISTORICO = 15;
export const LIMITE_DO_XML_BYTES = 1_048_576;

/** Identificadores opacos (UUID) e tokens curtos sem espaço nem controle. */
const identificador = z.uuid();
const chaveTextual = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);
const finalidade = z.enum(FINALIDADES);

const contextoDaOperacao = {
  tenantId: identificador,
  empresaId: identificador,
  finalidade,
  chaveIdempotente: chaveTextual,
  correlationId: chaveTextual,
  /** Usuário que iniciou a cadeia, quando houve pessoa. */
  usuarioOriginadorId: identificador.optional(),
} as const;

const xml = z.string().min(1).max(LIMITE_DO_XML_BYTES);

export const ComandoAssinarSchema = z.strictObject({ ...contextoDaOperacao, xml });
export type ComandoAssinar = z.infer<typeof ComandoAssinarSchema>;

export const ComandoExecutarMtlsSchema = z.strictObject({ ...contextoDaOperacao, xml });
export type ComandoExecutarMtls = z.infer<typeof ComandoExecutarMtlsSchema>;

/** O diagnóstico usa o XML de teste do próprio Signer e não recebe conteúdo. */
export const ORIGENS_DO_DIAGNOSTICO = ['AUTOMATICO', 'MANUAL'] as const;
export type OrigemDoDiagnostico = (typeof ORIGENS_DO_DIAGNOSTICO)[number];

export const ComandoDiagnosticarSchema = z.strictObject({
  tenantId: identificador,
  empresaId: identificador,
  finalidade,
  correlationId: chaveTextual,
  origem: z.enum(ORIGENS_DO_DIAGNOSTICO),
  usuarioOriginadorId: identificador.optional(),
});
export type ComandoDiagnosticar = z.infer<typeof ComandoDiagnosticarSchema>;

export const LIMITE_DE_EMPRESAS_POR_CONSULTA = 50;

/** Em lote: o painel lista várias empresas por página e o Signer lê uma de cada vez (RLS por empresa). */
export const ConsultaEstadosSchema = z.strictObject({
  tenantId: identificador,
  empresaIds: z.array(identificador).min(1).max(LIMITE_DE_EMPRESAS_POR_CONSULTA),
  correlationId: chaveTextual,
});
export type ConsultaEstados = z.infer<typeof ConsultaEstadosSchema>;

export const ConsultaHistoricoSchema = z.strictObject({
  tenantId: identificador,
  empresaId: identificador,
  correlationId: chaveTextual,
  pagina: z.number().int().min(1),
  finalidade: finalidade.optional(),
  resultado: z.enum(RESULTADOS_DO_HISTORICO).optional(),
});
export type ConsultaHistorico = z.infer<typeof ConsultaHistoricoSchema>;

export type RespostaDeAssinatura = Readonly<{
  operacaoId: string;
  reutilizado: boolean;
  /** Nulo na repetição idempotente: o XML assinado nunca é persistido (SPEC-012 §3.6). */
  xmlAssinado: string | null;
}>;

export type RespostaDeExecucaoMtls = Readonly<{
  operacaoId: string;
  reutilizado: boolean;
  resultado: ResultadoDoHistorico;
  codigo: string | null;
}>;

export type EstadoDeSaudeDoSigner = 'OPERACIONAL' | 'DEGRADADO' | 'INDISPONIVEL';

export type RespostaDeSaude = Readonly<{
  versaoDoContrato: typeof VERSAO_DO_CONTRATO_DO_SIGNER;
  estado: EstadoDeSaudeDoSigner;
  verificadoEm: string;
}>;

export const ESTADOS_DA_FINALIDADE_NO_SIGNER = ['OPERACIONAL', 'NAO_TESTADO', 'SEM_CERTIFICADO', 'FALHA'] as const;
export type EstadoDaFinalidadeNoSigner = (typeof ESTADOS_DA_FINALIDADE_NO_SIGNER)[number];

export type EstadoPorFinalidade = Readonly<{
  finalidade: Finalidade;
  estado: EstadoDaFinalidadeNoSigner;
  /** UTC; a tela converte para America/Sao_Paulo (I-11). */
  ultimoTesteEm: string | null;
  latenciaMs: number | null;
  codigo: string | null;
}>;

export type EstadoDaEmpresaNoSigner = Readonly<{
  empresaId: string;
  finalidades: readonly EstadoPorFinalidade[];
  /** O pior estado entre as finalidades; nunca depende só de cor na tela. */
  resumo: EstadoDaFinalidadeNoSigner;
}>;

export type RespostaDeEstados = Readonly<{ empresas: readonly EstadoDaEmpresaNoSigner[] }>;

export type ItemDoHistoricoDoSigner = Readonly<{
  id: string;
  finalidade: Finalidade;
  resultado: ResultadoDoHistorico;
  codigo: string | null;
  iniciadoEm: string;
  latenciaMs: number;
  reutilizado: boolean;
  origemDiagnostico: OrigemDoDiagnostico | null;
  identidadeTecnica: string;
  correlationId: string;
  /** Referência opaca da versão do certificado usada; nunca o segredo. */
  referenciaSegredo: string | null;
}>;

export type RespostaDeHistorico = Readonly<{
  pagina: number;
  itensPorPagina: typeof ITENS_POR_PAGINA_DO_HISTORICO;
  total: number;
  itens: readonly ItemDoHistoricoDoSigner[];
}>;
