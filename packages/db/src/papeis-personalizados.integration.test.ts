/**
 * Papéis personalizados, revisões da matriz e vínculos (SPEC-008).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 * O que estas provas defendem, em ordem de gravidade: um tenant não lê nem
 * escreve papel, revisão, vínculo ou evento do outro; a revisão é monotônica,
 * integral e imutável; a permissão efetiva sai da revisão vigente e só de papel
 * ativo; atribuir e arquivar um papel se serializam; e papel e auditoria
 * confirmam ou desfazem juntos.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import { semContexto } from './contexto.js';
import {
  carregarPapel,
  carregarPapeisParaAtribuir,
  contarVinculosDoPapel,
  criarPapel,
  gravarNovaRevisao,
  listarPapeis,
  listarUsuariosVinculados,
  papelComNome,
  substituirPapeisPersonalizados,
} from './repositorios/papeis-personalizados.js';
import { resolverIdentidade } from './repositorios/identidade.js';
import {
  atualizarEstado,
  carregarUsuario,
  criarUsuario,
  listarEventosDeUsuario,
  registrarEventoDeUsuario,
  substituirPapeis,
} from './repositorios/usuarios.js';
import { aplicarContextoDeTeste, comoUsuario } from './testes/suporte.js';

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
// Operadores de bootstrap: o primeiro usuário de cada escritório não tem quem o crie pela API.
let operadorA = '';
let operadorB = '';
let adminA = '';
let adminB = '';

const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const RAZOES = [`Escritório Papéis A ${SUFIXO}`, `Escritório Papéis B ${SUFIXO}`];
const email = (nome: string): string => `${nome}.${SUFIXO}@papeis.local`;
const subDe = (nome: string): string => `sub-papeis-${nome}-${SUFIXO}`;

const comTenant = <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => comoUsuario(poolApp, tenantId, (tenantId === tenantA ? adminA : adminB) || (tenantId === tenantA ? operadorA : operadorB), executar, 'ADMIN_ACESSO');

const novoUsuario = async (
  tenantId: string,
  nome: string,
  estado: 'CONVIDADO' | 'ATIVO' | 'SUSPENSO' | 'ARQUIVADO' = 'ATIVO',
): Promise<string> =>
  comTenant(tenantId, async (cliente) => {
    const id = await criarUsuario(cliente, tenantId, {
      subOidc: subDe(nome),
      email: email(nome),
      nome: `Usuário ${nome}`,
      telefone: null,
      crc: null,
    });

    await substituirPapeis(cliente, tenantId, id, ['auxiliar']);

    if (estado !== 'CONVIDADO') {
      await atualizarEstado(cliente, tenantId, id, estado);
    }

    return id;
  });

const novoPapel = (
  tenantId: string,
  nome: string,
  permissoes: readonly string[] = ['empresas.cadastro.consultar'],
): Promise<string> =>
  comTenant(tenantId, (cliente) =>
    criarPapel(cliente, tenantId, {
      nome,
      descricao: null,
      papelBase: 'auxiliar',
      permissoes,
      autorId: tenantId === tenantA ? adminA : adminB,
    }),
  );

const vincular = (tenantId: string, usuarioId: string, papelIds: readonly string[]): Promise<void> =>
  comTenant(tenantId, (cliente) =>
    substituirPapeisPersonalizados(cliente, tenantId, usuarioId, papelIds),
  );

const permissoesDe = async (sub: string): Promise<readonly string[] | null> => {
  const identidade = await semContexto(poolApp, (cliente) => resolverIdentidade(cliente, sub));

  return identidade === null ? null : identidade.permissoesPersonalizadas;
};

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    'select id from app.tenant where razao_social = any($1)',
    [RAZOES],
  );
  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // As triggers append-only recusam DELETE até para o dono da tabela: limpar
  // fixture é a única exceção legítima e as desliga de forma explícita.
  await poolAdmin.query('alter table app.usuario_evento disable trigger usuario_evento_append_only');
  await poolAdmin.query(
    'alter table app.papel_personalizado_revisao disable trigger papel_personalizado_revisao_append_only',
  );

  try {
    await poolAdmin.query('delete from app.usuario_evento where tenant_id = any($1)', [ids]);
    await poolAdmin.query('delete from app.papel_personalizado_revisao where tenant_id = any($1)', [ids]);
  } finally {
    await poolAdmin.query('alter table app.usuario_evento enable trigger usuario_evento_append_only');
    await poolAdmin.query(
      'alter table app.papel_personalizado_revisao enable trigger papel_personalizado_revisao_append_only',
    );
  }

  await poolAdmin.query('delete from app.usuario_papel_personalizado where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.papel_personalizado where tenant_id = any($1)', [ids]);
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
    [`93${SUFIXO}000193`, `94${SUFIXO}000194`, RAZOES[0], RAZOES[1]],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 10 });

  const operadores = await poolAdmin.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $3, $5, 'Operador A', 'ATIVO'), ($2, $4, $6, 'Operador B', 'ATIVO')
     returning id`,
    [
      tenantA,
      tenantB,
      `sub-operador-pp-a-${SUFIXO}`,
      `sub-operador-pp-b-${SUFIXO}`,
      `operador-pp-a-${SUFIXO}@local`,
      `operador-pp-b-${SUFIXO}@local`,
    ],
  );

  operadorA = operadores.rows[0]?.id ?? '';
  operadorB = operadores.rows[1]?.id ?? '';

  adminA = await novoUsuario(tenantA, 'admin-a');
  adminB = await novoUsuario(tenantB, 'admin-b');
});

afterAll(async () => {
  await limpar();
  await poolApp.end();
  await poolAdmin.end();
});

describe('isolamento por tenant (RLS)', () => {
  it('um tenant não lê papel, revisão nem vínculo do outro', async () => {
    const papelB = await novoPapel(tenantB, `Isolado ${SUFIXO}`);

    await vincular(tenantB, adminB, [papelB]);

    await comTenant(tenantA, async (cliente) => {
      for (const tabela of [
        'papel_personalizado',
        'papel_personalizado_revisao',
        'usuario_papel_personalizado',
      ]) {
        const { rows } = await cliente.query<{ tenant_id: string }>(
          `select tenant_id from app.${tabela}`,
        );

        expect(rows.every((linha) => linha.tenant_id === tenantA)).toBe(true);
      }

      expect(await carregarPapel(cliente, tenantA, papelB)).toBeNull();
      expect(await listarUsuariosVinculados(cliente, tenantA, papelB)).toEqual([]);
      expect(await contarVinculosDoPapel(cliente, tenantA, papelB)).toBe(0);
    });
  });

  it('sem contexto de tenant nada é devolvido', async () => {
    await comTenant(null, async (cliente) => {
      for (const tabela of [
        'papel_personalizado',
        'papel_personalizado_revisao',
        'usuario_papel_personalizado',
      ]) {
        const { rows } = await cliente.query(`select 1 from app.${tabela}`);

        expect(rows).toHaveLength(0);
      }
    });
  });

  it('tenant A não escreve linha com tenant_id do tenant B', async () => {
    const papelB = await novoPapel(tenantB, `Escrita ${SUFIXO}`);

    const tentativas: Array<[string, string, unknown[]]> = [
      [
        'papel_personalizado',
        `insert into app.papel_personalizado (tenant_id, nome, papel_base)
         values ($1, 'Invasor', 'auxiliar')`,
        [tenantB],
      ],
      [
        'papel_personalizado_revisao',
        `insert into app.papel_personalizado_revisao (tenant_id, papel_id, revisao, permissoes)
         values ($1, $2, 99, array['empresas.cadastro.consultar'])`,
        [tenantB, papelB],
      ],
      [
        'usuario_papel_personalizado',
        `insert into app.usuario_papel_personalizado (tenant_id, usuario_id, papel_id)
         values ($1, $2, $3)`,
        [tenantB, adminB, papelB],
      ],
    ];

    for (const [tabela, sql, parametros] of tentativas) {
      await expect(
        comTenant(tenantA, (cliente) => cliente.query(sql, parametros)),
        tabela,
      ).rejects.toThrow(/row-level security|violates/i);
    }
  });

  it('vínculo não cruza tenant nem com papel de outro escritório', async () => {
    const papelB = await novoPapel(tenantB, `Cruzado ${SUFIXO}`);

    await expect(vincular(tenantA, adminA, [papelB])).rejects.toThrow(/foreign key|violates/i);
  });
});

describe('criação e nome único', () => {
  it('nasce ATIVO na revisão 1 com a matriz integral', async () => {
    const permissoes = ['empresas.cadastro.consultar', 'empresas.cadastro.criar'];
    const id = await novoPapel(tenantA, `Criacao ${SUFIXO}`, permissoes);

    const papel = await comTenant(tenantA, (cliente) => carregarPapel(cliente, tenantA, id));

    expect(papel).toMatchObject({
      nome: `Criacao ${SUFIXO}`,
      estado: 'ATIVO',
      revisao: 1,
      papelBase: 'auxiliar',
      permissoes,
    });
  });

  it('o nome é único no tenant sem diferenciar caixa nem espaços repetidos', async () => {
    await novoPapel(tenantA, `Revisor Fiscal ${SUFIXO}`);

    await expect(novoPapel(tenantA, `  REVISOR   fiscal ${SUFIXO} `)).rejects.toMatchObject({
      code: '23505',
      constraint: 'papel_personalizado_nome_unico',
    });
  });

  it('o mesmo nome pode existir em outro escritório', async () => {
    await novoPapel(tenantA, `Compartilhado ${SUFIXO}`);

    await expect(novoPapel(tenantB, `Compartilhado ${SUFIXO}`)).resolves.toBeTruthy();
  });

  it('papelComNome acha o papel pela mesma chave normalizada', async () => {
    const id = await novoPapel(tenantA, `Buscavel ${SUFIXO}`);

    const achado = await comTenant(tenantA, (cliente) =>
      papelComNome(cliente, tenantA, `  BUSCAVEL   ${SUFIXO}`),
    );

    expect(achado).toBe(id);
  });

  it('matriz vazia não cria papel', async () => {
    await expect(novoPapel(tenantA, `Vazio ${SUFIXO}`, [])).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('papel criado sem revisão não existe: papel e revisão confirmam juntos', async () => {
    const nome = `Atomico ${SUFIXO}`;

    await expect(
      comTenant(tenantA, async (cliente) => {
        await criarPapel(cliente, tenantA, {
          nome,
          descricao: null,
          papelBase: 'contador',
          permissoes: ['empresas.cadastro.consultar'],
          autorId: adminA,
        });

        throw new Error('falha depois de criar');
      }),
    ).rejects.toThrow('falha depois de criar');

    expect(await comTenant(tenantA, (cliente) => papelComNome(cliente, tenantA, nome))).toBeNull();
  });
});

describe('revisão monotônica e imutável', () => {
  it('cada mudança abre a revisão seguinte com o snapshot integral', async () => {
    const id = await novoPapel(tenantA, `Revisoes ${SUFIXO}`, ['empresas.cadastro.consultar']);

    const segunda = await comTenant(tenantA, (cliente) =>
      gravarNovaRevisao(cliente, tenantA, id, {
        nome: `Revisoes ${SUFIXO}`,
        descricao: 'agora com descrição',
        estado: 'ATIVO',
        permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar'],
        autorId: adminA,
      }),
    );

    const terceira = await comTenant(tenantA, (cliente) =>
      gravarNovaRevisao(cliente, tenantA, id, {
        nome: `Revisoes ${SUFIXO}`,
        descricao: 'agora com descrição',
        estado: 'ATIVO',
        permissoes: ['historico.global.consultar'],
        autorId: adminA,
      }),
    );

    expect([segunda, terceira]).toEqual([2, 3]);

    const papel = await comTenant(tenantA, (cliente) => carregarPapel(cliente, tenantA, id));

    expect(papel).toMatchObject({ revisao: 3, permissoes: ['historico.global.consultar'] });

    const { rows } = await poolAdmin.query<{ revisao: number; permissoes: string[] }>(
      'select revisao, permissoes from app.papel_personalizado_revisao where papel_id = $1 order by revisao',
      [id],
    );

    expect(rows).toEqual([
      { revisao: 1, permissoes: ['empresas.cadastro.consultar'] },
      { revisao: 2, permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar'] },
      { revisao: 3, permissoes: ['historico.global.consultar'] },
    ]);
  });

  it('a revisão é append-only: a aplicação não atualiza nem apaga', async () => {
    const id = await novoPapel(tenantA, `Imutavel ${SUFIXO}`);

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `update app.papel_personalizado_revisao set permissoes = array['historico.global.consultar']
            where papel_id = $1`,
          [id],
        ),
      ),
    ).rejects.toThrow(/permission denied|append-only|somente/i);

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query('delete from app.papel_personalizado_revisao where papel_id = $1', [id]),
      ),
    ).rejects.toThrow(/permission denied|append-only|somente/i);
  });

  it('nem o dono da tabela altera a revisão: a trigger recusa', async () => {
    const id = await novoPapel(tenantA, `Trigger ${SUFIXO}`);

    await expect(
      poolAdmin.query(
        `update app.papel_personalizado_revisao set permissoes = array['historico.global.consultar']
          where papel_id = $1`,
        [id],
      ),
    ).rejects.toThrow();
  });

  it('papel não é apagado pela aplicação', async () => {
    const id = await novoPapel(tenantA, `Sem delete ${SUFIXO}`);

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query('delete from app.papel_personalizado where id = $1', [id]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('a mudança e a nova revisão confirmam juntas: falha depois desfaz as duas', async () => {
    const id = await novoPapel(tenantA, `Rollback ${SUFIXO}`, ['empresas.cadastro.consultar']);

    await expect(
      comTenant(tenantA, async (cliente) => {
        await gravarNovaRevisao(cliente, tenantA, id, {
          nome: `Rollback ${SUFIXO}`,
          descricao: null,
          estado: 'ARQUIVADO',
          permissoes: ['empresas.cadastro.consultar'],
          autorId: adminA,
        });

        throw new Error('auditoria falhou');
      }),
    ).rejects.toThrow('auditoria falhou');

    const papel = await comTenant(tenantA, (cliente) => carregarPapel(cliente, tenantA, id));

    expect(papel).toMatchObject({ estado: 'ATIVO', revisao: 1 });
  });

  it('renomear mantém a unicidade: nome de outro papel é recusado', async () => {
    await novoPapel(tenantA, `Ocupado ${SUFIXO}`);
    const id = await novoPapel(tenantA, `Livre ${SUFIXO}`);

    await expect(
      comTenant(tenantA, (cliente) =>
        gravarNovaRevisao(cliente, tenantA, id, {
          nome: `OCUPADO ${SUFIXO}`,
          descricao: null,
          estado: 'ATIVO',
          permissoes: ['empresas.cadastro.consultar'],
          autorId: adminA,
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('vínculos com usuários', () => {
  it('substituir é idempotente, remove sem apagar e não restaura vínculo antigo', async () => {
    const papel = await novoPapel(tenantA, `Vinculo ${SUFIXO}`);
    const outro = await novoPapel(tenantA, `Vinculo outro ${SUFIXO}`);
    const usuario = await novoUsuario(tenantA, 'vinculado');

    await vincular(tenantA, usuario, [papel]);
    await vincular(tenantA, usuario, [papel]);

    expect(await comTenant(tenantA, (c) => contarVinculosDoPapel(c, tenantA, papel))).toBe(1);

    await vincular(tenantA, usuario, [outro]);

    expect(await comTenant(tenantA, (c) => contarVinculosDoPapel(c, tenantA, papel))).toBe(0);
    expect(await comTenant(tenantA, (c) => contarVinculosDoPapel(c, tenantA, outro))).toBe(1);

    // O histórico do vínculo removido permanece: removido_em preenchido, linha intacta.
    const { rows } = await poolAdmin.query(
      'select removido_em from app.usuario_papel_personalizado where usuario_id = $1 and papel_id = $2',
      [usuario, papel],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.removido_em).not.toBeNull();

    await vincular(tenantA, usuario, [papel, outro]);

    const novos = await poolAdmin.query(
      'select 1 from app.usuario_papel_personalizado where usuario_id = $1 and papel_id = $2',
      [usuario, papel],
    );

    // Reatribuir cria vínculo novo; o antigo continua removido.
    expect(novos.rowCount).toBe(2);
  });

  it('o usuário carregado traz os papéis personalizados vigentes', async () => {
    const papel = await novoPapel(tenantA, `No usuario ${SUFIXO}`);
    const usuario = await novoUsuario(tenantA, 'com-papel');

    await vincular(tenantA, usuario, [papel]);

    const carregado = await comTenant(tenantA, (c) => carregarUsuario(c, tenantA, usuario));

    expect(carregado?.papeisPersonalizados).toEqual([
      { id: papel, nome: `No usuario ${SUFIXO}`, estado: 'ATIVO' },
    ]);
  });

  it('usuário arquivado não segura o papel e não entra na contagem de vinculados', async () => {
    const papel = await novoPapel(tenantA, `Contagem ${SUFIXO}`);
    const ativo = await novoUsuario(tenantA, 'conta-ativo');
    const suspenso = await novoUsuario(tenantA, 'conta-suspenso', 'SUSPENSO');
    const arquivado = await novoUsuario(tenantA, 'conta-arquivado', 'ARQUIVADO');

    await vincular(tenantA, ativo, [papel]);
    await vincular(tenantA, suspenso, [papel]);
    await vincular(tenantA, arquivado, [papel]);

    expect(await comTenant(tenantA, (c) => contarVinculosDoPapel(c, tenantA, papel))).toBe(2);

    const vinculados = await comTenant(tenantA, (c) => listarUsuariosVinculados(c, tenantA, papel));

    expect(vinculados.map((u) => u.id).sort()).toEqual([ativo, suspenso].sort());
  });

  it('atribuir e arquivar se serializam: quem chega depois enxerga o estado já gravado', async () => {
    const papel = await novoPapel(tenantA, `Corrida ${SUFIXO}`);

    const arquivando = await poolApp.connect();
    const atribuindo = await poolApp.connect();

    try {
      await arquivando.query('begin');
      await aplicarContextoDeTeste(arquivando, tenantA, adminA, 'ADMIN_ACESSO');
      await carregarPapel(arquivando, tenantA, papel, { travar: true });

      await atribuindo.query('begin');
      await aplicarContextoDeTeste(atribuindo, tenantA, adminA, 'ADMIN_ACESSO');

      // A atribuição espera o arquivamento terminar: nunca decide sobre estado antigo.
      const pendente = carregarPapeisParaAtribuir(atribuindo, tenantA, [papel]);
      const espera = await Promise.race([
        pendente.then(() => 'concluiu'),
        new Promise<string>((resolve) => setTimeout(() => resolve('esperando'), 400)),
      ]);

      expect(espera).toBe('esperando');

      await gravarNovaRevisao(arquivando, tenantA, papel, {
        nome: `Corrida ${SUFIXO}`,
        descricao: null,
        estado: 'ARQUIVADO',
        permissoes: ['empresas.cadastro.consultar'],
        autorId: adminA,
      });
      await arquivando.query('commit');

      const vistos = await pendente;

      expect(vistos).toEqual([{ id: papel, nome: `Corrida ${SUFIXO}`, estado: 'ARQUIVADO' }]);

      await atribuindo.query('commit');
    } finally {
      arquivando.release();
      atribuindo.release();
    }
  });
});

describe('edição concorrente do mesmo papel', () => {
  it('quem espera a trava enxerga a revisão nova, não um papel que "sumiu"', async () => {
    const papel = await novoPapel(tenantA, `Duas edicoes ${SUFIXO}`);

    const primeira = await poolApp.connect();
    const segunda = await poolApp.connect();

    try {
      await primeira.query('begin');
      await aplicarContextoDeTeste(primeira, tenantA, adminA, 'ADMIN_ACESSO');
      await carregarPapel(primeira, tenantA, papel, { travar: true });

      await segunda.query('begin');
      await aplicarContextoDeTeste(segunda, tenantA, adminA, 'ADMIN_ACESSO');

      const esperando = carregarPapel(segunda, tenantA, papel, { travar: true });
      const antesDoCommit = await Promise.race([
        esperando.then(() => 'concluiu'),
        new Promise<string>((resolve) => setTimeout(() => resolve('esperando'), 400)),
      ]);

      expect(antesDoCommit).toBe('esperando');

      await gravarNovaRevisao(primeira, tenantA, papel, {
        nome: `Duas edicoes ${SUFIXO}`,
        descricao: 'primeira edição',
        estado: 'ATIVO',
        permissoes: ['historico.global.consultar'],
        autorId: adminA,
      });
      await primeira.query('commit');

      const vista = await esperando;

      // A segunda decide sobre a revisão 2 (e responde 409 se esperava a 1), nunca sobre "papel inexistente".
      expect(vista).toMatchObject({ revisao: 2, descricao: 'primeira edição' });

      await segunda.query('commit');
    } finally {
      primeira.release();
      segunda.release();
    }
  });

  it('papel inexistente ou de outro tenant continua devolvendo null ao travar', async () => {
    const alheio = await novoPapel(tenantB, `Alheio travado ${SUFIXO}`);

    expect(
      await comTenant(tenantA, (cliente) => carregarPapel(cliente, tenantA, alheio, { travar: true })),
    ).toBeNull();
    expect(
      await comTenant(tenantA, (cliente) =>
        carregarPapel(cliente, tenantA, '00000000-0000-7000-8000-000000000000', { travar: true }),
      ),
    ).toBeNull();
  });
});

describe('listagem', () => {
  it('filtra por nome e estado, conta vinculados e pagina', async () => {
    const ativo = await novoPapel(tenantB, `Lista ativo ${SUFIXO}`);
    const arquivado = await novoPapel(tenantB, `Lista arquivado ${SUFIXO}`);

    await comTenant(tenantB, (cliente) =>
      gravarNovaRevisao(cliente, tenantB, arquivado, {
        nome: `Lista arquivado ${SUFIXO}`,
        descricao: null,
        estado: 'ARQUIVADO',
        permissoes: ['empresas.cadastro.consultar'],
        autorId: adminB,
      }),
    );
    await vincular(tenantB, adminB, [ativo]);

    const ativos = await comTenant(tenantB, (c) =>
      listarPapeis(c, tenantB, { busca: `lista ${SUFIXO}`.slice(0, 5), estado: 'ATIVO', limite: 50, deslocamento: 0 }),
    );
    const doAtivo = ativos.papeis.find((papel) => papel.id === ativo);

    expect(doAtivo).toMatchObject({ usuariosVinculados: 1, estado: 'ATIVO' });
    expect(ativos.papeis.some((papel) => papel.id === arquivado)).toBe(false);

    const arquivados = await comTenant(tenantB, (c) =>
      listarPapeis(c, tenantB, { estado: 'ARQUIVADO', limite: 50, deslocamento: 0 }),
    );

    expect(arquivados.papeis.some((papel) => papel.id === arquivado)).toBe(true);

    const pagina = await comTenant(tenantB, (c) =>
      listarPapeis(c, tenantB, { limite: 1, deslocamento: 0 }),
    );

    expect(pagina.papeis).toHaveLength(1);
    expect(pagina.total).toBeGreaterThan(1);
  });

  it('o curinga do LIKE na busca não vira filtro', async () => {
    const pagina = await comTenant(tenantB, (c) =>
      listarPapeis(c, tenantB, { busca: '%', limite: 50, deslocamento: 0 }),
    );

    expect(pagina.papeis).toHaveLength(0);
  });
});

describe('permissão efetiva na resolução da identidade', () => {
  it('une as matrizes dos papéis personalizados ativos na revisão vigente', async () => {
    const a = await novoPapel(tenantA, `Efetiva A ${SUFIXO}`, ['empresas.cadastro.consultar']);
    const b = await novoPapel(tenantA, `Efetiva B ${SUFIXO}`, [
      'empresas.cadastro.consultar',
      'historico.global.consultar',
    ]);
    const usuario = await novoUsuario(tenantA, 'efetiva');

    await vincular(tenantA, usuario, [a, b]);

    expect(await permissoesDe(subDe('efetiva'))).toEqual([
      'empresas.cadastro.consultar',
      'historico.global.consultar',
    ]);
  });

  it('a nova revisão vale na próxima resolução, sem cache', async () => {
    const papel = await novoPapel(tenantA, `Proxima ${SUFIXO}`, ['empresas.cadastro.consultar']);
    const usuario = await novoUsuario(tenantA, 'proxima');

    await vincular(tenantA, usuario, [papel]);

    expect(await permissoesDe(subDe('proxima'))).toEqual(['empresas.cadastro.consultar']);

    await comTenant(tenantA, (cliente) =>
      gravarNovaRevisao(cliente, tenantA, papel, {
        nome: `Proxima ${SUFIXO}`,
        descricao: null,
        estado: 'ATIVO',
        permissoes: ['historico.global.consultar'],
        autorId: adminA,
      }),
    );

    expect(await permissoesDe(subDe('proxima'))).toEqual(['historico.global.consultar']);
  });

  it('papel arquivado não concede nada', async () => {
    const papel = await novoPapel(tenantA, `Arquivada ${SUFIXO}`, ['historico.global.consultar']);
    const usuario = await novoUsuario(tenantA, 'arquivada');

    await vincular(tenantA, usuario, [papel]);
    await comTenant(tenantA, (cliente) =>
      gravarNovaRevisao(cliente, tenantA, papel, {
        nome: `Arquivada ${SUFIXO}`,
        descricao: null,
        estado: 'ARQUIVADO',
        permissoes: ['historico.global.consultar'],
        autorId: adminA,
      }),
    );

    expect(await permissoesDe(subDe('arquivada'))).toEqual([]);
  });

  it('vínculo removido deixa de conceder; usuário suspenso nem resolve', async () => {
    const papel = await novoPapel(tenantA, `Removida ${SUFIXO}`, ['historico.global.consultar']);
    const usuario = await novoUsuario(tenantA, 'removida');

    await vincular(tenantA, usuario, [papel]);
    await vincular(tenantA, usuario, []);

    expect(await permissoesDe(subDe('removida'))).toEqual([]);

    await vincular(tenantA, usuario, [papel]);
    await comTenant(tenantA, (cliente) => atualizarEstado(cliente, tenantA, usuario, 'SUSPENSO'));

    expect(await permissoesDe(subDe('removida'))).toBeNull();
  });

  it('papel de outro escritório nunca vaza para a identidade', async () => {
    const usuario = await novoUsuario(tenantA, 'sem-vazamento');

    await novoPapel(tenantB, `Alheio ${SUFIXO}`, ['historico.global.consultar']);

    expect(usuario).toBeTruthy();
    expect(await permissoesDe(subDe('sem-vazamento'))).toEqual([]);
  });
});

describe('auditoria do papel', () => {
  it('evento de papel nomeia o papel e a revisão e lista o nome do papel', async () => {
    const papel = await novoPapel(tenantA, `Auditado ${SUFIXO}`);

    await comTenant(tenantA, (cliente) =>
      registrarEventoDeUsuario(cliente, tenantA, {
        tipo: 'PAPEL_CRIADO',
        usuarioAfetadoId: null,
        papelId: papel,
        revisao: 1,
        autorId: adminA,
        antes: null,
        depois: { origem: 'auxiliar', permissoes: ['empresas.cadastro.consultar'] },
      }),
    );

    const pagina = await comTenant(tenantA, (c) =>
      listarEventosDeUsuario(c, tenantA, { limite: 50, deslocamento: 0 }),
    );

    expect(pagina.eventos.find((evento) => evento.papelId === papel)).toMatchObject({
      tipo: 'PAPEL_CRIADO',
      papelNome: `Auditado ${SUFIXO}`,
      revisao: 1,
      usuarioAfetadoId: null,
      autorNome: 'Usuário admin-a',
    });
  });

  it('evento de papel sem papel, ou com usuário afetado, é recusado pelo banco', async () => {
    const papel = await novoPapel(tenantA, `Constraint ${SUFIXO}`);

    await expect(
      comTenant(tenantA, (cliente) =>
        registrarEventoDeUsuario(cliente, tenantA, {
          tipo: 'PAPEL_ARQUIVADO',
          usuarioAfetadoId: adminA,
          papelId: papel,
          revisao: 2,
          autorId: adminA,
          antes: null,
          depois: null,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      comTenant(tenantA, (cliente) =>
        registrarEventoDeUsuario(cliente, tenantA, {
          tipo: 'SUSPENSO',
          usuarioAfetadoId: adminA,
          papelId: papel,
          revisao: 2,
          autorId: adminA,
          antes: null,
          depois: null,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      comTenant(tenantA, (cliente) =>
        registrarEventoDeUsuario(cliente, tenantA, {
          tipo: 'PAPEL_ARQUIVADO',
          usuarioAfetadoId: null,
          autorId: adminA,
          antes: null,
          depois: null,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('papel e evento confirmam juntos: se a auditoria falha, a revisão desfaz', async () => {
    const papel = await novoPapel(tenantA, `Atomica ${SUFIXO}`);

    await expect(
      comTenant(tenantA, async (cliente) => {
        await gravarNovaRevisao(cliente, tenantA, papel, {
          nome: `Atomica ${SUFIXO}`,
          descricao: null,
          estado: 'ARQUIVADO',
          permissoes: ['empresas.cadastro.consultar'],
          autorId: adminA,
        });

        await registrarEventoDeUsuario(cliente, tenantA, {
          tipo: 'PAPEL_ARQUIVADO',
          usuarioAfetadoId: null,
          // Sem `papelId`: a constraint recusa e a transação inteira desfaz.
          autorId: adminA,
          antes: null,
          depois: null,
        });
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const depois = await comTenant(tenantA, (c) => carregarPapel(c, tenantA, papel));

    expect(depois).toMatchObject({ estado: 'ATIVO', revisao: 1 });
  });

  it('o evento de papel é append-only', async () => {
    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(`update app.usuario_evento set revisao = 9 where papel_id is not null`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
