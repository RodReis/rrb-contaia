/**
 * Casos de uso de usuários e convite (SPEC-007).
 *
 * Toda mutação roda numa transação que escreve o dado e o evento de auditoria
 * juntos: se a auditoria falha, a mutação desfaz. As chamadas ao Keycloak
 * acontecem dentro dessa transação, antes do commit — se o Keycloak falha, nada
 * é gravado; se o commit falha depois de o Keycloak já ter mudado, cada efeito
 * tem uma compensação registrada que o desfaz. Nunca fica estado parcial.
 *
 * O e-mail do convite sai só depois do commit: uma falha de envio preserva o
 * cadastro e marca o convite para reenvio (§3.2).
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  comContextoHumano,
  atualizarDadosDoUsuario,
  atualizarEstadoDoUsuario,
  carregarPapeisParaAtribuir,
  carregarUsuario,
  conviteVigenteDoUsuario,
  criarConvite,
  criarUsuario,
  encerrarVinculosDoUsuario,
  invalidarConvitesVigentes,
  listarEventosDeUsuario,
  listarUsuarios,
  marcarEnvioFalhou,
  reconciliarConvitesExpirados,
  registrarEventoDeUsuario,
  substituirPapeis,
  substituirPapeisPersonalizados,
  travarAdminsAtivos,
  usuarioComEmailNoTenant,
} from '@contaia/db';
import type {
  ConviteVigente,
  EventoDeUsuarioNaLista,
  FiltroDeEventosDeUsuario,
  FiltroDeUsuarios,
  TipoDeEventoDeUsuario,
  UsuarioNaLista,
  UsuarioPersistido,
} from '@contaia/db';
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  expiraEm as expiracaoDoConvite,
  podePerderAdministracao,
  situacaoApresentada,
  transicionar,
  validarDadosDoUsuario,
  validarPapeisDoUsuario,
} from '@contaia/domain';
import type {
  PapeisDoUsuario,
  PapelPadrao,
  SituacaoApresentada,
  Transicao,
} from '@contaia/domain';

import { PoolDoBanco } from '../banco/pool.provider';
import { registrarEncerramento } from '../carteira/registro';
import { ConviteMailer } from './convite.mailer';
import { KeycloakAdminClient } from './keycloak-admin.client';
import { gerarTokenDeConvite, hashDoToken } from './token-de-convite';

export type Autor = Readonly<{ usuarioId: string }>;

export type DadosDoConvite = Readonly<{
  nome: string;
  email: string;
  telefone: string | null;
  crc: string | null;
  papeis: readonly string[];
  papeisPersonalizados?: readonly string[] | undefined;
}>;

export type DadosDeEdicao = Readonly<{
  nome: string;
  telefone: string | null;
  crc: string | null;
  papeis: readonly string[];
  papeisPersonalizados?: readonly string[] | undefined;
  /** Só aceito enquanto o usuário está CONVIDADO. */
  email?: string | undefined;
}>;

export type DadosDeNovoConvite = Omit<DadosDeEdicao, 'email'>;

/** Resposta administrativa: sem token, link, hash nem identificador da identidade. */
export type VisaoDeUsuario = Readonly<{
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  crc: string | null;
  papeis: readonly PapelPadrao[];
  papeisPersonalizados: UsuarioPersistido['papeisPersonalizados'];
  estado: UsuarioPersistido['estado'];
  situacao: SituacaoApresentada;
  conviteExpiraEm: string | null;
  envioFalhou: boolean;
  versao: number;
}>;

export type PaginaDeUsuariosVisao = Readonly<{
  usuarios: readonly VisaoDeUsuario[];
  total: number;
}>;

export type EventoDeUsuarioVisao = Readonly<
  Omit<EventoDeUsuarioNaLista, 'ocorridoEm'> & { ocorridoEm: string }
>;

export type PaginaDeEventosVisao = Readonly<{
  eventos: readonly EventoDeUsuarioVisao[];
  total: number;
}>;

