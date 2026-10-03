/**
 * Carteira do colaborador (SPEC-009).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 * O que estas provas defendem, em ordem de gravidade: um tenant não lê nem
 * escreve vínculo, evento ou notificação do outro; o vínculo ativo é único por
 * colaborador e empresa, mas a empresa é compartilhável entre colaboradores;
 * lote, evento e notificações se desfazem juntos; duas operações simultâneas
 * sobre o mesmo colaborador se enfileiram (revisão monotônica); o histórico é
 * append-only; e arquivar nunca restaura vínculo sozinho.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import { comContextoHumano } from './contexto.js';
import {
  aplicarEfeitos,
  autoatribuirEmpresa,
  carregarEmpresasDaOperacao,
  carregarUsuariosDaOperacao,
  criarNotificacoesDeCarteira,
  empresasDaCarteira,
  encerrarVinculosDaEmpresa,
  encerrarVinculosDoUsuario,
  listarColaboradores,
  listarColaboradoresDaEmpresa,
  listarEmpresasParaAtribuicao,
  listarEventosDeCarteira,
  registrarEventoDeCarteira,
  resumoDaEmpresa,
  vinculoAtivo,
} from './repositorios/carteira.js';
import type { AfetadoDoEvento } from './repositorios/carteira.js';
import { listarEmpresas } from './repositorios/empresa.js';
import { listarHistorico, registrarEventos } from './repositorios/manutencao-empresa.js';
import {
  contarNaoLidas,
  criarNotificacoes,
  listarPainel,
  marcarComoLida,
  marcarVariasComoLidas,
} from './repositorios/notificacoes.js';
import { dispensar, listarCentral, reconciliar } from './repositorios/pendencias.js';
import { atualizarEstado, criarUsuario, substituirPapeis } from './repositorios/usuarios.js';
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
let colabA1 = '';
let colabA2 = '';
let colabB = '';
let empresaA1 = '';
let empresaA2 = '';
let empresaA3 = '';
let empresaB = '';

const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const RAZOES = [`Escritório Carteira A ${SUFIXO}`, `Escritório Carteira B ${SUFIXO}`];
const email = (nome: string): string => `${nome}.${SUFIXO}@carteira.local`;

const comTenant = <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => comoUsuario(poolApp, tenantId, (tenantId === tenantA ? adminA : colabB) || (tenantId === tenantA ? operadorA : operadorB), executar, 'ADMIN_ACESSO');

const novoUsuario = (
  tenantId: string,
  nome: string,
  estado: 'CONVIDADO' | 'ATIVO' | 'SUSPENSO' | 'ARQUIVADO' = 'ATIVO',
): Promise<string> =>
  comTenant(tenantId, async (cliente) => {
    const id = await criarUsuario(cliente, tenantId, {
      subOidc: `sub-${nome}-${SUFIXO}`,
      email: email(nome),
      nome: `Colaborador ${nome}`,
      telefone: null,
      crc: null,
    });
    await substituirPapeis(cliente, tenantId, id, ['contador']);
    if (estado !== 'CONVIDADO') {
      await atualizarEstado(cliente, tenantId, id, estado);
    }
    return id;
  });

// A fixture nasce pelo semeador: a criação da empresa na aplicação é da F2, e o que esta suíte
// prova é a carteira. Empresa ativa, sem vínculo algum — quem atribui é o teste.
const novaEmpresa = async (tenantId: string, cnpj: string): Promise<string> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj, status) values ($1, $2, 'ATIVA') returning id`,
    [tenantId, cnpj],
  );

  return rows[0]?.id ?? '';
};

/** Leitura e escrita empresariais só existem na finalidade comum: carteira, nunca a gestão de acesso. */
const comoComum = <T>(
  tenantId: string,
  usuarioId: string,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => comoUsuario(poolApp, tenantId, usuarioId, executar, 'COMUM');

/** Fixture empresarial pelo semeador (papel dono da tabela), fora do caminho da aplicação. */
const comoSemeador = async <T>(executar: (cliente: PoolClient) => Promise<T>): Promise<T> => {
  const cliente = await poolAdmin.connect();

  try {
    return await executar(cliente);
  } finally {
    cliente.release();
  }
};

const resumo = (id: string, nome: string, cnpj = '00000000000000') => ({ id, nome, cnpj });

const afetado = (
  usuarioId: string,
  adicionadas: readonly string[],
  removidas: readonly string[],
  revisaoAnterior: number,
): AfetadoDoEvento => ({
  usuarioId,
  usuarioNome: `Colaborador ${usuarioId.slice(0, 4)}`,
  adicionadas: adicionadas.map((id) => resumo(id, `Empresa ${id.slice(0, 4)}`)),
  removidas: removidas.map((id) => resumo(id, `Empresa ${id.slice(0, 4)}`)),
  revisaoAnterior,
  revisaoNova: revisaoAnterior + 1,
});

const adicionar = (tenantId: string, usuarioId: string, empresas: readonly string[], autor = adminA) =>
  comTenant(tenantId, async (cliente) => {
    const [usuario] = await carregarUsuariosDaOperacao(cliente, tenantId, [usuarioId]);
    await aplicarEfeitos(cliente, tenantId, autor, [
      {
        usuarioId,
        adicionadas: empresas,
        removidas: [],
        revisaoNova: (usuario?.revisao ?? 0) + 1,
      },
    ]);
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

  // As triggers append-only recusam DELETE até para o dono da tabela, e `ALTER TABLE ... DISABLE
  // TRIGGER` valeria para as suítes paralelas que provam justamente essa recusa. Por isso a limpeza
  // usa `session_replication_role = replica` só nesta conexão (o papel do Compose é superusuário):
  // limpar fixture é a única exceção legítima, e ela não enfraquece a trigger para mais ninguém.
  const cliente = await poolAdmin.connect();

  try {
    await cliente.query("set session_replication_role = 'replica'");

    const tabelas = await cliente.query<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'app' and c.column_name = 'tenant_id'
          and t.table_type = 'BASE TABLE' and c.table_name <> 'tenant'`,
    );

    for (const { table_name: tabela } of tabelas.rows) {
      await cliente.query(`delete from app.${tabela} where tenant_id = any($1)`, [ids]);
    }

    await cliente.query('delete from app.tenant where id = any($1)', [ids]);
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }
};

beforeAll(async () => {
  await limpar();

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, $3, 'ATIVO'), ($2, $4, 'ATIVO')
     returning id`,
    [`85${SUFIXO}000185`, `86${SUFIXO}000186`, RAZOES[0], RAZOES[1]],
  );
  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao() });

  const operadores = await poolAdmin.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $3, $5, 'Operador A', 'ATIVO'), ($2, $4, $6, 'Operador B', 'ATIVO')
     returning id`,
    [
      tenantA,
      tenantB,
      `sub-operador-ct-a-${SUFIXO}`,
      `sub-operador-ct-b-${SUFIXO}`,
      `operador-ct-a-${SUFIXO}@local`,
      `operador-ct-b-${SUFIXO}@local`,
    ],
  );

  operadorA = operadores.rows[0]?.id ?? '';
  operadorB = operadores.rows[1]?.id ?? '';

  adminA = await novoUsuario(tenantA, 'adminA');
  colabA1 = await novoUsuario(tenantA, 'colabA1');
  colabA2 = await novoUsuario(tenantA, 'colabA2');
  colabB = await novoUsuario(tenantB, 'colabB');
  await poolAdmin.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`,
    [tenantA, adminA],
  );

  empresaA1 = await novaEmpresa(tenantA, `71${SUFIXO}000171`);
  empresaA2 = await novaEmpresa(tenantA, `72${SUFIXO}000172`);
  empresaA3 = await novaEmpresa(tenantA, `73${SUFIXO}000173`);
  empresaB = await novaEmpresa(tenantB, `74${SUFIXO}000174`);
});

