/**
 * Casos de uso da importação de empregados por CSV (SPEC-014 §3.2–§3.10, §6.1–§6.4).
 *
 * O fluxo (envio sem rastro antes do storage, idempotência, fila depois do commit, confirmação numa
 * transação com FALHA registrada numa 2ª, cancelamento, relatório em fluxo) é o comum de
 * `importacao/orquestrador.ts`, o mesmo da F13. Aqui fica a estratégia de empregados: o ciclo
 * genérico do banco com `DESCRITOR_EMPREGADOS`, o mapeamento dos cinco campos, a aplicação pela
 * chave empresa + CPF + matrícula, a pendência EMPREGADOS e os avisos ao iniciador e aos
 * `admin_escritorio` com a empresa na carteira.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  gerarRelatorioCsvDeEmpregados,
  validarMapeamentoDeEmpregados,
} from '@contaia/domain';
import {
  DESCRITOR_EMPREGADOS as D,
  aplicarLinhasDeEmpregados,
  cicloDeImportacao,
  comContextoHumano,
  consultasDeImportacao,
  criarNotificacoesDeImportacaoDeEmpregados,
  criarTentativaDeEmpregados,
  listarAdminsAutorizadosDaEmpresa,
  listarEmpregados,
  listarLinhasParaRelatorioDeEmpregados,
  listarRejeicoesDeEmpregados,
  type TentativaDoCiclo,
} from '@contaia/db';
import type {
  HistoricoDeImportacoes,
  InspecaoDePlanilha,
  PaginaDeEmpregados,
  PaginaDeRejeicoesDeEmpregados,
  PreviaDaImportacaoDeEmpregados,
  RejeicaoDeEmpregado,
} from '@contaia/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import type { FilaDeValidacao } from '../importacao/fila';
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
import { paraPreviaDeEmpregados } from './empregados.apresentacao';
import type { MapeamentoDeEmpregadosInformado } from './empregados.dto';
import { FILA_DE_VALIDACAO_DOS_EMPREGADOS } from './empregados.fila';
import { reconciliarPendenciaDosEmpregados } from './pendencia-dos-empregados';

export const ITENS_POR_PAGINA_DE_EMPREGADOS = 50;

/** Chave endereçada por conteúdo, como na F13: o mesmo arquivo ocupa um objeto só. */
export const chaveDoOriginalDeEmpregados = (tenantId: string, empresaId: string, hash: string, extensao: string): string =>
  `${tenantId}/${empresaId}/empregados/${hash}.${extensao}`;

const validarMapeamento = (informado: unknown, cabecalho: readonly string[]) => {
  const resultado = validarMapeamentoDeEmpregados(informado, cabecalho);

  if (!resultado.ok) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      'Associe uma coluna do arquivo, sem repetir, a cada campo obrigatório.',
      resultado.pendencias.map((pendencia) => ({ campo: pendencia.campo, codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO })),
      { pendencias: resultado.pendencias },
    );
  }

  return resultado.mapeamento;
};

/** Iniciador + admins autorizados, sem repetir; idempotente (reuso nunca chega aqui). */
const notificar = async (cliente: PoolClient, tentativa: TentativaDoCiclo, agora: Date): Promise<void> => {
  const admins = await listarAdminsAutorizadosDaEmpresa(cliente, tentativa.empresaId);

  await criarNotificacoesDeImportacaoDeEmpregados(cliente, {
    empresaId: tentativa.empresaId,
    tentativaId: tentativa.id,
    destinatarios: [...new Set([tentativa.usuarioIniciadorId, ...admins])],
    agora,
  });
};

const ESTRATEGIA_DE_EMPREGADOS: EstrategiaDeImportacao<
  TentativaDoCiclo,
  RejeicaoDeEmpregado,
  PreviaDaImportacaoDeEmpregados,
  PaginaDeRejeicoesDeEmpregados
