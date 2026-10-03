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
  usuarioAfetadoId: string | null;
  papelId?: string;
  revisao?: number;
  autorId: string | null;
  antes: unknown;
  depois: unknown;
};

export type PapelEmMemoria = {
  id: string;
  tenantId: string;
  nome: string;
  descricao: string | null;
  papelBase: string;
  estado: string;
  revisao: number;
  /** Matriz da revisão vigente; as revisões antigas ficam em `revisoes`. */
  permissoes: string[];
  criadoEm: Date;
  atualizadoEm: Date;
};

export type RevisaoEmMemoria = {
  papelId: string;
  revisao: number;
  permissoes: string[];
  autorId: string;
};

export type VinculoEmMemoria = {
  tenantId: string;
  usuarioId: string;
  papelId: string;
  removido: boolean;
};

/** Vínculo de carteira: `ativo: false` é o encerrado, que nunca volta a ficar ativo (SPEC-009). */
export type VinculoDeCarteiraEmMemoria = {
  tenantId: string;
  usuarioId: string;
  empresaId: string;
  ativo: boolean;
  motivo?: string;
};

export const estado = {
  carteira: [] as VinculoDeCarteiraEmMemoria[],
  eventosDeCarteira: [] as Array<{ origem: string; autorId: string | null; afetados: unknown[] }>,
  notificacoesDeCarteira: [] as Array<{ usuarioId: string; eventoId: string }>,
  usuarios: [] as UsuarioEmMemoria[],
  convites: [] as ConviteEmMemoria[],
  eventos: [] as EventoEmMemoria[],
  papeis: [] as PapelEmMemoria[],
  revisoes: [] as RevisaoEmMemoria[],
  vinculos: [] as VinculoEmMemoria[],
  sequencia: 0,
  falharAoRegistrarEvento: false,
};

export const reiniciar = (): void => {
  estado.carteira.length = 0;
  estado.eventosDeCarteira.length = 0;
  estado.notificacoesDeCarteira.length = 0;
  estado.usuarios.length = 0;
  estado.convites.length = 0;
  estado.eventos.length = 0;
  estado.papeis.length = 0;
  estado.revisoes.length = 0;
  estado.vinculos.length = 0;
  estado.sequencia = 0;
  estado.falharAoRegistrarEvento = false;
};

const novoId = (prefixo: string): string => `${prefixo}-${++estado.sequencia}`;

const doTenant = (tenantId: string, id: string): UsuarioEmMemoria | undefined =>
  estado.usuarios.find((u) => u.tenantId === tenantId && u.id === id);

const papelDoTenant = (tenantId: string, id: string): PapelEmMemoria | undefined =>
  estado.papeis.find((p) => p.tenantId === tenantId && p.id === id);

const chaveDoNome = (nome: string): string => nome.trim().replace(/\s+/g, ' ').toLowerCase();

const nomeEmUso = (tenantId: string, nome: string, exceto: string | null): boolean =>
  estado.papeis.some(
    (p) => p.tenantId === tenantId && p.id !== exceto && chaveDoNome(p.nome) === chaveDoNome(nome),
  );

const violacaoDeNome = (): Error =>
  Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'papel_personalizado_nome_unico',
  });

/** Vínculo vigente de usuário que ainda conta: o arquivado não tem acesso nem segura o papel. */
const vinculosVigentesDoPapel = (tenantId: string, papelId: string): VinculoEmMemoria[] =>
  estado.vinculos.filter(
    (v) =>
      v.tenantId === tenantId &&
      v.papelId === papelId &&
      !v.removido &&
      doTenant(tenantId, v.usuarioId)?.estado !== 'ARQUIVADO',
  );

const visao = (u: UsuarioEmMemoria) => ({
  id: u.id,
  subOidc: u.subOidc,
  email: u.email,
  nome: u.nome,
  telefone: u.telefone,
  crc: u.crc,
  estado: u.estado,
  papeis: [...u.papeis],
  papeisPersonalizados: estado.vinculos
    .filter((v) => v.tenantId === u.tenantId && v.usuarioId === u.id && !v.removido)
    .flatMap((v) => {
      const papel = papelDoTenant(u.tenantId, v.papelId);

      return papel === undefined ? [] : [{ id: papel.id, nome: papel.nome, estado: papel.estado }];
    })
    .sort((a, b) => a.nome.localeCompare(b.nome)),
  versao: u.versao,
});

const visaoDoPapel = (p: PapelEmMemoria) => ({
  id: p.id,
  nome: p.nome,
  descricao: p.descricao,
  papelBase: p.papelBase,
  estado: p.estado,
  revisao: p.revisao,
  permissoes: [...p.permissoes],
  criadoEm: p.criadoEm,
  atualizadoEm: p.atualizadoEm,
});

