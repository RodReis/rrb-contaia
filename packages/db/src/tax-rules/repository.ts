/**
 * Catálogo tributário global (SPEC-016 §3.1–3.3, §3.7–3.8). As tabelas ficam fechadas para a
 * aplicação: toda operação é uma função `app.tax_rule_*` sob o contexto de serviço
 * `CATALOGO_TRIBUTARIO` (ver `comContexto` + `contextoDeServico`). A API autoriza o ator; ele entra
 * aqui só para a auditoria. O repositório não calcula tributo nem escolhe regra por precedência.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  type CodigoDeErro,
  type DataCivil,
  type TaxRegime,
  type TaxRule,
  type TaxRuleStatus,
  type TaxType,
} from '@contaia/domain';
import type { PoolClient } from 'pg';

/** Quem comanda e quando: o instante vem do caso de uso, nunca do relógio do banco (I-11). */
export type TaxRuleActor = Readonly<{
  actorId: string;
  now: Date;
  correlationId: string;
}>;

export type TaxRuleEdit = Readonly<{
  validFrom: DataCivil;
  validUntil: DataCivil | null;
  baseReductionBasisPoints: number | null;
  rateBasisPoints: number;
  source: string;
  fixtureNote: string;
}>;

export type TaxRuleContent = TaxRuleEdit &
  Readonly<{
    taxType: TaxType;
    regime: TaxRegime;
    operationType: string;
  }>;

export type TaxRuleVersionRecord = TaxRuleContent &
  Readonly<{
    id: string;
    taxRuleId: string;
    versionNumber: number;
    status: TaxRuleStatus;
    /** Versão otimista: o cliente a devolve no próximo comando. */
    lockVersion: number;
    createdBy: string;
    createdAt: Date;
    publishedBy: string | null;
    publishedAt: Date | null;
    archivedBy: string | null;
    archivedAt: Date | null;
  }>;

/** Filtro ausente ou `undefined` não restringe: o repositório o envia como `null`. */
export type TaxRuleListFilters = Readonly<{
  taxType?: TaxType | undefined;
  regime?: TaxRegime | undefined;
  operationType?: string | undefined;
  status?: TaxRuleStatus | undefined;
  validOn?: DataCivil | undefined;
  limit: number;
  offset: number;
}>;

export type TaxRuleCriteria = Readonly<{
  taxType: TaxType;
  regime: TaxRegime;
  operationType: string;
  factDate: DataCivil;
}>;

type VersionRow = Readonly<{
  id: string;
  tax_rule_id: string;
  version_number: number;
  status: TaxRuleStatus;
  tax_type: TaxType;
  regime: TaxRegime;
  operation_type: string;
  valid_from: string;
  valid_until: string | null;
  base_reduction_basis_points: number | null;
  rate_basis_points: number;
  source: string;
  fixture_note: string;
  lock_version: number;
  created_by: string;
  created_at: Date;
  published_by: string | null;
  published_at: Date | null;
  archived_by: string | null;
  archived_at: Date | null;
}>;

const toRecord = (row: VersionRow): TaxRuleVersionRecord => ({
  id: row.id,
  taxRuleId: row.tax_rule_id,
  versionNumber: row.version_number,
  status: row.status,
  taxType: row.tax_type,
  regime: row.regime,
  operationType: row.operation_type,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  baseReductionBasisPoints: row.base_reduction_basis_points,
  rateBasisPoints: row.rate_basis_points,
  source: row.source,
  fixtureNote: row.fixture_note,
  lockVersion: row.lock_version,
  createdBy: row.created_by,
  createdAt: row.created_at,
  publishedBy: row.published_by,
  publishedAt: row.published_at,
  archivedBy: row.archived_by,
  archivedAt: row.archived_at,
});

const toDomainRule = (row: VersionRow): TaxRule => ({
  id: row.id,
  version: row.version_number,
  status: row.status,
  taxType: row.tax_type,
  regime: row.regime,
  operationType: row.operation_type,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  operation:
    row.base_reduction_basis_points === null
      ? { rateBasisPoints: row.rate_basis_points }
      : { baseReductionBasisPoints: row.base_reduction_basis_points, rateBasisPoints: row.rate_basis_points },
});

const MESSAGES: Readonly<Record<string, string>> = {
  TAX_RULE_NOT_FOUND: 'Versão de regra tributária não encontrada.',
  TAX_RULE_IMMUTABLE: 'A versão não aceita esse comando no estado atual.',
  TAX_RULE_VERSION_CONFLICT: 'A versão foi alterada por outra pessoa. Recarregue e tente de novo.',
  TAX_RULE_OVERLAPPING_VALIDITY: 'Já existe versão publicada com vigência sobreposta para esta regra.',
};

