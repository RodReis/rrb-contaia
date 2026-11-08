import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PoolDoBanco } from '../banco/pool.provider';
import { ModelosDreService } from './modelos-dre.service';

const admin = criarPool();
const app = criarPoolDaAplicacao();
const service = new ModelosDreService({ instancia: app } as PoolDoBanco);
let scenario: { tenantA: string; empresaA1: string; empresaA2: string; sourceVersionId: string; sourceAccountId: string; templateId?: string; usuarios: { naCarteira: string; foraDaCarteira: string } };
const actor = (usuarioId = scenario.usuarios.naCarteira) => ({ tenantId: scenario.tenantA, usuarioId });
const line = [{ code: 'RECEITA', title: 'Receita líquida', type: 'DETAIL' as const, order: 1, level: 0, parentCode: null, presentationSign: 1 as const, components: [], verticalBasis: true }];

beforeAll(async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(-13);
  const tenant = (await admin.query<{ id: string }>(`insert into app.tenant(razao_social,cnpj) values($1,$2) returning id`, [`F46 ${suffix}`, `M${suffix}`])).rows[0]!.id;
  const company = (await admin.query<{ id: string }>(`insert into app.empresa(tenant_id,cnpj,razao_social,status,situacao) values($1,$2,$3,'ATIVA','ativo') returning id`, [tenant, `E${suffix}`.slice(0, 14).padEnd(14, '0'), `Empresa F46 ${suffix}`])).rows[0]!.id;
  const user = (await admin.query<{ id: string }>(`insert into app.usuario(tenant_id,sub_oidc,email,nome,estado) values($1,$2,$3,'Usuário F46','ATIVO') returning id`, [tenant, `f46-${suffix}`, `f46-${suffix}@local.test`])).rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id) values($1,$2,$3)`, [tenant, user, company]);
  const companyB = (await admin.query<{ id: string }>(`insert into app.empresa(tenant_id,cnpj,razao_social,status,situacao) values($1,$2,$3,'ATIVA','ativo') returning id`, [tenant, `B${suffix}`.slice(0, 14).padEnd(14, '0'), `Empresa B F46 ${suffix}`])).rows[0]!.id;
  const userB = (await admin.query<{ id: string }>(`insert into app.usuario(tenant_id,sub_oidc,email,nome,estado) values($1,$2,$3,'Usuário B F46','ATIVO') returning id`, [tenant, `f46-b-${suffix}`, `f46-b-${suffix}@local.test`])).rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id) values($1,$2,$3)`, [tenant, userB, companyB]);
  const source = await admin.connect();
  let sourceVersionId = '';
  let sourceAccountId = '';
  try {
    await source.query(`set session_replication_role=replica`);
    await source.query('begin');
    sourceAccountId = (await source.query<{ id: string }>(
      `insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo) values($1,$2,$3,'Conta fonte sintética','analitica','credora','REVENUE','OPTIONAL') returning id`,
      [tenant, company, `F46-${suffix}`],
    )).rows[0]!.id;
    sourceVersionId = (await source.query<{ id: string }>(
      `insert into app.accounting_statement_version(tenant_id,company_id,version,status,effective_from,created_by,published_by,published_at,correlation_id) values($1,$2,1,'ACTIVE','2097-01',$3,$3,now(),'f46-source-fixture') returning id`,
      [tenant, company, user],
    )).rows[0]!.id;
    await source.query(
      `insert into app.accounting_statement_line(tenant_id,company_id,version_id,line_code,title,line_type,display_order,level,presentation_sign,vertical_basis) values($1,$2,$3,'RECEITA','Receita sanitizada','DETAIL',1,0,1,true)`,
      [tenant, company, sourceVersionId],
    );
    await source.query(
      `insert into app.accounting_statement_mapping(tenant_id,company_id,version_id,line_code,account_id,account_class,account_code,account_name) values($1,$2,$3,'RECEITA',$4,'REVENUE',$5,'Conta fonte sintética')`,
      [tenant, company, sourceVersionId, sourceAccountId, `F46-${suffix}`],
    );
    await source.query('commit');
  } catch (cause) {
    await source.query('rollback');
    throw cause;
  } finally {
    await source.query(`reset session_replication_role`);
    source.release();
  }
  scenario = { tenantA: tenant, empresaA1: company, empresaA2: companyB, sourceVersionId, sourceAccountId, usuarios: { naCarteira: user, foraDaCarteira: userB } };
}, 60_000);
afterAll(async () => {
  if (scenario) {
    const client = await admin.connect();
    try {
      await client.query(`set session_replication_role=replica`);
      const { rows } = await client.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema='app' and column_name='tenant_id'`);
      for (const { table_name } of rows) await client.query(`delete from app.${table_name} where tenant_id=$1`, [scenario.tenantA]);
      await client.query(`delete from app.tenant where id=$1`, [scenario.tenantA]);
    } finally { await client.query(`reset session_replication_role`); client.release(); }
  }
  await Promise.all([admin.end(), app.end()]);
});

describe('ModelosDreService F46', () => {
  it('publica estrutura sanitizada, aplica com idempotência e descarta rascunho sem alterar publicação', async () => {
    const created = await service.criar(actor(), { name: 'Modelo F46 integração', description: 'Teste da biblioteca' }, 'f46-service-create');
    scenario.templateId = created.templateId;
    expect((await service.listar(actor(), 'Modelo F46 integração', 'ACTIVE')).items[0]?.updatedByName).toBe('Usuário F46');
    await service.salvarLinhas(actor(), created.templateId, 1, { expectedRevision: 0, lines: line }, 'f46-service-save');
    const published = await service.publicar(actor(), created.templateId, 1, 1, 'f46-service-publish');
    expect(published.status).toBe('ACTIVE');
    const lockHolder = await admin.connect();
    await lockHolder.query('begin');
    await lockHolder.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`${scenario.tenantA}:${scenario.empresaA1}:statement`]);
    let applyFinished = false;
    const firstApplication = service.aplicar(actor(), created.templateId, { templateVersion: 1, companyId: scenario.empresaA1, expectedCompanyRevision: 0, idempotencyKey: 'f46-service-apply-001' }, 'f46-service-apply').then((value) => { applyFinished = true; return value; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(applyFinished).toBe(false);
    } finally {
      await lockHolder.query('commit');
      lockHolder.release();
    }
    const first = await firstApplication;
    const replay = await service.aplicar(actor(), created.templateId, { templateVersion: 1, companyId: scenario.empresaA1, expectedCompanyRevision: 0, idempotencyKey: 'f46-service-apply-001' }, 'f46-service-replay');
    expect(first.created).toBe(true);
    expect(replay).toEqual({ ...first, created: false });
    const applied = await admin.query<{ lineCount: string; mappingCount: string; status: string }>(
      `select (select count(*) from app.accounting_statement_line where version_id=$1) as "lineCount",(select count(*) from app.accounting_statement_mapping where version_id=$1) as "mappingCount",status from app.accounting_statement_version where id=$1`,
      [first.companyStatementDraftId],
    );
    expect(applied.rows[0]).toEqual({ lineCount: '1', mappingCount: '0', status: 'DRAFT' });
    const secondVersion = await service.criarVersao(actor(), created.templateId, 'f46-service-new-version');
    await service.publicar(actor(), created.templateId, secondVersion.version, 0, 'f46-service-publish-next');
    const replayAfterReplacement = await service.aplicar(actor(), created.templateId, { templateVersion: 1, companyId: scenario.empresaA1, expectedCompanyRevision: 0, idempotencyKey: 'f46-service-apply-001' }, 'f46-service-replay-replaced');
    expect(replayAfterReplacement).toEqual({ ...first, created: false });
    await service.alterarStatus(actor(), created.templateId, 'ARCHIVED', 'f46-service-archive');
    const replayAfterArchive = await service.aplicar(actor(), created.templateId, { templateVersion: 1, companyId: scenario.empresaA1, expectedCompanyRevision: 0, idempotencyKey: 'f46-service-apply-001' }, 'f46-service-replay-archived');
    expect(replayAfterArchive).toEqual({ ...first, created: false });
    await service.alterarStatus(actor(), created.templateId, 'ACTIVE', 'f46-service-reactivate');
    const draft = await service.criarVersao(actor(), created.templateId, 'f46-service-new-draft');
    const discarded = await service.descartarRascunho(actor(), created.templateId, draft.version, 'f46-service-discard');
    expect(discarded.status).toBe('DISCARDED');
    await expect(service.publicar(actor(), created.templateId, draft.version, 0, 'f46-service-invalid-publish')).rejects.toThrow('Somente rascunho pode ser publicado.');
    expect((await service.listarVersoes(actor(), created.templateId)).items.map((item) => item.status)).toEqual(['DISCARDED', 'ACTIVE', 'SUPERSEDED']);
  }, 30_000);

  it('copia somente a estrutura de uma origem empresarial com conta mapeada', async () => {
    const created = await service.criarDaEmpresa(actor(), {
      name: 'Modelo sanitizado F46', description: 'Origem empresarial', companyId: scenario.empresaA1, sourceVersionId: scenario.sourceVersionId,
    }, 'f46-source-clone');
    const detail = await service.obterVersao(actor(), created.templateId, 1);
    expect(detail.lines).toMatchObject([{ ...line[0], title: 'Receita sanitizada' }]);
    expect(JSON.stringify(detail)).not.toContain(scenario.sourceAccountId);
    expect(JSON.stringify(detail)).not.toContain(scenario.empresaA1);
    const provenance = await service.proveniencia(actor(), created.templateId, 1);
    expect(provenance.origin).toMatchObject({ companyId: scenario.empresaA1, sourceStatementVersionId: scenario.sourceVersionId });
  }, 30_000);

  it('traduz colisão de chave invisível pela carteira para conflito de aplicação', async () => {
    const templateId = scenario.templateId;
    if (!templateId) throw new Error('Modelo de integração F46 não foi criado.');
    const idempotencyKey = 'f46-hidden-application-002';
    const first = await service.aplicar(actor(), templateId, {
      templateVersion: 2, companyId: scenario.empresaA1, expectedCompanyRevision: 0, idempotencyKey,
    }, 'f46-hidden-first');
    expect(first.created).toBe(true);

    await expect(service.aplicar(actor(scenario.usuarios.foraDaCarteira), templateId, {
      templateVersion: 2, companyId: scenario.empresaA2, expectedCompanyRevision: 0, idempotencyKey,
    }, 'f46-hidden-reuse')).rejects.toMatchObject({ codigo: CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_APPLICATION_CONFLICT });
    const count = await admin.query<{ total: string }>(
      `select count(*)::text as total from app.accounting_statement_version where tenant_id=$1 and company_id=$2`,
      [scenario.tenantA, scenario.empresaA2],
    );
    expect(count.rows[0]?.total).toBe('0');
  }, 30_000);
});
