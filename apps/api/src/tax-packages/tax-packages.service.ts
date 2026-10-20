import { Injectable } from '@nestjs/common';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, hashTaxPackage, validateTaxPackage, type CuratedTaxPackage } from '@contaia/domain';
import { CuratedTaxPackageSchema, type CuratedTaxPackageInput } from '@contaia/shared';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { noCatalogoTributario } from '../tax-rules/catalogo-contexto';

type PackageRow = Readonly<{
  id: string; package_id: string; semantic_version: string; status: string; content: CuratedTaxPackage;
  content_sha256: string; imported_by: string; imported_at: Date; reviewed_by: string | null; reviewed_at: Date | null;
  published_by: string | null; published_at: Date | null; archived_at: Date | null;
}>;

const dto = (row: PackageRow) => ({
  id: row.id, packageId: row.package_id, semanticVersion: row.semantic_version, status: row.status,
  content: row.content, sha256: row.content_sha256, importedBy: row.imported_by,
  importedAt: row.imported_at.toISOString(), reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at?.toISOString() ?? null, publishedBy: row.published_by,
  publishedAt: row.published_at?.toISOString() ?? null, archivedAt: row.archived_at?.toISOString() ?? null,
});

@Injectable()
export class TaxPackagesService {
  agora: () => Date = () => new Date();
  constructor(private readonly pool: PoolDoBanco) {}

  private run<T>(correlationId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    return noCatalogoTributario(this.pool.instancia, correlationId, async (client) => {
      try { return await action(client); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('TAX_PACKAGE_NOT_FOUND')) throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_PACKAGE_NOT_FOUND, 'Pacote tributário não encontrado.');
        if (message.includes('TAX_PACKAGE_OVERLAPPING_VALIDITY')) throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_PACKAGE_OVERLAPPING_COVERAGE, 'Já existe pacote publicado com cobertura sobreposta.');
        if (message.includes('TAX_PACKAGE_IMMUTABLE')) throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_PACKAGE_IMMUTABLE, 'Pacote publicado ou arquivado é imutável.');
        if (message.includes('TAX_PACKAGE_TRANSITION_INVALID')) throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_PACKAGE_TRANSITION_INVALID, 'Transição de ciclo de vida não permitida.');
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_PACKAGE_VERSION_CONFLICT, 'Versão deste pacote já foi importada.');
        }
        throw error;
      }
    });
  }

  async list(actor: AtorDoCatalogo, correlationId: string) {
    const { rows } = await this.run(correlationId, (client) => client.query<PackageRow>(
      'select * from app.tax_package_list($1)', [actor.tipo === 'SUPER_ADMIN'],
    ));
    return {
      canAdminister: actor.tipo === 'SUPER_ADMIN',
      actorId: actor.id,
      items: rows.map((row) => ({
        id: row.id, packageId: row.package_id, semanticVersion: row.semantic_version, status: row.status,
        jurisdiction: row.content['jurisdiction'], regimes: row.content['regimes'], validFrom: row.content['validFrom'],
        validUntil: row.content['validUntil'], coverage: row.content['coverage'], exclusions: row.content['exclusions'],
        sha256: row.content_sha256, importedBy: row.imported_by, importedAt: row.imported_at.toISOString(),
        reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at?.toISOString() ?? null,
        publishedBy: row.published_by, publishedAt: row.published_at?.toISOString() ?? null,
        archivedAt: row.archived_at?.toISOString() ?? null,
      })),
    };
  }

  async get(actor: AtorDoCatalogo, id: string, correlationId: string) {
    const { rows } = await this.run(correlationId, (client) => client.query<PackageRow>(
      'select (app.tax_package_get($1)).*', [id],
    ));
    const row = rows[0];
    if (row === undefined || (actor.tipo !== 'SUPER_ADMIN' && row.status !== 'PUBLISHED')) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_PACKAGE_NOT_FOUND, 'Pacote tributário não encontrado.');
    }
    return dto(row);
  }

  async import(actor: AtorDoCatalogo, input: CuratedTaxPackageInput, correlationId: string) {
    const packageContent = CuratedTaxPackageSchema.parse(input) as CuratedTaxPackage;
    const hash = await hashTaxPackage(packageContent);
    const { rows } = await this.run(correlationId, (client) => client.query<PackageRow>(
      'select (app.tax_package_import($1,$2,$3,$4,$5,$6::jsonb,$7)).*',
      [actor.id, this.agora(), correlationId, packageContent.packageId, packageContent.semanticVersion, JSON.stringify(packageContent), hash],
    ));
    const row = rows[0];
    if (row === undefined) throw new Error('importação do pacote não devolveu resultado');
    return dto(row);
  }

  async validate(actor: AtorDoCatalogo, id: string, correlationId: string) {
    const current = await this.get(actor, id, correlationId);
    const content = CuratedTaxPackageSchema.parse(current.content) as unknown as CuratedTaxPackage;
    const result = validateTaxPackage(content);
    if (content.rules.length === 0) {
      return { ...current, validation: { valid: false, errors: ['PACKAGE_EXECUTABLE_RULES_EMPTY'] } };
    }
    const fixtureRuleIds = new Set(content.fixtures.map((fixture) => fixture.ruleId));
    const rulesWithoutFixture = content.rules.filter((rule) => !fixtureRuleIds.has(rule.id));
    if (rulesWithoutFixture.length > 0) {
      return { ...current, validation: { valid: false, errors: rulesWithoutFixture.map((rule) => `RULE_FIXTURE_MISSING:${rule.id}`) } };
    }
    if (await hashTaxPackage(content) !== current.sha256) {
      return { ...current, validation: { valid: false, errors: ['PACKAGE_HASH_MISMATCH'] } };
    }
    if (!result.valid) return { ...current, validation: result };
    return this.transition(actor, id, 'VALIDATED', correlationId, { sha256: current.sha256, errors: [] });
  }

  async review(actor: AtorDoCatalogo, id: string, declaration: string, correlationId: string) {
    const current = await this.get(actor, id, correlationId);
    if (current.status !== 'VALIDATED') throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_PACKAGE_NOT_REVIEWED, 'Pacote precisa estar validado antes da revisão.');
    if (current.importedBy === actor.id) throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_PACKAGE_REVIEWER_INVALID, 'Quem importou não pode revisar o mesmo pacote.');
    return this.transition(actor, id, 'REVIEWED', correlationId, { declaration });
  }

  publish(actor: AtorDoCatalogo, id: string, correlationId: string) {
    return this.transition(actor, id, 'PUBLISHED', correlationId, {});
  }

  archive(actor: AtorDoCatalogo, id: string, correlationId: string) {
    return this.transition(actor, id, 'ARCHIVED', correlationId, {});
  }

  private async transition(actor: AtorDoCatalogo, id: string, action: string, correlationId: string, details: object) {
    const { rows } = await this.run(correlationId, (client) => client.query<PackageRow>(
      'select (app.tax_package_transition($1,$2,$3,$4,$5,$6::jsonb)).*',
      [id, actor.id, this.agora(), correlationId, action, JSON.stringify(details)],
    ));
    const row = rows[0];
    if (row === undefined) throw new Error('transição do pacote não devolveu resultado');
    return dto(row);
  }
}
