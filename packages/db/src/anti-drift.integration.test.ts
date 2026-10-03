/**
 * Anti-drift de RLS (SPEC-010 §3.5, TESTING.md §3.1, CI-PR.md §4).
 *
 * Inspeciona o catálogo REAL do PostgreSQL e falha, com tabela e requisito, se
 * uma tabela escapar de tenant_id, empresa_id, índice, RLS forçada, política por
 * operação, classificação ou privilégio. Este teste não pode ser removido: é o
 * que impede que a próxima fatia crie tabela sem isolamento.
 *
 * As migrations são aplicadas antes da suíte (`pnpm db:migrate`, passo próprio da
 * CI). Aplicá-las aqui faria as suítes de banco, que rodam em paralelo,
 * disputarem a mesma tabela de controle.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import {
  auditarCatalogo,
  lerCatalogo,
  type FotografiaDoCatalogo,
  type TabelaDoCatalogo,
} from './rls/anti-drift.js';
import { CLASSIFICACAO, type EntradaDeClassificacao } from './rls/classificacao.js';

const pool = criarPool();

const SCHEMAS = ['app', 'public'] as const;
const PAPEL = 'contaia_app';

const requisitos = (violacoes: ReturnType<typeof auditarCatalogo>): string[] =>
  violacoes.map((v) => `${v.tabela}: ${v.requisito}`);

describe('anti-drift sobre o catálogo real', () => {
  it('há tabelas para varrer', async () => {
    const fotografia = await lerCatalogo(pool, { schemas: SCHEMAS, papel: PAPEL });

    expect(fotografia.tabelas.length).toBeGreaterThan(0);
  });

  it('nenhuma tabela escapa da classificação nem dos requisitos de RLS', async () => {
    const fotografia = await lerCatalogo(pool, { schemas: SCHEMAS, papel: PAPEL });

    expect(requisitos(auditarCatalogo(fotografia, CLASSIFICACAO))).toEqual([]);
  });

  it('o papel da aplicação não tem BYPASSRLS nem SUPERUSER', async () => {
    const { papel } = await lerCatalogo(pool, { schemas: SCHEMAS, papel: PAPEL });

    expect(papel).toEqual({ existe: true, bypassRls: false, superusuario: false });
  });

  it('tabela criada sem proteção reprova a prova, apontando cada requisito', async () => {
    const cliente = await pool.connect();

    try {
      await cliente.query('begin');
      await cliente.query('create schema rls_sonda');
      await cliente.query(
        'create table rls_sonda.insegura (id uuid primary key, tenant_id uuid, empresa_id uuid)',
      );
      await cliente.query('grant usage on schema rls_sonda to contaia_app');
      await cliente.query(
        'grant select, insert, update, delete on rls_sonda.insegura to contaia_app',
      );

      const fotografia = await lerCatalogo(cliente, { schemas: ['rls_sonda'], papel: PAPEL });
      const classificada: EntradaDeClassificacao = {
        tabela: 'rls_sonda.insegura',
        classe: 'empresa',
        origem: 'sonda do anti-drift',
      };

      const semClasse = requisitos(auditarCatalogo(fotografia, []));
      const comClasse = requisitos(auditarCatalogo(fotografia, [classificada]));

      expect(semClasse).toEqual(['rls_sonda.insegura: tabela classificada']);
      expect(comClasse).toEqual(
        expect.arrayContaining([
          'rls_sonda.insegura: RLS habilitada',
          'rls_sonda.insegura: RLS forçada',
          'rls_sonda.insegura: tenant_id NOT NULL',
          'rls_sonda.insegura: índice por tenant_id',
          'rls_sonda.insegura: empresa_id NOT NULL',
          'rls_sonda.insegura: índice por empresa_id',
          'rls_sonda.insegura: política de SELECT',
          'rls_sonda.insegura: política de INSERT',
          'rls_sonda.insegura: política de UPDATE',
          'rls_sonda.insegura: sem DELETE para a aplicação',
        ]),
      );
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
  });
});

const tabelaSegura = (sobre: Partial<TabelaDoCatalogo> = {}): TabelaDoCatalogo => ({
  nome: 'app.exemplo',
  rlsHabilitada: true,
  rlsForcada: true,
  colunas: { tenant_id: false, empresa_id: false },
  indices: [
    { nome: 'a', colunas: ['tenant_id'], parcial: false },
    { nome: 'b', colunas: ['tenant_id', 'empresa_id'], parcial: false },
  ],
  politicas: [
    {
      nome: 'p_select',
      comando: 'SELECT',
      permissiva: true,
      usando: '((tenant_id = app.tenant_atual()) AND app.empresa_autorizada(empresa_id))',
      comCheck: null,
    },
    {
      nome: 'p_insert',
      comando: 'INSERT',
      permissiva: true,
      usando: null,
      comCheck: '((tenant_id = app.tenant_atual()) AND app.empresa_autorizada(empresa_id))',
    },
  ],
  privilegiosDaAplicacao: ['SELECT', 'INSERT'],
  ...sobre,
});

const classeEmpresa: EntradaDeClassificacao = {
  tabela: 'app.exemplo',
  classe: 'empresa',
  origem: 'teste',
};

const fotografiaCom = (tabela: TabelaDoCatalogo): FotografiaDoCatalogo => ({
  tabelas: [tabela],
  papel: { existe: true, bypassRls: false, superusuario: false },
});

describe('auditoria pura do catálogo', () => {
  it('aceita a tabela segura de referência', () => {
    expect(auditarCatalogo(fotografiaCom(tabelaSegura()), [classeEmpresa])).toEqual([]);
  });

  it.each([
    [
      'política que libera tudo',
      {
        politicas: [
          {
            nome: 'liberada',
            comando: 'ALL' as const,
            permissiva: true,
            usando: 'true',
            comCheck: 'true',
          },
        ],
      },
      'política de SELECT com contexto',
    ],
    ['empresa_id anulável', { colunas: { tenant_id: false, empresa_id: true } }, 'empresa_id NOT NULL'],
    [
      'índice parcial não conta',
      {
        indices: [
          { nome: 'a', colunas: ['tenant_id'], parcial: false },
          { nome: 'b', colunas: ['tenant_id', 'empresa_id'], parcial: true },
        ],
      },
      'índice por empresa_id',
    ],
    [
      'UPDATE sem política',
      { privilegiosDaAplicacao: ['SELECT', 'INSERT', 'UPDATE'] },
      'política de UPDATE',
    ],
    [
      'TRUNCATE concedido',
      { privilegiosDaAplicacao: ['SELECT', 'INSERT', 'TRUNCATE'] },
      'sem TRUNCATE para a aplicação',
    ],
  ])('reprova: %s', (_nome, troca, requisito) => {
    const achados = requisitos(
      auditarCatalogo(fotografiaCom(tabelaSegura(troca)), [classeEmpresa]),
    );

    expect(achados.join('\n')).toContain(requisito);
  });

  it('reprova tabela append-only com UPDATE', () => {
    const achados = requisitos(
      auditarCatalogo(
        fotografiaCom(tabelaSegura({ privilegiosDaAplicacao: ['SELECT', 'INSERT', 'UPDATE'] })),
        [{ ...classeEmpresa, appendOnly: true }],
      ),
    );

    expect(achados).toContain('app.exemplo: append-only (I-6)');
  });

  it('reprova papel com BYPASSRLS e classificação órfã', () => {
    const achados = requisitos(
      auditarCatalogo(
        { tabelas: [], papel: { existe: true, bypassRls: true, superusuario: false } },
        [classeEmpresa],
      ),
    );

    expect(achados).toEqual([
      '(papel contaia_app): sem BYPASSRLS',
      'app.exemplo: classificação órfã',
    ]);
  });

  it('exige justificativa na allowlist sem empresa_id', () => {
    const achados = requisitos(
      auditarCatalogo(fotografiaCom(tabelaSegura()), [
        { tabela: 'app.exemplo', classe: 'tenant', origem: 'teste' },
      ]),
    );

    expect(achados).toContain('app.exemplo: allowlist justificada');
  });
});

afterAll(async () => {
  await pool.end();
});
