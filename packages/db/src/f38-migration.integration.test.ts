import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { criarPool, obterUrlDaAplicacao } from './client.js';
import { aplicarContextoDeTeste } from './testes/suporte.js';

const admin = criarPool();
const appUrl = new URL(obterUrlDaAplicacao()); appUrl.searchParams.set('application_name', 'f38-migration-test');
const app = new Pool({ connectionString: appUrl.toString(), max: 2 });
const tables = ['corporate_tax_rule_package','corporate_tax_rule_package_event','corporate_tax_declaration','corporate_tax_declaration_event',
  'corporate_tax_evidence','corporate_tax_assessment','corporate_tax_assessment_event','corporate_tax_artifact'];

afterAll(async () => { await Promise.all([admin.end(), app.end()]); });

describe('migration F38 / SPEC-038', () => {
  it('instala as oito tabelas com RLS forçada, índices e políticas por operação', async () => {
    const { rows } = await admin.query<{ tablename: string; rowsecurity: boolean; force: boolean; indexCount: number; policyCount: number }>(`
      select c.relname tablename,c.relrowsecurity rowsecurity,c.relforcerowsecurity force,
        (select count(*) from pg_indexes i where i.schemaname='app' and i.tablename=c.relname)::int "indexCount",
        (select count(*) from pg_policies p where p.schemaname='app' and p.tablename=c.relname)::int "policyCount"
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and c.relname=any($1)`, [tables]);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.rowsecurity && row.force && row.indexCount >= 3 && row.policyCount === 2)).toBe(true);
  });

  it('protege escopo, append-only e TRUNCATE e não concede escrita mutável ao papel da aplicação', async () => {
    const { rows } = await admin.query<{ tableCount: number; safeCount: number }>(`
      select count(distinct c.relname)::int "tableCount",
        count(distinct c.relname) filter (where not has_table_privilege('contaia_app',c.oid,'UPDATE')
          and not has_table_privilege('contaia_app',c.oid,'DELETE') and not has_table_privilege('contaia_app',c.oid,'TRUNCATE')
          and exists(select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal and t.tgname='escopo_imutavel')
          and exists(select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal and t.tgname=c.relname||'_append_only')
          and exists(select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal and t.tgname=c.relname||'_no_truncate'))::int "safeCount"
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and c.relname=any($1)`, [tables]);
    expect(rows[0]).toEqual({ tableCount: 8, safeCount: 8 });
  });

  it('limita as políticas de leitura e escrita ao contexto humano com carteira ativa', async () => {
    const { rows } = await admin.query<{ policyCount: number }>(`select count(*)::int "policyCount" from pg_policies
      where schemaname='app' and tablename=any($1) and (
        (policyname like '%_select' and coalesce(qual,'') like '%HUMANA%') or
        (policyname like '%_insert' and coalesce(with_check,'') like '%HUMANA%'))`, [tables]);
    expect(rows[0]?.policyCount).toBe(16);
  });

  it('concede SELECT e INSERT ao papel da aplicação, sem UPDATE, DELETE ou TRUNCATE', async () => {
    const { rows } = await admin.query<{ tableCount: number; grantedCount: number }>(`
      select count(*)::int "tableCount",
        count(*) filter (where has_table_privilege('contaia_app',c.oid,'SELECT')
          and has_table_privilege('contaia_app',c.oid,'INSERT')
          and not has_table_privilege('contaia_app',c.oid,'UPDATE')
          and not has_table_privilege('contaia_app',c.oid,'DELETE')
          and not has_table_privilege('contaia_app',c.oid,'TRUNCATE'))::int "grantedCount"
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relkind='r' and c.relname=any($1)`, [tables]);
    expect(rows[0]).toEqual({ tableCount: 8, grantedCount: 8 });
  });

  it('declara a concessão explícita e restrita no conjunto de migrations F38', async () => {
    const { readFile } = await import('node:fs/promises');
    const migration = await readFile(new URL('../migrations/0081_f38_app_grants.sql', import.meta.url), 'utf8');
    expect(migration).toContain('GRANT SELECT,INSERT ON app.corporate_tax_rule_package');
    expect(migration).not.toMatch(/GRANT\s+[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b/is);
    expect(migration).not.toMatch(/ON ALL TABLES|ON ALL SEQUENCES/is);
  });

  it('não expõe os novos registros sem contexto válido de empresa', async () => {
    const client = await app.connect();
    try {
      await client.query('begin');
      await aplicarContextoDeTeste(client, '0197a1b2-0000-7000-8000-0000000000a1', '0197a1b2-0000-7000-8000-0000000000a2');
      for (const table of tables) {
        const result = await client.query(`select * from app.${table}`);
        expect(result.rows).toEqual([]);
      }
      await client.query('rollback');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  });
});
