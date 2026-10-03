/**
 * Usuários, papéis aditivos, convite e auditoria (SPEC-007).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 * O que estas provas defendem, em ordem de gravidade: um tenant não lê nem
 * escreve usuário, papel, convite ou evento do outro; o e-mail é único entre
 * escritórios sem distinguir caixa; o convite só é consumido uma vez mesmo sob
 * concorrência; o escritório nunca fica sem administrador ativo mesmo com duas
 * remoções simultâneas; e o histórico de usuários é append-only.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import { comContextoHumano } from './contexto.js';
import {
  atualizarDados,
  atualizarEstado,
  carregarUsuario,
  consumirConvite,
  conviteVigenteDoUsuario,
  criarConvite,
  criarUsuario,
  invalidarConvitesVigentes,
  listarEventosDeUsuario,
  listarUsuarios,
  marcarEnvioFalhou,
  reconciliarConvitesExpirados,
  registrarEventoDeUsuario,
  resolverConvite,
  substituirPapeis,
  travarAdminsAtivos,
  usuarioComEmailNoTenant,
} from './repositorios/usuarios.js';
import { USUARIO_AVULSO, aplicarContextoDeTeste, comoUsuario } from './testes/suporte.js';

const urlDaAplicacao = (): string => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

const poolAdmin = criarPool();
let poolApp: Pool;
let tenantA = '';
let tenantB = '';
let adminA = '';
let adminA2 = '';
let adminB = '';

const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const RAZOES = [`Escritório Usuários A ${SUFIXO}`, `Escritório Usuários B ${SUFIXO}`];
const email = (nome: string): string => `${nome}.${SUFIXO}@usuarios.local`;

const comTenant = <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => comoUsuario(poolApp, tenantId, (tenantId === tenantA ? adminA : adminB) || USUARIO_AVULSO, executar, 'ADMIN_ACESSO');

const novoUsuario = async (
  tenantId: string,
  nome: string,
  papeis: readonly ('admin_escritorio' | 'contador' | 'auxiliar' | 'auditor_readonly')[],
  estado: 'CONVIDADO' | 'ATIVO' | 'SUSPENSO' | 'ARQUIVADO' = 'ATIVO',
): Promise<string> =>
  comTenant(tenantId, async (cliente) => {
    const id = await criarUsuario(cliente, tenantId, {
      subOidc: `sub-${nome}-${SUFIXO}`,
      email: email(nome),
      nome: `Usuário ${nome}`,
      telefone: null,
      crc: null,
    });

    await substituirPapeis(cliente, tenantId, id, papeis);

    if (estado !== 'CONVIDADO') {
      await atualizarEstado(cliente, tenantId, id, estado);
    }

    return id;
  });

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    'select id from app.tenant where razao_social = any($1)',
    [RAZOES],
  );
  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // A trigger append-only recusa DELETE até para o dono da tabela: limpar
  // fixture é a única exceção legítima e desliga a trigger de forma explícita.
  await poolAdmin.query('alter table app.usuario_evento disable trigger usuario_evento_append_only');

  try {
    await poolAdmin.query('delete from app.usuario_evento where tenant_id = any($1)', [ids]);
  } finally {
    await poolAdmin.query('alter table app.usuario_evento enable trigger usuario_evento_append_only');
  }

  await poolAdmin.query('delete from app.usuario_convite where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.usuario_papel where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.usuario where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [ids]);
};

beforeAll(async () => {
  await limpar();

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, $3, 'ATIVO'), ($2, $4, 'ATIVO')
     returning id`,
    [`91${SUFIXO}000191`, `92${SUFIXO}000192`, RAZOES[0], RAZOES[1]],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 10 });

  adminA = await novoUsuario(tenantA, 'admin-a', ['admin_escritorio']);
  adminA2 = await novoUsuario(tenantA, 'admin-a2', ['admin_escritorio']);
  adminB = await novoUsuario(tenantB, 'admin-b', ['admin_escritorio']);
});

afterAll(async () => {
  await limpar();
  await poolApp.end();
  await poolAdmin.end();
});

describe('isolamento por tenant (RLS)', () => {
  it('tenant A não lê usuário, papel, convite nem evento do tenant B', async () => {
    await comTenant(tenantB, async (cliente) => {
      await criarConvite(cliente, tenantB, adminB, {
        tokenHash: `hash-isolamento-${SUFIXO}`,
        expiraEm: new Date(Date.now() + 3_600_000),
      });
      await registrarEventoDeUsuario(cliente, tenantB, {
        tipo: 'CONVITE_CRIADO',
        usuarioAfetadoId: adminB,
        autorId: adminB,
        antes: null,
        depois: { origem: 'teste-isolamento' },
      });
    });

    await comTenant(tenantA, async (cliente) => {
      for (const tabela of ['usuario', 'usuario_papel', 'usuario_convite', 'usuario_evento']) {
        const { rows } = await cliente.query<{ tenant_id: string }>(
          `select tenant_id from app.${tabela}`,
        );

        expect(rows.every((linha) => linha.tenant_id === tenantA)).toBe(true);
      }

      expect(await carregarUsuario(cliente, tenantA, adminB)).toBeNull();
    });
  });

  it('sem contexto de tenant nada é devolvido', async () => {
    await comTenant(null, async (cliente) => {
      for (const tabela of ['usuario', 'usuario_papel', 'usuario_convite', 'usuario_evento']) {
        const { rows } = await cliente.query(`select 1 from app.${tabela}`);

        expect(rows).toHaveLength(0);
      }
    });
  });

  it('tenant A não escreve linha com tenant_id do tenant B em nenhuma tabela nova', async () => {
    const tentativas: Array<[string, string, unknown[]]> = [
      [
        'usuario_papel',
        `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'auxiliar')`,
        [tenantB, adminB],
      ],
      [
        'usuario_convite',
        `insert into app.usuario_convite (tenant_id, usuario_id, token_hash, expira_em)
         values ($1, $2, $3, now() + interval '1 hour')`,
        [tenantB, adminB, `hash-escrita-${SUFIXO}`],
      ],
      [
        'usuario_evento',
        `insert into app.usuario_evento (tenant_id, tipo, usuario_afetado_id)
         values ($1, 'SUSPENSO', $2)`,
        [tenantB, adminB],
      ],
    ];

    for (const [tabela, sql, parametros] of tentativas) {
      await expect(
        comTenant(tenantA, async (cliente) => cliente.query(sql, parametros)),
        tabela,
      ).rejects.toThrow(/row-level security/);
    }
  });

  it('FK composta impede papel de um tenant apontar para usuário de outro', async () => {
    await expect(
      poolAdmin.query(
        `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'auxiliar')`,
        [tenantA, adminB],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('unicidade global do e-mail', () => {
  it('recusa e-mail repetido ignorando a caixa, mesmo em outro tenant', async () => {
    const alvo = email('repetido');

    await comTenant(tenantA, async (cliente) => {
      await criarUsuario(cliente, tenantA, {
        subOidc: `sub-repetido-a-${SUFIXO}`,
        email: alvo,
        nome: 'Repetido A',
        telefone: null,
        crc: null,
      });
    });

    await expect(
      comTenant(tenantB, async (cliente) =>
        criarUsuario(cliente, tenantB, {
          subOidc: `sub-repetido-b-${SUFIXO}`,
          email: alvo.toUpperCase(),
          nome: 'Repetido B',
          telefone: null,
          crc: null,
        }),
      ),
    ).rejects.toThrow(/usuario_email_unico/);
  });

  it('localiza usuário pelo e-mail normalizado apenas dentro do próprio tenant', async () => {
    const noTenantA = await comTenant(tenantA, (cliente) =>
      usuarioComEmailNoTenant(cliente, tenantA, email('repetido')),
    );
    const noTenantB = await comTenant(tenantB, (cliente) =>
      usuarioComEmailNoTenant(cliente, tenantB, email('repetido')),
    );

    expect(noTenantA?.estado).toBe('CONVIDADO');
    expect(noTenantB).toBeNull();
  });
});

describe('papéis aditivos', () => {
  it('recusa papel fora do catálogo padrão do MVP-1', async () => {
    await expect(
      poolAdmin.query(
        `insert into app.usuario_papel (tenant_id, usuario_id, papel)
         values ($1, $2, 'gestor_financeiro')`,
        [tenantA, adminA],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('substituir papéis preserva o histórico: o removido ganha removido_em, nada é apagado', async () => {
    const id = await novoUsuario(tenantA, 'troca', ['contador', 'auxiliar']);

    await comTenant(tenantA, (cliente) =>
      substituirPapeis(cliente, tenantA, id, ['auxiliar', 'auditor_readonly']),
    );

    const usuario = await comTenant(tenantA, (cliente) => carregarUsuario(cliente, tenantA, id));
    const { rows } = await poolAdmin.query<{ papel: string; removido_em: Date | null }>(
      'select papel, removido_em from app.usuario_papel where usuario_id = $1',
      [id],
    );

    expect([...(usuario?.papeis ?? [])].sort()).toEqual(['auditor_readonly', 'auxiliar']);
    expect(rows.find((linha) => linha.papel === 'contador')?.removido_em).not.toBeNull();
    expect(rows).toHaveLength(3);
  });

  it('não duplica o papel vigente ao substituir pelo mesmo conjunto', async () => {
    const id = await novoUsuario(tenantA, 'estavel', ['contador']);

    await comTenant(tenantA, (cliente) => substituirPapeis(cliente, tenantA, id, ['contador']));

    const { rows } = await poolAdmin.query(
      'select 1 from app.usuario_papel where usuario_id = $1 and removido_em is null',
      [id],
    );

    expect(rows).toHaveLength(1);
  });
});

describe('app.resolver_identidade', () => {
  const resolver = async (sub: string) =>
    poolApp.query<{ tenant_id: string; papeis: string[]; tenant_status: string }>(
      'select * from app.resolver_identidade($1)',
      [sub],
    );

  it('devolve a união dos papéis vigentes do usuário ativo', async () => {
    await novoUsuario(tenantA, 'uniao', ['contador', 'auxiliar']);

    const { rows } = await resolver(`sub-uniao-${SUFIXO}`);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(tenantA);
    expect([...(rows[0]?.papeis ?? [])].sort()).toEqual(['auxiliar', 'contador']);
  });

  it('não inclui papel removido', async () => {
    const id = await novoUsuario(tenantA, 'removido', ['contador', 'auxiliar']);

    await comTenant(tenantA, (cliente) => substituirPapeis(cliente, tenantA, id, ['auxiliar']));

    const { rows } = await resolver(`sub-removido-${SUFIXO}`);

    expect(rows[0]?.papeis).toEqual(['auxiliar']);
  });

  it.each(['CONVIDADO', 'SUSPENSO', 'ARQUIVADO'] as const)(
    'não resolve usuário %s',
    async (estado) => {
      const nome = `estado-${estado.toLowerCase()}`;

      await novoUsuario(tenantA, nome, ['contador'], estado);

      const { rows } = await resolver(`sub-${nome}-${SUFIXO}`);

      expect(rows).toHaveLength(0);
    },
  );

  it('não devolve nada para um sub desconhecido', async () => {
    expect((await resolver('sub-que-nao-existe')).rows).toHaveLength(0);
  });
});

describe('convite', () => {
  it('app.resolver_convite devolve só o par do hash e nada para hash desconhecido', async () => {
    const id = await novoUsuario(tenantA, 'convidado-resolve', ['auxiliar'], 'CONVIDADO');
    const expiraEm = new Date(Date.now() + 3_600_000);

    await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, id, { tokenHash: `hash-resolve-${SUFIXO}`, expiraEm }),
    );

    const resolvido = await comTenant(null, (cliente) =>
      resolverConvite(cliente, `hash-resolve-${SUFIXO}`),
    );
    const desconhecido = await comTenant(null, (cliente) =>
      resolverConvite(cliente, 'hash-que-nao-existe'),
    );

    expect(resolvido?.tenantId).toBe(tenantA);
    expect(resolvido?.usuarioId).toBe(id);
    expect(resolvido?.usuarioEstado).toBe('CONVIDADO');
    expect(desconhecido).toBeNull();
  });

  it('só existe um convite vigente por usuário; invalidar libera o próximo', async () => {
    const id = await novoUsuario(tenantA, 'convidado-unico', ['auxiliar'], 'CONVIDADO');
    const expiraEm = new Date(Date.now() + 3_600_000);

    await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, id, { tokenHash: `hash-unico-1-${SUFIXO}`, expiraEm }),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        criarConvite(cliente, tenantA, id, { tokenHash: `hash-unico-2-${SUFIXO}`, expiraEm }),
      ),
    ).rejects.toThrow(/usuario_convite_vigente_unico/);

    await comTenant(tenantA, async (cliente) => {
      await invalidarConvitesVigentes(cliente, tenantA, id);
      await criarConvite(cliente, tenantA, id, { tokenHash: `hash-unico-3-${SUFIXO}`, expiraEm });
    });

    const vigente = await comTenant(tenantA, (cliente) =>
      conviteVigenteDoUsuario(cliente, tenantA, id),
    );

    expect(vigente).not.toBeNull();
  });

  it('duas aceitações simultâneas do mesmo convite: exatamente uma consome', async () => {
    const id = await novoUsuario(tenantA, 'convidado-corrida', ['auxiliar'], 'CONVIDADO');
    const conviteId = await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, id, {
        tokenHash: `hash-corrida-${SUFIXO}`,
        expiraEm: new Date(Date.now() + 3_600_000),
      }),
    );

    const resultados = await Promise.all([
      comTenant(tenantA, (cliente) => consumirConvite(cliente, tenantA, conviteId)),
      comTenant(tenantA, (cliente) => consumirConvite(cliente, tenantA, conviteId)),
    ]);

    expect(resultados.filter(Boolean)).toHaveLength(1);
  });

  it('convite invalidado não pode ser consumido', async () => {
    const id = await novoUsuario(tenantA, 'convidado-invalidado', ['auxiliar'], 'CONVIDADO');
    const conviteId = await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, id, {
        tokenHash: `hash-invalidado-${SUFIXO}`,
        expiraEm: new Date(Date.now() + 3_600_000),
      }),
    );

    await comTenant(tenantA, (cliente) => invalidarConvitesVigentes(cliente, tenantA, id));

    expect(await comTenant(tenantA, (cliente) => consumirConvite(cliente, tenantA, conviteId))).toBe(
      false,
    );
  });

  it('registra e limpa a falha de envio sem tocar no cadastro', async () => {
    const id = await novoUsuario(tenantA, 'convidado-envio', ['auxiliar'], 'CONVIDADO');
    const conviteId = await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, id, {
        tokenHash: `hash-envio-${SUFIXO}`,
        expiraEm: new Date(Date.now() + 3_600_000),
      }),
    );

    await comTenant(tenantA, (cliente) => marcarEnvioFalhou(cliente, tenantA, conviteId, true));

    const vigente = await comTenant(tenantA, (cliente) =>
      conviteVigenteDoUsuario(cliente, tenantA, id),
    );

    expect(vigente?.envioFalhou).toBe(true);
  });
});

describe('expiração preguiçosa do convite', () => {
  it('gera um único evento CONVITE_EXPIRADO por convite, mesmo reconciliando várias vezes', async () => {
    const id = await novoUsuario(tenantA, 'convidado-expirado', ['auxiliar'], 'CONVIDADO');
    const conviteId = await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, id, {
        tokenHash: `hash-expirado-${SUFIXO}`,
        expiraEm: new Date(Date.now() - 1000),
      }),
    );

    const agora = new Date();
    const primeira = await comTenant(tenantA, (cliente) =>
      reconciliarConvitesExpirados(cliente, tenantA, agora),
    );
    const segunda = await comTenant(tenantA, (cliente) =>
      reconciliarConvitesExpirados(cliente, tenantA, agora),
    );

    const { rows } = await poolAdmin.query<{ depois: { conviteId: string } }>(
      `select depois from app.usuario_evento
        where tenant_id = $1 and tipo = 'CONVITE_EXPIRADO' and usuario_afetado_id = $2`,
      [tenantA, id],
    );

    expect(primeira).toBeGreaterThanOrEqual(1);
    expect(segunda).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.depois.conviteId).toBe(conviteId);
  });

  it('não expira convite ainda vigente nem convite já consumido', async () => {
    const vigente = await novoUsuario(tenantA, 'convidado-ainda-vale', ['auxiliar'], 'CONVIDADO');

    await comTenant(tenantA, (cliente) =>
      criarConvite(cliente, tenantA, vigente, {
        tokenHash: `hash-ainda-vale-${SUFIXO}`,
        expiraEm: new Date(Date.now() + 3_600_000),
      }),
    );

    await comTenant(tenantA, (cliente) => reconciliarConvitesExpirados(cliente, tenantA, new Date()));

    const { rows } = await poolAdmin.query(
      `select 1 from app.usuario_evento
        where tenant_id = $1 and tipo = 'CONVITE_EXPIRADO' and usuario_afetado_id = $2`,
      [tenantA, vigente],
    );

    expect(rows).toHaveLength(0);
  });
});

describe('proteção do último administrador sob concorrência', () => {
  it('a segunda remoção simultânea enxerga só um administrador depois da primeira', async () => {
    const x = await novoUsuario(tenantB, 'conc-x', ['admin_escritorio']);
    // adminB já é administrador ativo do tenant B: o tenant tem dois (adminB e x).
    const clienteUm = await poolApp.connect();
    const clienteDois = await poolApp.connect();

    try {
      await clienteUm.query('begin');
      await aplicarContextoDeTeste(clienteUm, tenantB, adminB, 'ADMIN_ACESSO');
      const vistosPelaPrimeira = await travarAdminsAtivos(clienteUm, tenantB);

      expect(vistosPelaPrimeira.sort()).toEqual([adminB, x].sort());

      await clienteDois.query('begin');
      await aplicarContextoDeTeste(clienteDois, tenantB, adminB, 'ADMIN_ACESSO');

      let resolvida = false;
      const segunda = travarAdminsAtivos(clienteDois, tenantB).then((ids) => {
        resolvida = true;

        return ids;
      });

      await new Promise((resolver) => setTimeout(resolver, 300));
      expect(resolvida).toBe(false);

      await substituirPapeis(clienteUm, tenantB, x, ['auxiliar']);
      await clienteUm.query('commit');

      const vistosPelaSegunda = await segunda;

      expect(vistosPelaSegunda).toEqual([adminB]);
      await clienteDois.query('rollback');
    } finally {
      clienteUm.release();
      clienteDois.release();
    }
  });
});

describe('proteção do último administrador contra suspensão simultânea', () => {
  it('a segunda operação enxerga o estado já suspenso pela primeira, não o do início', async () => {
    // Suspender muda `usuario.estado`, não as linhas de papel: travar só os papéis deixaria a
    // segunda transação ler o estado antigo e os dois admins se suspenderem em paralelo.
    const y = await novoUsuario(tenantB, 'conc-susp', ['admin_escritorio']);
    const clienteUm = await poolApp.connect();
    const clienteDois = await poolApp.connect();

    try {
      await clienteUm.query('begin');
      await aplicarContextoDeTeste(clienteUm, tenantB, adminB, 'ADMIN_ACESSO');
      const vistosPelaPrimeira = await travarAdminsAtivos(clienteUm, tenantB);

      expect(vistosPelaPrimeira).toContain(y);

      await clienteDois.query('begin');
      await aplicarContextoDeTeste(clienteDois, tenantB, adminB, 'ADMIN_ACESSO');

      let resolvida = false;
      const segunda = travarAdminsAtivos(clienteDois, tenantB).then((ids) => {
        resolvida = true;

        return ids;
      });

      await new Promise((resolver) => setTimeout(resolver, 300));
      expect(resolvida).toBe(false);

      await atualizarEstado(clienteUm, tenantB, y, 'SUSPENSO');
      await clienteUm.query('commit');

      expect(await segunda).not.toContain(y);
      await clienteDois.query('rollback');
    } finally {
      clienteUm.release();
      clienteDois.release();
    }
  });
});

describe('atomicidade de mutação + auditoria no PostgreSQL real', () => {
  it('se o evento é recusado pelo banco, a mutação anterior da mesma transação não persiste', async () => {
    const id = await novoUsuario(tenantA, 'atomico', ['auxiliar']);
    const antes = await comTenant(tenantA, (cliente) => carregarUsuario(cliente, tenantA, id));

    await expect(
      comContextoHumano(poolApp, { tenantId: tenantA, usuarioId: adminA, finalidade: 'ADMIN_ACESSO' }, async (cliente) => {
        await atualizarEstado(cliente, tenantA, id, 'SUSPENSO');
        await substituirPapeis(cliente, tenantA, id, ['auditor_readonly']);
        await registrarEventoDeUsuario(cliente, tenantA, {
          // Tipo fora do CHECK da tabela: o banco recusa e a transação inteira desfaz.
          tipo: 'TIPO_INEXISTENTE' as never,
          usuarioAfetadoId: id,
          autorId: adminA,
          antes: null,
          depois: null,
        });
      }),
    ).rejects.toThrow();

    const depois = await comTenant(tenantA, (cliente) => carregarUsuario(cliente, tenantA, id));

    expect(depois?.estado).toBe(antes?.estado);
    expect(depois?.papeis).toEqual(antes?.papeis);
    expect(depois?.versao).toBe(antes?.versao);
  });
});

describe('carregar para alterar', () => {
  it('quem carrega o usuário travado faz a segunda operação esperar e ver o que a primeira gravou', async () => {
    // Sem a trava, dois "suspender" simultâneos passam pela mesma validação e gravam dois eventos.
    const id = await novoUsuario(tenantA, 'trava-linha', ['auxiliar']);
    const clienteUm = await poolApp.connect();
    const clienteDois = await poolApp.connect();

    try {
      await clienteUm.query('begin');
      await aplicarContextoDeTeste(clienteUm, tenantA, adminA, 'ADMIN_ACESSO');
      await carregarUsuario(clienteUm, tenantA, id, { travar: true });

      await clienteDois.query('begin');
      await aplicarContextoDeTeste(clienteDois, tenantA, adminA, 'ADMIN_ACESSO');

      let estadoVisto: string | undefined;
      const segunda = carregarUsuario(clienteDois, tenantA, id, { travar: true }).then((usuario) => {
        estadoVisto = usuario?.estado;

        return usuario;
      });

      await new Promise((resolver) => setTimeout(resolver, 300));
      expect(estadoVisto).toBeUndefined();

      await atualizarEstado(clienteUm, tenantA, id, 'SUSPENSO');
      await clienteUm.query('commit');
      await segunda;

      expect(estadoVisto).toBe('SUSPENSO');
      await clienteDois.query('rollback');
    } finally {
      clienteUm.release();
      clienteDois.release();
    }
  });
});

describe('listagem de usuários', () => {
  it('pagina, filtra por estado, papel e busca, e conta o total do tenant', async () => {
    const todos = await comTenant(tenantA, (cliente) =>
      listarUsuarios(cliente, tenantA, { limite: 100, deslocamento: 0 }),
    );
    const ativos = await comTenant(tenantA, (cliente) =>
      listarUsuarios(cliente, tenantA, { estado: 'ATIVO', limite: 100, deslocamento: 0 }),
    );
    const admins = await comTenant(tenantA, (cliente) =>
      listarUsuarios(cliente, tenantA, {
        papel: 'admin_escritorio',
        limite: 100,
        deslocamento: 0,
      }),
    );
    const busca = await comTenant(tenantA, (cliente) =>
      listarUsuarios(cliente, tenantA, { busca: 'ADMIN-A2', limite: 100, deslocamento: 0 }),
    );
    const pagina = await comTenant(tenantA, (cliente) =>
      listarUsuarios(cliente, tenantA, { limite: 1, deslocamento: 0 }),
    );

    expect(todos.total).toBeGreaterThan(ativos.total);
    expect(ativos.usuarios.every((usuario) => usuario.estado === 'ATIVO')).toBe(true);
    expect(admins.usuarios.map((usuario) => usuario.id).sort()).toEqual([adminA, adminA2].sort());
    expect(busca.usuarios.map((usuario) => usuario.id)).toEqual([adminA2]);
    expect(pagina.usuarios).toHaveLength(1);
    expect(pagina.total).toBe(todos.total);
    expect(todos.usuarios.every((usuario) => usuario.papeis !== undefined)).toBe(true);
  });

  it('atualizarDados altera nome, telefone e CRC e incrementa a versão', async () => {
    const id = await novoUsuario(tenantA, 'dados', ['auxiliar']);
    const antes = await comTenant(tenantA, (cliente) => carregarUsuario(cliente, tenantA, id));

    await comTenant(tenantA, (cliente) =>
      atualizarDados(cliente, tenantA, id, {
        nome: 'Nome Novo',
        telefone: '11987654321',
        crc: 'SP-123456/O',
      }),
    );

    const depois = await comTenant(tenantA, (cliente) => carregarUsuario(cliente, tenantA, id));

    expect(depois?.nome).toBe('Nome Novo');
    expect(depois?.telefone).toBe('11987654321');
    expect(depois?.crc).toBe('SP-123456/O');
    expect(depois?.versao).toBe((antes?.versao ?? 0) + 1);
  });
});

describe('histórico de usuários e acessos', () => {
  it('é append-only: UPDATE e DELETE são recusados até para o dono da tabela', async () => {
    await comTenant(tenantA, (cliente) =>
      registrarEventoDeUsuario(cliente, tenantA, {
        tipo: 'SUSPENSO',
        usuarioAfetadoId: adminA2,
        autorId: adminA,
        antes: { estado: 'ATIVO' },
        depois: { estado: 'SUSPENSO' },
      }),
    );

    await expect(
      poolAdmin.query(`update app.usuario_evento set tipo = 'REATIVADO' where tenant_id = $1`, [
        tenantA,
      ]),
    ).rejects.toThrow();
    await expect(
      poolAdmin.query('delete from app.usuario_evento where tenant_id = $1', [tenantA]),
    ).rejects.toThrow();
  });

  it('lista por sequência decrescente e filtra por afetado, autor, tipo e período', async () => {
    const alvo = await novoUsuario(tenantA, 'historico', ['auxiliar']);

    await comTenant(tenantA, async (cliente) => {
      await registrarEventoDeUsuario(cliente, tenantA, {
        tipo: 'CONVITE_CRIADO',
        usuarioAfetadoId: alvo,
        autorId: adminA,
        antes: null,
        depois: { estado: 'CONVIDADO' },
      });
      await registrarEventoDeUsuario(cliente, tenantA, {
        tipo: 'SUSPENSO',
        usuarioAfetadoId: alvo,
        autorId: adminA2,
        antes: { estado: 'ATIVO' },
        depois: { estado: 'SUSPENSO' },
      });
    });

    const doAlvo = await comTenant(tenantA, (cliente) =>
      listarEventosDeUsuario(cliente, tenantA, {
        usuarioAfetadoId: alvo,
        limite: 50,
        deslocamento: 0,
      }),
    );
    const porAutor = await comTenant(tenantA, (cliente) =>
      listarEventosDeUsuario(cliente, tenantA, {
        usuarioAfetadoId: alvo,
        autorId: adminA2,
        limite: 50,
        deslocamento: 0,
      }),
    );
    const porTipo = await comTenant(tenantA, (cliente) =>
      listarEventosDeUsuario(cliente, tenantA, {
        usuarioAfetadoId: alvo,
        tipo: 'CONVITE_CRIADO',
        limite: 50,
        deslocamento: 0,
      }),
    );
    const futuro = await comTenant(tenantA, (cliente) =>
      listarEventosDeUsuario(cliente, tenantA, {
        usuarioAfetadoId: alvo,
        de: new Date(Date.now() + 86_400_000),
        limite: 50,
        deslocamento: 0,
      }),
    );

    expect(doAlvo.eventos.map((evento) => evento.tipo)).toEqual(['SUSPENSO', 'CONVITE_CRIADO']);
    expect(doAlvo.total).toBe(2);
    expect(porAutor.eventos.map((evento) => evento.tipo)).toEqual(['SUSPENSO']);
    expect(porTipo.eventos).toHaveLength(1);
    expect(futuro.eventos).toHaveLength(0);
    expect(doAlvo.eventos[0]?.antes).toEqual({ estado: 'ATIVO' });
    expect(doAlvo.eventos[0]?.depois).toEqual({ estado: 'SUSPENSO' });
  });

  it('o histórico do tenant B não aparece para o tenant A', async () => {
    const doOutro = await comTenant(tenantA, (cliente) =>
      listarEventosDeUsuario(cliente, tenantA, {
        usuarioAfetadoId: adminB,
        limite: 50,
        deslocamento: 0,
      }),
    );

    expect(doOutro.eventos).toHaveLength(0);
  });
});
