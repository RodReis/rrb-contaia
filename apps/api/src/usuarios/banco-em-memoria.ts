/**
 * Dublê em memória do repositório de usuários, só para os specs de regras.
 *
 * Comporta-se como o banco real onde isso importa para a decisão do caso de
 * uso: a transação desfaz tudo quando o caso de uso lança (por isso "nada
 * parcial" é provado, não presumido), o e-mail é único entre escritórios e só
 * existe um convite vigente por usuário. SQL, RLS e concorrência real têm
 * provas próprias em `packages/db`.
 *
 * Uso: `vi.mock('@contaia/db', async () => ({ ...real, ...(await import('./banco-em-memoria')).funcoesDoBanco }))`.
 */
import { vi } from 'vitest';

export type UsuarioEmMemoria = {
  id: string;
  tenantId: string;
  subOidc: string;
  email: string;
  nome: string;
  telefone: string | null;
  crc: string | null;
  estado: string;
  papeis: string[];
  versao: number;
  criadoEm: Date;
};

export type ConviteEmMemoria = {
  id: string;
  tenantId: string;
  usuarioId: string;
  tokenHash: string;
  expiraEm: Date;
  usadoEm: Date | null;
  invalidadoEm: Date | null;
  envioFalhou: boolean;
};

export type EventoEmMemoria = {
  tenantId: string;
  tipo: string;
  usuarioAfetadoId: string;
  autorId: string | null;
  antes: unknown;
  depois: unknown;
};

export const estado = {
  usuarios: [] as UsuarioEmMemoria[],
  convites: [] as ConviteEmMemoria[],
  eventos: [] as EventoEmMemoria[],
  sequencia: 0,
  falharAoRegistrarEvento: false,
};

export const reiniciar = (): void => {
  estado.usuarios.length = 0;
  estado.convites.length = 0;
  estado.eventos.length = 0;
  estado.sequencia = 0;
  estado.falharAoRegistrarEvento = false;
};

const novoId = (prefixo: string): string => `${prefixo}-${++estado.sequencia}`;

const doTenant = (tenantId: string, id: string): UsuarioEmMemoria | undefined =>
  estado.usuarios.find((u) => u.tenantId === tenantId && u.id === id);

const visao = (u: UsuarioEmMemoria) => ({
  id: u.id,
  subOidc: u.subOidc,
  email: u.email,
  nome: u.nome,
  telefone: u.telefone,
  crc: u.crc,
  estado: u.estado,
  papeis: [...u.papeis],
  versao: u.versao,
});

const vigente = (usuarioId: string): ConviteEmMemoria | undefined =>
  estado.convites.find(
    (c) => c.usuarioId === usuarioId && c.usadoEm === null && c.invalidadoEm === null,
  );