afterAll(async () => {
  await poolApp.end();
  await limpar();
  await poolAdmin.end();
});

describe('vínculo de carteira', () => {
  it('uma empresa pertence a vários colaboradores e um colaborador a várias empresas', async () => {
    await adicionar(tenantA, colabA1, [empresaA1, empresaA2]);
    await adicionar(tenantA, colabA2, [empresaA1]);

    const [c1, c2] = await comTenant(tenantA, async (cliente) => [
      await empresasDaCarteira(cliente, tenantA, colabA1),
      await empresasDaCarteira(cliente, tenantA, colabA2),
    ]);

    expect([...(c1 ?? [])].sort()).toEqual([empresaA1, empresaA2].sort());
    expect(c2).toEqual([empresaA1]);

    const colaboradores = await comTenant(tenantA, (cliente) =>
      listarColaboradoresDaEmpresa(cliente, tenantA, empresaA1),
    );
    expect(colaboradores.map((c) => c.id).sort()).toEqual([colabA1, colabA2].sort());
  });

  it('recusa um segundo vínculo ativo do mesmo par', async () => {
    await expect(adicionar(tenantA, colabA1, [empresaA1])).rejects.toMatchObject({ code: '23505' });
  });

  it('vinculoAtivo responde pelo par, e não pela empresa em si', async () => {
    const [com, sem] = await comTenant(tenantA, async (cliente) => [
      await vinculoAtivo(cliente, tenantA, colabA2, empresaA1),
      await vinculoAtivo(cliente, tenantA, colabA2, empresaA2),
    ]);

    expect(com).toBe(true);
    expect(sem).toBe(false);
  });

  it('remover encerra o vínculo e reatribuir abre um novo, sem restaurar o antigo', async () => {
    await comTenant(tenantA, async (cliente) => {
      const [usuario] = await carregarUsuariosDaOperacao(cliente, tenantA, [colabA2]);
      await aplicarEfeitos(cliente, tenantA, adminA, [
        { usuarioId: colabA2, adicionadas: [], removidas: [empresaA1], revisaoNova: (usuario?.revisao ?? 0) + 1 },
      ]);
    });
    await adicionar(tenantA, colabA2, [empresaA1]);

    const { rows } = await poolAdmin.query<{ ativos: string; encerrados: string }>(
      `select count(*) filter (where encerrado_em is null)::text as ativos,
              count(*) filter (where encerrado_em is not null)::text as encerrados
         from app.carteira_vinculo where usuario_id = $1 and empresa_id = $2`,
      [colabA2, empresaA1],
    );

    expect(rows[0]).toEqual({ ativos: '1', encerrados: '1' });
  });

  it('vínculo encerrado e identidade do vínculo são imutáveis', async () => {
    // Vínculo já encerrado (colabA2 × empresaA1, do teste anterior) não volta a ficar ativo.
    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `update app.carteira_vinculo set encerrado_em = null, encerrado_motivo = null
            where usuario_id = $1 and empresa_id = $2 and encerrado_em is not null`,
          [colabA2, empresaA1],
        ),
      ),
    ).rejects.toMatchObject({ code: '23001' });

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(`update app.carteira_vinculo set empresa_id = $1 where usuario_id = $2`, [
          empresaA3,
          colabA1,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('a aplicação não tem privilégio de DELETE no vínculo', async () => {
    await expect(
      comTenant(tenantA, (cliente) => cliente.query('delete from app.carteira_vinculo')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('revisão da carteira', () => {
  it('sobe uma vez por operação e só quando o conjunto muda', async () => {
    const antes = await comTenant(tenantA, (cliente) =>
      carregarUsuariosDaOperacao(cliente, tenantA, [colabA1]),
    );
    await adicionar(tenantA, colabA1, [empresaA3]);
    const depois = await comTenant(tenantA, (cliente) =>
      carregarUsuariosDaOperacao(cliente, tenantA, [colabA1]),
    );

    expect((depois[0]?.revisao ?? 0) - (antes[0]?.revisao ?? 0)).toBe(1);
    expect(depois[0]?.empresasVinculadas).toContain(empresaA3);
  });

  it('duas operações simultâneas sobre o mesmo colaborador se enfileiram', async () => {
    const primeiro = await poolApp.connect();
    const segundo = await poolApp.connect();

    try {
      await primeiro.query('begin');
      await aplicarContextoDeTeste(primeiro, tenantA, adminA, 'ADMIN_ACESSO');
      await carregarUsuariosDaOperacao(primeiro, tenantA, [colabA2]);

      await segundo.query('begin');
      await aplicarContextoDeTeste(segundo, tenantA, adminA, 'ADMIN_ACESSO');
      await segundo.query("set local lock_timeout = '300ms'");

      // O segundo não consegue travar o mesmo colaborador enquanto o primeiro não termina.
      await expect(carregarUsuariosDaOperacao(segundo, tenantA, [colabA2])).rejects.toMatchObject({
        code: '55P03',
      });
    } finally {
      await primeiro.query('rollback');
      await segundo.query('rollback');
      primeiro.release();
      segundo.release();
    }
  });
});

describe('autoatribuição', () => {
  it('cria o vínculo do criador e sobe a revisão', async () => {
    const empresa = await novaEmpresa(tenantA, `75${SUFIXO}000175`);
    const resultado = await comTenant(tenantA, (cliente) =>
      autoatribuirEmpresa(cliente, tenantA, adminA, empresa),
    );

    expect(resultado.revisaoNova).toBe(resultado.revisaoAnterior + 1);
    expect(
      await comTenant(tenantA, (cliente) => vinculoAtivo(cliente, tenantA, adminA, empresa)),
    ).toBe(true);
  });
});

describe('encerramento por arquivamento', () => {
  it('arquivar a empresa encerra os vínculos de todos os colaboradores e informa quem foi afetado', async () => {
    const empresa = await novaEmpresa(tenantA, `76${SUFIXO}000176`);
    await adicionar(tenantA, colabA1, [empresa]);
    await adicionar(tenantA, colabA2, [empresa]);

    const afetados = await comTenant(tenantA, (cliente) =>
      encerrarVinculosDaEmpresa(cliente, tenantA, empresa, adminA),
    );

    expect(afetados.map((a) => a.usuarioId).sort()).toEqual([colabA1, colabA2].sort());
    expect(afetados.every((a) => a.removidas.some((e) => e.id === empresa))).toBe(true);
    expect(afetados.every((a) => a.revisaoNova === a.revisaoAnterior + 1)).toBe(true);
    expect(
      await comTenant(tenantA, (cliente) => listarColaboradoresDaEmpresa(cliente, tenantA, empresa)),
    ).toEqual([]);
  });

  it('arquivar o usuário encerra os vínculos dele e nenhum vínculo de outro', async () => {
    const usuario = await novoUsuario(tenantA, 'sairá');
    await adicionar(tenantA, usuario, [empresaA1, empresaA2]);

    const afetados = await comTenant(tenantA, (cliente) =>
      encerrarVinculosDoUsuario(cliente, tenantA, usuario, adminA),
    );

    expect(afetados).toHaveLength(1);
    expect(afetados[0]?.removidas.map((e) => e.id).sort()).toEqual([empresaA1, empresaA2].sort());
    expect(
      await comTenant(tenantA, (cliente) => empresasDaCarteira(cliente, tenantA, colabA1)),
    ).toContain(empresaA1);
  });

  it('sem vínculo ativo não há afetado e a revisão não muda', async () => {
    const usuario = await novoUsuario(tenantA, 'vazio');
    const afetados = await comTenant(tenantA, (cliente) =>
      encerrarVinculosDoUsuario(cliente, tenantA, usuario, adminA),
    );
    const [depois] = await comTenant(tenantA, (cliente) =>
      carregarUsuariosDaOperacao(cliente, tenantA, [usuario]),
    );

    expect(afetados).toEqual([]);
    expect(depois?.revisao).toBe(0);
  });
});

describe('evento e notificação', () => {
  it('registra o evento global e uma notificação por colaborador, na mesma transação', async () => {
    const afetados = [
      afetado(colabA1, [empresaA1], [], 0),
      afetado(colabA2, [empresaA1, empresaA2], [], 0),
    ];

    const eventoId = await comTenant(tenantA, async (cliente) => {
      const id = await registrarEventoDeCarteira(cliente, tenantA, {
        origem: 'LOTE',
        autorId: adminA,
        afetados,
      });
      await criarNotificacoesDeCarteira(cliente, tenantA, id, afetados);
      return id;
    });

    const { rows } = await poolAdmin.query<{ total: string }>(
      'select count(*)::text as total from app.carteira_notificacao where evento_id = $1',
      [eventoId],
    );
    expect(rows[0]?.total).toBe('2');
  });

  it('falha na notificação desfaz o evento e o vínculo', async () => {
    const antes = await poolAdmin.query<{ total: string }>(
      'select count(*)::text as total from app.carteira_evento where tenant_id = $1',
      [tenantA],
    );

    await expect(
      comTenant(tenantA, async (cliente) => {
        await adicionar2(cliente, colabA2, empresaA3);
        const dados = [afetado(colabA2, [empresaA3], [], 0)];
        const id = await registrarEventoDeCarteira(cliente, tenantA, {
          origem: 'INDIVIDUAL',
          autorId: adminA,
          afetados: dados,
        });
        // Destinatário de outro tenant: a FK composta recusa e a transação cai.
        await criarNotificacoesDeCarteira(cliente, tenantA, id, [afetado(colabB, [empresaA3], [], 0)]);
      }),
    ).rejects.toBeDefined();

    const depois = await poolAdmin.query<{ total: string }>(
      'select count(*)::text as total from app.carteira_evento where tenant_id = $1',
      [tenantA],
    );
    expect(depois.rows[0]?.total).toBe(antes.rows[0]?.total);
    expect(
      await comTenant(tenantA, (cliente) => vinculoAtivo(cliente, tenantA, colabA2, empresaA3)),
    ).toBe(false);
  });

  it('o evento é append-only: nem UPDATE nem DELETE passam', async () => {
    await expect(
      poolAdmin.query(`update app.carteira_evento set origem = 'INDIVIDUAL' where tenant_id = $1`, [
        tenantA,
      ]),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(
      poolAdmin.query('delete from app.carteira_evento where tenant_id = $1', [tenantA]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('lista o histórico por colaborador, empresa e origem', async () => {
    const pagina = await comTenant(tenantA, (cliente) =>
      listarEventosDeCarteira(cliente, tenantA, {
        usuarioAfetadoId: colabA2,
        empresaId: empresaA2,
        origem: 'LOTE',
        limite: 10,
        deslocamento: 0,
      }),
    );

    expect(pagina.total).toBeGreaterThanOrEqual(1);
    expect(pagina.eventos[0]?.autorNome).toContain('adminA');
  });
});

describe('Central de Carteiras', () => {
  it('lista colaboradores com a contagem de empresas e filtra pela situação da carteira', async () => {
    const sem = await comTenant(tenantA, (cliente) =>
      listarColaboradores(cliente, tenantA, {
        carteira: 'SEM_EMPRESAS',
        estado: 'ATIVO',
        limite: 50,
        deslocamento: 0,
      }),
    );
    const com = await comTenant(tenantA, (cliente) =>
      listarColaboradores(cliente, tenantA, {
        carteira: 'COM_EMPRESAS',
        estado: 'ATIVO',
        limite: 50,
        deslocamento: 0,
      }),
    );

    expect(sem.colaboradores.every((c) => c.empresas === 0)).toBe(true);
    expect(com.colaboradores.find((c) => c.id === colabA1)?.empresas).toBeGreaterThanOrEqual(2);
  });

  it('oferece só empresa ativa para atribuição, marcando as já atribuídas', async () => {
    const arquivada = await novaEmpresa(tenantA, `77${SUFIXO}000177`);
    await poolAdmin.query(`update app.empresa set situacao = 'arquivado' where id = $1`, [arquivada]);

    const pagina = await comTenant(tenantA, (cliente) =>
      listarEmpresasParaAtribuicao(cliente, tenantA, colabA1, { limite: 100, deslocamento: 0 }),
    );

    expect(pagina.empresas.some((e) => e.id === arquivada)).toBe(false);
    expect(pagina.empresas.find((e) => e.id === empresaA1)?.atribuida).toBe(true);
  });

  it('carrega empresa pelo id com o resumo nome e CNPJ', async () => {
    const [empresas, resumoA] = await comTenant(tenantA, async (cliente) => [
      await carregarEmpresasDaOperacao(cliente, tenantA, [empresaA1, empresaA2]),
      await resumoDaEmpresa(cliente, tenantA, empresaA1),
    ]);

    expect(empresas).toHaveLength(2);
    expect(resumoA?.cnpj).toBe(`71${SUFIXO}000171`);
  });
});

describe('isolamento entre tenants', () => {
  it('tenant B não enxerga vínculo, evento nem notificação do tenant A', async () => {
    const [vinculos, eventos, notificacoes] = await comTenant(tenantB, async (cliente) => [
      (await cliente.query('select 1 from app.carteira_vinculo')).rowCount,
      (await cliente.query('select 1 from app.carteira_evento')).rowCount,
      (await cliente.query('select 1 from app.carteira_notificacao')).rowCount,
    ]);

    expect([vinculos, eventos, notificacoes]).toEqual([0, 0, 0]);
  });

  it('consulta sem contexto de tenant devolve vazio', async () => {
    const resultado = await comTenant(null, (cliente) =>
      cliente.query('select 1 from app.carteira_vinculo'),
    );
    expect(resultado.rowCount).toBe(0);
  });

  it('a FK composta recusa vínculo entre usuário de um tenant e empresa de outro', async () => {
    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`,
          [tenantA, colabA1, empresaB],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('a RLS recusa gravar vínculo com tenant_id de outro escritório', async () => {
    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`,
          [tenantB, colabB, empresaB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('empresa de outro tenant não tem resumo nem entra na operação', async () => {
    const [resumoB, empresas] = await comTenant(tenantA, async (cliente) => [
      await resumoDaEmpresa(cliente, tenantA, empresaB),
      await carregarEmpresasDaOperacao(cliente, tenantA, [empresaB]),
    ]);

    expect(resumoB).toBeNull();
    expect(empresas).toEqual([]);
  });

  it('tenant e empresa são obrigatórios no vínculo', async () => {
    await expect(
      poolAdmin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values (null, $1, $2)`, [
        colabA1,
        empresaA1,
      ]),
    ).rejects.toMatchObject({ code: '23502' });
    await expect(
      poolAdmin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, null)`, [
        tenantA,
        colabA1,
      ]),
    ).rejects.toMatchObject({ code: '23502' });
  });
});

// Auxiliar fora do bloco `describe` para manter a prova de atomicidade legível.
const adicionar2 = async (cliente: PoolClient, usuarioId: string, empresaId: string): Promise<void> => {
  const [usuario] = await carregarUsuariosDaOperacao(cliente, tenantA, [usuarioId]);
  await aplicarEfeitos(cliente, tenantA, adminA, [
    { usuarioId, adicionadas: [empresaId], removidas: [], revisaoNova: (usuario?.revisao ?? 0) + 1 },
  ]);
};

// `comContextoHumano` é o caminho real dos casos de uso; um fumo garante que o
// repositório funciona também quando a transação vem dele.

describe('leituras empresariais filtradas pela carteira (SPEC-009 §3.5)', () => {
  let usuarioX = '';
  let usuarioY = '';
  let adminX = '';
  let empresaX1 = '';
  let empresaX2 = '';
  let empresaArquivada = '';

  const filtroDeEmpresas = (
    usuarioId: string,
    veArquivadas = false,
    status: 'ARQUIVADA' | null = null,
  ) => ({
    carteiraDoUsuarioId: usuarioId,
    veArquivadasDoTenant: veArquivadas,
    busca: null,
    status,
    limite: 50,
    deslocamento: 0,
  });

  beforeAll(async () => {
    usuarioX = await novoUsuario(tenantA, 'leitorX');
    usuarioY = await novoUsuario(tenantA, 'leitorY');
    // Administrador do escritório com a empresa X1 na carteira: a exceção da F9 (arquivadas sem
    // vínculo) é conferida pelo próprio banco, a partir do papel gravado.
    adminX = await novoUsuario(tenantA, 'adminX');
    await poolAdmin.query(
      `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`,
      [tenantA, adminX],
    );
    empresaX1 = await novaEmpresa(tenantA, `66${SUFIXO}000166`);
    empresaX2 = await novaEmpresa(tenantA, `67${SUFIXO}000167`);
    empresaArquivada = await novaEmpresa(tenantA, `68${SUFIXO}000168`);
    await poolAdmin.query(`update app.empresa set situacao = 'arquivado' where id = $1`, [
      empresaArquivada,
    ]);

    await adicionar(tenantA, usuarioX, [empresaX1]);
    await adicionar(tenantA, usuarioY, [empresaX2]);
    await adicionar(tenantA, adminX, [empresaX1]);

    for (const empresaId of [empresaX1, empresaX2]) {
      const chave = `campo:${empresaId.slice(-4)}`;

      await comoComum(tenantA, empresaId === empresaX1 ? usuarioX : usuarioY, async (cliente) => {
        await reconciliar(
          cliente,
          tenantA,
          empresaId,
          [{ origem: 'CADASTRAL', tipo: 'CAMPO_AUSENTE', chave, dataLimite: null }],
          [],
          adminA,
        );
        await criarNotificacoes(cliente, tenantA, empresaId, [{ chave, tipo: 'NOVA_PENDENCIA' }]);
      });
    }

    await comoSemeador((cliente) =>
      registrarEventos(
        cliente,
        tenantA,
        [empresaX1, empresaX2, empresaArquivada].map((empresaId) => ({
          empresaId,
          aba: 'DADOS_CADASTRAIS' as const,
          acao: 'ALTERACAO' as const,
          campo: 'razaoSocial',
          valorAnterior: 'a',
          valorNovo: 'b',
          vigencia: null,
          justificativa: null,
          usuarioId: adminA,
        })),
      ),
    );
  });

  it('a lista de empresas devolve só as da carteira de quem pergunta', async () => {
    const doX = await comoComum(tenantA, usuarioX, (c) =>
      listarEmpresas(c, tenantA, filtroDeEmpresas(usuarioX)),
    );
    const doY = await comoComum(tenantA, usuarioY, (c) =>
      listarEmpresas(c, tenantA, filtroDeEmpresas(usuarioY)),
    );

    expect(doX.empresas.map((e) => e.id)).toEqual([empresaX1]);
    expect(doY.empresas.map((e) => e.id)).toEqual([empresaX2]);
    expect(doX.total).toBe(1);
  });

  it('colaborador sem carteira vê lista vazia, nunca a base inteira', async () => {
    const sem = await novoUsuario(tenantA, 'semCarteira');
    const lista = await comoComum(tenantA, sem, (c) =>
      listarEmpresas(c, tenantA, filtroDeEmpresas(sem)),
    );

    expect(lista).toMatchObject({ empresas: [], total: 0 });
  });

  it('só o admin alcança as arquivadas sem vínculo; a ativa continua exigindo vínculo', async () => {
    const doAdmin = await comoComum(tenantA, adminX, (c) =>
      listarEmpresas(c, tenantA, filtroDeEmpresas(adminX, true, 'ARQUIVADA')),
    );
    const doComum = await comoComum(tenantA, usuarioX, (c) =>
      listarEmpresas(c, tenantA, filtroDeEmpresas(usuarioX, false, 'ARQUIVADA')),
    );
    const ativasDoAdmin = await comoComum(tenantA, adminX, (c) =>
      listarEmpresas(c, tenantA, filtroDeEmpresas(adminX, true)),
    );

    expect(doAdmin.empresas.map((e) => e.id)).toContain(empresaArquivada);
    expect(doComum.empresas).toEqual([]);
    expect(ativasDoAdmin.empresas.map((e) => e.id)).toEqual([empresaX1]);
  });

  it('a Central de Pendências só mostra pendência de empresa da carteira', async () => {
    const pagina = (usuarioId: string) =>
      comoComum(tenantA, usuarioId, (c) =>
        listarCentral(
          c,
          {
            carteiraDoUsuarioId: usuarioId,
            empresaId: null,
            origem: null,
            tipo: null,
            estado: 'ABERTA',
            vencimento: null,
            limite: 50,
            deslocamento: 0,
          },
          '2026-10-03',
        ),
      );

    expect((await pagina(usuarioX)).pendencias.map((p) => p.empresaId)).toEqual([empresaX1]);
    expect((await pagina(usuarioY)).pendencias.map((p) => p.empresaId)).toEqual([empresaX2]);
  });

  it('o histórico das empresas respeita a carteira; o admin também lê o das arquivadas', async () => {
    const leitura = async (usuarioId: string, veArquivadas: boolean) =>
      (
        await comoComum(tenantA, usuarioId, (c) =>
          listarHistorico(c, tenantA, {
            carteiraDoUsuarioId: usuarioId,
            veArquivadasDoTenant: veArquivadas,
            aba: null,
            empresaId: null,
            inicio: null,
            fim: null,
            usuarioId: null,
            campo: null,
            limite: 50,
            deslocamento: 0,
          }),
        )
      ).eventos.map((e) => e.empresaId);

    expect(await leitura(usuarioX, false)).toEqual([empresaX1]);
    expect((await leitura(adminX, true)).sort()).toEqual([empresaX1, empresaArquivada].sort());
  });

  it('o sino mostra pendência só da carteira e o aviso consolidado só ao destinatário', async () => {
    const afetados = [afetado(usuarioX, [empresaX1], [], 0)];
    const eventoId = await comTenant(tenantA, async (cliente) => {
      const id = await registrarEventoDeCarteira(cliente, tenantA, {
        origem: 'INDIVIDUAL',
        autorId: adminA,
        afetados,
      });
      await criarNotificacoesDeCarteira(cliente, tenantA, id, afetados);
      return id;
    });

    const sinoX = await comoComum(tenantA, usuarioX, (c) => listarPainel(c, tenantA, usuarioX));
    const sinoY = await comoComum(tenantA, usuarioY, (c) => listarPainel(c, tenantA, usuarioY));

    // X vê a pendência da empresa dele e o aviso; Y vê só a pendência da dele.
    expect(sinoX.map((n) => n.empresaId).filter((id) => id !== null)).toEqual([empresaX1]);
    expect(sinoX.some((n) => n.tipo === 'CARTEIRA_ALTERADA' && n.chave === eventoId)).toBe(true);
    expect(sinoY.map((n) => n.empresaId).filter((id) => id !== null)).toEqual([empresaX2]);
    expect(sinoY.some((n) => n.tipo === 'CARTEIRA_ALTERADA')).toBe(false);

    const aviso = sinoX.find((n) => n.tipo === 'CARTEIRA_ALTERADA');
    expect(aviso?.empresaId).toBeNull();
    expect(aviso?.adicionadas).toHaveLength(1);
  });

  it('quem perdeu a última empresa ainda vê o aviso consolidado', async () => {
    const solitario = await novoUsuario(tenantA, 'perdeuTudo');
    const afetados = [afetado(solitario, [], [empresaX1], 1)];

    await comTenant(tenantA, async (cliente) => {
      const id = await registrarEventoDeCarteira(cliente, tenantA, {
        origem: 'INDIVIDUAL',
        autorId: adminA,
        afetados,
      });
      await criarNotificacoesDeCarteira(cliente, tenantA, id, afetados);
    });

    const sino = await comoComum(tenantA, solitario, (c) => listarPainel(c, tenantA, solitario));

    expect(sino).toHaveLength(1);
    expect(sino[0]?.tipo).toBe('CARTEIRA_ALTERADA');
    expect(await comoComum(tenantA, solitario, (c) => contarNaoLidas(c, tenantA, solitario))).toBe(1);
  });

  it('ninguém marca como lida a notificação de outro: nem pendência fora da carteira, nem aviso alheio', async () => {
    const sinoX = await comoComum(tenantA, usuarioX, (c) => listarPainel(c, tenantA, usuarioX));
    const avisoDeX = sinoX.find((n) => n.tipo === 'CARTEIRA_ALTERADA');
    const pendenciaDeX = sinoX.find((n) => n.empresaId === empresaX1);

    expect(avisoDeX).toBeDefined();
    expect(pendenciaDeX).toBeDefined();

    // Y tenta ler os dois ids de X: responde como inexistente e nada muda.
    expect(
      await comoComum(tenantA, usuarioY, (c) => marcarComoLida(c, tenantA, avisoDeX?.id ?? '', usuarioY)),
    ).toBeNull();
    expect(
      await comoComum(tenantA, usuarioY, (c) => marcarComoLida(c, tenantA, pendenciaDeX?.id ?? '', usuarioY)),
    ).toBeNull();
    expect(
      await comoComum(tenantA, usuarioY, (c) =>
        marcarVariasComoLidas(c, tenantA, [avisoDeX?.id ?? '', pendenciaDeX?.id ?? ''], usuarioY),
      ),
    ).toBe(0);

    // O destinatário marca o próprio aviso, e só ele.
    const lida = await comoComum(tenantA, usuarioX, (c) =>
      marcarComoLida(c, tenantA, avisoDeX?.id ?? '', usuarioX),
    );
    expect(lida?.lida).toBe(true);
  });
});

describe('privilégios finos e empresa arquivada', () => {
  it('a notificação consolidada só muda de não lida para lida: destinatário e resumo são imutáveis', async () => {
    const destinatario = await novoUsuario(tenantA, 'destinatario');
    const afetados = [afetado(destinatario, [empresaA1], [], 0)];
    await comTenant(tenantA, async (cliente) => {
      const id = await registrarEventoDeCarteira(cliente, tenantA, {
        origem: 'INDIVIDUAL',
        autorId: adminA,
        afetados,
      });
      await criarNotificacoesDeCarteira(cliente, tenantA, id, afetados);
    });

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(`update app.carteira_notificacao set usuario_id = $1 where usuario_id = $2`, [
          colabA1,
          destinatario,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(`update app.carteira_notificacao set removidas = '[]'::jsonb where usuario_id = $1`, [
          destinatario,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await comTenant(tenantA, (cliente) =>
      cliente.query(`update app.carteira_notificacao set lida = true, lida_em = now() where usuario_id = $1`, [
        destinatario,
      ]),
    );
  });

  it('pendência de empresa arquivada não se dispensa: o admin a alcança sem vínculo, mas só para consultar', async () => {
    const empresaId = await novaEmpresa(tenantA, `69${SUFIXO}000169`);
    await comoSemeador((cliente) =>
      reconciliar(
        cliente,
        tenantA,
        empresaId,
        [{ origem: 'CADASTRAL', tipo: 'CAMPO_AUSENTE', chave: 'campo:cnae', dataLimite: null }],
        [],
        adminA,
      ),
    );
    const pendenciaId = (
      await poolAdmin.query<{ id: string }>('select id from app.empresa_pendencia where empresa_id = $1', [
        empresaId,
      ])
    ).rows[0]?.id;
    await poolAdmin.query(`update app.empresa set situacao = 'arquivado' where id = $1`, [empresaId]);

    const dispensada = await comoComum(tenantA, adminA, (cliente) =>
      dispensar(cliente, tenantA, empresaId, pendenciaId ?? '', adminA, 'Tentativa em empresa arquivada.'),
    );

    expect(dispensada).toBeNull();
  });
});

describe('com comContextoHumano', () => {
  it('lê a carteira pelo mesmo caminho dos casos de uso', async () => {
    const empresas = await comContextoHumano(poolApp, { tenantId: tenantA, usuarioId: adminA, finalidade: 'ADMIN_ACESSO' }, (cliente) =>
      empresasDaCarteira(cliente, tenantA, colabA1),
    );
    expect(empresas.length).toBeGreaterThan(0);
  });
});
