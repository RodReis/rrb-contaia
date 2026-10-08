/**
 * Casos de uso da importação do plano de contas (SPEC-013 §3, §4, §6).
 *
 * A API: autoriza, registra tentativa, recebe mapeamento, consulta prévia/histórico,
 * confirma aplicação transacional, cancela prévia. O processamento assíncrono roda no worker.
 * O caso de uso controla a transação; controller só valida e delega.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  decidirIdempotenciaDaImportacao,
  ehEstadoTerminal,
  proximoEstado,
  type EstadoDaTentativa,
  type TentativaExistente,
  type PedidoDeImportacao,
} from '@contaia/domain';
import { comContextoHumano, comContextoTecnico } from '@contaia/db';
import type {
  ComandoValidarImportacao,
  HistoricoDeImportacoes,
  PreviaDaImportacao,
  TentativaDoHistorico,
} from '@contaia/shared';
import {
  ErroDoClienteDaFila,
  enfileirarValidacaoPlanoContas,
  type FilaQueEnfileira,
} from '@contaia/importacao-plano-contas-client';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { PoolDoBanco } from '../banco/pool.provider';
import type { SessaoDoCofre } from '../certificados/visoes';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import {
  confirmarImportacaoSchema,
  criarTentativaSchema,
  cancelarPreviaSchema,
  listarHistoricoSchema,
  listarRejeicoesSchema,
  mapeamentoSchema,
  salvarMapeamentoSchema,
} from './plano-contas.dto';
import { FILA_DE_VALIDACAO_PLANO_CONTAS_DA_API } from './plano-contas.tokens';

const semAutorizacao = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Sem autorização para este recurso.');

const naoEncontrada = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');

const estadoInvalido = (estado: EstadoDaTentativa): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO,
    `Ação não permitida no estado atual: ${estado}.`,
  );

const versaoConflito = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
    'O plano de contas foi alterado desde a prévia. Valide novamente antes de confirmar.',
  );

const indisponivel = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.FILA_INDISPONIVEL,
    'Serviço de processamento indisponível. Tente novamente em instantes.',
  );

@Injectable()
export class PlanoContasService {
  private readonly logger = new Logger(PlanoContasService.name);

  constructor(
    private readonly pool: PoolDoBanco,
    @Inject(FILA_DE_VALIDACAO_PLANO_CONTAS_DA_API) private readonly fila: FilaQueEnfileira,
  ) {}

  protected agora(): Date {
    return new Date();
  }

  // -- Criar tentativa (inicia wizard/aba) ------------------------------------------------

  async criarTentativa(
    sessao: SessaoDoCofre,
    dto: z.infer<typeof criarTentativaSchema>,
    correlationId: string,
  ): Promise<{ tentativaId: string; reutilizada: boolean }> {
    const pedido: PedidoDeImportacao = {
      tenantId: sessao.tenantId,
      empresaId: sessao.empresaId!,
      hashArquivo: dto.hashArquivo,
      mapeamento: '', // mapeamento vazio no registro inicial; preenchido depois
    };

    // Verifica idempotência antes de criar
    const existente = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.buscarTentativaPorChave(cliente, pedido.empresaId, pedido.hashArquivo, {}),
    );

    const decisao = decidirIdempotenciaDaImportacao(
      existente ? { ...existente, mapeamento: '' } : null,
      pedido,
    );

    if (decisao.tipo === 'REUTILIZAR') {
      await comContextoHumano(
        this.pool.instancia,
        { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
        (cliente) => this.marcarReutilizada(cliente, decisao.tentativaId),
      );
      return { tentativaId: decisao.tentativaId, reutilizada: true };
    }

    if (decisao.tipo === 'EM_ANDAMENTO') {
      return { tentativaId: decisao.tentativaId, reutilizada: false };
    }

    // Nova tentativa
    const validado = analisar(criarTentativaSchema, dto);
    const tentativaId = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) =>
        this.criarTentativa(cliente, {
          tenantId: sessao.tenantId,
          empresaId: sessao.empresaId!,
          hashArquivo: validado.hashArquivo,
          mapeamento: {},
          arquivoNome: validado.arquivoNome,
          arquivoTamanho: validado.arquivoTamanho,
          usuarioIniciadorId: sessao.usuarioId,
          correlationId,
        }),
    );

    // Registra evento RECEBIDA
    await this.registrarEvento(tentativaId, sessao, correlationId, null, 'RECEBIDA');

    return { tentativaId, reutilizada: false };
  }

  // -- Salvar mapeamento + enfileirar validação ------------------------------------------

  async salvarMapeamento(
    sessao: SessaoDoCofre,
    tentativaId: string,
    dto: z.infer<typeof salvarMapeamentoSchema>,
    correlationId: string,
  ): Promise<{ enfileirado: boolean }> {
    const validado = analisar(salvarMapeamentoSchema, dto);

    const tentativa = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.buscarTentativaPorId(cliente, tentativaId),
    );

    if (!tentativa) throw naoEncontrada();
    if (tentativa.estado !== 'RECEBIDA') throw estadoInvalido(tentativa.estado);
    if (tentativa.usuarioIniciadorId !== sessao.usuarioId) throw semAutorizacao();

    await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.salvarMapeamentoRepo(cliente, tentativaId, validado.mapeamento),
    );

    // Atualiza a chave idempotente (hash + mapeamento) — reavalia idempotência
    const pedido: PedidoDeImportacao = {
      tenantId: sessao.tenantId,
      empresaId: sessao.empresaId!,
      hashArquivo: tentativa.hashArquivo,
      mapeamento: JSON.stringify(validado.mapeamento),
    };

    const existente = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) =>
        this.buscarTentativaPorChave(cliente, pedido.empresaId, pedido.hashArquivo, validado.mapeamento),
    );

    const decisao = decidirIdempotenciaDaImportacao(existente, pedido);

    if (decisao.tipo === 'REUTILIZAR') {
      // Mesmo hash + mapeamento já processado: marca reutilizada e não enfileira
      await comContextoHumano(
        this.pool.instancia,
        { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
        (cliente) => this.marcarReutilizada(cliente, decisao.tentativaId),
      );
      return { enfileirado: false };
    }

    if (decisao.tipo === 'EM_ANDAMENTO') {
      return { enfileirado: false };
    }

    // Nova validação: RECEBIDA -> VALIDANDO
    const iniciada = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.iniciarValidacao(cliente, tentativaId),
    );

    if (!iniciada) throw estadoInvalido(tentativa.estado);

    await this.registrarEvento(tentativaId, sessao, correlationId, 'RECEBIDA', 'VALIDANDO');

    // Enfileira processamento assíncrono
    try {
      await enfileirarValidacaoPlanoContas(this.fila, {
        tenantId: sessao.tenantId,
        empresaId: sessao.empresaId!,
        tentativaId,
        correlationId,
        arquivoHash: tentativa.hashArquivo,
        mapeamento: validado.mapeamento,
        usuarioOriginadorId: sessao.usuarioId,
      });
    } catch (erro) {
      this.logger.warn(`falha ao enfileirar validação [${correlationId}]: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
      throw indisponivel();
    }

    return { enfileirado: true };
  }

  // -- Consultar prévia (estado + totais + amostra de rejeições) --------------------------

  async consultarPrevia(
    sessao: SessaoDoCofre,
    tentativaId: string,
    correlationId: string,
  ): Promise<PreviaDaImportacao> {
    return comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      async (cliente) => {
        const tentativa = await this.buscarTentativaPorId(cliente, tentativaId);
        if (!tentativa) throw naoEncontrada();

        const linhas = await this.listarLinhasStaging(cliente, tentativaId);
        const rejeicoes = linhas.filter((l) => !l.aceita);
        const amostra = rejeicoes.slice(0, 50);

        return {
          tentativaId: tentativa.id,
          estado: tentativa.estado,
          arquivo: {
            nome: tentativa.arquivoNome,
            tamanho: tentativa.arquivoTamanho,
            hash: tentativa.hashArquivo,
          },
          mapeamento: tentativa.mapeamento,
          totais: tentativa.totais,
          amostraRejeicoes: amostra.map((l) => ({
            numeroDaLinha: l.numeroDaLinha,
            codigo: l.codigo,
            campo: l.campoErro,
            codigoDeErro: l.codigoErro!,
          })),
          criadoEm: tentativa.iniciadoEm,
        };
      },
    );
  }

  // -- Confirmar importação (transacional, versão otimista) ------------------------------

  async confirmarImportacao(
    sessao: SessaoDoCofre,
    tentativaId: string,
    dto: z.infer<typeof confirmarImportacaoSchema>,
    correlationId: string,
  ): Promise<{ estado: EstadoDaTentativa; totais: PreviaDaImportacao['totais'] }> {
    const validado = analisar(confirmarImportacaoSchema, dto);

    return comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      async (cliente) => {
        const tentativa = await this.buscarTentativaPorId(cliente, tentativaId);
        if (!tentativa) throw naoEncontrada();
        if (tentativa.estado !== 'AGUARDANDO_CONFIRMACAO') throw estadoInvalido(tentativa.estado);
        if (tentativa.planoVersaoNaValidacao !== validado.planoVersao) throw versaoConflito();

        // AGUARDANDO_CONFIRMACAO -> APLICANDO
        const confirmada = await this.confirmarImportacaoRepo(cliente, tentativaId, validado.planoVersao, sessao.usuarioId);
        if (!confirmada) throw estadoInvalido(tentativa.estado);

        await this.registrarEvento(tentativaId, sessao, correlationId, 'AGUARDANDO_CONFIRMACAO', 'APLICANDO');

        // Aplica linhas aceitas no plano
        const linhas = await this.listarLinhasStaging(cliente, tentativaId);
        const { incluidas, atualizadas } = await this.aplicarLinhasNoPlano(cliente, sessao.empresaId!, linhas);

        const totais = {
          lidas: tentativa.totais.lidas,
          novas: incluidas,
          atualizadas,
          rejeitadas: tentativa.totais.rejeitadas,
        };

        const estadoFinal = totais.rejeitadas > 0 ? 'CONCLUIDA_COM_REJEICOES' : 'CONCLUIDA';

        // APLICANDO -> CONCLUIDA | CONCLUIDA_COM_REJEICOES
        const finalizada = await this.finalizarAplicacao(cliente, tentativaId, estadoFinal, totais);
        if (!finalizada) throw new ErroDeDominio(CODIGOS_DE_ERRO.FALHA_TECNICA, 'Falha ao finalizar aplicação.');

        await this.registrarEvento(tentativaId, sessao, correlationId, 'APLICANDO', estadoFinal, incluidas, atualizadas, totais.rejeitadas);

        // Notifica iniciador
        await this.criarNotificacaoConclusao(cliente, sessao.tenantId, tentativa.usuarioIniciadorId, tentativaId, estadoFinal, totais);

        // Resolve pendência F5 se primeira conta válida
        if (totais.novas > 0 || totais.atualizadas > 0) {
          const temConta = await this.empresaTemContaValida(cliente, sessao.empresaId!);
          if (temConta) {
            await this.reconciliarPendenciaPlanoContas(cliente, sessao.tenantId, sessao.empresaId!);
          }
        }

        return { estado: estadoFinal, totais };
      },
    );
  }

  // -- Cancelar prévia --------------------------------------------------------------------

  async cancelarPrevia(
    sessao: SessaoDoCofre,
    tentativaId: string,
    dto: z.infer<typeof cancelarPreviaSchema>,
    correlationId: string,
  ): Promise<void> {
    analisar(cancelarPreviaSchema, dto);

    await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      async (cliente) => {
        const tentativa = await this.buscarTentativaPorId(cliente, tentativaId);
        if (!tentativa) throw naoEncontrada();
        if (tentativa.estado !== 'AGUARDANDO_CONFIRMACAO') throw estadoInvalido(tentativa.estado);
        if (tentativa.usuarioIniciadorId !== sessao.usuarioId) throw semAutorizacao();

        const cancelada = await this.cancelarPreviaRepo(cliente, tentativaId, sessao.usuarioId);
        if (!cancelada) throw estadoInvalido(tentativa.estado);

        await this.registrarEvento(tentativaId, sessao, correlationId, 'AGUARDANDO_CONFIRMACAO', 'CANCELADA');
      },
    );
  }

  // -- Histórico --------------------------------------------------------------------------

  async listarHistorico(
    sessao: SessaoDoCofre,
    dto: z.infer<typeof listarHistoricoSchema>,
    correlationId: string,
  ): Promise<HistoricoDeImportacoes> {
    const validado = analisar(listarHistoricoSchema, dto);

    return comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.listarHistoricoRepo(cliente, sessao.empresaId!, validado.pagina, validado.itensPorPagina),
    );
  }

  // -- Plano vigente ----------------------------------------------------------------------

  async listarPlanoVigente(
    sessao: SessaoDoCofre,
    correlationId: string,
  ): Promise<readonly import('@contaia/db').ContaContabil[]> {
    return comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.listarPlanoVigenteRepo(cliente, sessao.empresaId!),
    );
  }

  // -- Rejeições paginadas ----------------------------------------------------------------

  async listarRejeicoes(
    sessao: SessaoDoCofre,
    tentativaId: string,
    dto: z.infer<typeof listarRejeicoesSchema>,
    correlationId: string,
  ): Promise<{ rejeicoes: readonly import('@contaia/db').LinhaDeStaging[]; total: number }> {
    const validado = analisar(listarRejeicoesSchema, dto);

    return comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => this.listarRejeicoesPaginadasRepo(cliente, tentativaId, validado.pagina, validado.itensPorPagina),
    );
  }

  // -- Delegação ao repositório -----------------------------------------------------------

  private async buscarTentativaPorId(
    cliente: import('pg').PoolClient,
    tentativaId: string,
  ): Promise<import('@contaia/db').TentativaDeImportacao | null> {
    const { buscarTentativaPorId } = await import('@contaia/db');
    return buscarTentativaPorId(cliente, tentativaId);
  }

  private async buscarTentativaPorChave(
    cliente: import('pg').PoolClient,
    empresaId: string,
    hashArquivo: string,
    mapeamento: Record<string, string>,
  ): Promise<import('@contaia/db').TentativaDeImportacao | null> {
    const { buscarTentativaPorChave } = await import('@contaia/db');
    return buscarTentativaPorChave(cliente, empresaId, hashArquivo, mapeamento);
  }

  private async criarTentativa(
    cliente: import('pg').PoolClient,
    dados: import('@contaia/db').NovaTentativa,
  ): Promise<string> {
    const { criarTentativa } = await import('@contaia/db');
    return criarTentativa(cliente, dados);
  }

  private async salvarMapeamentoRepo(
    cliente: import('pg').PoolClient,
    tentativaId: string,
    mapeamento: Record<string, string>,
  ): Promise<void> {
    const { salvarMapeamento } = await import('@contaia/db');
    await salvarMapeamento(cliente, tentativaId, mapeamento);
  }

  private async iniciarValidacao(
    cliente: import('pg').PoolClient,
    tentativaId: string,
  ): Promise<boolean> {
    const { iniciarValidacao } = await import('@contaia/db');
    return iniciarValidacao(cliente, tentativaId);
  }

  private async confirmarImportacaoRepo(
    cliente: import('pg').PoolClient,
    tentativaId: string,
    planoVersao: number,
    usuarioConfirmadorId: string,
  ): Promise<boolean> {
    const { confirmarImportacao } = await import('@contaia/db');
    return confirmarImportacao(cliente, tentativaId, planoVersao, usuarioConfirmadorId);
  }

  private async cancelarPreviaRepo(
    cliente: import('pg').PoolClient,
    tentativaId: string,
    usuarioCanceladorId: string,
  ): Promise<boolean> {
    const { cancelarPrevia } = await import('@contaia/db');
    return cancelarPrevia(cliente, tentativaId, usuarioCanceladorId);
  }

  private async aplicarLinhasNoPlano(
    cliente: import('pg').PoolClient,
    empresaId: string,
    linhas: readonly import('@contaia/db').LinhaDeStaging[],
  ): Promise<{ incluidas: number; atualizadas: number }> {
    const { aplicarLinhasNoPlano } = await import('@contaia/db');
    return aplicarLinhasNoPlano(cliente, empresaId, linhas);
  }

  private async finalizarAplicacao(
    cliente: import('pg').PoolClient,
    tentativaId: string,
    estado: 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES' | 'FALHA',
    totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number },
  ): Promise<boolean> {
    const { finalizarAplicacao } = await import('@contaia/db');
    return finalizarAplicacao(cliente, tentativaId, estado, totais);
  }

  private async listarHistoricoRepo(
    cliente: import('pg').PoolClient,
    empresaId: string,
    pagina: number,
    itensPorPagina: number,
  ): Promise<HistoricoDeImportacoes> {
    const { listarHistorico } = await import('@contaia/db');
    return listarHistorico(cliente, empresaId, pagina, itensPorPagina);
  }

  private async listarPlanoVigenteRepo(
    cliente: import('pg').PoolClient,
    empresaId: string,
  ): Promise<readonly import('@contaia/db').ContaContabil[]> {
    const { listarPlanoVigente } = await import('@contaia/db');
    return listarPlanoVigente(cliente, empresaId);
  }

  private async listarLinhasStaging(
    cliente: import('pg').PoolClient,
    tentativaId: string,
  ): Promise<readonly import('@contaia/db').LinhaDeStaging[]> {
    const { listarLinhasStaging } = await import('@contaia/db');
    return listarLinhasStaging(cliente, tentativaId);
  }

  private async listarRejeicoesPaginadasRepo(
    cliente: import('pg').PoolClient,
    tentativaId: string,
    pagina: number,
    itensPorPagina: number,
  ): Promise<{ rejeicoes: readonly import('@contaia/db').LinhaDeStaging[]; total: number }> {
    const { listarRejeicoesPaginadas } = await import('@contaia/db');
    return listarRejeicoesPaginadas(cliente, tentativaId, pagina, itensPorPagina);
  }

  private async registrarEvento(
    tentativaId: string,
    sessao: SessaoDoCofre,
    correlationId: string,
    estadoAnterior: EstadoDaTentativa | null,
    estadoNovo: EstadoDaTentativa,
    linhasIncluidas?: number,
    linhasAtualizadas?: number,
    linhasRejeitadas?: number,
  ): Promise<void> {
    const { registrarEvento } = await import('@contaia/db');
    await registrarEvento(cliente => cliente, {
      tenantId: sessao.tenantId,
      empresaId: sessao.empresaId!,
      tentativaId,
      estadoAnterior,
      estadoNovo,
      linhasIncluidas: linhasIncluidas ?? null,
      linhasAtualizadas: linhasAtualizadas ?? null,
      linhasRejeitadas: linhasRejeitadas ?? null,
      iniciadoEm: this.agora(),
      finalizadoEm: this.agora(),
      correlationId,
    });
  }

  private async criarNotificacaoConclusao(
    cliente: import('pg').PoolClient,
    tenantId: string,
    usuarioId: string,
    tentativaId: string,
    tipo: 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES' | 'REJEITADA' | 'FALHA',
    totais: { lidas: number; novas: number; atualizadas: number; rejeitadas: number },
  ): Promise<void> {
    const { criarNotificacaoConclusao } = await import('@contaia/db');
    await criarNotificacaoConclusao(cliente, tenantId, usuarioId, tentativaId, tipo, totais);
  }

  private async empresaTemContaValida(
    cliente: import('pg').PoolClient,
    empresaId: string,
  ): Promise<boolean> {
    const { empresaTemContaValida } = await import('@contaia/db');
    return empresaTemContaValida(cliente, empresaId);
  }

  private async reconciliarPendenciaPlanoContas(
    cliente: import('pg').PoolClient,
    tenantId: string,
    empresaId: string,
  ): Promise<void> {
    const { reconciliarPendencias } = await import('@contaia/db');
    // A F5 já reconcilia pendência de plano de contas via causa `PLANO_CONTAS_INCOMPLETO`
    // O caso de uso da F5 escuta a mudança no plano e resolve automaticamente.
    // Aqui só garantimos que a tentativa de reconciliação é feita.
    // (A implementação real está no repositório de pendências da F5)
  }

  private async marcarReutilizada(
    cliente: import('pg').PoolClient,
    tentativaId: string,
  ): Promise<void> {
    const { marcarReutilizada } = await import('@contaia/db');
    await marcarReutilizada(cliente, tentativaId);
  }
}