export const funcoesDoBanco = {
  // A transação do dublê desfaz tudo se o caso de uso lançar: é o que prova "nada parcial".
  comContextoDeTenant: vi.fn(
    async (_pool: unknown, _tenantId: string, executar: (cliente: never) => Promise<unknown>) => {
      const antes = structuredClone({
        usuarios: estado.usuarios,
        convites: estado.convites,
        eventos: estado.eventos,
      });

      try {
        return await executar({} as never);
      } catch (erro) {
        estado.usuarios.splice(0, estado.usuarios.length, ...antes.usuarios);
        estado.convites.splice(0, estado.convites.length, ...antes.convites);
        estado.eventos.splice(0, estado.eventos.length, ...antes.eventos);
        throw erro;
      }
    },
  ),
  semContexto: vi.fn(
    async (_pool: unknown, executar: (cliente: never) => Promise<unknown>) =>
      executar({} as never),
  ),
  criarUsuario: vi.fn(async (_c: unknown, tenantId: string, novo: Record<string, string | null>) => {
    if (estado.usuarios.some((u) => u.email.toLowerCase() === String(novo['email']).toLowerCase())) {
      throw Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'usuario_email_unico',
      });
    }

    const id = novoId('usuario');

    estado.usuarios.push({
      id,
      tenantId,
      subOidc: String(novo['subOidc']),
      email: String(novo['email']),
      nome: String(novo['nome']),
      telefone: novo['telefone'] ?? null,
      crc: novo['crc'] ?? null,
      estado: 'CONVIDADO',
      papeis: [],
      versao: 0,
      criadoEm: new Date(),
    });

    return id;
  }),
  substituirPapeis: vi.fn(async (_c: unknown, tenantId: string, id: string, papeis: string[]) => {
    const u = doTenant(tenantId, id);

    if (u !== undefined) u.papeis = [...papeis];
  }),
  carregarUsuario: vi.fn(async (_c: unknown, tenantId: string, id: string) => {
    const u = doTenant(tenantId, id);

    return u === undefined ? null : visao(u);
  }),
  usuarioComEmailNoTenant: vi.fn(async (_c: unknown, tenantId: string, email: string) => {
    const u = estado.usuarios.find(
      (x) => x.tenantId === tenantId && x.email.toLowerCase() === email.toLowerCase(),
    );

    return u === undefined ? null : { id: u.id, estado: u.estado };
  }),
  atualizarDadosDoUsuario: vi.fn(
    async (_c: unknown, tenantId: string, id: string, dados: Record<string, string | null>) => {
      const u = doTenant(tenantId, id);

      if (u === undefined) return;
      u.nome = String(dados['nome']);
      u.telefone = dados['telefone'] ?? null;
      u.crc = dados['crc'] ?? null;
      if (dados['email'] !== undefined && dados['email'] !== null) u.email = dados['email'];
      u.versao += 1;
    },
  ),
  atualizarEstadoDoUsuario: vi.fn(async (_c: unknown, tenantId: string, id: string, novo: string) => {
    const u = doTenant(tenantId, id);

    if (u !== undefined) {
      u.estado = novo;
      u.versao += 1;
    }
  }),
  travarAdminsAtivos: vi.fn(async (_c: unknown, tenantId: string) =>
    estado.usuarios
      .filter(
        (u) =>
          u.tenantId === tenantId && u.estado === 'ATIVO' && u.papeis.includes('admin_escritorio'),
      )
      .map((u) => u.id),
  ),
  criarConvite: vi.fn(
    async (
      _c: unknown,
      tenantId: string,
      usuarioId: string,
      convite: { tokenHash: string; expiraEm: Date },
    ) => {
      if (vigente(usuarioId) !== undefined) {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'usuario_convite_vigente_unico',
        });
      }

      const id = novoId('convite');

      estado.convites.push({
        id,
        tenantId,
        usuarioId,
        tokenHash: convite.tokenHash,
        expiraEm: convite.expiraEm,
        usadoEm: null,
        invalidadoEm: null,
        envioFalhou: false,
      });

      return id;
    },
  ),
  invalidarConvitesVigentes: vi.fn(async (_c: unknown, _tenantId: string, usuarioId: string) => {
    const pendente = vigente(usuarioId);

    if (pendente === undefined) return 0;
    pendente.invalidadoEm = new Date();

    return 1;
  }),
  consumirConvite: vi.fn(async (_c: unknown, tenantId: string, conviteId: string) => {
    const convite = estado.convites.find((c) => c.id === conviteId && c.tenantId === tenantId);

    if (convite === undefined || convite.usadoEm !== null || convite.invalidadoEm !== null) {
      return false;
    }

    convite.usadoEm = new Date();

    return true;
  }),
  resolverConvite: vi.fn(async (_c: unknown, tokenHash: string) => {
    const convite = estado.convites.find((c) => c.tokenHash === tokenHash);
    const usuario = estado.usuarios.find((u) => u.id === convite?.usuarioId);

    return convite === undefined || usuario === undefined
      ? null
      : {
          conviteId: convite.id,
          tenantId: convite.tenantId,
          usuarioId: convite.usuarioId,
          usuarioEstado: usuario.estado,
          expiraEm: convite.expiraEm,
          usadoEm: convite.usadoEm,
          invalidadoEm: convite.invalidadoEm,
        };
  }),
  marcarEnvioFalhou: vi.fn(
    async (_c: unknown, _tenantId: string, conviteId: string, falhou: boolean) => {
      const c = estado.convites.find((x) => x.id === conviteId);

      if (c !== undefined) c.envioFalhou = falhou;
    },
  ),
  conviteVigenteDoUsuario: vi.fn(async (_c: unknown, _tenantId: string, usuarioId: string) => {
    const c = vigente(usuarioId);

    return c === undefined ? null : { id: c.id, expiraEm: c.expiraEm, envioFalhou: c.envioFalhou };
  }),
  registrarEventoDeUsuario: vi.fn(
    async (
      _c: unknown,
      tenantId: string,
      evento: Omit<EventoEmMemoria, 'tenantId'>,
    ) => {
      if (estado.falharAoRegistrarEvento) {
        throw new Error('falha na auditoria');
      }

      estado.eventos.push({ tenantId, ...evento });
    },
  ),
  listarUsuarios: vi.fn(async (_c: unknown, tenantId: string) => {
    const usuarios = estado.usuarios
      .filter((u) => u.tenantId === tenantId)
      .map((u) => ({
        ...visao(u),
        conviteExpiraEm: vigente(u.id)?.expiraEm ?? null,
        envioFalhou: vigente(u.id)?.envioFalhou ?? false,
        criadoEm: u.criadoEm,
      }));

    return { usuarios, total: usuarios.length };
  }),
  reconciliarConvitesExpirados: vi.fn(async (_c: unknown, tenantId: string, agora: Date) => {
    let novos = 0;

    for (const c of estado.convites) {
      const jaRegistrado = estado.eventos.some(
        (e) =>
          e.tipo === 'CONVITE_EXPIRADO' &&
          (e.depois as { conviteId?: string } | null)?.conviteId === c.id,
      );

      if (
        c.tenantId === tenantId &&
        c.expiraEm.getTime() <= agora.getTime() &&
        c.usadoEm === null &&
        c.invalidadoEm === null &&
        !jaRegistrado
      ) {
        estado.eventos.push({
          tenantId,
          tipo: 'CONVITE_EXPIRADO',
          usuarioAfetadoId: c.usuarioId,
          autorId: null,
          antes: null,
          depois: { conviteId: c.id },
        });
        novos += 1;
      }
    }

    return novos;
  }),
  listarEventosDeUsuario: vi.fn(
    async (
      _c: unknown,
      tenantId: string,
      filtro: { usuarioAfetadoId?: string; autorId?: string; tipo?: string },
    ) => {
      const eventos = estado.eventos
        .map((e, indice) => ({ e, indice }))
        .filter(({ e }) => e.tenantId === tenantId)
        .filter(({ e }) => filtro.usuarioAfetadoId === undefined || e.usuarioAfetadoId === filtro.usuarioAfetadoId)
        .filter(({ e }) => filtro.autorId === undefined || e.autorId === filtro.autorId)
        .filter(({ e }) => filtro.tipo === undefined || e.tipo === filtro.tipo)
        .sort((a, b) => b.indice - a.indice)
        .map(({ e, indice }) => ({
          id: `evento-${indice}`,
          ocorridoEm: new Date('2026-10-02T12:00:00Z'),
          tipo: e.tipo,
          usuarioAfetadoId: e.usuarioAfetadoId,
          usuarioAfetadoNome: doTenant(tenantId, e.usuarioAfetadoId)?.nome ?? '?',
          autorId: e.autorId,
          autorNome: e.autorId === null ? null : (doTenant(tenantId, e.autorId)?.nome ?? '?'),
          antes: e.antes,
          depois: e.depois,
        }));

      return { eventos, total: eventos.length };
    },
  ),
};
