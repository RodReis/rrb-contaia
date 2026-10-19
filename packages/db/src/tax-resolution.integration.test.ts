import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextoDeServico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto, comContextoHumano } from './contexto.js';
import { listarItensParaResolucaoTributaria, obterRegimeTributarioHistorico, persistirSnapshotsResolucaoTributaria } from './repositorios/fiscal-documents.js';
import { limparCenario, montarCenario } from './testes/cenario-rls.js';
import { FIXTURES } from './testes/fixtures-rls.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
let cenario: Awaited<ReturnType<typeof montarCenario>>;
let documentId = '';
const parserVersion = 'fixture';
const asCatalog = <T>(run: (client: PoolClient) => Promise<T>): Promise<T> => comContexto(
  app,
  contextoDeServico({ identidadeTecnica: 'api-catalogo-tributario', finalidade: 'CATALOGO_TRIBUTARIO', correlationId: 'f26-package-test' }),
  run,
);
const importarPacoteFixture = async (packageId: string, sha256: string): Promise<{ id: string; sha256: string }> =>
  asCatalog(async (client) => {
    const result = await client.query<{ id: string }>(
      'select (app.tax_package_import($1,$2,$3,$4,$5,$6::jsonb,$7)).id',
      [randomUUID(), new Date().toISOString(), randomUUID(), packageId, '1.0.0', '{}', sha256],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('id do pacote fixture ausente');
    return { id, sha256 };
  });

beforeAll(async () => {
  cenario = await montarCenario(admin);
  const fixture = FIXTURES['app.tax_entry_resolution_snapshot'];
  if (!fixture?.preparar) throw new Error('fixture de snapshot F26 ausente');
  const refs = await fixture.preparar(admin, {
    tenantId: cenario.tenantA, empresaId: cenario.empresaA1,
    autorId: cenario.usuarios.naCarteira, sufixo: cenario.sufixo,
  });
  documentId = refs['documentId'] ?? '';
  await admin.query(
    `insert into app.fiscal_document_item
       (tenant_id,empresa_id,document_id,parser_version,numero,tipo,descricao,ncm,cfop,cst_csosn)
     values($1,$2,$3,'fixture',2,'ITEM','Item fiscal de teste','12345678','1102','00')
     on conflict(document_id,parser_version,numero) do update set ncm=excluded.ncm,cfop=excluded.cfop,cst_csosn=excluded.cst_csosn`,
    [cenario.tenantA,cenario.empresaA1,documentId],
  );
}, 120_000);

afterAll(async () => {
  if (cenario) await limparCenario(admin, cenario);
  await Promise.all([admin.end(), app.end()]);
});

describe('snapshots tributários F26', () => {
  it('retorna tributos persistidos por item para fatos da resolução', async () => {
    await admin.query(
      `insert into app.fiscal_document_tax
         (tenant_id,empresa_id,document_id,parser_version,escopo,numero_item,codigo,valor)
       values($1,$2,$3,'fixture','ITEM',2,'ICMS_ST',12.34)
       on conflict do nothing`,
      [cenario.tenantA,cenario.empresaA1,documentId],
    );
    const result = await comContextoHumano(app, { tenantId: cenario.tenantA, usuarioId: cenario.usuarios.naCarteira, correlationId: 'f26-item-tax-facts' },
      (client) => listarItensParaResolucaoTributaria(client,cenario.empresaA1,documentId));
    expect(result?.tributos).toContainEqual(expect.objectContaining({ escopo: 'ITEM', numero_item: 2, codigo: 'ICMS_ST' }));
  });

  const persist = (idempotencyKey: string, inputSha256: string, reprocessingReason: string | null = null,
    taxPackage: Readonly<{ id: string; sha256: string }> | null = null, targetDocumentId = documentId) =>
    comContextoHumano(app, { tenantId: cenario.tenantA, usuarioId: cenario.usuarios.naCarteira, correlationId: 'f26-snapshot-test' }, (client) =>
      persistirSnapshotsResolucaoTributaria(client, {
        tenantId: cenario.tenantA, empresaId: cenario.empresaA1, documentId: targetDocumentId,
        actorId: cenario.usuarios.naCarteira, correlationId: 'f26-snapshot-test', idempotencyKey,
        expectedParserVersion: parserVersion, reprocessingReason, packageId: taxPackage?.id ?? null, packageSha256: taxPackage?.sha256 ?? null,
        items: [{ itemNumber: 1, parserVersion, inputSha256, facts: { ncm: '12345678' },
          decisions: [{ tax: 'ICMS', status: 'INDETERMINATE' }] }],
      }));

  it('repete a mesma chave sem criar outra revisão e exige motivo na revisão seguinte', async () => {
    const testKey = randomUUID();
    const first = await persist(testKey, 'a'.repeat(64));
    const replay = await persist(testKey, 'a'.repeat(64));
    expect(first.revision).toBe(1);
    expect(first.reused).toBe(false);
    expect(replay.revision).toBe(1);
    expect(replay.reused).toBe(true);
    const nextKey = randomUUID();
    await expect(persist(nextKey, 'b'.repeat(64)))
      .rejects.toThrow('Informe o motivo');
    const revised = await persist(nextKey, 'b'.repeat(64), 'Atualização de contexto fiscal');
    expect(revised.revision).toBe(2);
  }, 30_000);

  it('recusa reutilizar chave idempotente com hash diferente', async () => {
    const testKey = randomUUID();
    await persist(testKey, 'c'.repeat(64), 'Fixture isolada de idempotência');
    await expect(persist(testKey, 'd'.repeat(64))).rejects.toThrow('chave idempotente');
  });

  it('recusa reutilizar chave com outro pacote ou hash normativo', async () => {
    const packageA = await importarPacoteFixture(`f26-test-${randomUUID()}`, 'a'.repeat(64));
    const packageB = await importarPacoteFixture(`f26-test-${randomUUID()}`, 'b'.repeat(64));
    const testKey = randomUUID();
    await persist(testKey, 'e'.repeat(64), 'Fixture isolada de pacote', packageA);
    await expect(persist(testKey, 'e'.repeat(64), null, packageB)).rejects.toThrow('chave idempotente');
  });

  it('permite reprocessamento com nova chave e nova versão de pacote quando justificado', async () => {
    const firstPackage = await importarPacoteFixture(`f26-test-${randomUUID()}`, 'f'.repeat(64));
    const nextPackage = await importarPacoteFixture(`f26-test-${randomUUID()}`, '1'.repeat(64));
    const isolated = await FIXTURES['app.tax_entry_resolution_snapshot']?.preparar?.(admin, {
      tenantId: cenario.tenantA, empresaId: cenario.empresaA1,
      autorId: cenario.usuarios.naCarteira, sufixo: cenario.sufixo,
    });
    const isolatedDocumentId = isolated?.['documentId'];
    if (!isolatedDocumentId) throw new Error('documento isolado para reprocessamento ausente');
    const firstKey = randomUUID();
    const nextKey = randomUUID();
    const first = await persist(firstKey, '1'.repeat(64), null, firstPackage, isolatedDocumentId);
    const next = await persist(nextKey, '2'.repeat(64), 'Atualização normativa validada', nextPackage, isolatedDocumentId);
    expect(first.revision).toBe(1);
    expect(next.revision).toBe(2);
  });

  it('seleciona o regime cadastral vigente na data fiscal, sem usar a versão atual por inferência', async () => {
    const regime = await comContextoHumano(app, { tenantId: cenario.tenantA, usuarioId: cenario.usuarios.naCarteira, correlationId: 'f26-regime-history-test' }, async (client) => {
      await client.query(
        `insert into app.empresa_evento_de_historico (tenant_id,empresa_id,aba,acao,campo,valor_novo,vigencia,usuario_id)
         values ($1,$2,'DADOS_FISCAIS','ALTERACAO','regimeTributario','SIMPLES_NACIONAL','2030-01-01',$3),
                ($1,$2,'DADOS_FISCAIS','ALTERACAO','regimeTributario','LUCRO_PRESUMIDO','2030-07-01',$3)`,
        [cenario.tenantA,cenario.empresaA1,cenario.usuarios.naCarteira],
      );
      return Promise.all([
        obterRegimeTributarioHistorico(client,cenario.empresaA1,'2030-03-15'),
        obterRegimeTributarioHistorico(client,cenario.empresaA1,'2030-08-15'),
        obterRegimeTributarioHistorico(client,cenario.empresaA1,null),
      ]);
    });
    expect(regime).toEqual([
      { regime: 'SIMPLES_NACIONAL', vigente_desde: '2030-01-01' },
      { regime: 'LUCRO_PRESUMIDO', vigente_desde: '2030-07-01' },
      null,
    ]);
  });

  it('audita o ciclo do pacote, exige revisor distinto e impede sobreposição publicada', async () => {
    const packageId = `f26-${randomUUID()}`;
    const effectiveYear = 2500 + (Number.parseInt(randomUUID().slice(0,8),16) % 7000);
    const effectiveDate = `${effectiveYear}-01-01`;
    const importer = randomUUID();
    const reviewer = randomUUID();
    const content = { jurisdiction: 'BR', regimes: ['SIMPLES_NACIONAL'], validFrom: effectiveDate, validUntil: `${effectiveYear}-12-31` };
    const saved = await asCatalog(async (client) => {
      const imported = await client.query<{ id: string }>(
        `select (app.tax_package_import($1,$2,$3,$4,$5,$6::jsonb,$7)).id`,
        [importer,'2096-12-01T12:00:00Z','f26-import',packageId,'1.0.0',JSON.stringify(content),'d'.repeat(64)],
      );
      const id = imported.rows[0]?.id;
      if (!id) throw new Error('id do pacote ausente');
      await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[id,importer,'2096-12-01T12:01:00Z','f26-validate','VALIDATED','{"valid":true}']);
      await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[id,reviewer,'2096-12-01T12:02:00Z','f26-review','REVIEWED','{"declaration":"Fonte oficial conferida"}']);
      await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[id,reviewer,'2096-12-01T12:03:00Z','f26-publish','PUBLISHED','{}']);
      const secondId = `f26-${randomUUID()}`;
      const second = await client.query<{ id: string }>(
        `select (app.tax_package_import($1,$2,$3,$4,$5,$6::jsonb,$7)).id`,
        [importer,'2096-12-02T12:00:00Z','f26-import-overlap',secondId,'1.0.0',JSON.stringify(content),'e'.repeat(64)],
      );
      const overlapId = second.rows[0]?.id;
      if (!overlapId) throw new Error('id do segundo pacote ausente');
      await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[overlapId,importer,'2096-12-02T12:01:00Z','f26-validate-overlap','VALIDATED','{}']);
      await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[overlapId,reviewer,'2096-12-02T12:02:00Z','f26-review-overlap','REVIEWED','{}']);
      await client.query('savepoint before_overlapping_publish');
      let overlappingError = '';
      try {
        await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[overlapId,reviewer,'2096-12-02T12:03:00Z','f26-publish-overlap','PUBLISHED','{}']);
      } catch (error) {
        overlappingError = error instanceof Error ? error.message : String(error);
        await client.query('rollback to savepoint before_overlapping_publish');
      }
      await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[id,reviewer,'2096-12-01T12:04:00Z','f26-archive','ARCHIVED','{}']);
      return { packageId: id, overlappingError };
    });
    const events = await admin.query<{ count: string }>('select count(*)::text as count from app.tax_resolution_package_event where package_id=$1',[saved.packageId]);
    expect(Number(events.rows[0]?.count)).toBe(5);
    expect(saved.overlappingError).toContain('TAX_PACKAGE_OVERLAPPING_VALIDITY');
  }, 30_000);
});
