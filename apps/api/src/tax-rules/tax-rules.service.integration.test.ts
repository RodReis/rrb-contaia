/**
 * Casos de uso do catálogo tributário sobre o PostgreSQL real, pelo papel `contaia_app` sob o
 * contexto de serviço `CATALOGO_TRIBUTARIO` (SPEC-016 §3.2, §3.7, §3.8). O catálogo é append-only:
 * cada teste usa uma identidade própria em vez de limpar.
 */
import { randomUUID } from 'node:crypto';

import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { CreateTaxRule } from '@contaia/shared';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { TaxRulesService } from './tax-rules.service';

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();
const servico = new TaxRulesService({ instancia: app } as never);
const AGORA = new Date('2026-09-20T12:00:00.000Z');
servico.agora = () => AGORA;

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const superAdmin: AtorDoCatalogo = { id: randomUUID(), tipo: 'SUPER_ADMIN' };
const escritorio: AtorDoCatalogo = { id: randomUUID(), tipo: 'ESCRITORIO' };

/**
 * Identidade única por teste: o catálogo nunca apaga, então reexecutar com a mesma identidade
 * colidiria em vigência. O serviço não passa pelo zod, e o banco só exige o formato do tipo de
 * operação; a coerção de tipo fica restrita a este arquivo de teste.
 */
const identidade = (): Pick<CreateTaxRule, 'taxType' | 'regime' | 'operationType'> => ({
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: `OP_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}` as CreateTaxRule['operationType'],
});

const entrada = (overrides: Partial<CreateTaxRule> = {}): CreateTaxRule => ({
  ...identidade(),
  validFrom: '2026-01-01',
  validUntil: '2026-06-30',
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
  ...overrides,
});

const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `inesperado: ${String(erro)}`;
  }
  return undefined;
};