> = {
  rotulo: 'empregados',
  tipoDoArquivo: 'IMPORTACAO_EMPREGADOS',
  nomePadraoDoArquivo: 'empregados.csv',
  chaveDoOriginal: chaveDoOriginalDeEmpregados,
  validarMapeamento,
  repositorio: {
    criar: (c, nova) => criarTentativaDeEmpregados(c, nova),
    buscar: (c, e, id) => cicloDeImportacao.buscarTentativa(c, D, e, id),
    confirmar: (c, confirmacao) => cicloDeImportacao.confirmar(c, D, confirmacao),
    cancelar: (c, cancelamento) => cicloDeImportacao.cancelar(c, D, cancelamento),
    registrarEvento: (c, evento) => cicloDeImportacao.registrarEvento(c, D, evento),
    registrarFalha: (c, e, id, agora) => cicloDeImportacao.registrarFalha(c, D, e, id, agora),
    finalizar: (c, e, id, estado, totais, agora) => cicloDeImportacao.finalizar(c, D, e, id, estado, totais, agora),
    listarRejeicoes: (c, e, id, pagina, porPagina) => listarRejeicoesDeEmpregados(c, e, id, pagina, porPagina),
    buscarDiagnostico: (c, e, id) => consultasDeImportacao.buscarDiagnosticoDaTentativa(c, D, e, id),
    listarHistorico: (c, e, pagina) => consultasDeImportacao.listarHistorico(c, D, e, pagina),
  },
  aplicar: (c, empresaId, tentativaId, agora) => aplicarLinhasDeEmpregados(c, { empresaId, tentativaId, agora }),
  reconciliarPendencia: reconciliarPendenciaDosEmpregados,
  notificar,
  gerarRelatorio: (c, e, id) => gerarRelatorioCsvDeEmpregados(listarLinhasParaRelatorioDeEmpregados(c, e, id)),
  paraPrevia: paraPreviaDeEmpregados,
  paraPaginaDeRejeicoes: (pagina) => ({ ...pagina, itens: [...pagina.itens] }),
  textos: {
    empresaArquivada: 'Empresa arquivada fica somente para consulta; reative-a antes de importar empregados.',
    empresaNaoAtiva: 'Conclua o cadastro da empresa antes de importar empregados.',
    storageIndisponivel: 'Não foi possível guardar o arquivo agora. Nenhum empregado foi alterado; envie de novo.',
    conflitoPorArquivado:
      'A base de empregados mudou depois da prévia (há empregado arquivado). Valide o arquivo novamente.',
    falhaRegistrada:
      'A importação não pôde ser aplicada por um problema técnico. Nenhum empregado foi alterado; envie o arquivo de novo para uma nova tentativa.',
  },
};

@Injectable()
export class EmpregadosService {
  private readonly orquestrador: OrquestradorDeImportacao<
    TentativaDoCiclo,
    RejeicaoDeEmpregado,
    PreviaDaImportacaoDeEmpregados,
    PaginaDeRejeicoesDeEmpregados
  >;

  constructor(
    private readonly pool: PoolDoBanco,
    storage: StorageService,
    @Inject(FILA_DE_VALIDACAO_DOS_EMPREGADOS) fila: FilaDeValidacao,
    @Optional() @Inject(PRAZOS_DO_RELATORIO) prazos?: PrazosDoRelatorio,
    @Optional() @Inject(LEITURA_DE_PLANILHAS) leitura?: LeituraDePlanilhas,
  ) {
    this.orquestrador = new OrquestradorDeImportacao(
      ESTRATEGIA_DE_EMPREGADOS,
      { pool: pool.instancia, storage, fila, prazos, leitura, agora: () => this.agora() },
      EmpregadosService.name,
    );
  }

  /** Único ponto que lê o relógio (I-11): os testes o substituem. */
  protected agora(): Date {
    return new Date();
  }

  enviar(
    contexto: ContextoDaImportacao,
    empresaId: string,
    arquivo: ArquivoEnviado,
    informado: MapeamentoDeEmpregadosInformado,
  ): Promise<PreviaDaImportacaoDeEmpregados> {
    return this.orquestrador.enviar(contexto, empresaId, arquivo, informado);
  }

  /** Inspeção sem estado da planilha (SPEC-015 §3.3–§3.4): nada é gravado. */
  inspecionarPlanilha(
    contexto: ContextoDaImportacao,
    arquivo: ArquivoEnviado,
    pedido: CamposDePlanilhaInformados,
  ): Promise<InspecaoDePlanilha> {
    return this.orquestrador.inspecionar(contexto, arquivo, pedido);
  }

  confirmar(
    contexto: ContextoDaImportacao,
    empresaId: string,
    tentativaId: string,
    versaoDaPrevia: number,
  ): Promise<PreviaDaImportacaoDeEmpregados> {
    return this.orquestrador.confirmar(contexto, empresaId, tentativaId, versaoDaPrevia);
  }

  cancelar(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<PreviaDaImportacaoDeEmpregados> {
    return this.orquestrador.cancelar(contexto, empresaId, tentativaId);
  }

  previa(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<PreviaDaImportacaoDeEmpregados> {
    return this.orquestrador.previa(contexto, empresaId, tentativaId);
  }

  historico(contexto: ContextoDaImportacao, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes> {
    return this.orquestrador.historico(contexto, empresaId, pagina);
  }

  rejeicoes(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string, pagina: number): Promise<PaginaDeRejeicoesDeEmpregados> {
    return this.orquestrador.rejeicoes(contexto, empresaId, tentativaId, pagina);
  }

  arquivoOriginal(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<OriginalDaImportacao> {
    return this.orquestrador.arquivoOriginal(contexto, empresaId, tentativaId);
  }

  relatorio(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<RelatorioDaImportacao> {
    return this.orquestrador.relatorio(contexto, empresaId, tentativaId);
  }

  /** Base importada em consulta (SPEC-014 §3.9): sem edição, arquivamento nem reativação. */
  empregados(contexto: ContextoDaImportacao, empresaId: string, pagina: number, busca?: string): Promise<PaginaDeEmpregados> {
    return comContextoHumano(this.pool.instancia, contexto, (cliente) =>
      listarEmpregados(cliente, empresaId, pagina, ITENS_POR_PAGINA_DE_EMPREGADOS, busca),
    );
  }
}
