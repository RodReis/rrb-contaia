/**
 * Casos de uso do cofre de certificados A1 (SPEC-011).
 *
 * A API principal só enxerga metadados. Arquivo, senha e chave existem no navegador → cofre
 * → Vault; aqui entram o ticket assinado, os metadados extraídos e a referência opaca do
 * segredo. O caso de uso controla a transação; o repositório persiste; a decisão é do domínio.
 *
 * Ingestão (cofre → API): o ticket é consumido PRIMEIRO, em transação própria (uma tentativa
 * gasta o ticket, mesmo falha); a ativação roda em outra, como o usuário do ticket e com a
 * permissão dele reavaliada agora — troca do vigente, evento, pendências e alertas confirmam
 * ou desfazem juntos. A recusa de negócio é registrada fora da transação que desfez.
 */
import { randomUUID } from 'node:crypto';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  avaliarMetadadosDoCertificado,
  dataCivilEmSaoPaulo,
  planejarDesativacao,
  podeMutarCofre,
  type ChaveDePermissao,
  type OperacaoDeIngestao,
} from '@contaia/domain';
import {
  ativarVersao,
  carregarItemDoCofre,
  carregarVigente,
  comContextoHumano,
  consumirTicketDeIngestao,
  desativarVigente,
  emitirTicketDeIngestao,
  identidadeDoUsuario,
  listarCofre,
  listarHistoricoDeCertificados,
  listarResponsaveisElegiveis,
  listarVersoesDoCertificado,
  reconciliarCofre,
  registrarEventoDeCertificado,
  situacoesDeResponsaveis,
  travarCofreDaEmpresa,
  trocarResponsavel,
  type ItemDoCofreBruto,
} from '@contaia/db';
import {
  MENSAGEM_DA_RECUSA,
  VALIDADE_DO_TICKET_SEGUNDOS,
  type CargaDoTicket,
  type DetalheDoCofre,
  type EventoDeCertificado,
  type PaginaDoCofre,
  type ResponsavelElegivel,
  type RespostaDaIngestao,
  type TicketDeIngestao,
} from '@contaia/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { permissoesEfetivas } from '../auth/permissoes-efetivas';
import { PoolDoBanco } from '../banco/pool.provider';
import type {
  FiltroDoCofreDto,
  FiltroDoHistoricoDeCertificadosDto,
  PedidoDeAtivacaoDto,
  PedidoDeRecusaDto,
} from './certificados.dto';
import { CofreClient, configuracaoDoCofre } from './cofre.client';
import { assinarTicket, lerTicketAssinado, verificarTicket } from './ticket';
import { paraItem, paraMetadados, type SessaoDoCofre } from './visoes';

const IDENTIDADE_DO_COFRE = 'cofre';

const semAutorizacao = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Sem autorização para este recurso.');

@Injectable()
export class CertificadosService {
  private readonly logger = new Logger(CertificadosService.name);

  constructor(
    private readonly pool: PoolDoBanco,
    private readonly cofre: CofreClient,
  ) {}

  /** Único ponto que lê o relógio (I-11): os testes o substituem. */
  protected agora(): Date {
    return new Date();
  }

  private hoje(): string {
    return dataCivilEmSaoPaulo(this.agora());
  }

  private comoUsuario<T>(
    quem: Readonly<{ tenantId: string; usuarioId: string }>,
    correlationId: string,
    executar: (cliente: PoolClient) => Promise<T>,
  ): Promise<T> {
    return comContextoHumano(
      this.pool.instancia,
      { tenantId: quem.tenantId, usuarioId: quem.usuarioId, correlationId },
      executar,
    );
  }

  // -- Consulta ---------------------------------------------------------------------------