/** Eventos cujo único conteúdo é técnico (prazo e identificador do convite): o tipo basta. */
const TIPOS_SEM_VALORES: ReadonlySet<TipoDeEventoDeUsuario> = new Set([
  'CONVITE_REENVIADO',
  'CONVITE_EXPIRADO',
]);

const paraEventoVisivel = (evento: EventoDeUsuarioNaLista): EventoDeUsuarioVisao => ({
  ...evento,
  ocorridoEm: evento.ocorridoEm.toISOString(),
  ...(TIPOS_SEM_VALORES.has(evento.tipo) ? { antes: null, depois: null } : {}),
});

type Compensacao = () => Promise<void>;
/** A descrição entra no log se a compensação falhar: diz o que conferir no Keycloak. */
type RegistrarCompensacao = (compensacao: Compensacao, descricao: string) => void;
type CompensacaoRegistrada = Readonly<{ executar: Compensacao; descricao: string }>;
/** Gestão de usuários e carteiras: o autor da sessão age na finalidade administrativa. */
const comoAdmin = (tenantId: string, autor: Autor) =>
  ({ tenantId, usuarioId: autor.usuarioId, finalidade: 'ADMIN_ACESSO' }) as const;

type Cliente = Parameters<Parameters<typeof comContextoHumano>[2]>[0];

type ConviteEmitido = Readonly<{ conviteId: string; token: string; expiraEm: Date }>;
type DestinoDoConvite = Readonly<{ email: string; nome: string }>;

const ADMIN: PapelPadrao = 'admin_escritorio';

const urlPublicaDaWeb = (): string => process.env['WEB_PUBLIC_URL'] ?? 'http://127.0.0.1:15100';

const paraVisao = (
  usuario: UsuarioPersistido,
  convite: Pick<ConviteVigente, 'expiraEm' | 'envioFalhou'> | null,
  agora: Date,
): VisaoDeUsuario => ({
  id: usuario.id,
  nome: usuario.nome,
  email: usuario.email,
  telefone: usuario.telefone,
  crc: usuario.crc,
  papeis: usuario.papeis,
  papeisPersonalizados: usuario.papeisPersonalizados,
  estado: usuario.estado,
  situacao: situacaoApresentada(
    { estado: usuario.estado, conviteExpiraEm: convite?.expiraEm ?? null },
    agora,
  ),
  conviteExpiraEm: convite?.expiraEm.toISOString() ?? null,
  envioFalhou: convite?.envioFalhou ?? false,
  versao: usuario.versao,
});

const paraVisaoDaLista = (usuario: UsuarioNaLista, agora: Date): VisaoDeUsuario =>
  paraVisao(
    usuario,
    usuario.conviteExpiraEm === null
      ? null
      : { expiraEm: usuario.conviteExpiraEm, envioFalhou: usuario.envioFalhou },
    agora,
  );

const nomesDosPapeis = (
  papeis: UsuarioPersistido['papeisPersonalizados'],
): ReadonlyArray<Readonly<{ id: string; nome: string }>> =>
  papeis.map(({ id, nome }) => ({ id, nome }));

