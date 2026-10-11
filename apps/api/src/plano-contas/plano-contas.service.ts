/**
 * Casos de uso da importação do plano de contas por CSV (SPEC-013 §3.2–§3.10, §6.1–§6.4).
 *
 * O fluxo (envio sem rastro antes do storage, idempotência, fila depois do commit, confirmação numa
 * transação com FALHA registrada numa 2ª, cancelamento, relatório em fluxo) é o comum de
 * `importacao/orquestrador.ts`; aqui fica a estratégia do plano: o repositório da F13, o mapeamento
 * dos cinco campos, a aplicação nas contas, a pendência PLANO_CONTAS e o aviso ao iniciador.
 */
import {
  CAMPOS_DO_CONTRATO,
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  gerarRelatorioCsv,
  validarMapeamento,
  type CampoDoContrato,
  type Mapeamento,
} from '@contaia/domain';
import {
  aplicarLinhasNoPlano,
  buscarDiagnosticoDaTentativa,
  buscarTentativaDeImportacao,
  cancelarImportacao,
  comContextoHumano,
  confirmarImportacao,
  criarNotificacaoDeImportacao,
  criarTentativaDeImportacao,
  finalizarImportacao,
  listarHistoricoDeImportacoes,
  listarLinhasParaRelatorio,
  listarPlanoDeContas,
  listarRejeicoesDaImportacao,
  registrarEventoDeImportacao,
  registrarFalhaDaImportacao,
  type RejeicaoDaLinha,
  type TentativaDeImportacao,
} from '@contaia/db';
import type {
  HistoricoDeImportacoes,
  InspecaoDePlanilha,
  PaginaDeRejeicoesDaImportacao,
  PaginaDoPlanoDeContas,
  PreviaDaImportacao,
} from '@contaia/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import {
  OrquestradorDeImportacao,
  PRAZOS_DO_RELATORIO,
  type ArquivoEnviado,
  type ContextoDaImportacao,
  type EstrategiaDeImportacao,
  type OriginalDaImportacao,
  type PrazosDoRelatorio,
  type RelatorioDaImportacao,
} from '../importacao/orquestrador';
import { LEITURA_DE_PLANILHAS, type CamposDePlanilhaInformados, type LeituraDePlanilhas } from '../importacao/planilha';
import { reconciliarPendenciaDoPlano } from './pendencia-do-plano';
import { paraPaginaDeRejeicoes, paraPaginaDoPlano, paraPrevia } from './plano-contas.apresentacao';
import { FILA_DE_VALIDACAO_DO_PLANO, type FilaDeValidacaoDoPlano } from './plano-contas.fila';

export {
  CODIGO_DA_FALHA_NA_APLICACAO,
  ITENS_POR_PAGINA_DE_REJEICOES,
  OCIOSIDADE_MAXIMA_DO_RELATORIO_MS,
  PRAZOS_DO_RELATORIO,
  PRAZO_TOTAL_DO_RELATORIO_MS,
  type ContextoDaImportacao,
  type OriginalDaImportacao,
  type PrazosDoRelatorio,
  type RelatorioDaImportacao,
} from '../importacao/orquestrador';

export type ArquivoDoPlano = ArquivoEnviado;

/** Mapeamento como chegou (campos podem faltar): a ausência vira `MAPEAMENTO_INCOMPLETO`. */
export type MapeamentoInformado = Readonly<{ [Campo in CampoDoContrato]?: string | undefined }>;

export const ITENS_POR_PAGINA_DO_PLANO = 50;

/**
 * Chave endereçada por conteúdo: o mesmo arquivo ocupa um objeto só (sem duplicados). O PUT acontece
 * antes do commit da tentativa; se ela não nascer, o objeto fica — inofensivo, e o próximo envio do
 * mesmo conteúdo o sobrescreve com bytes idênticos.
 */
export const chaveDoOriginal = (tenantId: string, empresaId: string, hash: string, extensao = 'csv'): string =>
  `${tenantId}/${empresaId}/plano-contas/${hash}.${extensao}`;

/** Os cinco campos do contrato, aparados: a identidade idempotente não depende de espaço. */
const validarMapeamentoDoPlano = (informado: unknown, cabecalho: readonly string[]): Mapeamento => {
  const origem = (informado ?? {}) as MapeamentoInformado;
  const mapeamento = Object.fromEntries(
    CAMPOS_DO_CONTRATO.map((campo) => [campo, (origem[campo] ?? '').trim()]),
  ) as Mapeamento;
  const pendencias = validarMapeamento(cabecalho, mapeamento);

  if (pendencias.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      'Associe uma coluna do arquivo, sem repetir, a cada campo obrigatório.',
      pendencias.map((pendencia) => ({ campo: pendencia.campo, codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO })),
      { pendencias },
    );
  }

  return mapeamento;
};

const ESTRATEGIA_DO_PLANO: EstrategiaDeImportacao<
  TentativaDeImportacao,
  RejeicaoDaLinha,
  PreviaDaImportacao,
  PaginaDeRejeicoesDaImportacao