  /** Lista do cofre da carteira de quem consulta; reconcilia pendências e alertas antes. */
  async consultar(
    sessao: SessaoDoCofre,
    filtro: FiltroDoCofreDto,
    correlationId: string,
  ): Promise<PaginaDoCofre> {
    return this.comoUsuario(sessao, correlationId, async (cliente) => {
      const hoje = this.hoje();

      await reconciliarCofre(cliente, {
        tenantId: sessao.tenantId,
        usuarioId: sessao.usuarioId,
        correlationId,
        hoje,
        empresaIds: null,
      });

      const pagina = await listarCofre(
        cliente,
        sessao.tenantId,
        {
          carteiraDoUsuarioId: sessao.usuarioId,
          busca: filtro.busca,
          estado: filtro.estado,
          ordem: filtro.ordem,
          limite: filtro.limite,
          deslocamento: (filtro.pagina - 1) * filtro.limite,
        },
        hoje,
      );
      const itens = await this.apresentar(cliente, sessao, pagina.itens);

      return {
        resumo: pagina.resumo,
        itens,
        total: pagina.total,
        pagina: filtro.pagina,
        limite: filtro.limite,
      };
    });
  }

  async consultarEmpresa(
    sessao: SessaoDoCofre,
    empresaId: string,
    correlationId: string,
  ): Promise<DetalheDoCofre> {
    return this.comoUsuario(sessao, correlationId, (cliente) =>
      this.detalhar(cliente, sessao, empresaId, correlationId, true),
    );
  }

  /** Reconcilia (a menos que `reconciliar` seja falso) e devolve o detalhe da empresa. */
  private async detalhar(
    cliente: PoolClient,
    sessao: SessaoDoCofre,
    empresaId: string,
    correlationId: string,
    reconciliar: boolean,
  ): Promise<DetalheDoCofre> {
    const hoje = this.hoje();

    if (reconciliar) {
      await reconciliarCofre(cliente, {
        tenantId: sessao.tenantId,
        usuarioId: sessao.usuarioId,
        correlationId,
        hoje,
        empresaIds: [empresaId],
      });
    }

    const item = await carregarItemDoCofre(cliente, sessao.tenantId, empresaId, hoje);

    if (item === null) {
      throw empresaNaoEncontrada();
    }

    const [apresentado] = await this.apresentar(cliente, sessao, [item]);
    const versoes = await listarVersoesDoCertificado(cliente, sessao.tenantId, empresaId);

    if (apresentado === undefined) {
      throw empresaNaoEncontrada();
    }

    return { item: apresentado, versoes: versoes.map(paraMetadados) };
  }

  /** Situação do responsável só importa (e só é buscada) onde a pendência de responsável está aberta. */
  private async apresentar(
    cliente: PoolClient,
    sessao: SessaoDoCofre,
    itens: readonly ItemDoCofreBruto[],
  ): Promise<DetalheDoCofre['item'][]> {
    const pares = itens.flatMap((item) =>
      item.semResponsavel && item.responsavel !== null
        ? [{ responsavelId: item.responsavel.id, empresaId: item.empresaId }]
        : [],
    );
    const situacoes = await situacoesDeResponsaveis(cliente, sessao.tenantId, pares);

    return itens.map((item) =>
      paraItem(
        item,
        sessao,
        item.responsavel === null
          ? null
          : (situacoes.get(`${item.responsavel.id}:${item.empresaId}`) ?? null),
      ),
    );
  }

  async listarResponsaveis(
    sessao: SessaoDoCofre,
    empresaId: string,
    correlationId: string,
  ): Promise<readonly ResponsavelElegivel[]> {
    return this.comoUsuario(sessao, correlationId, async (cliente) => {
      await this.carregarEmpresa(cliente, sessao.tenantId, empresaId);

      return listarResponsaveisElegiveis(cliente, sessao.tenantId, empresaId);
    });
  }

  async consultarHistorico(
    sessao: SessaoDoCofre,
    filtro: FiltroDoHistoricoDeCertificadosDto,
    correlationId: string,
  ): Promise<Readonly<{ eventos: readonly EventoDeCertificado[]; total: number }>> {
    return this.comoUsuario(sessao, correlationId, (cliente) =>
      listarHistoricoDeCertificados(cliente, sessao.tenantId, {
        carteiraDoUsuarioId: sessao.usuarioId,
        empresaId: filtro.empresaId,
        acao: filtro.acao,
        resultado: filtro.resultado,
        limite: filtro.limite,
        deslocamento: filtro.deslocamento,
      }),
    );
  }

  // -- Reconciliação por outras telas ---------------------------------------------------------