const vigente = (usuarioId: string): ConviteEmMemoria | undefined =>
  estado.convites.find(
    (c) => c.usuarioId === usuarioId && c.usadoEm === null && c.invalidadoEm === null,
  );

export const funcoesDoBanco = {
  // A transação do dublê desfaz tudo se o caso de uso lançar: é o que prova "nada parcial".
  comContextoHumano: vi.fn(
    async (_pool: unknown, _entrada: unknown, executar: (cliente: never) => Promise<unknown>) => {
      const antes = structuredClone({
        carteira: estado.carteira,
        eventosDeCarteira: estado.eventosDeCarteira,
        notificacoesDeCarteira: estado.notificacoesDeCarteira,
        usuarios: estado.usuarios,
        convites: estado.convites,
        eventos: estado.eventos,
        papeis: estado.papeis,
        revisoes: estado.revisoes,
        vinculos: estado.vinculos,
      });

      try {
        return await executar({} as never);
      } catch (erro) {
        estado.carteira.splice(0, estado.carteira.length, ...antes.carteira);
        estado.eventosDeCarteira.splice(
          0,
          estado.eventosDeCarteira.length,
          ...antes.eventosDeCarteira,
        );
        estado.notificacoesDeCarteira.splice(
          0,
          estado.notificacoesDeCarteira.length,
          ...antes.notificacoesDeCarteira,
        );
        estado.usuarios.splice(0, estado.usuarios.length, ...antes.usuarios);
        estado.convites.splice(0, estado.convites.length, ...antes.convites);
        estado.eventos.splice(0, estado.eventos.length, ...antes.eventos);
        estado.papeis.splice(0, estado.papeis.length, ...antes.papeis);
        estado.revisoes.splice(0, estado.revisoes.length, ...antes.revisoes);
        estado.vinculos.splice(0, estado.vinculos.length, ...antes.vinculos);
        throw erro;
      }
    },
  ),
  // Carteira (SPEC-009): encerra os vínculos ativos do usuário e devolve quem foi afetado.
  encerrarVinculosDoUsuario: vi.fn(
    async (_c: unknown, tenantId: string, usuarioId: string) => {
      const ativos = estado.carteira.filter(
        (v) => v.tenantId === tenantId && v.usuarioId === usuarioId && v.ativo,
      );
      for (const vinculo of ativos) {
        vinculo.ativo = false;
        vinculo.motivo = 'ARQUIVAMENTO_USUARIO';
      }

      return ativos.length === 0
        ? []
        : [
            {
              usuarioId,
              usuarioNome: doTenant(tenantId, usuarioId)?.nome ?? '',
              adicionadas: [],
              removidas: ativos.map((v) => ({ id: v.empresaId, nome: v.empresaId, cnpj: '0' })),
              revisaoAnterior: 0,
              revisaoNova: 1,
            },
          ];
    },
  ),
  registrarEventoDeCarteira: vi.fn(
    async (
      _c: unknown,
      _t: string,
      evento: { origem: string; autorId: string | null; afetados: unknown[] },
    ) => {
      estado.eventosDeCarteira.push(evento);
      return `evento-carteira-${estado.eventosDeCarteira.length}`;
    },
  ),
  criarNotificacoesDeCarteira: vi.fn(
    async (
      _c: unknown,
      _t: string,
      eventoId: string,
      afetados: Array<{ usuarioId: string }>,
    ) => {
      for (const afetado of afetados) {
        estado.notificacoesDeCarteira.push({ usuarioId: afetado.usuarioId, eventoId });
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
          usuarioAfetadoNome:
            e.usuarioAfetadoId === null ? null : (doTenant(tenantId, e.usuarioAfetadoId)?.nome ?? '?'),
          papelId: e.papelId ?? null,
          papelNome: e.papelId === undefined ? null : (papelDoTenant(tenantId, e.papelId)?.nome ?? '?'),
          revisao: e.revisao ?? null,
          autorId: e.autorId,
          autorNome: e.autorId === null ? null : (doTenant(tenantId, e.autorId)?.nome ?? '?'),
          antes: e.antes,
          depois: e.depois,
        }));

      return { eventos, total: eventos.length };
    },
  ),

  // -- Papéis personalizados (SPEC-008) ---------------------------------------
  criarPapel: vi.fn(
    async (
      _c: unknown,
      tenantId: string,
      novo: {
        nome: string;
        descricao: string | null;
        papelBase: string;
        permissoes: string[];
        autorId: string;
      },
    ) => {
      if (nomeEmUso(tenantId, novo.nome, null)) {
        throw violacaoDeNome();
      }

      const id = novoId('papel');
      const agora = new Date();

      estado.papeis.push({
        id,
        tenantId,
        nome: novo.nome,
        descricao: novo.descricao,
        papelBase: novo.papelBase,
        estado: 'ATIVO',
        revisao: 1,
        permissoes: [...novo.permissoes],
        criadoEm: agora,
        atualizadoEm: agora,
      });
      estado.revisoes.push({
        papelId: id,
        revisao: 1,
        permissoes: [...novo.permissoes],
        autorId: novo.autorId,
      });

      return id;
    },
  ),
  carregarPapel: vi.fn(async (_c: unknown, tenantId: string, id: string) => {
    const p = papelDoTenant(tenantId, id);

    return p === undefined ? null : visaoDoPapel(p);
  }),
  papelComNome: vi.fn(async (_c: unknown, tenantId: string, nome: string) => {
    const p = estado.papeis.find(
      (x) => x.tenantId === tenantId && chaveDoNome(x.nome) === chaveDoNome(nome),
    );

    return p?.id ?? null;
  }),
  gravarNovaRevisao: vi.fn(
    async (
      _c: unknown,
      tenantId: string,
      id: string,
      dados: {
        nome: string;
        descricao: string | null;
        estado: string;
        permissoes: string[];
        autorId: string;
      },
    ) => {
      const p = papelDoTenant(tenantId, id);

      if (p === undefined) {
        throw new Error('Falha ao gravar a revisão do papel.');
      }

      if (nomeEmUso(tenantId, dados.nome, id)) {
        throw violacaoDeNome();
      }

      p.nome = dados.nome;
      p.descricao = dados.descricao;
      p.estado = dados.estado;
      p.revisao += 1;
      p.permissoes = [...dados.permissoes];
      p.atualizadoEm = new Date();
      estado.revisoes.push({
        papelId: id,
        revisao: p.revisao,
        permissoes: [...dados.permissoes],
        autorId: dados.autorId,
      });

      return p.revisao;
    },
  ),
  listarPapeis: vi.fn(
    async (
      _c: unknown,
      tenantId: string,
      filtro: { busca?: string; estado?: string; limite: number; deslocamento: number },
    ) => {
      const papeis = estado.papeis
        .filter((p) => p.tenantId === tenantId)
        .filter((p) => filtro.estado === undefined || p.estado === filtro.estado)
        .filter(
          (p) =>
            filtro.busca === undefined || p.nome.toLowerCase().includes(filtro.busca.toLowerCase()),
        )
        .sort((a, b) => a.nome.localeCompare(b.nome));

      return {
        total: papeis.length,
        papeis: papeis
          .slice(filtro.deslocamento, filtro.deslocamento + filtro.limite)
          .map((p) => ({
            ...visaoDoPapel(p),
            usuariosVinculados: vinculosVigentesDoPapel(tenantId, p.id).length,
          })),
      };
    },
  ),
  contarVinculosDoPapel: vi.fn(
    async (_c: unknown, tenantId: string, id: string) =>
      vinculosVigentesDoPapel(tenantId, id).length,
  ),
  listarUsuariosVinculados: vi.fn(async (_c: unknown, tenantId: string, id: string) =>
    vinculosVigentesDoPapel(tenantId, id).map((v) => ({
      id: v.usuarioId,
      nome: doTenant(tenantId, v.usuarioId)?.nome ?? '?',
    })),
  ),
  carregarPapeisParaAtribuir: vi.fn(async (_c: unknown, tenantId: string, ids: string[]) =>
    estado.papeis
      .filter((p) => p.tenantId === tenantId && ids.includes(p.id))
      .map((p) => ({ id: p.id, nome: p.nome, estado: p.estado })),
  ),
  substituirPapeisPersonalizados: vi.fn(
    async (_c: unknown, tenantId: string, usuarioId: string, papelIds: string[]) => {
      for (const v of estado.vinculos) {
        if (
          v.tenantId === tenantId &&
          v.usuarioId === usuarioId &&
          !v.removido &&
          !papelIds.includes(v.papelId)
        ) {
          v.removido = true;
        }
      }

      for (const papelId of papelIds) {
        const jaVigente = estado.vinculos.some(
          (v) => v.tenantId === tenantId && v.usuarioId === usuarioId && v.papelId === papelId && !v.removido,
        );

        if (!jaVigente) {
          estado.vinculos.push({ tenantId, usuarioId, papelId, removido: false });
        }
      }
    },
  ),
};
