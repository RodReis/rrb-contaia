/**
 * DTOs de saída da importação do plano de contas (SPEC-013 §3.5, §3.9). A entidade persistida
 * nunca sai como veio: tenant, iniciador, chave do storage e a versão interna da conta ficam no
 * servidor. As flags de ação saem do estado — a permissão continua conferida em cada rota.
 */
import type {
  ContaDoPlano,
  DiagnosticoDaTentativa,
  PaginaDeRejeicoes,
  PaginaDoPlano,
  RejeicaoDaLinha,
  TentativaDeImportacao,
} from '@contaia/db';
import type {
  ContaDoPlanoDeContas,
  DiagnosticoDaImportacao,
  PaginaDeRejeicoesDaImportacao,
  PaginaDoPlanoDeContas,
  PreviaDaImportacao,
  RejeicaoDaImportacao,
} from '@contaia/shared';

type SituacaoDaTentativa = Pick<TentativaDeImportacao, 'estado' | 'totais'>;

/**
 * Há staging quando a validação gravou o resultado (os totais saem dele). RECEBIDA, VALIDANDO e a
 * FALHA de validação não têm: sem rejeições nem relatório.
 */
export const temResultadoDaValidacao = (tentativa: SituacaoDaTentativa): boolean => tentativa.totais !== null;

/** Relatório existe para a prévia e para os terminais com staging; `APLICANDO` nunca é visto fora da transação. */
export const relatorioDisponivel = (tentativa: SituacaoDaTentativa): boolean =>
  temResultadoDaValidacao(tentativa) && tentativa.estado !== 'APLICANDO';

const paraRejeicao = (rejeicao: RejeicaoDaLinha): RejeicaoDaImportacao => ({
  numeroDaLinha: rejeicao.numeroDaLinha,
  codigo: rejeicao.codigo,
  campo: rejeicao.campo,
  codigoDeErro: rejeicao.codigoDeErro,
  mensagem: rejeicao.mensagem,
});

export const paraPaginaDeRejeicoes = (pagina: PaginaDeRejeicoes): PaginaDeRejeicoesDaImportacao => ({
  pagina: pagina.pagina,
  itensPorPagina: pagina.itensPorPagina,
  total: pagina.total,
  itens: pagina.itens.map(paraRejeicao),
});

/**
 * Mensagem PT-BR FECHADA por código estável do diagnóstico (SPEC-013 §7: desfecho acionável). O
 * texto nunca vem do evento nem de exceção: código fora do mapa recebe a mensagem genérica.
 */
const MENSAGENS_DO_DIAGNOSTICO: Readonly<Record<string, string>> = {
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
  FALHA_NA_APLICACAO: 'Uma falha técnica interrompeu a aplicação e nenhuma conta foi alterada. Envie o arquivo de novo.',
};
const MENSAGEM_GENERICA_DO_DIAGNOSTICO =
  'A importação não pôde ser concluída. Envie o arquivo de novo; se persistir, informe o código de correlação ao suporte.';

/** Só FALHA e REJEITADA têm diagnóstico; nos demais estados a trilha nem é consultada. */
export const temDiagnostico = (tentativa: Pick<TentativaDeImportacao, 'estado'>): boolean =>
  tentativa.estado === 'FALHA' || tentativa.estado === 'REJEITADA';

export const paraDiagnostico = (diagnostico: DiagnosticoDaTentativa | null): DiagnosticoDaImportacao | null =>
  diagnostico === null
    ? null
    : { codigo: diagnostico.codigo, mensagem: MENSAGENS_DO_DIAGNOSTICO[diagnostico.codigo] ?? MENSAGEM_GENERICA_DO_DIAGNOSTICO };

export const paraPrevia = (
  tentativa: TentativaDeImportacao,
  amostra: readonly RejeicaoDaLinha[],
  diagnostico: DiagnosticoDaTentativa | null = null,
): PreviaDaImportacao => {
  const aguardando = tentativa.estado === 'AGUARDANDO_CONFIRMACAO';

  return {
    tentativaId: tentativa.id,
    estado: tentativa.estado,
    arquivo: { nome: tentativa.arquivoNome, tamanho: tentativa.arquivoTamanho, hash: tentativa.hashArquivo },
    mapeamento: { ...tentativa.mapeamento },
    totais: tentativa.totais === null ? null : { ...tentativa.totais },
    amostraRejeicoes: amostra.map(paraRejeicao),
    criadoEm: tentativa.criadoEm.toISOString(),
    finalizadoEm: tentativa.finalizadoEm?.toISOString() ?? null,
    correlationId: tentativa.correlationId,
    versaoDaPrevia: tentativa.planoVersaoNaValidacao,
    reutilizadaPorIdempotencia: tentativa.reutilizadaPorIdempotencia,
    podeConfirmar: aguardando,
    podeCancelar: aguardando,
    relatorioDisponivel: relatorioDisponivel(tentativa),
    diagnostico: temDiagnostico(tentativa) ? paraDiagnostico(diagnostico) : null,
  };
};

const paraConta = (conta: ContaDoPlano): ContaDoPlanoDeContas => ({
  id: conta.id,
  codigo: conta.codigo,
  nome: conta.nome,
  tipo: conta.tipo,
  natureza: conta.natureza,
  contaPai: conta.contaPai,
  arquivada: conta.arquivada,
  atualizadoEm: conta.atualizadoEm.toISOString(),
});

export const paraPaginaDoPlano = (pagina: PaginaDoPlano): PaginaDoPlanoDeContas => ({
  pagina: pagina.pagina,
  itensPorPagina: pagina.itensPorPagina,
  total: pagina.total,
  itens: pagina.itens.map(paraConta),
});