const DATABASE_CODES: readonly CodigoDeErro[] = [
  CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND,
  CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE,
  CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT,
];

const OVERLAP_CONSTRAINT = 'tax_rule_version_no_overlap';

type PgError = Error & { code?: string; constraint?: string };

/** Violações conhecidas viram o código estável da SPEC; o resto sobe intacto (nunca expõe SQL). */
const mapDatabaseError = (error: unknown): unknown => {
  if (!(error instanceof Error)) {
    return error;
  }
  const { code, constraint, message } = error as PgError;

  if (code === '23P01' && constraint === OVERLAP_CONSTRAINT) {
    return new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_OVERLAPPING_VALIDITY, MESSAGES['TAX_RULE_OVERLAPPING_VALIDITY'] ?? message);
  }

  const known = DATABASE_CODES.find((candidate) => message.startsWith(`${candidate}:`));
  return known === undefined ? error : new ErroDeDominio(known, MESSAGES[known] ?? message);
};

const run = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
};

const oneVersion = async (client: PoolClient, sql: string, params: readonly unknown[]): Promise<TaxRuleVersionRecord> =>
  run(async () => {
    const { rows } = await client.query<VersionRow>(sql, [...params]);
    const [row] = rows;
    if (row === undefined) {
      throw new Error('a função do catálogo tributário não devolveu a versão');
    }
    return toRecord(row);
  });

export const createDraft = (client: PoolClient, actor: TaxRuleActor, content: TaxRuleContent): Promise<TaxRuleVersionRecord> =>
  oneVersion(client, 'select * from app.tax_rule_create_draft($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [
    actor.actorId,
    actor.now,
    actor.correlationId,
    content.taxType,
    content.regime,
    content.operationType,
    content.validFrom,
    content.validUntil,
    content.baseReductionBasisPoints,
    content.rateBasisPoints,
    content.source,
    content.fixtureNote,
  ]);

export const updateDraft = (
  client: PoolClient,
  actor: TaxRuleActor,
  id: string,
  expectedLockVersion: number,
  edit: TaxRuleEdit,
): Promise<TaxRuleVersionRecord> =>
  oneVersion(client, 'select * from app.tax_rule_update_draft($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [
    actor.actorId,
    actor.now,
    actor.correlationId,
    id,
    expectedLockVersion,
    edit.validFrom,
    edit.validUntil,
    edit.baseReductionBasisPoints,
    edit.rateBasisPoints,
    edit.source,
    edit.fixtureNote,
  ]);

export const publish = (client: PoolClient, actor: TaxRuleActor, id: string, expectedLockVersion: number): Promise<TaxRuleVersionRecord> =>
  oneVersion(client, 'select * from app.tax_rule_publish($1, $2, $3, $4, $5)', [
    actor.actorId,
    actor.now,
    actor.correlationId,
    id,
    expectedLockVersion,
  ]);

export const archive = (client: PoolClient, actor: TaxRuleActor, id: string, expectedLockVersion: number): Promise<TaxRuleVersionRecord> =>
  oneVersion(client, 'select * from app.tax_rule_archive($1, $2, $3, $4, $5)', [
    actor.actorId,
    actor.now,
    actor.correlationId,
    id,
    expectedLockVersion,
  ]);

export const getById = (client: PoolClient, id: string): Promise<TaxRuleVersionRecord> =>
  oneVersion(client, 'select * from app.tax_rule_get($1)', [id]);

export const list = (
  client: PoolClient,
  filters: TaxRuleListFilters,
): Promise<Readonly<{ items: readonly TaxRuleVersionRecord[]; total: number }>> =>
  run(async () => {
    const criteria = [
      filters.taxType ?? null,
      filters.regime ?? null,
      filters.operationType ?? null,
      filters.status ?? null,
      filters.validOn ?? null,
    ];
    const { rows } = await client.query<VersionRow>('select * from app.tax_rule_list($1, $2, $3, $4, $5, $6, $7)', [
      ...criteria,
      filters.limit,
      filters.offset,
    ]);
    const counted = await client.query<{ total: string }>('select app.tax_rule_count($1, $2, $3, $4, $5)::text as total', criteria);

    return { items: rows.map(toRecord), total: Number(counted.rows[0]?.total ?? 0) };
  });

/** No máximo duas candidatas: uma é a regra; duas é erro de integridade que o domínio nomeia. */
export const findApplicable = (client: PoolClient, criteria: TaxRuleCriteria): Promise<readonly TaxRule[]> =>
  run(async () => {
    const { rows } = await client.query<VersionRow>('select * from app.tax_rule_find_applicable($1, $2, $3, $4)', [
      criteria.taxType,
      criteria.regime,
      criteria.operationType,
      criteria.factDate,
    ]);

    return rows.map(toDomainRule);
  });
