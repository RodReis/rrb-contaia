/**
 * Matriz negativa de RLS sobre o PostgreSQL real (SPEC-010 §9, §10).
 *
 * Roda pelo papel `contaia_app` (sem BYPASSRLS) e prova, tabela a tabela, o
 * isolamento entre tenants, entre empresas do mesmo tenant, fora da carteira,
 * sem contexto, com contexto adulterado, para usuário suspenso e para job
 * técnico. Publica `rls-matrix.json` vinculado à SPEC-010 e à issue #12.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao, obterUrlDaAplicacao } from './client.js';
import { comContexto, semContexto } from './contexto.js';
import { auditarCobertura } from './rls/anti-drift.js';
import { CLASSIFICACAO } from './rls/classificacao.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { FIXTURES } from './testes/fixtures-rls.js';
import { executarMatriz, type CasoDaMatriz } from './testes/matriz-rls.js';
import { contextoHumano } from '@contaia/domain';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let cenario: Cenario;
let casos: CasoDaMatriz[] = [];

const SAIDA = resolve('test-results', 'banco', 'rls-matrix.json');
const TABELAS_SENSIVEIS = CLASSIFICACAO.filter((entrada) => entrada.classe !== 'global');

beforeAll(async () => {
  cenario = await montarCenario(admin);
  casos = await executarMatriz({ app, admin, cenario, classificacao: CLASSIFICACAO });
}, 120_000);

afterAll(async () => {
  await limparCenario(admin, cenario);
  await Promise.all([admin.end(), app.end()]);
});

describe('matriz de RLS', () => {
  it('toda tabela sensível tem fixture e casos na matriz', () => {
    const semFixture = TABELAS_SENSIVEIS.filter((entrada) => FIXTURES[entrada.tabela] === undefined);
    const cobertas = [...new Set(casos.map((caso) => caso.tabela))];

    expect(semFixture.map((entrada) => entrada.tabela)).toEqual([]);
    expect(auditarCobertura(CLASSIFICACAO, cobertas)).toEqual([]);
  });

  it('cada tabela sensível tem controle positivo: o recorte certo enxerga a linha', () => {
    const semControle = TABELAS_SENSIVEIS.filter(
      (entrada) =>
        !casos.some(
          (caso) =>
            caso.tabela === entrada.tabela &&
            caso.operacao === 'SELECT' &&
            caso.esperado === 'visivel' &&
            caso.passou,
        ),
    );

    expect(semControle.map((entrada) => entrada.tabela)).toEqual([]);
  });

  it('todo caso da matriz obteve o resultado esperado', () => {
    const reprovados = casos
      .filter((caso) => !caso.passou)
      .map((caso) => `${caso.tabela} · ${caso.operacao} · ${caso.caso}: esperado ${caso.esperado}, obtido ${caso.obtido}`);

    expect(reprovados).toEqual([]);
  });

  it('o recorte não vaza por conexão reaproveitada do pool', async () => {
    // `max: 1`: a segunda operação reaproveita exatamente a conexão da primeira.
    const pool = new Pool({ connectionString: obterUrlDaAplicacao(), max: 1 });
    const contar = `select count(*)::text as n, pg_backend_pid() as pid,
                           app.tenant_atual()::text as tenant, app.usuario_atual()::text as usuario,
                           app.finalidade_atual() as finalidade, app.origem_atual() as origem
                      from app.empresa_pendencia`;

    try {
      const contexto = contextoHumano({
        tenantId: cenario.tenantA,
        usuarioId: cenario.usuarios.naCarteira,
      });
      const durante = await comContexto(pool, contexto, async (cliente) => {
        const { rows } = await cliente.query<{ n: string; pid: number; tenant: string | null }>(contar);

        return rows[0];
      });
      const depois = await semContexto(pool, async (cliente) => {
        const { rows } = await cliente.query<{ n: string; pid: number }>(contar);

        return rows[0];
      });

      expect(Number(durante?.n)).toBeGreaterThan(0);
      expect(durante?.tenant).toBe(cenario.tenantA);
      expect(depois?.pid).toBe(durante?.pid);
      expect(depois).toMatchObject({
        n: '0',
        tenant: null,
        usuario: null,
        finalidade: null,
        origem: null,
      });
    } finally {
      await pool.end();
    }
  });

  it('publica rls-matrix.json vinculado à SPEC-010 e à issue #12', async () => {
    const porTabela = TABELAS_SENSIVEIS.map((entrada) => {
      const dela = casos.filter((caso) => caso.tabela === entrada.tabela);

      return {
        tabela: entrada.tabela,
        classe: entrada.classe,
        origem: entrada.origem,
        justificativa: entrada.justificativa ?? null,
        casos: dela.length,
        passou: dela.filter((caso) => caso.passou).length,
        falhou: dela.filter((caso) => !caso.passou).length,
      };
    });

    const matriz = {
      spec: 'SPEC-010',
      fatia: 'F10',
      issue: 12,
      papel_da_aplicacao: 'contaia_app',
      banco: 'PostgreSQL real (sem mock de SQL)',
      gerado_em: new Date().toISOString(),
      tabelas_sensiveis: TABELAS_SENSIVEIS.length,
      tabelas_cobertas: porTabela.filter((tabela) => tabela.casos > 0).length,
      cobertura_percentual: Math.round(
        (porTabela.filter((tabela) => tabela.casos > 0).length / TABELAS_SENSIVEIS.length) * 100,
      ),
      casos_total: casos.length,
      casos_passou: casos.filter((caso) => caso.passou).length,
      casos_falhou: casos.filter((caso) => !caso.passou).length,
      allowlist_sem_empresa_id: CLASSIFICACAO.filter((entrada) =>
        ['raiz_tenant', 'raiz_empresa', 'tenant', 'global'].includes(entrada.classe),
      ).map((entrada) => ({
        tabela: entrada.tabela,
        classe: entrada.classe,
        origem: entrada.origem,
        justificativa: entrada.justificativa,
      })),
      tabelas: porTabela,
      casos,
    };

    await mkdir(dirname(SAIDA), { recursive: true });
    await writeFile(SAIDA, `${JSON.stringify(matriz, null, 2)}\n`);

    expect(matriz.cobertura_percentual).toBe(100);
    expect(matriz.casos_falhou).toBe(0);
  });
});
