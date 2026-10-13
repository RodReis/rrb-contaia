/**
 * Casos de uso do catálogo tributário global (SPEC-016 §3.2, §3.7, §6.1). Cada comando abre UMA
 * transação sob o contexto de serviço `CATALOGO_TRIBUTARIO` (global, sem tenant); a autorização do
 * ator já foi decidida pelo guard e o ator entra só para a auditoria. O instante vem daqui, nunca
 * do relógio do banco nem de função pura.
 */
import { Injectable } from '@nestjs/common';

import { taxRules, type TaxRuleActor, type TaxRuleVersionRecord } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type {
  CreateTaxRule,
  ListTaxRulesQuery,
  TaxRuleCommand,
  TaxRulePageDto,
  TaxRuleVersionDto,
  UpdateTaxRule,
} from '@contaia/shared';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { noCatalogoTributario } from './catalogo-contexto';

export const paraDto = (registro: TaxRuleVersionRecord): TaxRuleVersionDto => ({
  id: registro.id,
  taxRuleId: registro.taxRuleId,
  versionNumber: registro.versionNumber,
  lockVersion: registro.lockVersion,
  status: registro.status,
  taxType: registro.taxType,
  regime: registro.regime,
  operationType: registro.operationType,
  validFrom: registro.validFrom,
  validUntil: registro.validUntil,
  baseReductionBasisPoints: registro.baseReductionBasisPoints,
  rateBasisPoints: registro.rateBasisPoints,
  source: registro.source,
  fixtureNote: registro.fixtureNote,
  createdBy: registro.createdBy,
  createdAt: registro.createdAt.toISOString(),
  publishedAt: registro.publishedAt?.toISOString() ?? null,
  archivedAt: registro.archivedAt?.toISOString() ?? null,
});

/** Papel de escritório só enxerga o que está publicado; rascunho e arquivada são da administração. */
const naoEhAdministracao = (ator: AtorDoCatalogo): boolean => ator.tipo !== 'SUPER_ADMIN';

@Injectable()
export class TaxRulesService {
  /** Injetável nos testes; em produção é o relógio do processo, lido uma vez por comando. */
  agora: () => Date = () => new Date();

  constructor(private readonly pool: PoolDoBanco) {}

  private noCatalogo<T>(correlationId: string, executar: (cliente: PoolClient) => Promise<T>): Promise<T> {
    return noCatalogoTributario(this.pool.instancia, correlationId, executar);
  }

  private comando(ator: AtorDoCatalogo, correlationId: string): TaxRuleActor {
    return { actorId: ator.id, now: this.agora(), correlationId };
  }

  async list(ator: AtorDoCatalogo, consulta: ListTaxRulesQuery, correlationId: string): Promise<TaxRulePageDto> {
    const { page, pageSize, status, ...filtros } = consulta;

    const canAdminister = !naoEhAdministracao(ator);

    if (!canAdminister && status !== undefined && status !== 'PUBLISHED') {
      return { items: [], total: 0, page, pageSize, canAdminister };
    }

    const pagina = await this.noCatalogo(correlationId, (cliente) =>
      taxRules.list(cliente, {
        ...filtros,
        ...(naoEhAdministracao(ator) ? { status: 'PUBLISHED' as const } : status === undefined ? {} : { status }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    );

    return { items: pagina.items.map(paraDto), total: pagina.total, page, pageSize, canAdminister };
  }

  async get(ator: AtorDoCatalogo, id: string, correlationId: string): Promise<TaxRuleVersionDto> {
    const registro = await this.noCatalogo(correlationId, (cliente) => taxRules.getById(cliente, id));

    if (naoEhAdministracao(ator) && registro.status !== 'PUBLISHED') {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND, 'Versão de regra tributária não encontrada.');
    }

    return paraDto(registro);
  }

  async create(ator: AtorDoCatalogo, entrada: CreateTaxRule, correlationId: string): Promise<TaxRuleVersionDto> {
    const registro = await this.noCatalogo(correlationId, (cliente) =>
      taxRules.createDraft(cliente, this.comando(ator, correlationId), entrada),
    );

    return paraDto(registro);
  }

  async update(ator: AtorDoCatalogo, id: string, entrada: UpdateTaxRule, correlationId: string): Promise<TaxRuleVersionDto> {
    const { expectedVersion, ...edicao } = entrada;
    const registro = await this.noCatalogo(correlationId, (cliente) =>
      taxRules.updateDraft(cliente, this.comando(ator, correlationId), id, expectedVersion, edicao),
    );

    return paraDto(registro);
  }

  async publish(ator: AtorDoCatalogo, id: string, comando: TaxRuleCommand, correlationId: string): Promise<TaxRuleVersionDto> {
    const registro = await this.noCatalogo(correlationId, (cliente) =>
      taxRules.publish(cliente, this.comando(ator, correlationId), id, comando.expectedVersion),
    );

    return paraDto(registro);
  }

  async archive(ator: AtorDoCatalogo, id: string, comando: TaxRuleCommand, correlationId: string): Promise<TaxRuleVersionDto> {
    const registro = await this.noCatalogo(correlationId, (cliente) =>
      taxRules.archive(cliente, this.comando(ator, correlationId), id, comando.expectedVersion),
    );

    return paraDto(registro);
  }
}
