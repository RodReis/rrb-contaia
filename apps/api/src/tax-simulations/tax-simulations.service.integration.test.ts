/**
 * Simulação manual sobre o PostgreSQL real (SPEC-016 §3.5, §8 "Vigência" e "Contrafactual"):
 * seleção única pela data do fato, ausência, arquivamento e regra futura sem efeito retroativo,
 * pelo papel `contaia_app` sob o contexto de serviço do catálogo.
 */
import { randomUUID } from 'node:crypto';

import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { CreateTaxRule, ManualTaxSimulation } from '@contaia/shared';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { TaxSimulationsService } from './tax-simulations.service';

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();
const catalogo = new TaxRulesService({ instancia: app } as never);
const simulacoes = new TaxSimulationsService({ instancia: app } as never);
catalogo.agora = () => new Date('2026-09-20T12:00:00.000Z');

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const superAdmin: AtorDoCatalogo = { id: randomUUID(), tipo: 'SUPER_ADMIN' };
const escritorio: AtorDoCatalogo = { id: randomUUID(), tipo: 'ESCRITORIO' };

/** O catálogo nunca apaga: identidade única por teste. O serviço não passa pelo zod (só o banco). */
const operacaoUnica = (): CreateTaxRule['operationType'] =>
  `OP_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}` as CreateTaxRule['operationType'];

const regra = (operationType: CreateTaxRule['operationType'], overrides: Partial<CreateTaxRule> = {}): CreateTaxRule => ({
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

const publicar = async (entrada: CreateTaxRule) => {
  const criada = await catalogo.create(superAdmin, entrada, 'corr-sim-seed');

  return catalogo.publish(superAdmin, criada.id, { expectedVersion: criada.lockVersion }, 'corr-sim-seed');
};

const simulacao = (operationType: CreateTaxRule['operationType'], overrides: Partial<ManualTaxSimulation> = {}): ManualTaxSimulation => ({
  factDate: '2026-06-15',
  regime: 'LUCRO_PRESUMIDO',
  taxType: 'ICMS',
  operationType,
  baseCents: 10_000,
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

describe('simulação manual contra o catálogo real', () => {
  it('seleciona a versão vigente na data do fato e devolve regra, vigência, fixture e memória', async () => {
    const op = operacaoUnica();
    const publicada = await publicar(regra(op, { baseReductionBasisPoints: 3_333 }));

    const resultado = await simulacoes.simulateManual(escritorio, simulacao(op), 'corr-sim-0001');

    expect(resultado.rule).toEqual({
      id: publicada.id,
      versionNumber: 1,
      taxType: 'ICMS',
      regime: 'LUCRO_PRESUMIDO',
      operationType: op,
      validFrom: '2026-01-01',
      validUntil: '2026-06-30',
      source: 'Fixture de teste não oficial',
      fixtureNote: 'Dado de teste não oficial',
    });
    expect(resultado.memory).toMatchObject({
      ruleId: publicada.id,
      baseCents: 10_000,
      baseReductionBasisPoints: 3_333,
      rateBasisPoints: 1_800,
      unrounded: { numerator: '60003', denominator: '50' },
      rounding: 'HALF_UP',
      resultCents: 1_200,
    });
  });

  it('usa os limites inclusivos e troca de versão na transição entre vigências', async () => {
    const op = operacaoUnica();
    const antiga = await publicar(regra(op, { validFrom: '2026-01-01', validUntil: '2026-06-30', rateBasisPoints: 1_800 }));
    const nova = await publicar(regra(op, { validFrom: '2026-07-01', validUntil: null, rateBasisPoints: 2_000 }));

    const ultimoDia = await simulacoes.simulateManual(escritorio, simulacao(op, { factDate: '2026-06-30' }), 'corr-sim-0010');
    const primeiroDia = await simulacoes.simulateManual(escritorio, simulacao(op, { factDate: '2026-07-01' }), 'corr-sim-0011');

    expect(ultimoDia.memory).toMatchObject({ ruleId: antiga.id, resultCents: 1_800 });
    expect(primeiroDia.memory).toMatchObject({ ruleId: nova.id, resultCents: 2_000 });
  });

  it('sem regra vigente na data responde TAX_RULE_NOT_APPLICABLE, sem calcular', async () => {
    const op = operacaoUnica();
    await publicar(regra(op));

    expect(await codigoDe(() => simulacoes.simulateManual(escritorio, simulacao(op, { factDate: '2025-12-31' }), 'corr-sim-0020'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE,
    );
    expect(await codigoDe(() => simulacoes.simulateManual(escritorio, simulacao(operacaoUnica()), 'corr-sim-0021'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE,
    );
  });

  it('ignora rascunho e versão arquivada', async () => {
    const op = operacaoUnica();
    await catalogo.create(superAdmin, regra(op), 'corr-sim-0030');
    expect(await codigoDe(() => simulacoes.simulateManual(escritorio, simulacao(op), 'corr-sim-0031'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE,
    );

    const outraOp = operacaoUnica();
    const publicada = await publicar(regra(outraOp));
    await catalogo.archive(superAdmin, publicada.id, { expectedVersion: publicada.lockVersion }, 'corr-sim-0032');
    expect(await codigoDe(() => simulacoes.simulateManual(escritorio, simulacao(outraOp), 'corr-sim-0033'))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE,
    );
  });

  it('contrafactual: publicar regra futura depois não altera a simulação de fato anterior', async () => {
    const op = operacaoUnica();
    await publicar(regra(op, { validFrom: '2026-01-01', validUntil: '2026-06-30' }));
    const antes = await simulacoes.simulateManual(escritorio, simulacao(op), 'corr-sim-0040');

    await publicar(regra(op, { validFrom: '2026-07-01', validUntil: null, rateBasisPoints: 2_500 }));
    const depois = await simulacoes.simulateManual(escritorio, simulacao(op), 'corr-sim-0041');

    expect(JSON.stringify(depois)).toBe(JSON.stringify(antes));
  });

  it('reproduz exatamente memória e resultado para a mesma entrada e versão', async () => {
    const op = operacaoUnica();
    await publicar(regra(op, { baseReductionBasisPoints: 2_500, rateBasisPoints: 3_333 }));

    const primeira = await simulacoes.simulateManual(escritorio, simulacao(op, { baseCents: Number.MAX_SAFE_INTEGER }), 'corr-sim-0050');
    const segunda = await simulacoes.simulateManual(escritorio, simulacao(op, { baseCents: Number.MAX_SAFE_INTEGER }), 'corr-sim-0051');

    expect(JSON.stringify(segunda)).toBe(JSON.stringify(primeira));
    expect(primeira.memory.resultCents).toBe(2_251_574_633_703_879);
  });

  it('a simulação não grava auditoria nem altera o catálogo', async () => {
    const op = operacaoUnica();
    const publicada = await publicar(regra(op));
    const eventos = async (): Promise<number> => {
      const { rows } = await admin.query<{ total: string }>(
        `select count(*)::text as total from app.tax_rule_audit_event e
           join app.tax_rule_version v on v.id = e.tax_rule_version_id
           join app.tax_rule r on r.id = v.tax_rule_id
          where r.operation_type = $1`,
        [op],
      );

      return Number(rows[0]?.total);
    };
    const antes = await eventos();

    await simulacoes.simulateManual(escritorio, simulacao(op), 'corr-sim-0060');

    expect(await eventos()).toBe(antes);
    expect(await catalogo.get(superAdmin, publicada.id, 'corr-sim-0061')).toMatchObject({
      status: 'PUBLISHED',
      lockVersion: publicada.lockVersion,
    });
  });
});
