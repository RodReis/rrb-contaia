/**
 * Notificações de pendências (SPEC-006).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 * Mesmo padrão de `pendencias.integration.test.ts` (Task 3 de F5): dois
 * tenants para provar isolamento, CNPJ sufixado com `process.pid`.
 *
 * O que estas provas defendem, em ordem de gravidade: notificação de um
 * tenant não vaza para o outro; reprocessamento e concorrência real na mesma
 * causa não duplicam notificação não lida; marcar como lida é idempotente e
 * não reescreve o evento (histórico append-only); marcar em lote conta só as
 * recém-marcadas; e o histórico paginado preserva as já lidas.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import {
  contarNaoLidas,
  criarNotificacoes,
  listarHistorico,
  listarPainel,
  marcarComoLida,
  marcarVariasComoLidas,
} from './repositorios/notificacoes.js';
import { aplicarContextoDeTeste, comoUsuario, criarEmpresaNaCarteira } from './testes/suporte.js';

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
let usuarioA = '';
let usuarioB = '';

const comTenant = <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => comoUsuario(poolApp, tenantId, tenantId === tenantA ? usuarioA : usuarioB, executar, 'COMUM');

// Mesmo motivo das suítes de F3/F4/F5: as suítes de banco rodam em paralelo
// sobre o mesmo PostgreSQL, então cada execução gera os próprios CNPJs e
// limpa exclusivamente pelas próprias razões sociais.
const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const CNPJ_TENANT_A = `81${SUFIXO}000181`;
const CNPJ_TENANT_B = `82${SUFIXO}000182`;
const CNPJ_EMPRESA = `83${SUFIXO}000183`;

const RAZOES = [`Escritório Notificação A ${SUFIXO}`, `Escritório Notificação B ${SUFIXO}`];

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    `select id from app.tenant where razao_social = any($1)`,
    [RAZOES],
  );

  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // A trigger append-only recusa DELETE até para o dono da tabela — é
  // exatamente o comportamento que as provas abaixo exigem. Limpar fixture é
  // a única exceção legítima, e ela desliga a trigger explicitamente em vez
  // de enfraquecê-la.
  await poolAdmin.query(
    'alter table app.empresa_evento_de_notificacao disable trigger empresa_evento_de_notificacao_append_only',
  );

  try {
    await poolAdmin.query(
      'delete from app.empresa_evento_de_notificacao where tenant_id = any($1)',
      [ids],
    );
    await poolAdmin.query('delete from app.empresa_notificacao where tenant_id = any($1)', [ids]);
  } finally {
    await poolAdmin.query(
      'alter table app.empresa_evento_de_notificacao enable trigger empresa_evento_de_notificacao_append_only',
    );
  }

  await poolAdmin.query('delete from app.signer_notificacao where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.carteira_vinculo where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.empresa where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.usuario where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [ids]);
};

beforeAll(async () => {
  await limpar();

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, $3, 'ATIVO'), ($2, $4, 'ATIVO')
     returning id`,
    [CNPJ_TENANT_A, CNPJ_TENANT_B, RAZOES[0], RAZOES[1]],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  const usuarios = await poolAdmin.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $3, 'notificacao-a@local', 'Admin Notificação A', 'ATIVO'),
            ($2, $4, 'notificacao-b@local', 'Admin Notificação B', 'ATIVO')
     returning id`,
    [tenantA, tenantB, `sub-notificacao-a-${SUFIXO}`, `sub-notificacao-b-${SUFIXO}`],
  );

  usuarioA = usuarios.rows[0]?.id ?? '';
  usuarioB = usuarios.rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolApp.end();
  await limpar();
  await poolAdmin.end();
});

let proximoCnpj = 0;

const criarEmpresaAtiva = async (tenantId: string): Promise<string> => {
  proximoCnpj += 1;
  const cnpj = `${CNPJ_EMPRESA.slice(0, 8)}${String(proximoCnpj).padStart(6, '0')}`;

  return comTenant(tenantId, async (cliente) => {
    const empresaId = await criarEmpresaNaCarteira(
      cliente,
      tenantId,
      tenantId === tenantA ? usuarioA : usuarioB,
      cnpj,
    );

    await cliente.query(
      `update app.empresa set status = 'ATIVA', razao_social = 'Empresa Notificação'
        where tenant_id = $1 and id = $2`,
      [tenantId, empresaId],
    );

    return empresaId;
  });
};

describe('isolamento por tenant', () => {
  it('notificação de um tenant não vaza para o outro (I-1, I-2)', async () => {
    const empresaA = await criarEmpresaAtiva(tenantA);

    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaA, [
        { chave: 'campo:cnae', tipo: 'NOVA_PENDENCIA' },
      ]),
    );

    const painelA = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const painelB = await comTenant(tenantB, (cliente) => listarPainel(cliente, tenantB, usuarioB));

    expect(painelA).toHaveLength(1);
    expect(painelB).toHaveLength(0);
  });
});

describe('criação de notificações (secao 2)', () => {
  it('não duplica notificação da mesma causa não lida (reprocessamento)', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA);

    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'exigencia:x1', tipo: 'NOVA_EXIGENCIA' },
      ]),
    );
    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'exigencia:x1', tipo: 'NOVA_EXIGENCIA' },
      ]),
    );

    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const daMesmaCausa = painel.filter(
      (n) => n.empresaId === empresaId && n.chave === 'exigencia:x1',
    );

    expect(daMesmaCausa).toHaveLength(1);
  });

  it('cria notificações concorrentes da mesma causa sem duplicar (concorrência real)', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA);

    const executarEmTransacaoPropria = async (): Promise<void> => {
      const cliente = await poolApp.connect();
      try {
        await cliente.query('begin');
        await aplicarContextoDeTeste(cliente, tenantA, usuarioA, 'COMUM');
        await criarNotificacoes(cliente, tenantA, empresaId, [
          { chave: 'campo:concorrente', tipo: 'NOVA_PENDENCIA' },
        ]);
        await cliente.query('commit');
      } catch (erro) {
        await cliente.query('rollback');
        throw erro;
      } finally {
        cliente.release();
      }
    };

    await Promise.all([executarEmTransacaoPropria(), executarEmTransacaoPropria()]);

    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const daMesmaCausa = painel.filter(
      (n) => n.empresaId === empresaId && n.chave === 'campo:concorrente',
    );

    expect(daMesmaCausa).toHaveLength(1);
  });

  it('não descarta notificação de outro tipo da mesma chave (achado C1)', async () => {
    // Mesma `chave` (mesma exigência), tipos diferentes: NOVA_PENDENCIA e
    // DOCUMENTO_REJEITADO da exigência X são causas distintas e devem
    // coexistir não lidas — o índice único é (empresa_id, chave, tipo), não
    // (empresa_id, chave). Antes do fix, a segunda inserção era descartada em
    // silêncio pelo `on conflict (empresa_id, chave) where lida = false`.
    const empresaId = await criarEmpresaAtiva(tenantA);
    const antes = await comTenant(tenantA, (cliente) => contarNaoLidas(cliente, tenantA, usuarioA));

    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'exigencia:mesma-causa', tipo: 'NOVA_PENDENCIA' },
      ]),
    );
    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'exigencia:mesma-causa', tipo: 'DOCUMENTO_REJEITADO' },
      ]),
    );

    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const daMesmaChave = painel.filter(
      (n) => n.empresaId === empresaId && n.chave === 'exigencia:mesma-causa',
    );

    expect(daMesmaChave).toHaveLength(2);
    expect(daMesmaChave.map((n) => n.tipo).sort()).toEqual([
      'DOCUMENTO_REJEITADO',
      'NOVA_PENDENCIA',
    ]);

    const depois = await comTenant(tenantA, (cliente) => contarNaoLidas(cliente, tenantA, usuarioA));
    expect(depois).toBe(antes + 2);
  });
});

describe('contagem de não lidas (badge)', () => {
  it('conta só as não lidas do tenant, ignorando as lidas', async () => {
    const empresaId = await criarEmpresaAtiva(tenantB);

    const antes = await comTenant(tenantB, (cliente) => contarNaoLidas(cliente, tenantB, usuarioB));

    await comTenant(tenantB, (cliente) =>
      criarNotificacoes(cliente, tenantB, empresaId, [
        { chave: 'campo:badge-1', tipo: 'NOVA_PENDENCIA' },
        { chave: 'campo:badge-2', tipo: 'NOVA_PENDENCIA' },
      ]),
    );

    const depoisDeCriar = await comTenant(tenantB, (cliente) => contarNaoLidas(cliente, tenantB, usuarioB));
    expect(depoisDeCriar).toBe(antes + 2);

    const painel = await comTenant(tenantB, (cliente) => listarPainel(cliente, tenantB, usuarioB));
    const notificacao = painel.find(
      (n) => n.empresaId === empresaId && n.chave === 'campo:badge-1',
    );
    expect(notificacao).toBeDefined();

    await comTenant(tenantB, (cliente) =>
      marcarComoLida(cliente, tenantB, notificacao!.id, usuarioB),
    );

    const depoisDeLer = await comTenant(tenantB, (cliente) => contarNaoLidas(cliente, tenantB, usuarioB));
    expect(depoisDeLer).toBe(antes + 1);
  });
});

describe('marcar como lida (secao 5)', () => {
  it('é idempotente e não permite reescrever o histórico (append-only)', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA);

    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'campo:leitura', tipo: 'NOVA_PENDENCIA' },
      ]),
    );

    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const notificacao = painel.find((n) => n.chave === 'campo:leitura');
    expect(notificacao).toBeDefined();

    const primeiraLeitura = await comTenant(tenantA, (cliente) =>
      marcarComoLida(cliente, tenantA, notificacao!.id, usuarioA),
    );
    const segundaLeitura = await comTenant(tenantA, (cliente) =>
      marcarComoLida(cliente, tenantA, notificacao!.id, usuarioA),
    );

    expect(primeiraLeitura?.lida).toBe(true);
    expect(segundaLeitura?.lida).toBe(true);
    expect(segundaLeitura?.id).toBe(primeiraLeitura?.id);

    // Histórico append-only: UPDATE direto no evento deve falhar.
    await comTenant(tenantA, async (cliente) => {
      await expect(
        cliente.query(
          `update app.empresa_evento_de_notificacao set acao = 'CRIACAO' where notificacao_id = $1`,
          [notificacao!.id],
        ),
      ).rejects.toThrow();
    });

    const eventos = await comTenant(tenantA, (cliente) =>
      cliente.query<{ acao: string }>(
        `select acao from app.empresa_evento_de_notificacao
         where notificacao_id = $1 order by sequencia asc`,
        [notificacao!.id],
      ),
    );
    // Só um evento de LEITURA — a segunda chamada (já lida) não grava de novo.
    expect(eventos.rows.map((linha) => linha.acao)).toEqual(['CRIACAO', 'LEITURA']);
  });

  it('marca várias como lidas em lote e não conta as já lidas de novo', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA);

    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'campo:l1', tipo: 'NOVA_PENDENCIA' },
        { chave: 'campo:l2', tipo: 'NOVA_PENDENCIA' },
      ]),
    );

    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const ids = painel
      .filter((n) => n.chave === 'campo:l1' || n.chave === 'campo:l2')
      .map((n) => n.id);
    expect(ids).toHaveLength(2);

    const marcadas = await comTenant(tenantA, (cliente) =>
      marcarVariasComoLidas(cliente, tenantA, ids, usuarioA),
    );
    const marcadasDeNovo = await comTenant(tenantA, (cliente) =>
      marcarVariasComoLidas(cliente, tenantA, ids, usuarioA),
    );

    expect(marcadas).toBe(2);
    expect(marcadasDeNovo).toBe(0);
  });
});

describe('histórico (secao 3)', () => {
  it('histórico paginado preserva notificações lidas (não são excluídas)', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA);

    await comTenant(tenantA, (cliente) =>
      criarNotificacoes(cliente, tenantA, empresaId, [
        { chave: 'campo:h1', tipo: 'NOVA_PENDENCIA' },
      ]),
    );
    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const notificacao = painel.find((n) => n.chave === 'campo:h1');
    expect(notificacao).toBeDefined();

    await comTenant(tenantA, (cliente) =>
      marcarComoLida(cliente, tenantA, notificacao!.id, usuarioA),
    );

    const pagina = await comTenant(tenantA, (cliente) =>
      listarHistorico(cliente, tenantA, usuarioA, 25, 0),
    );

    expect(pagina.notificacoes.some((n) => n.id === notificacao!.id && n.lida)).toBe(true);
    expect(pagina.total).toBeGreaterThanOrEqual(1);
  });
});

describe('alertas de incidente do Signer no sino (SPEC-012 §3.10)', () => {
  const incidente = '0198f3c2-0000-7000-0000-0000000000a1';
  let colegaDeA = '';

  const semear = async (
    tenantId: string,
    usuarioId: string,
    tipo: 'INDISPONIBILIDADE' | 'RECUPERACAO',
    duracaoMs: number | null,
  ): Promise<void> => {
    await poolAdmin.query(
      `insert into app.signer_notificacao (tenant_id, usuario_id, incidente_id, tipo, duracao_ms)
       values ($1, $2, $3, $4, $5)`,
      [tenantId, usuarioId, incidente, tipo, duracaoMs],
    );
  };

  beforeAll(async () => {
    colegaDeA = (
      await poolAdmin.query<{ id: string }>(
        `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
         values ($1, $2, 'colega-a@local', 'Colega A', 'ATIVO') returning id`,
        [tenantA, `sub-colega-a-${SUFIXO}`],
      )
    ).rows[0]!.id;
    await semear(tenantA, usuarioA, 'INDISPONIBILIDADE', null);
    await semear(tenantA, usuarioA, 'RECUPERACAO', 330_000);
  });

  it('o administrador destinatário vê os dois avisos, sem empresa, com tipo e duração', async () => {
    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const indisponivel = painel.find((n) => n.tipo === 'SIGNER_INDISPONIVEL');
    const recuperado = painel.find((n) => n.tipo === 'SIGNER_RECUPERADO');

    expect(indisponivel).toMatchObject({ empresaId: null, empresaNome: null, lida: false, duracaoMs: null });
    expect(indisponivel?.chave).toBe(`signer:${incidente}:INDISPONIBILIDADE`);
    expect(recuperado).toMatchObject({ empresaId: null, lida: false, duracaoMs: 330_000 });
  });

  it('é do destinatário: outro usuário do mesmo tenant e outro tenant não veem', async () => {
    const doColega = await comoUsuario(poolApp, tenantA, colegaDeA, (cliente) => listarPainel(cliente, tenantA, colegaDeA), 'COMUM');
    const deOutroTenant = await comTenant(tenantB, (cliente) => listarPainel(cliente, tenantB, usuarioB));

    expect(doColega.some((n) => n.tipo.startsWith('SIGNER_'))).toBe(false);
    expect(deOutroTenant.some((n) => n.tipo.startsWith('SIGNER_'))).toBe(false);
  });

  it('entra na contagem de não lidas e sai dela ao marcar como lida (idempotente)', async () => {
    const antes = await comTenant(tenantA, (cliente) => contarNaoLidas(cliente, tenantA, usuarioA));
    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const alvo = painel.find((n) => n.tipo === 'SIGNER_INDISPONIVEL')!;

    const primeira = await comTenant(tenantA, (cliente) => marcarComoLida(cliente, tenantA, alvo.id, usuarioA));
    const repetida = await comTenant(tenantA, (cliente) => marcarComoLida(cliente, tenantA, alvo.id, usuarioA));
    const depois = await comTenant(tenantA, (cliente) => contarNaoLidas(cliente, tenantA, usuarioA));

    expect(primeira).toMatchObject({ lida: true });
    expect(repetida).toMatchObject({ lida: true });
    expect(depois).toBe(antes - 1);
  });

  it('em lote conta só as recém-marcadas, e quem não é o dono não marca a do outro', async () => {
    const painel = await comTenant(tenantA, (cliente) => listarPainel(cliente, tenantA, usuarioA));
    const alvo = painel.find((n) => n.tipo === 'SIGNER_RECUPERADO')!;

    const doColega = await comoUsuario(
      poolApp,
      tenantA,
      colegaDeA,
      (cliente) => marcarVariasComoLidas(cliente, tenantA, [alvo.id], colegaDeA),
      'COMUM',
    );
    const doDono = await comTenant(tenantA, (cliente) => marcarVariasComoLidas(cliente, tenantA, [alvo.id], usuarioA));
    const denovo = await comTenant(tenantA, (cliente) => marcarVariasComoLidas(cliente, tenantA, [alvo.id], usuarioA));

    expect(doColega).toBe(0);
    expect(doDono).toBe(1);
    expect(denovo).toBe(0);
  });

  it('o histórico completo preserva os avisos já lidos', async () => {
    const pagina = await comTenant(tenantA, (cliente) => listarHistorico(cliente, tenantA, usuarioA, 25, 0));

    expect(pagina.notificacoes.filter((n) => n.tipo.startsWith('SIGNER_'))).toHaveLength(2);
  });
});