const mesmoConjunto = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly pool: PoolDoBanco,
    private readonly identidade: KeycloakAdminClient,
    private readonly mailer: ConviteMailer,
  ) {}

  // -- Consulta ---------------------------------------------------------------

  async listar(
    tenantId: string,
    autor: Autor,
    filtro: FiltroDeUsuarios,
  ): Promise<PaginaDeUsuariosVisao> {
    const agora = new Date();

    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      // Expiração é preguiçosa (sem worker): o evento nasce na primeira observação.
      await reconciliarConvitesExpirados(cliente, tenantId, agora);

      const pagina = await listarUsuarios(cliente, tenantId, filtro);

      return {
        total: pagina.total,
        usuarios: pagina.usuarios.map((usuario) => paraVisaoDaLista(usuario, agora)),
      };
    });
  }

  /** Aba "Usuários e acessos" do Histórico: somente leitura, só do escritório da sessão. */
  async consultarHistorico(
    tenantId: string,
    autor: Autor,
    filtro: FiltroDeEventosDeUsuario,
  ): Promise<PaginaDeEventosVisao> {
    const agora = new Date();

    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      await reconciliarConvitesExpirados(cliente, tenantId, agora);

      const pagina = await listarEventosDeUsuario(cliente, tenantId, filtro);

      return { total: pagina.total, eventos: pagina.eventos.map(paraEventoVisivel) };
    });
  }

  async obter(tenantId: string, autor: Autor, usuarioId: string): Promise<VisaoDeUsuario> {
    const agora = new Date();

    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      const usuario = await this.carregarOuFalhar(cliente, tenantId, usuarioId);
      const convite = await conviteVigenteDoUsuario(cliente, tenantId, usuarioId);

      return paraVisao(usuario, convite, agora);
    });
  }

  // -- Convite ----------------------------------------------------------------

  async convidar(tenantId: string, autor: Autor, entrada: DadosDoConvite): Promise<VisaoDeUsuario> {
    const dados = validarDadosDoUsuario(entrada);
    const papeis = validarPapeisDoUsuario(entrada.papeis, entrada.papeisPersonalizados ?? []);
    const agora = new Date();

    const emitido = await this.comTransacao(tenantId, autor, async (cliente, compensar) => {
      const existente = await usuarioComEmailNoTenant(cliente, tenantId, dados.email);

      if (existente !== null) {
        throw existente.estado === 'ARQUIVADO'
          ? new ErroDeConflito(
              CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE,
              'Este usuário está arquivado. Inicie um novo convite para ele.',
            )
          : new ErroDeConflito(CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO, 'Este e-mail já está em uso.');
      }

      const sub = await this.identidade.criar({ email: dados.email, nome: dados.nome });

      compensar(() => this.identidade.remover(sub), `remover a identidade criada (sub ${sub})`);

      const usuarioId = await criarUsuario(cliente, tenantId, { subOidc: sub, ...dados });

      const personalizados = await this.atribuirPapeis(cliente, tenantId, usuarioId, papeis);

      const convite = await this.emitirConvite(cliente, tenantId, usuarioId, agora);

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'CONVITE_CRIADO',
        usuarioAfetadoId: usuarioId,
        autorId: autor.usuarioId,
        antes: null,
        depois: {
          estado: 'CONVIDADO',
          nome: dados.nome,
          email: dados.email,
          papeis: papeis.padrao,
          ...(personalizados.length > 0 ? { papeisPersonalizados: personalizados } : {}),
        },
      });

      return { usuarioId, convite };
    });

    await this.enviarConvite(tenantId, autor, emitido.convite, dados);

    return this.obter(tenantId, autor, emitido.usuarioId);
  }

  async reenviarConvite(tenantId: string, autor: Autor, usuarioId: string): Promise<VisaoDeUsuario> {
    const agora = new Date();

    const { convite, destino } = await this.comTransacao(tenantId, autor, async (cliente) => {
      const usuario = await this.carregarOuFalhar(cliente, tenantId, usuarioId, true);

      transicionar(usuario.estado, 'REENVIAR');

      const emitido = await this.emitirConvite(cliente, tenantId, usuarioId, agora);

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'CONVITE_REENVIADO',
        usuarioAfetadoId: usuarioId,
        autorId: autor.usuarioId,
        antes: null,
        depois: { expiraEm: emitido.expiraEm.toISOString() },
      });

      return { convite: emitido, destino: { email: usuario.email, nome: usuario.nome } };
    });

    await this.enviarConvite(tenantId, autor, convite, destino);

    return this.obter(tenantId, autor, usuarioId);
  }

  async novoConvite(
    tenantId: string,
    autor: Autor,
    usuarioId: string,
    entrada: DadosDeNovoConvite,
  ): Promise<VisaoDeUsuario> {
    const papeis = validarPapeisDoUsuario(entrada.papeis, entrada.papeisPersonalizados ?? []);
    const agora = new Date();

    const { convite, destino } = await this.comTransacao(tenantId, autor, async (cliente) => {
      const usuario = await this.carregarOuFalhar(cliente, tenantId, usuarioId, true);
      const novoEstado = transicionar(usuario.estado, 'NOVO_CONVITE');
      const dados = validarDadosDoUsuario({ ...entrada, email: usuario.email });

      await atualizarDadosDoUsuario(cliente, tenantId, usuarioId, dados);
      const personalizados = await this.atribuirPapeis(cliente, tenantId, usuarioId, papeis);
      await atualizarEstadoDoUsuario(cliente, tenantId, usuarioId, novoEstado);

      const emitido = await this.emitirConvite(cliente, tenantId, usuarioId, agora);

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'NOVO_CONVITE_INICIADO',
        usuarioAfetadoId: usuarioId,
        autorId: autor.usuarioId,
        antes: {
          estado: usuario.estado,
          papeis: usuario.papeis,
          ...(usuario.papeisPersonalizados.length > 0
            ? { papeisPersonalizados: nomesDosPapeis(usuario.papeisPersonalizados) }
            : {}),
        },
        depois: {
          estado: novoEstado,
          papeis: papeis.padrao,
          ...(personalizados.length > 0 ? { papeisPersonalizados: personalizados } : {}),
        },
      });

      return { convite: emitido, destino: { email: usuario.email, nome: dados.nome } };
    });

    await this.enviarConvite(tenantId, autor, convite, destino);

    return this.obter(tenantId, autor, usuarioId);
  }

  // -- Edição -----------------------------------------------------------------

  async editar(
    tenantId: string,
    autor: Autor,
    usuarioId: string,
    entrada: DadosDeEdicao,
  ): Promise<VisaoDeUsuario> {
    const papeis = validarPapeisDoUsuario(entrada.papeis, entrada.papeisPersonalizados ?? []);
    const agora = new Date();

    const reemissao = await this.comTransacao(tenantId, autor, async (cliente, compensar) => {
      const usuario = await this.carregarOuFalhar(cliente, tenantId, usuarioId, true);

      if (usuario.estado === 'ARQUIVADO') {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE,
          'Este usuário está arquivado. Inicie um novo convite para ele.',
        );
      }

      const dados = validarDadosDoUsuario({ ...entrada, email: entrada.email ?? usuario.email });
      const emailMudou = dados.email !== usuario.email.toLowerCase();

      if (emailMudou && usuario.estado !== 'CONVIDADO') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.EMAIL_IMUTAVEL,
          'O e-mail só pode ser corrigido antes de o convite ser aceito.',
        );
      }

      const perdeAdministracao =
        usuario.estado === 'ATIVO' &&
        usuario.papeis.includes(ADMIN) &&
        !papeis.padrao.includes(ADMIN);

      if (perdeAdministracao) {
        await this.exigirOutroAdministrador(cliente, tenantId, usuarioId);
      }

      const mudou = {
        nome: dados.nome !== usuario.nome,
        telefone: dados.telefone !== usuario.telefone,
        crc: dados.crc !== usuario.crc,
        papeis: !mesmoConjunto(papeis.padrao, usuario.papeis),
        papeisPersonalizados: !mesmoConjunto(
          papeis.personalizados,
          usuario.papeisPersonalizados.map((papel) => papel.id),
        ),
      };

      if (!emailMudou && !Object.values(mudou).some(Boolean)) {
        return null;
      }

      await atualizarDadosDoUsuario(cliente, tenantId, usuarioId, {
        ...dados,
        ...(emailMudou ? { email: dados.email } : {}),
      });
      const personalizados = await this.atribuirPapeis(cliente, tenantId, usuarioId, papeis);

      if (Object.values(mudou).some(Boolean)) {
        await registrarEventoDeUsuario(cliente, tenantId, {
          tipo: 'DADOS_E_PAPEIS_ALTERADOS',
          usuarioAfetadoId: usuarioId,
          autorId: autor.usuarioId,
          antes: this.camposAlterados(
            mudou,
            usuario,
            usuario.papeis,
            nomesDosPapeis(usuario.papeisPersonalizados),
          ),
          depois: this.camposAlterados(mudou, dados, papeis.padrao, personalizados),
        });
      }

      if (!emailMudou) {
        return null;
      }

      // A compensação vem antes da chamada: se o tempo esgotar depois de o Keycloak ter aplicado
      // a troca, o erro sobe sem ela e a identidade ficaria com o e-mail novo. É idempotente.
      compensar(
        () => this.identidade.atualizarEmail(usuario.subOidc, usuario.email),
        `devolver o e-mail anterior (usuário ${usuarioId}, sub ${usuario.subOidc})`,
      );
      await this.identidade.atualizarEmail(usuario.subOidc, dados.email);

      const convite = await this.emitirConvite(cliente, tenantId, usuarioId, agora);

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'EMAIL_DE_CONVITE_CORRIGIDO',
        usuarioAfetadoId: usuarioId,
        autorId: autor.usuarioId,
        antes: { email: usuario.email },
        depois: { email: dados.email },
      });

      return { convite, destino: { email: dados.email, nome: dados.nome } };
    });

    if (reemissao !== null) {
      await this.enviarConvite(tenantId, autor, reemissao.convite, reemissao.destino);
    }

    return this.obter(tenantId, autor, usuarioId);
  }

  // -- Ciclo de vida ----------------------------------------------------------

  suspender(tenantId: string, autor: Autor, usuarioId: string): Promise<VisaoDeUsuario> {
    return this.mudarEstado(tenantId, autor, usuarioId, 'SUSPENDER', 'SUSPENSO', (sub, compensar) =>
      this.desabilitarEEncerrarSessoes(sub, compensar),
    );
  }

  arquivar(tenantId: string, autor: Autor, usuarioId: string): Promise<VisaoDeUsuario> {
    return this.mudarEstado(tenantId, autor, usuarioId, 'ARQUIVAR', 'ARQUIVADO', (sub, compensar) =>
      this.desabilitarEEncerrarSessoes(sub, compensar),
    );
  }

  reativar(tenantId: string, autor: Autor, usuarioId: string): Promise<VisaoDeUsuario> {
    return this.mudarEstado(tenantId, autor, usuarioId, 'REATIVAR', 'REATIVADO', async (sub, compensar) => {
      compensar(() => this.identidade.habilitar(sub, false), `desabilitar de novo (sub ${sub})`);
      await this.identidade.habilitar(sub, true);
    });
  }

  // -- Internos ---------------------------------------------------------------

  /** Desabilita a conta e revoga as sessões; reabilita se algo falhar depois. */
  private async desabilitarEEncerrarSessoes(
    sub: string,
    compensar: RegistrarCompensacao,
  ): Promise<void> {
    compensar(() => this.identidade.habilitar(sub, true), `reabilitar (sub ${sub})`);
    await this.identidade.habilitar(sub, false);
    await this.identidade.encerrarSessoes(sub);
  }

  private async mudarEstado(
    tenantId: string,
    autor: Autor,
    usuarioId: string,
    transicao: Transicao,
    tipo: TipoDeEventoDeUsuario,
    aplicarNaIdentidade: (sub: string, compensar: RegistrarCompensacao) => Promise<void>,
  ): Promise<VisaoDeUsuario> {
    await this.comTransacao(tenantId, autor, async (cliente, compensar) => {
      const usuario = await this.carregarOuFalhar(cliente, tenantId, usuarioId, true);
      const novoEstado = transicionar(usuario.estado, transicao);
      const deixaDeSerAdministrador =
        usuario.estado === 'ATIVO' && usuario.papeis.includes(ADMIN) && novoEstado !== 'ATIVO';

      // Antes de qualquer chamada ao Keycloak: o bloqueio não pode deixar efeito para trás.
      if (deixaDeSerAdministrador) {
        await this.exigirOutroAdministrador(cliente, tenantId, usuarioId);
      }

      await aplicarNaIdentidade(usuario.subOidc, compensar);
      await atualizarEstadoDoUsuario(cliente, tenantId, usuarioId, novoEstado);
      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo,
        usuarioAfetadoId: usuarioId,
        autorId: autor.usuarioId,
        antes: { estado: usuario.estado },
        depois: { estado: novoEstado },
      });

      // Arquivar encerra os vínculos de carteira e o histórico fica; suspender os preserva
      // (voltam a valer na reativação) e o retorno do arquivado exige nova atribuição.
      // Sem notificação: o colaborador arquivado já não acessa o sino (SPEC-009 §3.3).
      if (transicao === 'ARQUIVAR') {
        const afetados = await encerrarVinculosDoUsuario(
          cliente,
          tenantId,
          usuarioId,
          autor.usuarioId,
        );
        await registrarEncerramento(
          cliente,
          tenantId,
          autor.usuarioId,
          'ARQUIVAMENTO_USUARIO',
          afetados,
          false,
        );
      }
    });

    return this.obter(tenantId, autor, usuarioId);
  }

  /** Serializa alterações de administração: a segunda enxerga o conjunto já reduzido pela primeira. */
  private async exigirOutroAdministrador(
    cliente: Cliente,
    tenantId: string,
    usuarioId: string,
  ): Promise<void> {
    const administradores = await travarAdminsAtivos(cliente, tenantId);
    const restantes = administradores.filter((id) => id !== usuarioId).length;

    if (!podePerderAdministracao(restantes)) {
      throw new ErroDeConflito(
        CODIGOS_DE_ERRO.ULTIMO_ADMIN,
        'O escritório precisa manter ao menos um administrador ativo.',
      );
    }
  }

  private camposAlterados(
    mudou: Readonly<
      Record<'nome' | 'telefone' | 'crc' | 'papeis' | 'papeisPersonalizados', boolean>
    >,
    fonte: Readonly<{ nome: string; telefone: string | null; crc: string | null }>,
    papeis: readonly string[],
    papeisPersonalizados: ReadonlyArray<Readonly<{ id: string; nome: string }>>,
  ): Readonly<Record<string, unknown>> {
    return {
      ...(mudou.nome ? { nome: fonte.nome } : {}),
      ...(mudou.telefone ? { telefone: fonte.telefone } : {}),
      ...(mudou.crc ? { crc: fonte.crc } : {}),
      ...(mudou.papeis ? { papeis } : {}),
      ...(mudou.papeisPersonalizados ? { papeisPersonalizados } : {}),
    };
  }

  /**
   * Troca os papéis do usuário, padrão e personalizados. O papel personalizado
   * precisa existir no escritório e estar `ATIVO`; a leitura o trava em modo
   * compartilhado, então um arquivamento simultâneo espera esta transação (e
   * vice-versa) em vez de decidir sobre estado antigo. Devolve id e nome dos
   * personalizados atribuídos, para a auditoria.
   */
  private async atribuirPapeis(
    cliente: Cliente,
    tenantId: string,
    usuarioId: string,
    papeis: PapeisDoUsuario,
  ): Promise<ReadonlyArray<Readonly<{ id: string; nome: string }>>> {
    await substituirPapeis(cliente, tenantId, usuarioId, papeis.padrao);

    const encontrados =
      papeis.personalizados.length === 0
        ? []
        : await carregarPapeisParaAtribuir(cliente, tenantId, papeis.personalizados);

    if (encontrados.length !== papeis.personalizados.length) {
      // Papel de outro escritório responde como inexistente, sem revelar que existe.
      throw new ErroDeDominio(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO, 'Papel não encontrado.');
    }

    if (encontrados.some((papel) => papel.estado === 'ARQUIVADO')) {
      throw new ErroDeConflito(
        CODIGOS_DE_ERRO.PAPEL_ARQUIVADO,
        'Papel arquivado não pode ser atribuído. Reative-o ou escolha outro.',
      );
    }

    await substituirPapeisPersonalizados(cliente, tenantId, usuarioId, papeis.personalizados);

    return encontrados.map(({ id, nome }) => ({ id, nome }));
  }

  private async carregarOuFalhar(
    cliente: Cliente,
    tenantId: string,
    usuarioId: string,
    travar = false,
  ): Promise<UsuarioPersistido> {
    const usuario = await carregarUsuario(cliente, tenantId, usuarioId, { travar });

    if (usuario === null) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO, 'Usuário não encontrado.');
    }

    return usuario;
  }

  /** Invalida o convite pendente e emite outro: só um link vale por vez. */
  private async emitirConvite(
    cliente: Cliente,
    tenantId: string,
    usuarioId: string,
    agora: Date,
  ): Promise<ConviteEmitido> {
    // Antes de invalidar: um convite que já venceu precisa deixar o evento CONVITE_EXPIRADO
    // (SPEC-007 §3.5), e depois de invalidado ele não seria mais reconhecido como vencido.
    await reconciliarConvitesExpirados(cliente, tenantId, agora);
    await invalidarConvitesVigentes(cliente, tenantId, usuarioId);

    const token = gerarTokenDeConvite();
    const expiraEm = expiracaoDoConvite(agora);
    const conviteId = await criarConvite(cliente, tenantId, usuarioId, {
      tokenHash: hashDoToken(token),
      expiraEm,
    });

    return { conviteId, token, expiraEm };
  }

  /** Depois do commit. Falha não desfaz o cadastro: marca o convite para reenvio. */
  private async enviarConvite(
    tenantId: string,
    autor: Autor,
    convite: ConviteEmitido,
    destino: DestinoDoConvite,
  ): Promise<void> {
    try {
      await this.mailer.enviar({
        para: destino.email,
        nome: destino.nome,
        link: `${urlPublicaDaWeb()}/convite/${convite.token}`,
        expiraEm: convite.expiraEm,
      });
    } catch {
      // O cadastro já foi gravado: se nem a marcação de falha couber no banco, o pedido não
      // vira erro (o admin repetiria "Convidar" e esbarraria em e-mail já usado).
      try {
        await comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), (cliente) =>
          marcarEnvioFalhou(cliente, tenantId, convite.conviteId, true),
        );
      } catch (falha) {
        this.logger.warn(
          `envio do convite ${convite.conviteId} falhou e a marcação de reenvio também ` +
            `(${falha instanceof Error ? falha.message : 'erro desconhecido'})`,
        );
      }
    }
  }

  private async comTransacao<T>(
    tenantId: string,
    autor: Autor,
    executar: (cliente: Cliente, compensar: RegistrarCompensacao) => Promise<T>,
  ): Promise<T> {
    const compensacoes: CompensacaoRegistrada[] = [];

    try {
      return await comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), (cliente) =>
        executar(cliente, (executarCompensacao, descricao) =>
          compensacoes.push({ executar: executarCompensacao, descricao }),
        ),
      );
    } catch (erro) {
      for (const compensacao of compensacoes.reverse()) {
        try {
          await compensacao.executar();
        } catch (falha) {
          this.logger.error(
            `falha ao compensar a identidade; conferir no Keycloak: ${compensacao.descricao}` +
              ` (${falha instanceof Error ? falha.message : 'erro desconhecido'})`,
          );
        }
      }

      throw erro;
    }
  }
}
