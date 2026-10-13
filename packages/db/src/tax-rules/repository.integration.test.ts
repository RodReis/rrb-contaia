/**
 * Catálogo tributário global (SPEC-016 §§3.1–3.3, §3.7–3.8, §4: I-6, I-7, I-8).
 *
 * As tabelas são globais e fechadas para a aplicação: só as funções `app.tax_rule_*`, sob o
 * contexto de serviço `CATALOGO_TRIBUTARIO`, entram. Linha publicada ou auditada nunca é apagada
 * (nem pelo superusuário), então cada teste usa uma identidade de regra própria em vez de limpar.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { CODIGOS_DE_ERRO, ErroDeDominio, contextoDeServico, contextoHumano } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from '../client.js';
import { comContexto } from '../contexto.js';
import {
  archive,
  createDraft,
  findApplicable,
  getById,
  list,
  publish,
  updateDraft,
  type TaxRuleActor,
  type TaxRuleContent,
  type TaxRuleEdit,
} from './repository.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const asCatalog = <T>(run: (client: PoolClient) => Promise<T>): Promise<T> =>
  comContexto(
    app,
    contextoDeServico({
      identidadeTecnica: 'api-catalogo-tributario',
      finalidade: 'CATALOGO_TRIBUTARIO',
      correlationId: 'teste-tax-rules',
    }),
    run,
  );

const actor = (overrides: Partial<TaxRuleActor> = {}): TaxRuleActor => ({
  actorId: randomUUID(),
  now: new Date('2026-09-20T12:00:00.000Z'),
  correlationId: 'teste-tax-rules',
  ...overrides,
});

/** Operação própria por teste: o catálogo é append-only e as suítes rodam em paralelo. */
const uniqueOperation = (): string => `OP_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;

const content = (operationType: string, overrides: Partial<TaxRuleContent> = {}): TaxRuleContent => ({
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType,
  validFrom: '2026-01-01',
  validUntil: '2026-06-30',
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
  ...overrides,
});

/** Edição de rascunho: a identidade (tributo, regime, operação) é fixa desde a criação. */
const edit = (overrides: Partial<TaxRuleEdit> = {}): TaxRuleEdit => ({
  validFrom: '2026-01-01',
  validUntil: '2026-06-30',
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
  ...overrides,
});

const codeOf = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run();
  } catch (error) {
    return error instanceof ErroDeDominio ? error.codigo : `inesperado: ${String(error)}`;
  }
  return undefined;
};

const auditOf = async (versionId: string) =>
  (
    await admin.query<{
      action: string;
      actor_id: string;
      previous_lock_version: number | null;
      resulting_lock_version: number;
      correlation_id: string;
      occurred_at: Date;
    }>(
      `select action, actor_id, previous_lock_version, resulting_lock_version, correlation_id, occurred_at
         from app.tax_rule_audit_event where tax_rule_version_id = $1 order by sequence`,
      [versionId],
    )
  ).rows;

describe('rascunho', () => {
  it('cria a versão 1 em RASCUNHO e audita a criação com ator, instante e correlationId', async () => {
    const op = uniqueOperation();
    const who = actor();

    const draft = await asCatalog((c) => createDraft(c, who, content(op)));

    expect(draft).toMatchObject({
      status: 'DRAFT',
      versionNumber: 1,
      lockVersion: 1,
      taxType: 'ICMS',
      regime: 'LUCRO_PRESUMIDO',
      operationType: op,
      validFrom: '2026-01-01',
      validUntil: '2026-06-30',
      baseReductionBasisPoints: null,
      rateBasisPoints: 1_800,
      createdBy: who.actorId,
      publishedAt: null,
      archivedAt: null,
    });
    expect(await auditOf(draft.id)).toEqual([
      expect.objectContaining({
        action: 'CREATED',
        actor_id: who.actorId,
        previous_lock_version: null,
        resulting_lock_version: 1,
        correlation_id: 'teste-tax-rules',
        occurred_at: who.now,
      }),
    ]);
  });

  it('numera a próxima versão da mesma identidade', async () => {
    const op = uniqueOperation();

    const first = await asCatalog((c) => createDraft(c, actor(), content(op)));
    const second = await asCatalog((c) => createDraft(c, actor(), content(op, { validFrom: '2026-07-01', validUntil: null })));

    expect([first.versionNumber, second.versionNumber]).toEqual([1, 2]);
    expect(second.taxRuleId).toBe(first.taxRuleId);
  });

  it('edita o rascunho com a versão esperada e audita versão anterior e resultante', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));

    const edited = await asCatalog((c) =>
      updateDraft(c, actor(), draft.id, draft.lockVersion, edit({ rateBasisPoints: 2_000, baseReductionBasisPoints: 3_333 })),
    );

    expect(edited).toMatchObject({ lockVersion: 2, rateBasisPoints: 2_000, baseReductionBasisPoints: 3_333, status: 'DRAFT' });
    expect((await auditOf(draft.id)).map((e) => [e.action, e.previous_lock_version, e.resulting_lock_version])).toEqual([
      ['CREATED', null, 1],
      ['UPDATED', 1, 2],
    ]);
  });

  it('recusa edição com versão desatualizada sem alterar o rascunho', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    await asCatalog((c) => updateDraft(c, actor(), draft.id, 1, edit({ rateBasisPoints: 1_900 })));

    const code = await codeOf(() =>
      asCatalog((c) => updateDraft(c, actor(), draft.id, 1, edit({ rateBasisPoints: 2_500 }))),
    );

    expect(code).toBe(CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT);
    expect(await asCatalog((c) => getById(c, draft.id))).toMatchObject({ rateBasisPoints: 1_900, lockVersion: 2 });
  });

  it('recusa vigência final anterior à inicial', async () => {
    const op = uniqueOperation();

    await expect(
      asCatalog((c) => createDraft(c, actor(), content(op, { validFrom: '2026-06-30', validUntil: '2026-01-01' }))),
    ).rejects.toThrow();
  });

  it.each([
    ['alíquota acima de 100%', { rateBasisPoints: 10_001 }],
    ['redução acima de 100%', { baseReductionBasisPoints: 10_001 }],
    ['alíquota negativa', { rateBasisPoints: -1 }],
  ])('recusa %s', async (_name, overrides) => {
    await expect(
      asCatalog((c) => createDraft(c, actor(), content(uniqueOperation(), overrides))),
    ).rejects.toThrow();
  });

  it('responde TAX_RULE_NOT_FOUND para versão inexistente', async () => {
    const id = randomUUID();

    expect(await codeOf(() => asCatalog((c) => getById(c, id)))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND);
    expect(await codeOf(() => asCatalog((c) => updateDraft(c, actor(), id, 1, edit())))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND,
    );
    expect(await codeOf(() => asCatalog((c) => publish(c, actor(), id, 1)))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND);
    expect(await codeOf(() => asCatalog((c) => archive(c, actor(), id, 1)))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND);
  });
});

describe('publicação e imutabilidade', () => {
  it('congela a versão publicada e audita a publicação', async () => {
    const op = uniqueOperation();
    const who = actor({ now: new Date('2026-09-21T09:30:00.000Z') });
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));

    const published = await asCatalog((c) => publish(c, who, draft.id, draft.lockVersion));

    expect(published).toMatchObject({ status: 'PUBLISHED', lockVersion: 2, publishedAt: who.now });
    expect((await auditOf(draft.id)).map((e) => [e.action, e.previous_lock_version, e.resulting_lock_version])).toEqual([
      ['CREATED', null, 1],
      ['PUBLISHED', 1, 2],
    ]);
  });

  it('responde TAX_RULE_IMMUTABLE ao editar ou republicar versão publicada', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    const published = await asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));

    expect(
      await codeOf(() => asCatalog((c) => updateDraft(c, actor(), draft.id, published.lockVersion, edit({ rateBasisPoints: 1 })))),
    ).toBe(CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE);
    expect(await codeOf(() => asCatalog((c) => publish(c, actor(), draft.id, published.lockVersion)))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE,
    );
    expect(await asCatalog((c) => getById(c, draft.id))).toMatchObject({ rateBasisPoints: 1_800, lockVersion: 2 });
  });

  it('recusa publicar com versão desatualizada', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    await asCatalog((c) => updateDraft(c, actor(), draft.id, 1, edit({ rateBasisPoints: 1_900 })));

    expect(await codeOf(() => asCatalog((c) => publish(c, actor(), draft.id, 1)))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT,
    );
  });

  it('rejeita vigência sobreposta de forma atômica, sem alterar nenhuma versão', async () => {
    const op = uniqueOperation();
    const first = await asCatalog((c) => createDraft(c, actor(), content(op)));
    await asCatalog((c) => publish(c, actor(), first.id, first.lockVersion));
    const overlapping = await asCatalog((c) =>
      createDraft(c, actor(), content(op, { validFrom: '2026-06-30', validUntil: null })),
    );

    const code = await codeOf(() => asCatalog((c) => publish(c, actor(), overlapping.id, overlapping.lockVersion)));

    expect(code).toBe(CODIGOS_DE_ERRO.TAX_RULE_OVERLAPPING_VALIDITY);
    expect(await asCatalog((c) => getById(c, overlapping.id))).toMatchObject({ status: 'DRAFT', lockVersion: 1 });
    expect(await asCatalog((c) => getById(c, first.id))).toMatchObject({ status: 'PUBLISHED' });
    expect((await auditOf(overlapping.id)).map((e) => e.action)).toEqual(['CREATED']);
  });

  it('aceita intervalos adjacentes e outras identidades com as mesmas datas', async () => {
    const op = uniqueOperation();
    const first = await asCatalog((c) => createDraft(c, actor(), content(op)));
    await asCatalog((c) => publish(c, actor(), first.id, first.lockVersion));
    const adjacent = await asCatalog((c) =>
      createDraft(c, actor(), content(op, { validFrom: '2026-07-01', validUntil: null })),
    );
    const otherRegime = await asCatalog((c) => createDraft(c, actor(), content(op, { regime: 'LUCRO_REAL' })));

    expect(await asCatalog((c) => publish(c, actor(), adjacent.id, adjacent.lockVersion))).toMatchObject({ status: 'PUBLISHED' });
    expect(await asCatalog((c) => publish(c, actor(), otherRegime.id, otherRegime.lockVersion))).toMatchObject({
      status: 'PUBLISHED',
    });
  });
});

describe('arquivamento', () => {
  it('arquiva a versão publicada preservando o conteúdo e a auditoria', async () => {
    const op = uniqueOperation();
    const who = actor({ now: new Date('2026-10-01T00:00:00.000Z') });
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    const published = await asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));

    const archived = await asCatalog((c) => archive(c, who, draft.id, published.lockVersion));

    expect(archived).toMatchObject({
      status: 'ARCHIVED',
      lockVersion: 3,
      archivedAt: who.now,
      validFrom: '2026-01-01',
      validUntil: '2026-06-30',
      rateBasisPoints: 1_800,
    });
    expect((await auditOf(draft.id)).map((e) => e.action)).toEqual(['CREATED', 'PUBLISHED', 'ARCHIVED']);
  });

  it('libera o intervalo para uma versão substituta, sem reescrever a arquivada', async () => {
    const op = uniqueOperation();
    const old = await asCatalog((c) => createDraft(c, actor(), content(op)));
    const oldPublished = await asCatalog((c) => publish(c, actor(), old.id, old.lockVersion));
    await asCatalog((c) => archive(c, actor(), old.id, oldPublished.lockVersion));
    const replacement = await asCatalog((c) => createDraft(c, actor(), content(op, { rateBasisPoints: 1_700 })));

    const published = await asCatalog((c) => publish(c, actor(), replacement.id, replacement.lockVersion));

    expect(published).toMatchObject({ status: 'PUBLISHED', versionNumber: 2, rateBasisPoints: 1_700 });
    expect(await asCatalog((c) => getById(c, old.id))).toMatchObject({ status: 'ARCHIVED', rateBasisPoints: 1_800 });
  });

  it('só arquiva versão publicada: rascunho e arquivada respondem TAX_RULE_IMMUTABLE', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    expect(await codeOf(() => asCatalog((c) => archive(c, actor(), draft.id, draft.lockVersion)))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE,
    );

    const published = await asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));
    const archived = await asCatalog((c) => archive(c, actor(), draft.id, published.lockVersion));
    expect(await codeOf(() => asCatalog((c) => archive(c, actor(), draft.id, archived.lockVersion)))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE,
    );
  });

  it('recusa arquivar com versão desatualizada', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    await asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));

    expect(await codeOf(() => asCatalog((c) => archive(c, actor(), draft.id, 1)))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT,
    );
  });
});

describe('seleção por vigência e listagem', () => {
  it('devolve só versões publicadas vigentes na data do fato, ignorando rascunho, arquivada e futura', async () => {
    const op = uniqueOperation();
    const publish1 = async (overrides: Partial<TaxRuleContent>) => {
      const draft = await asCatalog((c) => createDraft(c, actor(), content(op, overrides)));
      return asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));
    };
    const past = await publish1({ validFrom: '2026-01-01', validUntil: '2026-06-30' });
    const future = await publish1({ validFrom: '2026-07-01', validUntil: null, rateBasisPoints: 1_700 });
    const toArchive = await publish1({ regime: 'LUCRO_REAL' });
    await asCatalog((c) => archive(c, actor(), toArchive.id, toArchive.lockVersion));
    await asCatalog((c) => createDraft(c, actor(), content(op, { regime: 'SIMPLES_NACIONAL' })));

    const criteria = { taxType: 'ICMS', regime: 'LUCRO_PRESUMIDO', operationType: op } as const;
    const inPast = await asCatalog((c) => findApplicable(c, { ...criteria, factDate: '2026-06-30' }));
    const inFuture = await asCatalog((c) => findApplicable(c, { ...criteria, factDate: '2026-07-01' }));
    const before = await asCatalog((c) => findApplicable(c, { ...criteria, factDate: '2025-12-31' }));
    const archivedRegime = await asCatalog((c) =>
      findApplicable(c, { ...criteria, regime: 'LUCRO_REAL', factDate: '2026-03-01' }),
    );
    const draftRegime = await asCatalog((c) =>
      findApplicable(c, { ...criteria, regime: 'SIMPLES_NACIONAL', factDate: '2026-03-01' }),
    );

    expect(inPast).toEqual([
      {
        id: past.id,
        version: past.versionNumber,
        status: 'PUBLISHED',
        taxType: 'ICMS',
        regime: 'LUCRO_PRESUMIDO',
        operationType: op,
        validFrom: '2026-01-01',
        validUntil: '2026-06-30',
        operation: { rateBasisPoints: 1_800 },
      },
    ]);
    expect(inFuture.map((rule) => rule.id)).toEqual([future.id]);
    expect(inFuture[0]).toMatchObject({ validUntil: null, operation: { rateBasisPoints: 1_700 } });
    expect([before, archivedRegime, draftRegime]).toEqual([[], [], []]);
  });

  it('carrega a redução de base na operação', async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) =>
      createDraft(c, actor(), content(op, { baseReductionBasisPoints: 3_333, rateBasisPoints: 1_800 })),
    );
    await asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));

    const [rule] = await asCatalog((c) =>
      findApplicable(c, { taxType: 'ICMS', regime: 'LUCRO_PRESUMIDO', operationType: op, factDate: '2026-03-01' }),
    );

    expect(rule?.operation).toEqual({ baseReductionBasisPoints: 3_333, rateBasisPoints: 1_800 });
  });

  it('lista com filtros, ordem estável e paginação com total', async () => {
    const op = uniqueOperation();
    const make = (overrides: Partial<TaxRuleContent>) =>
      asCatalog((c) => createDraft(c, actor(), content(op, overrides)));
    const a = await make({ validFrom: '2026-01-01', validUntil: '2026-03-31' });
    const b = await make({ validFrom: '2026-04-01', validUntil: '2026-06-30' });
    const d = await make({ validFrom: '2026-07-01', validUntil: null });
    await asCatalog((c) => publish(c, actor(), a.id, a.lockVersion));

    const all = await asCatalog((c) => list(c, { operationType: op, limit: 10, offset: 0 }));
    const firstPage = await asCatalog((c) => list(c, { operationType: op, limit: 2, offset: 0 }));
    const secondPage = await asCatalog((c) => list(c, { operationType: op, limit: 2, offset: 2 }));
    const onlyPublished = await asCatalog((c) => list(c, { operationType: op, status: 'PUBLISHED', limit: 10, offset: 0 }));
    const onDate = await asCatalog((c) => list(c, { operationType: op, validOn: '2026-05-15', limit: 10, offset: 0 }));

    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.id)).toEqual([d.id, b.id, a.id]);
    expect(firstPage.items.map((item) => item.id)).toEqual([d.id, b.id]);
    expect(secondPage.items.map((item) => item.id)).toEqual([a.id]);
    expect(secondPage.total).toBe(3);
    expect(onlyPublished.items.map((item) => item.id)).toEqual([a.id]);
    expect(onDate.items.map((item) => item.id)).toEqual([b.id]);
  });
});

describe('fechamento da tabela global', () => {
  it('a aplicação não alcança as tabelas diretamente', async () => {
    for (const table of ['tax_rule', 'tax_rule_version', 'tax_rule_audit_event']) {
      await expect(app.query(`select 1 from app.${table} limit 1`)).rejects.toThrow(/permission denied/u);
    }
    await expect(app.query(`insert into app.tax_rule (tax_type, regime, operation_type) values ('ICMS', 'LUCRO_REAL', 'X')`)).rejects.toThrow(
      /permission denied/u,
    );
  });

  it('as funções recusam chamada sem contexto de serviço do catálogo', async () => {
    await expect(app.query(`select * from app.tax_rule_list(null, null, null, null, null, 10, 0)`)).rejects.toThrow(
      /contexto de servico/u,
    );

    const human = contextoHumano({ tenantId: randomUUID(), usuarioId: randomUUID(), correlationId: 'teste' });
    await expect(comContexto(app, human, (c) => c.query(`select * from app.tax_rule_list(null, null, null, null, null, 10, 0)`))).rejects.toThrow(
      /contexto de servico/u,
    );

    const monitor = contextoDeServico({
      identidadeTecnica: 'workers-monitor-signer',
      finalidade: 'MONITORAMENTO_DO_SIGNER',
      correlationId: 'teste',
    });
    await expect(comContexto(app, monitor, (c) => c.query(`select * from app.tax_rule_list(null, null, null, null, null, 10, 0)`))).rejects.toThrow(
      /contexto de servico/u,
    );
  });

  it('o catálogo não vira acesso a tabela de tenant', async () => {
    await expect(asCatalog((c) => c.query('select 1 from app.empresa limit 1'))).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe('proteção em nível de banco, inclusive contra o superusuário das migrations', () => {
  const publishedVersion = async () => {
    const op = uniqueOperation();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(op)));
    return asCatalog((c) => publish(c, actor(), draft.id, draft.lockVersion));
  };

  it('bloqueia alterar o conteúdo de versão publicada por UPDATE direto', async () => {
    const published = await publishedVersion();

    await expect(admin.query('update app.tax_rule_version set rate_basis_points = 1 where id = $1', [published.id])).rejects.toThrow(
      /TAX_RULE_IMMUTABLE/u,
    );
    await expect(admin.query(`update app.tax_rule_version set valid_until = '2099-12-31' where id = $1`, [published.id])).rejects.toThrow(
      /TAX_RULE_IMMUTABLE/u,
    );
  });

  it('bloqueia voltar o estado para rascunho e excluir qualquer versão', async () => {
    const published = await publishedVersion();
    const draft = await asCatalog((c) => createDraft(c, actor(), content(uniqueOperation())));

    await expect(admin.query(`update app.tax_rule_version set status = 'DRAFT' where id = $1`, [published.id])).rejects.toThrow(
      /TAX_RULE_IMMUTABLE/u,
    );
    await expect(admin.query('delete from app.tax_rule_version where id = $1', [published.id])).rejects.toThrow(/TAX_RULE_IMMUTABLE/u);
    await expect(admin.query('delete from app.tax_rule_version where id = $1', [draft.id])).rejects.toThrow(/TAX_RULE_IMMUTABLE/u);
  });

  it('a auditoria é append-only: UPDATE e DELETE são recusados', async () => {
    const published = await publishedVersion();

    await expect(
      admin.query(`update app.tax_rule_audit_event set correlation_id = 'x' where tax_rule_version_id = $1`, [published.id]),
    ).rejects.toThrow();
    await expect(admin.query('delete from app.tax_rule_audit_event where tax_rule_version_id = $1', [published.id])).rejects.toThrow();
  });

  it('o bloco de rollback da migration desfaz o catálogo por inteiro', async () => {
    const sql = readFileSync(new URL('../../migrations/0019_tax_rules.sql', import.meta.url), 'utf8');
    const rollback = /-- ROLLBACK:INICIO\r?\n([\s\S]*?)-- ROLLBACK:FIM/u.exec(sql)?.[1]?.replace(/^-- ?/gmu, '');
    expect(rollback).toBeDefined();

    const client = await admin.connect();
    try {
      await client.query('begin');
      await client.query(rollback as string);
      const { rows } = await client.query<{ objeto: string | null }>(
        `select to_regclass('app.tax_rule')::text as objeto
         union all select to_regclass('app.tax_rule_version')::text
         union all select to_regclass('app.tax_rule_audit_event')::text
         union all select to_regtype('app.tax_rule_version_row')::text
         union all select to_regprocedure('app.tax_rule_publish(uuid, timestamptz, text, uuid, integer)')::text
         union all select to_regprocedure('app.contexto_do_catalogo_tributario()')::text`,
      );

      expect(rows.map((row) => row.objeto)).toEqual([null, null, null, null, null, null]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('o catálogo não tem tenant_id nem empresa_id', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'app' and table_name in ('tax_rule', 'tax_rule_version', 'tax_rule_audit_event')
          and column_name in ('tenant_id', 'empresa_id')`,
    );

    expect(rows).toEqual([]);
  });
});
