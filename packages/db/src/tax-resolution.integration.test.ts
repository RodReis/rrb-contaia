import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextoDeServico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto, comContextoHumano } from './contexto.js';
import { decidirRevisaoResolucaoTributaria, listarItensParaResolucaoTributaria, obterRegimeTributarioHistorico, persistirSnapshotsResolucaoTributaria, registrarEventoResolucaoTributaria, submeterRevisaoResolucaoTributaria } from './repositorios/fiscal-documents.js';
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
  it('submete e aprova cálculo histórico com papel autorizado, versão otimista e trilha append-only', async()=>{
    await admin.query("insert into app.usuario_papel(tenant_id,usuario_id,papel) values($1,$2,'contador')",[cenario.tenantA,cenario.usuarios.naCarteira]);
    const saved=await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:'f28-human-review'},async(client)=>{
      return persistirSnapshotsResolucaoTributaria(client,{tenantId:cenario.tenantA,empresaId:cenario.empresaA1,documentId,
        actorId:cenario.usuarios.naCarteira,correlationId:'f28-human-review',idempotencyKey:randomUUID(),expectedParserVersion:parserVersion,
        reprocessingReason:null,packageId:null,packageSha256:null,items:[{itemNumber:2,parserVersion,inputSha256:'9'.repeat(64),facts:{},decisions:[{
          tax:'ICMS_HISTORICAL',liabilityKind:'ICMS_ENTRY_ADVANCE',status:'APPLICABLE',amountDueCents:'1234',sourceIds:['source-reviewed'],
        }]}]});
    });
    let review!:Record<string,unknown>;
    await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:'f28-human-review'},async(client)=>{
      review=await submeterRevisaoResolucaoTributaria(client,{snapshotId:saved.snapshots[0]!.id,empresaId:cenario.empresaA1,
        liabilityKind:'ICMS_ENTRY_ADVANCE',actorId:cenario.usuarios.naCarteira,now:new Date(),correlationId:'f28-human-review'});
    });
    expect(review['status']).toBe('PENDING_REVIEW');
    const approved=await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:'f28-human-approve'},async(client)=>{
      const result=await decidirRevisaoResolucaoTributaria(client,{reviewId:String(review['id']),empresaId:cenario.empresaA1,
        actorId:cenario.usuarios.naCarteira,now:new Date(),expectedVersion:1,action:'APPROVED',reason:null,correlationId:'f28-human-approve'});
      expect(result['status']).toBe('APPROVED');
      expect(result['lock_version']).toBe(2);
      return result;
    });
    expect(approved['events']).toHaveLength(2);
    let staleError: unknown;
    try {
      await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:'f28-stale'},async(client)=>
        decidirRevisaoResolucaoTributaria(client,{reviewId:String(review['id']),empresaId:cenario.empresaA1,
          actorId:cenario.usuarios.naCarteira,now:new Date(Date.now()+10),expectedVersion:1,action:'APPROVED',reason:null,correlationId:'f28-stale'}));
    } catch (error) {
      staleError = error;
    }
    expect(staleError).toBeInstanceOf(Error);
    expect((staleError as Error).message).toContain('TAX_REVIEW_CONFLICT');
    let duplicateDecisionError: unknown;
    try {
      await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:'f28-duplicate-decision'},async(client)=>
        decidirRevisaoResolucaoTributaria(client,{reviewId:String(review['id']),empresaId:cenario.empresaA1,
          actorId:cenario.usuarios.naCarteira,now:new Date(Date.now()+20),expectedVersion:2,action:'REJECTED',reason:'decisão concorrente duplicada',correlationId:'f28-duplicate-decision'}));
    } catch (error) {
      duplicateDecisionError = error;
    }
    expect(duplicateDecisionError).toBeInstanceOf(Error);
    expect((duplicateDecisionError as Error).message).toContain('TAX_REVIEW_CONFLICT');
    await expect(admin.query("delete from app.tax_entry_resolution_human_review_event where review_id=$1",[review['id']])).rejects.toThrow();
  },30_000);

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

  it('grava evento de resolução uma vez e mantém a trilha imutável', async () => {
    const event = { tenantId:cenario.tenantA,empresaId:cenario.empresaA1,documentId,actorId:cenario.usuarios.naCarteira,
      correlationId:'f26-event-ledger',action:'ABSTAINED' as const,revision:88,packageId:null,itemCount:2,indeterminateCount:2,
      idempotencyKey:`f26-event:${randomUUID()}` };
    await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:event.correlationId},async(client)=>{
      await registrarEventoResolucaoTributaria(client,event);
      await registrarEventoResolucaoTributaria(client,event);
    });
    const { rows } = await admin.query('select * from app.tax_entry_resolution_event where tenant_id=$1 and idempotency_key=$2',[event.tenantId,event.idempotencyKey]);
    expect(rows).toHaveLength(1);
    await expect(admin.query("update app.tax_entry_resolution_event set action='PROCESSED' where id=$1",[rows[0]?.id])).rejects.toThrow();
    await expect(admin.query('delete from app.tax_entry_resolution_event where id=$1',[rows[0]?.id])).rejects.toThrow();
  },30_000);

  const persist = (idempotencyKey: string, inputSha256: string, reprocessingReason: string | null = null,
    taxPackage: Readonly<{ id: string; sha256: string }> | null = null, targetDocumentId = documentId,
    itemNumbers: readonly number[] = [1]) =>
    comContextoHumano(app, { tenantId: cenario.tenantA, usuarioId: cenario.usuarios.naCarteira, correlationId: 'f26-snapshot-test' }, (client) =>
      persistirSnapshotsResolucaoTributaria(client, {
        tenantId: cenario.tenantA, empresaId: cenario.empresaA1, documentId: targetDocumentId,
        actorId: cenario.usuarios.naCarteira, correlationId: 'f26-snapshot-test', idempotencyKey,
        expectedParserVersion: parserVersion, reprocessingReason, packageId: taxPackage?.id ?? null, packageSha256: taxPackage?.sha256 ?? null,
        items: itemNumbers.map((itemNumber) => ({ itemNumber, parserVersion, inputSha256, facts: { ncm: '12345678' },
          decisions: [{ tax: 'ICMS', status: 'INDETERMINATE' }] })),
      }));

  it('repete a mesma chave sem criar outra revisão e exige motivo na revisão seguinte', async () => {
    const isolated = await FIXTURES['app.tax_entry_resolution_snapshot']?.preparar?.(admin,{tenantId:cenario.tenantA,empresaId:cenario.empresaA1,autorId:cenario.usuarios.naCarteira,sufixo:`idem-${randomUUID()}`});
    const targetDocumentId=isolated?.['documentId'];
    if(!targetDocumentId)throw new Error('documento isolado para idempotência ausente');
    const testKey = randomUUID();
    const first = await persist(testKey, 'a'.repeat(64),null,null,targetDocumentId);
    const replay = await persist(testKey, 'a'.repeat(64),null,null,targetDocumentId);
    expect(first.revision).toBe(1);
    expect(first.reused).toBe(false);
    expect(replay.revision).toBe(1);
    expect(replay.reused).toBe(true);
    const nextKey = randomUUID();
    await expect(persist(nextKey, 'b'.repeat(64),null,null,targetDocumentId))
      .rejects.toThrow('Informe o motivo');
    const revised = await persist(nextKey, 'b'.repeat(64), 'Atualização de contexto fiscal',null,targetDocumentId);
    expect(revised.revision).toBe(2);
  }, 30_000);

  it('recusa reutilizar chave idempotente com hash diferente', async () => {
    const testKey = randomUUID();
    await persist(testKey, 'c'.repeat(64), 'Fixture isolada de idempotência');
    await expect(persist(testKey, 'd'.repeat(64))).rejects.toThrow('chave idempotente');
  });

  it('recusa reuso idempotente quando os itens repetidos não correspondem ao snapshot', async () => {
    const testKey = randomUUID();
    await persist(testKey, 'f'.repeat(64), 'Reprocessamento para testar a lista de itens', null, documentId, [1, 2]);
    await expect(persist(testKey, 'f'.repeat(64), null, null, documentId, [1, 1]))
      .rejects.toThrow('chave idempotente');
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
    const content = { jurisdiction: 'BR', regimes: ['SIMPLES_NACIONAL'], validFrom: effectiveDate, validUntil: `${effectiveYear}-12-31`,
      document:{model:'55',direction:'ENTRY',purpose:'RESALE'},operations:['COMPRA_INTERNA_REVENDA'] };
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

  it('permite vigências sobrepostas quando o escopo de documento ou operação é distinto', async () => {
    const year = 2600 + (Number.parseInt(randomUUID().slice(0,8),16) % 6000);
    const from = `${year}-01-01`, until = `${year}-12-31`;
    const actor = randomUUID(), reviewer = randomUUID();
    const publish = async (key:string, document:string, operation:string) => asCatalog(async(client) => {
      const content = { jurisdiction:'BR',regimes:['SIMPLES_NACIONAL'],validFrom:from,validUntil:until,
        document:{model:document, direction:'ENTRY',purpose:'RESALE'},operations:[operation] };
      const imported = await client.query<{id:string}>('select (app.tax_package_import($1,$2,$3,$4,$5,$6::jsonb,$7)).id',
        [actor,`${year-1}-12-01T12:00:00Z`,`f26-scope-${key}`,`f26-${key}-${randomUUID()}`,'1.0.0',JSON.stringify(content),randomUUID().replaceAll('-','').padEnd(64,'0').slice(0,64)]);
      const id = imported.rows[0]?.id;
      if(!id) throw new Error('pacote ausente');
      for(const [action,who] of [['VALIDATED',actor],['REVIEWED',reviewer],['PUBLISHED',reviewer]] as const)
        await client.query('select app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)',[id,who,`${year-1}-12-01T12:01:00Z`,`f26-${key}-${action}`,action,'{}']);
      return id;
    });
    await publish('entry-a','55','COMPRA_INTERNA_REVENDA');
    await expect(publish('entry-b','65','COMPRA_INTERNA_REVENDA')).resolves.toBeTruthy();
    await expect(publish('entry-c','55','COMPRA_INTERESTADUAL_REVENDA')).resolves.toBeTruthy();
  },30_000);
});