  /**
   * Sino e Central pedem o cofre em dia (pendências e alertas lazy). Falha aqui nunca derruba a
   * tela de quem pediu — mas também não some em silêncio: fica no log, sem dado sensível.
   */
  async reconciliarDaCarteira(
    quem: Readonly<{ tenantId: string; usuarioId: string }>,
    correlationId: string = randomUUID(),
  ): Promise<void> {
    try {
      await this.comoUsuario(quem, correlationId, (cliente) =>
        reconciliarCofre(cliente, {
          tenantId: quem.tenantId,
          usuarioId: quem.usuarioId,
          correlationId,
          hoje: this.hoje(),
          empresaIds: null,
        }),
      );
    } catch (erro) {
      this.logger.warn(
        `reconciliação do cofre falhou [${correlationId}]: ${erro instanceof Error ? erro.name : 'erro'}`,
      );
    }
  }

  // -- Mutações da sessão -----------------------------------------------------------------

  /**
   * Emite o ticket para o navegador enviar o PKCS#12 direto ao cofre. Cadastro (`criar`) se a
   * empresa não tem vigente; substituição (`substituir`) se tem — a chave certa depende do
   * estado, por isso é conferida aqui, além da `consultar` que o guard já exige.
   */
  async emitirTicket(
    sessao: SessaoDoCofre,
    empresaId: string,
    responsavelId: string,
    correlationId: string,
  ): Promise<TicketDeIngestao> {
    const { ticketSecret, publicUrl } = configuracaoDoCofre();

    if (ticketSecret.length === 0 || publicUrl.length === 0) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
        'O cofre está indisponível no momento. Nada foi alterado; tente novamente.',
      );
    }

    try {
      return await this.comoUsuario(sessao, correlationId, async (cliente) => {
        await travarCofreDaEmpresa(cliente, empresaId);

        const item = await this.empresaMutavel(cliente, sessao.tenantId, empresaId);
        const operacao: OperacaoDeIngestao =
          item.certificado?.estado === 'VIGENTE' ? 'SUBSTITUICAO' : 'CADASTRO';

        exigirPoderDeMutar(
          sessao,
          operacao === 'CADASTRO' ? 'certificados.cofre.criar' : 'certificados.cofre.substituir',
        );
        await this.exigirResponsavelElegivel(cliente, sessao.tenantId, empresaId, responsavelId);

        const emitido = await emitirTicketDeIngestao(cliente, {
          tenantId: sessao.tenantId,
          empresaId,
          usuarioId: sessao.usuarioId,
          operacao,
          responsavelId,
          correlationId,
          validadeEmSegundos: VALIDADE_DO_TICKET_SEGUNDOS,
        });
        const carga: CargaDoTicket = {
          jti: emitido.id,
          tenantId: sessao.tenantId,
          empresaId,
          usuarioId: sessao.usuarioId,
          cnpjDaEmpresa: item.cnpj,
          responsavelId,
          operacao,
          correlationId,
          exp: Math.floor(new Date(emitido.expiraEm).getTime() / 1000),
        };

        return {
          ticket: assinarTicket(carga, ticketSecret),
          cofreUrl: publicUrl,
          operacao,
          expiraEm: emitido.expiraEm,
        };
      });
    } catch (erro) {
      await this.registrarRecusaDaEmissao(sessao, empresaId, erro, correlationId);
      throw erro;
    }
  }

  async trocarResponsavel(
    sessao: SessaoDoCofre,
    empresaId: string,
    novoResponsavelId: string,
    correlationId: string,
  ): Promise<DetalheDoCofre> {
    exigirPoderDeMutar(sessao, 'certificados.cofre.editar');

    return this.comoUsuario(sessao, correlationId, async (cliente) => {
      await travarCofreDaEmpresa(cliente, empresaId);

      const item = await this.empresaMutavel(cliente, sessao.tenantId, empresaId);
      const elegiveis = await listarResponsaveisElegiveis(cliente, sessao.tenantId, empresaId);
      const novo = elegiveis.find((candidato) => candidato.id === novoResponsavelId);
      const troca = await trocarResponsavel(cliente, {
        tenantId: sessao.tenantId,
        empresaId,
        novoResponsavelId,
        novoElegivel: novo !== undefined,
      });

      if (troca.mudou) {
        await registrarEventoDeCertificado(cliente, {
          tenantId: sessao.tenantId,
          empresaId,
          certificadoId: troca.versao.id,
          acao: 'RESPONSAVEL_ALTERADO',
          motivo: `${item.responsavel?.nome ?? 'Sem responsável'} → ${novo?.nome ?? ''}`,
          usuarioId: sessao.usuarioId,
          correlationId,
        });
      }

      return this.detalhar(cliente, sessao, empresaId, correlationId, true);
    });
  }

  /**
   * Desativação em duas fases (SPEC-011 §3.4 e §7): 1) o cofre inutiliza o segredo — se falhar,
   * nada mudou; 2) uma transação desativa, registra e reabre a pendência. Falha na 2 devolve o
   * segredo (compensação) e o certificado continua vigente.
   */
  async desativar(
    sessao: SessaoDoCofre,
    empresaId: string,
    motivo: string,
    correlationId: string,
  ): Promise<DetalheDoCofre> {
    exigirPoderDeMutar(sessao, 'certificados.cofre.desativar');

    const vigente = await this.comoUsuario(sessao, correlationId, async (cliente) => {
      await this.empresaMutavel(cliente, sessao.tenantId, empresaId);

      const atual = await carregarVigente(cliente, sessao.tenantId, empresaId);

      // Motivo e vigente são validados antes de tocar no cofre.
      planejarDesativacao(
        atual === null ? null : { id: atual.id, versao: atual.versao, responsavelId: atual.responsavelId },
        motivo,
      );

      return atual;
    });

    if (vigente === null) {
      throw semVigente();
    }

    const escopo = { tenantId: sessao.tenantId, empresaId };

    await this.cofre.inutilizar(vigente.referenciaSegredo, escopo, correlationId);

    try {
      return await this.comoUsuario(sessao, correlationId, async (cliente) => {
        await travarCofreDaEmpresa(cliente, empresaId);

        // Outra operação pode ter trocado o vigente entre as fases: nunca desativar outro.
        const atual = await carregarVigente(cliente, sessao.tenantId, empresaId);

        if (atual?.id !== vigente.id) {
          throw new ErroDeDominio(
            CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
            'O certificado da empresa foi alterado por outra operação. Recarregue e tente de novo.',
          );
        }

        const desativada = await desativarVigente(cliente, {
          tenantId: sessao.tenantId,
          empresaId,
          motivo,
          autorId: sessao.usuarioId,
        });

        await registrarEventoDeCertificado(cliente, {
          tenantId: sessao.tenantId,
          empresaId,
          certificadoId: desativada.id,
          acao: 'DESATIVACAO',
          motivo: desativada.justificativa,
          usuarioId: sessao.usuarioId,
          correlationId,
        });

        return this.detalhar(cliente, sessao, empresaId, correlationId, true);
      });
    } catch (erro) {
      await this.compensarInutilizacao(vigente.referenciaSegredo, escopo, correlationId);
      throw erro;
    }
  }

  // -- Ingestão (cofre → API) ----------------------------------------------------------------

  /**
   * Ativa o certificado que o cofre acabou de gravar no Vault. Qualquer erro devolvido aqui faz
   * o cofre compensar (destruir a referência) — o vigente anterior segue intacto porque a troca
   * só existe dentro da transação abaixo.
   */
  async ativar(
    pedido: PedidoDeAtivacaoDto,
    correlationId: string,
  ): Promise<RespostaDaIngestao> {
    const carga = verificarTicket(pedido.ticket, configuracaoDoCofre().ticketSecret, this.agora());
    const quem = { tenantId: carga.tenantId, usuarioId: carga.usuarioId };

    await this.consumirTicket(carga, 'CONSUMIDO', correlationId);

    try {
      return await this.comoUsuario(quem, correlationId, async (cliente) => {
        await travarCofreDaEmpresa(cliente, carga.empresaId);

        const item = await this.empresaMutavel(cliente, carga.tenantId, carga.empresaId);

        // O ticket foi emitido para esta empresa e este CNPJ; mudança no meio é ticket inválido.
        if (item.cnpj !== carga.cnpjDaEmpresa) {
          throw ticketInvalido();
        }

        await this.exigirPermissaoDoTicket(cliente, carga);
        await this.exigirResponsavelElegivel(cliente, carga.tenantId, carga.empresaId, carga.responsavelId);

        const avaliacao = avaliarMetadadosDoCertificado(
          {
            cnpjTitular: pedido.metadados.cnpjTitular,
            naoAntes: new Date(pedido.metadados.naoAntes),
            naoDepois: new Date(pedido.metadados.naoDepois),
          },
          { cnpjDaEmpresa: item.cnpj, agora: this.agora() },
        );

        if (!avaliacao.ok) {
          throw new ErroDeDominio(CODIGOS_DE_ERRO[avaliacao.codigo], MENSAGEM_DA_RECUSA[avaliacao.codigo]);
        }

        const { nova, acao } = await ativarVersao(cliente, {
          tenantId: carga.tenantId,
          empresaId: carga.empresaId,
          operacao: carga.operacao,
          dados: {
            titular: pedido.metadados.titular,
            cnpjTitular: pedido.metadados.cnpjTitular,
            autoridadeCertificadora: pedido.metadados.autoridadeCertificadora,
            cadeia: pedido.metadados.cadeia,
            numeroSerie: pedido.metadados.numeroSerie,
            impressaoDigital: pedido.metadados.impressaoDigital,
            validoDe: avaliacao.validoDe,
            validoAte: avaliacao.validoAte,
            referenciaSegredo: pedido.referenciaDoSegredo,
          },
          responsavelId: carga.responsavelId,
          autorId: carga.usuarioId,
        });

        await registrarEventoDeCertificado(cliente, {
          tenantId: carga.tenantId,
          empresaId: carga.empresaId,
          certificadoId: nova.id,
          acao,
          usuarioId: carga.usuarioId,
          identidadeTecnica: IDENTIDADE_DO_COFRE,
          correlationId,
        });
        await reconciliarCofre(cliente, {
          tenantId: carga.tenantId,
          usuarioId: carga.usuarioId,
          correlationId,
          hoje: this.hoje(),
          empresaIds: [carga.empresaId],
        });

        return { certificado: paraMetadados(nova) };
      });
    } catch (erro) {
      if (erro instanceof ErroDeDominio) {
        await this.registrarRecusa(carga, erro.codigo, correlationId);
      }

      throw erro;
    }
  }

  /** O cofre recusou o arquivo antes de gravar: consome o ticket e registra a tentativa recusada. */
  async recusar(pedido: PedidoDeRecusaDto, correlationId: string): Promise<void> {
    // Ticket vencido ainda registra a recusa (a tentativa existiu), mas assinatura é obrigatória.
    const carga = lerTicketAssinado(pedido.ticket, configuracaoDoCofre().ticketSecret);

    await this.consumirTicket(carga, 'RECUSADO', correlationId);
    await this.registrarRecusa(carga, pedido.codigo, correlationId);
  }

  // -- Peças -----------------------------------------------------------------------------

  private async consumirTicket(
    carga: CargaDoTicket,
    destino: 'CONSUMIDO' | 'RECUSADO',
    correlationId: string,
  ): Promise<void> {
    const consumido = await this.comoUsuario(
      { tenantId: carga.tenantId, usuarioId: carga.usuarioId },
      correlationId,
      (cliente) =>
        consumirTicketDeIngestao(
          cliente,
          {
            id: carga.jti,
            tenantId: carga.tenantId,
            empresaId: carga.empresaId,
            usuarioId: carga.usuarioId,
            operacao: carga.operacao,
            responsavelId: carga.responsavelId,
          },
          destino,
        ),
    );

    if (!consumido) {
      throw ticketInvalido();
    }
  }

  /**
   * Quem age é o usuário do ticket, não o cofre: ele precisa continuar ativo, com a chave da
   * operação na permissão EFETIVA de agora e papel padrão que muta o cofre (SPEC-011 §3.2).
   */
  private async exigirPermissaoDoTicket(cliente: PoolClient, carga: CargaDoTicket): Promise<void> {
    const identidade = await identidadeDoUsuario(cliente, carga.tenantId, carga.usuarioId);

    if (identidade === null) {
      throw semAutorizacao();
    }

    exigirPoderDeMutar(
      { papeis: identidade.papeis, permissoes: permissoesEfetivas(identidade) },
      carga.operacao === 'CADASTRO' ? 'certificados.cofre.criar' : 'certificados.cofre.substituir',
    );
  }

  private async carregarEmpresa(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
  ): Promise<ItemDoCofreBruto> {
    const item = await carregarItemDoCofre(cliente, tenantId, empresaId, this.hoje());

    if (item === null) {
      throw empresaNaoEncontrada();
    }

    return item;
  }

  /** Empresa que aceita mutação: ativa e não arquivada (arquivada é só consulta). */
  private async empresaMutavel(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
  ): Promise<ItemDoCofreBruto> {
    const item = await this.carregarEmpresa(cliente, tenantId, empresaId);

    if (item.empresaArquivada) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
        'Empresa arquivada fica somente para consulta; reative-a antes de editar.',
      );
    }

    if (!item.empresaAtiva) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_NAO_ATIVA,
        'Conclua o cadastro da empresa para guardar o certificado.',
      );
    }

    return item;
  }

  private async exigirResponsavelElegivel(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
    responsavelId: string,
  ): Promise<void> {
    const elegiveis = await listarResponsaveisElegiveis(cliente, tenantId, empresaId);

    if (!elegiveis.some((candidato) => candidato.id === responsavelId)) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
        MENSAGEM_DA_RECUSA.CERTIFICADO_RESPONSAVEL_INVALIDO,
        [{ campo: 'responsavelId', codigo: CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO }],
      );
    }
  }

  /** Recusa de ingestão no histórico, em transação própria: a da ativação já foi desfeita. */
  private async registrarRecusa(
    carga: CargaDoTicket,
    codigo: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.comoUsuario(
        { tenantId: carga.tenantId, usuarioId: carga.usuarioId },
        correlationId,
        (cliente) =>
          registrarEventoDeCertificado(cliente, {
            tenantId: carga.tenantId,
            empresaId: carga.empresaId,
            certificadoId: null,
            acao: 'RECUSA',
            codigo,
            usuarioId: carga.usuarioId,
            identidadeTecnica: IDENTIDADE_DO_COFRE,
            correlationId,
          }),
      );
    } catch (erro) {
      this.logger.warn(
        `recusa não registrada [${correlationId}]: ${erro instanceof Error ? erro.name : 'erro'}`,
      );
    }
  }

  /** Só o responsável inválido é recusa de negócio na emissão; o resto é permissão ou estado. */
  private async registrarRecusaDaEmissao(
    sessao: SessaoDoCofre,
    empresaId: string,
    erro: unknown,
    correlationId: string,
  ): Promise<void> {
    if (!(erro instanceof ErroDeDominio) || erro.codigo !== CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO) {
      return;
    }

    try {
      await this.comoUsuario(sessao, correlationId, (cliente) =>
        registrarEventoDeCertificado(cliente, {
          tenantId: sessao.tenantId,
          empresaId,
          certificadoId: null,
          acao: 'RECUSA',
          codigo: erro.codigo,
          usuarioId: sessao.usuarioId,
          correlationId,
        }),
      );
    } catch (falha) {
      this.logger.warn(
        `recusa não registrada [${correlationId}]: ${falha instanceof Error ? falha.name : 'erro'}`,
      );
    }
  }

  private async compensarInutilizacao(
    referencia: string,
    escopo: Readonly<{ tenantId: string; empresaId: string }>,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.cofre.restaurar(referencia, escopo, correlationId);
    } catch (erro) {
      // O cofre fora do ar impede restaurar: fica para o operador, com o correlationId no log.
      this.logger.error(
        `compensação do cofre falhou [${correlationId}]: ${erro instanceof Error ? erro.name : 'erro'}`,
      );
    }
  }
}

const empresaNaoEncontrada = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');

const ticketInvalido = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO,
    'A autorização para enviar o certificado expirou ou já foi usada. Tente enviar novamente.',
  );

const semVigente = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    'A empresa não tem certificado vigente.',
  );

/** Chave do catálogo E papel padrão que muta o cofre (SPEC-011 §3.2): as duas, sempre. */
const exigirPoderDeMutar = (
  quem: Pick<SessaoDoCofre, 'papeis' | 'permissoes'>,
  chave: ChaveDePermissao,
): void => {
  if (!podeMutarCofre(quem.papeis) || !quem.permissoes.includes(chave)) {
    throw semAutorizacao();
  }
};
