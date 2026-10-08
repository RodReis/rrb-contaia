/**
 * DTOs de saída da importação do plano de contas (SPEC-013 §3.5, §3.9). A entidade persistida
 * nunca sai como veio: tenant, iniciador, chave do storage e a versão interna da conta ficam no
 * servidor. As flags de ação saem do estado — a permissão continua conferida em cada rota.
 */
import type {
  ContaDoPlano,
  PaginaDeRejeicoes,
  PaginaDoPlano,
  RejeicaoDaLinha,
  TentativaDeImportacao,
} from '@contaia/db';
import type {
  ContaDoPlanoDeContas,
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

export const paraPrevia = (
  tentativa: TentativaDeImportacao,
  amostra: readonly RejeicaoDaLinha[],
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