describe('ciclo de vida pelo caso de uso', () => {
  it('cria, edita, publica e arquiva; o DTO traz instantes ISO e a versão otimista', async () => {
    const regra = entrada();
    const criada = await servico.create(superAdmin, regra, 'corr-ciclo-0001');
    expect(criada).toMatchObject({
      status: 'DRAFT',
      versionNumber: 1,
      lockVersion: 1,
      createdBy: superAdmin.id,
      createdAt: AGORA.toISOString(),
      publishedAt: null,
      archivedAt: null,
    });

    const { taxType, regime, operationType, ...resto } = regra;
    void taxType;
    void regime;
    void operationType;
    const editada = await servico.update(superAdmin, criada.id, { ...resto, rateBasisPoints: 2_000, expectedVersion: 1 }, 'corr-ciclo-0002');
    expect(editada).toMatchObject({ lockVersion: 2, rateBasisPoints: 2_000 });

    const publicada = await servico.publish(superAdmin, criada.id, { expectedVersion: 2 }, 'corr-ciclo-0003');
    expect(publicada).toMatchObject({ status: 'PUBLISHED', lockVersion: 3, publishedAt: AGORA.toISOString() });

    const arquivada = await servico.archive(superAdmin, criada.id, { expectedVersion: 3 }, 'corr-ciclo-0004');
    expect(arquivada).toMatchObject({ status: 'ARCHIVED', lockVersion: 4, archivedAt: AGORA.toISOString() });
  });

  it('audita ator e correlationId de cada comando', async () => {
    const criada = await servico.create(superAdmin, entrada(), 'corr-audit-0001');
    await servico.publish(superAdmin, criada.id, { expectedVersion: 1 }, 'corr-audit-0002');

    const { rows } = await admin.query<{ action: string; actor_id: string; correlation_id: string }>(
      'select action, actor_id, correlation_id from app.tax_rule_audit_event where tax_rule_version_id = $1 order by sequence',
      [criada.id],
    );

    expect(rows).toEqual([
      { action: 'CREATED', actor_id: superAdmin.id, correlation_id: 'corr-audit-0001' },
      { action: 'PUBLISHED', actor_id: superAdmin.id, correlation_id: 'corr-audit-0002' },
    ]);
  });

  it('traduz as violações do banco para os códigos estáveis', async () => {
    const regra = entrada();
    const criada = await servico.create(superAdmin, regra, 'corr-erros-0001');
    const publicada = await servico.publish(superAdmin, criada.id, { expectedVersion: 1 }, 'corr-erros-0002');

    expect(await codigoDe(() => servico.publish(superAdmin, criada.id, { expectedVersion: 1 }, 'corr-erros-0003'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE,
    );

    const outra = await servico.create(superAdmin, { ...regra, validFrom: '2026-06-30', validUntil: null }, 'corr-erros-0004');
    expect(await codigoDe(() => servico.publish(superAdmin, outra.id, { expectedVersion: outra.lockVersion }, 'corr-erros-0005'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_OVERLAPPING_VALIDITY,
    );
    expect(await codigoDe(() => servico.archive(superAdmin, publicada.id, { expectedVersion: 1 }, 'corr-erros-0006'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT,
    );
    expect(await codigoDe(() => servico.get(superAdmin, randomUUID(), 'corr-erros-0007'))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND);
  });
});

describe('visibilidade por identidade (SPEC-016 §3.7)', () => {
  it('o escritório só enxerga versão publicada; o super_admin enxerga todas', async () => {
    const regra = entrada();
    const rascunho = await servico.create(superAdmin, regra, 'corr-vis-0001');
    const outra = await servico.create(superAdmin, { ...regra, validFrom: '2026-07-01', validUntil: null }, 'corr-vis-0002');
    const publicada = await servico.publish(superAdmin, outra.id, { expectedVersion: 1 }, 'corr-vis-0003');
    const filtro = { operationType: regra.operationType, taxType: regra.taxType, regime: regra.regime, page: 1, pageSize: 25 } as const;

    const doEscritorio = await servico.list(escritorio, filtro, 'corr-vis-0004');
    const daPlataforma = await servico.list(superAdmin, filtro, 'corr-vis-0005');

    expect(doEscritorio.items.map((item) => item.id)).toEqual([publicada.id]);
    expect(doEscritorio.total).toBe(1);
    // A tela só oferece criar, editar, publicar e arquivar a quem a API aceitaria.
    expect(doEscritorio.canAdminister).toBe(false);
    expect(daPlataforma.canAdminister).toBe(true);
    expect(daPlataforma.items.map((item) => item.id)).toEqual([publicada.id, rascunho.id]);
    expect(daPlataforma.total).toBe(2);
  });

  it('o escritório que pede estado diferente de publicada recebe lista vazia, nunca o rascunho', async () => {
    const regra = entrada();
    await servico.create(superAdmin, regra, 'corr-vis-0010');

    const resposta = await servico.list(escritorio, { ...regra, status: 'DRAFT', page: 1, pageSize: 25 }, 'corr-vis-0011');

    expect(resposta).toEqual({ items: [], total: 0, page: 1, pageSize: 25, canAdminister: false });
  });

  it('obter rascunho ou arquivada pelo escritório responde TAX_RULE_NOT_FOUND, como inexistente', async () => {
    const regra = entrada();
    const rascunho = await servico.create(superAdmin, regra, 'corr-vis-0020');
    const arquivada = await servico.create(superAdmin, { ...regra, validFrom: '2027-01-01', validUntil: null }, 'corr-vis-0021');
    const publicada = await servico.publish(superAdmin, arquivada.id, { expectedVersion: 1 }, 'corr-vis-0022');
    await servico.archive(superAdmin, arquivada.id, { expectedVersion: publicada.lockVersion }, 'corr-vis-0023');

    expect(await codigoDe(() => servico.get(escritorio, rascunho.id, 'corr-vis-0024'))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND);
    expect(await codigoDe(() => servico.get(escritorio, arquivada.id, 'corr-vis-0025'))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND);
    expect(await servico.get(superAdmin, rascunho.id, 'corr-vis-0026')).toMatchObject({ status: 'DRAFT' });
  });

  it('pagina com total e converte página em deslocamento', async () => {
    const regra = entrada();
    for (const ano of [2026, 2027, 2028]) {
      await servico.create(superAdmin, { ...regra, validFrom: `${ano}-01-01`, validUntil: `${ano}-12-31` }, `corr-pag-${ano}`);
    }
    const filtro = { operationType: regra.operationType, taxType: regra.taxType, regime: regra.regime, pageSize: 2 } as const;

    const primeira = await servico.list(superAdmin, { ...filtro, page: 1 }, 'corr-pag-0001');
    const segunda = await servico.list(superAdmin, { ...filtro, page: 2 }, 'corr-pag-0002');

    expect(primeira.total).toBe(3);
    expect(primeira.items.map((item) => item.validFrom)).toEqual(['2028-01-01', '2027-01-01']);
    expect(segunda.items.map((item) => item.validFrom)).toEqual(['2026-01-01']);
  });
});