> = {
  rotulo: 'plano de contas',
  tipoDoArquivo: 'IMPORTACAO_PLANO_CONTAS',
  nomePadraoDoArquivo: 'plano-de-contas.csv',
  chaveDoOriginal,
  validarMapeamento: validarMapeamentoDoPlano,
  repositorio: {
    criar: (c, nova) => criarTentativaDeImportacao(c, nova),
    buscar: (c, e, id) => buscarTentativaDeImportacao(c, e, id),
    confirmar: (c, confirmacao) => confirmarImportacao(c, confirmacao),
    cancelar: (c, cancelamento) => cancelarImportacao(c, cancelamento),
    registrarEvento: (c, evento) => registrarEventoDeImportacao(c, evento),
    registrarFalha: (c, e, id, agora) => registrarFalhaDaImportacao(c, e, id, agora),
    finalizar: (c, e, id, estado, totais, agora) => finalizarImportacao(c, e, id, estado, totais, agora),
    listarRejeicoes: (c, e, id, pagina, porPagina) => listarRejeicoesDaImportacao(c, e, id, pagina, porPagina),
    buscarDiagnostico: (c, e, id) => buscarDiagnosticoDaTentativa(c, e, id),
    listarHistorico: (c, e, pagina) => listarHistoricoDeImportacoes(c, e, pagina),
  },
  aplicar: async (c, e, id, agora) => {
    const { incluidas, atualizadas, ignoradas } = await aplicarLinhasNoPlano(c, e, id, agora);

    return { incluidas, atualizadas, ignoradas: ignoradas.length };
  },
  reconciliarPendencia: reconciliarPendenciaDoPlano,
  // Só o iniciador (SPEC-013 §3.10): o repositório da F13 não recebe destinatários.
  notificar: async (c, tentativa, agora) => {
    await criarNotificacaoDeImportacao(c, { empresaId: tentativa.empresaId, tentativaId: tentativa.id, agora });
  },
  gerarRelatorio: (c, e, id) => gerarRelatorioCsv(listarLinhasParaRelatorio(c, e, id)),
  paraPrevia,
  paraPaginaDeRejeicoes,
  textos: {
    empresaArquivada: 'Empresa arquivada fica somente para consulta; reative-a antes de importar o plano de contas.',
    empresaNaoAtiva: 'Conclua o cadastro da empresa antes de importar o plano de contas.',
    storageIndisponivel: 'Não foi possível guardar o arquivo agora. Nenhuma conta foi alterada; envie de novo.',
    conflitoPorArquivado: 'O plano de contas mudou depois da prévia (há conta arquivada). Valide o arquivo novamente.',
    falhaRegistrada:
      'A importação não pôde ser aplicada por um problema técnico. Nenhuma conta foi alterada; envie o arquivo de novo para uma nova tentativa.',
  },
};

@Injectable()
export class PlanoContasService {
  private readonly orquestrador: OrquestradorDeImportacao<
    TentativaDeImportacao,
    RejeicaoDaLinha,
    PreviaDaImportacao,
    PaginaDeRejeicoesDaImportacao
  >;

  constructor(
    private readonly pool: PoolDoBanco,
    storage: StorageService,
    @Inject(FILA_DE_VALIDACAO_DO_PLANO) fila: FilaDeValidacaoDoPlano,
    @Optional() @Inject(PRAZOS_DO_RELATORIO) prazos?: PrazosDoRelatorio,
    @Optional() @Inject(LEITURA_DE_PLANILHAS) leitura?: LeituraDePlanilhas,
  ) {
    this.orquestrador = new OrquestradorDeImportacao(
      ESTRATEGIA_DO_PLANO,
      { pool: pool.instancia, storage, fila, prazos, leitura, agora: () => this.agora() },
      PlanoContasService.name,
    );
  }

  /** Único ponto que lê o relógio (I-11): os testes o substituem. */
  protected agora(): Date {
    return new Date();
  }

  enviar(
    contexto: ContextoDaImportacao,
    empresaId: string,
    arquivo: ArquivoDoPlano,
    informado: MapeamentoInformado,
  ): Promise<PreviaDaImportacao> {
    return this.orquestrador.enviar(contexto, empresaId, arquivo, informado);
  }

  /** Inspeção sem estado da planilha (SPEC-015 §3.3–§3.4): nada é gravado. */
  inspecionarPlanilha(
    contexto: ContextoDaImportacao,
    arquivo: ArquivoDoPlano,
    pedido: CamposDePlanilhaInformados,
  ): Promise<InspecaoDePlanilha> {
    return this.orquestrador.inspecionar(contexto, arquivo, pedido);
  }

  confirmar(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string, versaoDaPrevia: number): Promise<PreviaDaImportacao> {
    return this.orquestrador.confirmar(contexto, empresaId, tentativaId, versaoDaPrevia);
  }

  cancelar(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<PreviaDaImportacao> {
    return this.orquestrador.cancelar(contexto, empresaId, tentativaId);
  }

  previa(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<PreviaDaImportacao> {
    return this.orquestrador.previa(contexto, empresaId, tentativaId);
  }

  historico(contexto: ContextoDaImportacao, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes> {
    return this.orquestrador.historico(contexto, empresaId, pagina);
  }

  rejeicoes(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string, pagina: number): Promise<PaginaDeRejeicoesDaImportacao> {
    return this.orquestrador.rejeicoes(contexto, empresaId, tentativaId, pagina);
  }

  arquivoOriginal(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<OriginalDaImportacao> {
    return this.orquestrador.arquivoOriginal(contexto, empresaId, tentativaId);
  }

  relatorio(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<RelatorioDaImportacao> {
    return this.orquestrador.relatorio(contexto, empresaId, tentativaId);
  }

  async plano(contexto: ContextoDaImportacao, empresaId: string, pagina: number, busca?: string): Promise<PaginaDoPlanoDeContas> {
    return comContextoHumano(this.pool.instancia, contexto, async (cliente) =>
      paraPaginaDoPlano(await listarPlanoDeContas(cliente, empresaId, pagina, ITENS_POR_PAGINA_DO_PLANO, busca)),
    );
  }
}
