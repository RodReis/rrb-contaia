import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { criarPool, obterUrlDaAplicacao } from './client.js';
import { aplicarContextoDeTeste } from './testes/suporte.js';

const admin = criarPool();
const TEST_TABLES = ['tax_monthly_rule_package', 'tax_monthly_rule_package_event', 'tax_monthly_declaration', 'tax_monthly_declaration_event', 'tax_monthly_evidence', 'tax_monthly_assessment', 'tax_monthly_assessment_event'];
const appUrl = new URL(obterUrlDaAplicacao()); appUrl.searchParams.set('application_name', 'f36-migration-test');
const app = new Pool({ connectionString: appUrl.toString(), max: 2 });

afterAll(async () => { await Promise.all([admin.end(), app.end()]); });

describe('migration F36 / SPEC-036', () => {
  it('cria tabelas com RLS forçada, índices e políticas SELECT/INSERT', async () => {
    const { rows } = await admin.query<{ tablename: string; rowsecurity: boolean; force: boolean; index_count: number; policy_count: number }>(`
        select c.relname tablename,c.relrowsecurity rowsecurity,c.relforcerowsecurity force,
          (select count(*) from pg_indexes i where i.schemaname='app' and i.tablename=c.relname)::int index_count,
          (select count(*) from pg_policies p where p.schemaname='app' and p.tablename=c.relname)::int policy_count
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and c.relname=any($1)`, [TEST_TABLES]);
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.rowsecurity && row.force && row.index_count > 0 && row.policy_count === 2)).toBe(true);
  }, 20_000);

  it('instala proteção append-only, escopo imutável e bloqueio de TRUNCATE nas sete tabelas', async () => {
    const { rows } = await admin.query<{ count: number }>(`select count(distinct c.relname||':'||t.tgname)::int count from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relname=any($1) and not t.tgisinternal
        and t.tgname in ('escopo_imutavel','tax_monthly_rule_package_append_only','tax_monthly_rule_package_no_truncate',
          'tax_monthly_rule_package_event_append_only','tax_monthly_rule_package_event_no_truncate',
          'tax_monthly_declaration_append_only','tax_monthly_declaration_no_truncate','tax_monthly_declaration_event_append_only','tax_monthly_declaration_event_no_truncate',
          'tax_monthly_evidence_append_only','tax_monthly_evidence_no_truncate','tax_monthly_assessment_append_only','tax_monthly_assessment_no_truncate',
          'tax_monthly_assessment_event_append_only','tax_monthly_assessment_event_no_truncate')`, [TEST_TABLES]);
    expect(rows[0]?.count).toBe(21);
  }, 20_000);

  it('a aplicação não acessa tabela F36 sem contexto humano', async () => {
    const { rows } = await app.query('select * from app.tax_monthly_assessment');
    expect(rows).toEqual([]);
  }, 20_000);

  it('nega UPDATE/DELETE da aplicação e mantém os eventos protegidos sem contexto humano', async () => {
    const result = await admin.query<{ exists: boolean }>("select to_regclass('app.tax_monthly_assessment_event') is not null exists");
    if (!result.rows[0]?.exists) return;
    const client = await app.connect();
    try {
      await client.query('begin');
      await aplicarContextoDeTeste(client, '0197a1b2-0000-7000-8000-0000000000a1', '0197a1b2-0000-7000-8000-0000000000a2');
      await expect(client.query('update app.tax_monthly_assessment_event set correlation_id=correlation_id')).rejects.toThrow();
      await expect(client.query('delete from app.tax_monthly_assessment_event')).rejects.toThrow();
      await client.query('rollback');
    } finally { client.release(); }
  });
});
