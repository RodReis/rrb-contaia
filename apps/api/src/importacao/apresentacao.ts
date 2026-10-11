/**
 * Saída comum das importações por arquivo (SPEC-013 §3.5, §3.9; SPEC-014 §3.5, §3.9). A entidade
 * persistida nunca sai como veio: tenant, iniciador e chave do storage ficam no servidor. As flags de
 * ação saem do estado — a permissão continua conferida em cada rota.
 */
import type { DiagnosticoDaTentativa, TentativaDoCiclo, TotaisDaImportacao } from '@contaia/db';
import type { DiagnosticoDaImportacao, EstadoDaImportacao } from '@contaia/shared';

type SituacaoDaTentativa = Readonly<{ estado: EstadoDaImportacao; totais: TotaisDaImportacao | null }>;

/** O que a prévia mostra de uma tentativa (o tipo do plano e o do ciclo genérico cabem aqui). */
export type TentativaApresentavel = Pick<
  TentativaDoCiclo,
  | 'id'
  | 'estado'
  | 'arquivoNome'
  | 'arquivoTamanho'
  | 'hashArquivo'
  | 'mapeamento'
  | 'totais'
  | 'criadoEm'
  | 'finalizadoEm'
  | 'correlationId'
  | 'reutilizadaPorIdempotencia'
  // SPEC-015: configuração e leitura da planilha (no CSV, os padrões: formato CSV, sem aba, linha 1).
  | 'formato'
  | 'aba'
  | 'linhaCabecalho'
  | 'linhasIgnoradasAntesDoCabecalho'
  | 'linhasOcultas'
  | 'diagnosticosDaPlanilha'
>;

/**
 * Há staging quando a validação gravou o resultado (os totais saem dele). RECEBIDA, VALIDANDO e a
 * FALHA de validação não têm: sem rejeições nem relatório.
 */
export const temResultadoDaValidacao = (tentativa: SituacaoDaTentativa): boolean => tentativa.totais !== null;

/** Relatório existe para a prévia e para os terminais com staging; `APLICANDO` nunca é visto fora da transação. */
export const relatorioDisponivel = (tentativa: SituacaoDaTentativa): boolean =>
  temResultadoDaValidacao(tentativa) && tentativa.estado !== 'APLICANDO';

/** Só FALHA e REJEITADA têm diagnóstico; nos demais estados a trilha nem é consultada. */
export const temDiagnostico = (tentativa: Readonly<{ estado: EstadoDaImportacao }>): boolean =>
  tentativa.estado === 'FALHA' || tentativa.estado === 'REJEITADA';

/**
 * Mensagem PT-BR FECHADA por código estável do diagnóstico (SPEC-013 §7, SPEC-014 §7: desfecho
 * acionável). O texto nunca vem do evento nem de exceção: código fora do mapa recebe a genérica.
 * `FALHA_NA_APLICACAO` diz o que não mudou, e isso é do domínio: cada um passa a sua.
 */
export const mensagensDoDiagnostico = (falhaNaAplicacao: string): Readonly<Record<string, string>> => ({
  ARQUIVO_VAZIO: 'O arquivo não tem linhas de dados. Confira o arquivo e envie de novo.',
  ARQUIVO_ACIMA_DO_LIMITE: 'O arquivo passa do limite de 10 MB ou de 10.000 linhas. Divida o arquivo e envie de novo.',
  ARQUIVO_INVALIDO: 'Não foi possível ler o arquivo como CSV (aspas ou formato). Confira o arquivo e envie de novo.',
  CABECALHO_INVALIDO: 'O cabeçalho do arquivo tem coluna sem nome ou repetida. Corrija o cabeçalho e envie de novo.',
  MAPEAMENTO_INCOMPLETO: 'O mapeamento não corresponde às colunas do arquivo. Refaça o mapeamento e envie de novo.',
  ORIGINAL_NAO_ENCONTRADO: 'O arquivo enviado não foi encontrado no armazenamento. Envie o arquivo de novo.',
  ARMAZENAMENTO_INDISPONIVEL:
    'O armazenamento de arquivos ficou indisponível durante a validação. Envie o arquivo de novo em instantes.',
  FALHA_NA_VALIDACAO:
    'Uma falha técnica interrompeu a validação. Envie o arquivo de novo; se persistir, informe o código de correlação ao suporte.',
  FALHA_NA_APLICACAO: falhaNaAplicacao,
});

const MENSAGEM_GENERICA_DO_DIAGNOSTICO =
  'A importação não pôde ser concluída. Envie o arquivo de novo; se persistir, informe o código de correlação ao suporte.';

export const paraDiagnosticoCom = (
  mensagens: Readonly<Record<string, string>>,
  diagnostico: DiagnosticoDaTentativa | null,
): DiagnosticoDaImportacao | null =>
  diagnostico === null
    ? null
    : { codigo: diagnostico.codigo, mensagem: mensagens[diagnostico.codigo] ?? MENSAGEM_GENERICA_DO_DIAGNOSTICO };

/** Envelope da prévia, igual nos domínios; muda o formato da rejeição e a versão do agregado. */
export const montarPrevia = <Rejeicao>(
  tentativa: TentativaApresentavel,
  versaoDaPrevia: number | null,
  amostra: readonly Rejeicao[],
  diagnostico: DiagnosticoDaImportacao | null,
) => {
  const aguardando = tentativa.estado === 'AGUARDANDO_CONFIRMACAO';

  return {
    tentativaId: tentativa.id,
    estado: tentativa.estado,
    arquivo: { nome: tentativa.arquivoNome, tamanho: tentativa.arquivoTamanho, hash: tentativa.hashArquivo },
    mapeamento: { ...tentativa.mapeamento },
    totais: tentativa.totais === null ? null : { ...tentativa.totais },
    amostraRejeicoes: [...amostra],
    criadoEm: tentativa.criadoEm.toISOString(),
    finalizadoEm: tentativa.finalizadoEm?.toISOString() ?? null,
    correlationId: tentativa.correlationId,
    versaoDaPrevia,
    reutilizadaPorIdempotencia: tentativa.reutilizadaPorIdempotencia,
    podeConfirmar: aguardando,
    podeCancelar: aguardando,
    relatorioDisponivel: relatorioDisponivel(tentativa),
    diagnostico: temDiagnostico(tentativa) ? diagnostico : null,
    formato: tentativa.formato,
    aba: tentativa.aba === null ? null : { ...tentativa.aba },
    linhaCabecalho: tentativa.linhaCabecalho,
    linhasIgnoradasAntesDoCabecalho: tentativa.linhasIgnoradasAntesDoCabecalho,
    linhasOcultas: tentativa.linhasOcultas,
    diagnosticosDaPlanilha: tentativa.diagnosticosDaPlanilha.map((diagnostico) => ({ ...diagnostico })),
  };
};
