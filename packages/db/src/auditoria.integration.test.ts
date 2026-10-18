import { afterAll, describe, expect, it } from 'vitest';
import { criarPool } from './client.js';

const pool=criarPool();
afterAll(async()=>pool.end());

describe('F24 audit ledger',()=>{
  it('limita privilégios diretos e mantém RLS forçada nos registros',async()=>{
    const result=await pool.query("SELECT has_table_privilege('contaia_app','app.audit_event','SELECT') event_select, has_table_privilege('contaia_app','app.audit_event','INSERT') event_insert, has_table_privilege('contaia_app','app.audit_event','UPDATE') event_update, has_table_privilege('contaia_app','app.audit_event','DELETE') event_delete, has_table_privilege('contaia_app','app.audit_payload','SELECT') payload_select, has_table_privilege('contaia_app','app.audit_payload','UPDATE') payload_update, has_table_privilege('contaia_app','app.audit_payload','DELETE') payload_delete, has_table_privilege('contaia_app','app.audit_export_job','INSERT') job_insert, has_table_privilege('contaia_app','app.audit_export_job','UPDATE') job_update, has_table_privilege('contaia_app','app.audit_export_download','INSERT') download_insert, has_table_privilege('contaia_app','app.audit_export_download','UPDATE') download_update, has_table_privilege('contaia_app','app.audit_export_manifest','INSERT') manifest_insert, has_table_privilege('contaia_app','app.audit_export_manifest','UPDATE') manifest_update, has_table_privilege('contaia_app','app.audit_export_manifest','DELETE') manifest_delete, (SELECT relrowsecurity FROM pg_class WHERE oid='app.audit_event'::regclass) event_rls, (SELECT relforcerowsecurity FROM pg_class WHERE oid='app.audit_event'::regclass) event_force_rls, (SELECT relrowsecurity FROM pg_class WHERE oid='app.audit_payload'::regclass) payload_rls, (SELECT relrowsecurity FROM pg_class WHERE oid='app.audit_export_manifest'::regclass) manifest_rls");
    expect(result.rows[0]).toEqual({
      event_select:true,event_insert:false,event_update:false,event_delete:false,
      payload_select:true,payload_update:false,payload_delete:false,
      job_insert:true,job_update:false,download_insert:true,download_update:false,
      manifest_insert:true,manifest_update:false,manifest_delete:false,
      event_rls:true,event_force_rls:true,payload_rls:true,manifest_rls:true,
    });
  });

  it('instala captura transacional somente nas origens F20, F21 e F22',async()=>{
    const result=await pool.query("SELECT c.relname table_name,t.tgname trigger_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND NOT t.tgisinternal AND t.tgname LIKE 'audit_capture%'");
    expect(result.rows.map((row:{table_name:string})=>row.table_name)).toEqual(expect.arrayContaining([
      'fiscal_risk_execution','fiscal_risk_analysis','fiscal_risk_attempt','fiscal_risk_event',
      'fiscal_manifestation_event','obligation_event','audit_payload_revelation',
      'audit_export_job','audit_export_download',
    ]));
    expect(result.rows.map((row:{table_name:string})=>row.table_name)).not.toContain('audit_export_manifest');
  });

  it('recusa expiração sem contexto técnico',async()=>{
    await expect(pool.query('SELECT app.audit_expire_payloads()')).rejects.toMatchObject({code:'42501'});
  });

  it('não cria cópia integral da decisão humana F21 e preserva eventos de transmissão',async()=>{
    const names=await pool.query("SELECT tgname FROM pg_trigger WHERE tgrelid='app.fiscal_manifestation'::regclass AND NOT tgisinternal");
    expect(names.rows.map((row:{tgname:string})=>row.tgname)).not.toContain('audit_capture');
    const events=await pool.query("SELECT tgname FROM pg_trigger WHERE tgrelid='app.fiscal_manifestation_event'::regclass AND NOT tgisinternal");
    expect(events.rows.map((row:{tgname:string})=>row.tgname)).toContain('audit_capture');
  });

  it('revelação de payload tem tabela append-only sob RLS e captura um novo evento',async()=>{
    const result=await pool.query("SELECT has_table_privilege('contaia_app','app.audit_payload_revelation','INSERT') insert_allowed,has_table_privilege('contaia_app','app.audit_payload_revelation','UPDATE') update_allowed,has_table_privilege('contaia_app','app.audit_payload_revelation','DELETE') delete_allowed,(SELECT relforcerowsecurity FROM pg_class WHERE oid='app.audit_payload_revelation'::regclass) force_rls");
    expect(result.rows[0]).toEqual({insert_allowed:true,update_allowed:false,delete_allowed:false,force_rls:true});
    const trigger=await pool.query("SELECT tgname FROM pg_trigger WHERE tgrelid='app.audit_payload_revelation'::regclass AND NOT tgisinternal");
    expect(trigger.rows.map((row:{tgname:string})=>row.tgname)).toContain('audit_capture');
  });
});
