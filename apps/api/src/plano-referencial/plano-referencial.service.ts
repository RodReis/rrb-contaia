import { avaliarAplicabilidadeReferencial, CODIGOS_DE_ERRO, ErroDeDominio, hashMapeamentoReferencial, validarPublicacaoReferencial, type DecisaoReferencial, type PacoteReferencial, type RegimeReferencial } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';

type Ator = Readonly<{ tenantId: string; usuarioId: string }>;
type SituacaoEspecial = Readonly<{ year: number; code: string }>;
type LinhaPacote = Readonly<{
  id: string; authority: string; sourceDocument: string; sourceUrl: string; layout: string; revision: string;
  coveredCalendarYears: number[]; coveredSpecialSituations: SituacaoEspecial[]; downloadedAt: Date;
  sourceSha256: string; canonicalSha256: string; status: PacoteReferencial['status'];
}>;
type DecisaoEntrada = Readonly<{ accountCode: string; centerCode: string | null; kind: 'MAPPED' | 'NOT_APPLICABLE'; referenceCode: string | null; reason: string | null }>;

@Injectable()
export class PlanoReferencialService {
  constructor(private readonly pool: PoolDoBanco) {}

  private contexto<T>(ator: Ator, executar: (cliente: PoolClient) => Promise<T>): Promise<T> {
    return comContextoHumano(this.pool.instancia, ator, executar);
  }

  private async pacotes(cliente: PoolClient): Promise<LinhaPacote[]> {
    const { rows } = await cliente.query<LinhaPacote>(`select id,authority,"source_document" as "sourceDocument",source_url as "sourceUrl",
      layout,revision,covered_calendar_years as "coveredCalendarYears",covered_special_situations as "coveredSpecialSituations",
      downloaded_at as "downloadedAt",source_sha256 as "sourceSha256",canonical_sha256 as "canonicalSha256",status
      from app.list_reference_accounting_packages()`);
    return rows;
  }

  consultar(ator: Ator, empresaId: string, calendarYear: number, taxRegime: RegimeReferencial, specialSituation: string | null) {
    return this.contexto(ator, async (cliente) => {
      const packages = await this.pacotes(cliente);
      const applicability = avaliarAplicabilidadeReferencial({
        regime: taxRegime, year: calendarYear, situation: specialSituation,
        packages: packages.map(({ id, status, coveredCalendarYears, coveredSpecialSituations }) => ({
          id, status, calendarYears: coveredCalendarYears,
          specialSituations: coveredSpecialSituations,
        })),
      });
      // O SELECT de catálogo é global e somente leitura. Esta consulta separada aplica empresa e carteira via RLS.
      const { rows: companies } = await cliente.query<{ id: string; name: string; cnpj: string }>(
        `select e.id,e.nome_fantasia as name,e.cnpj from app.empresa e where e.id=$1`, [empresaId]);
      if (companies[0] === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const { rows: mappings } = await cliente.query(`select id,calendar_year as "calendarYear",tax_regime as "taxRegime",
        special_situation as "specialSituation",package_id as "packageId",applicability,status,version,revision,
        canonical_sha256 as "canonicalSha256",created_at as "createdAt",published_at as "publishedAt"
        from app.company_reference_mapping where company_id=$1 and calendar_year=$2 and tax_regime=$3
          and special_situation is not distinct from $4 order by version desc nulls first,created_at desc`,
      [empresaId, calendarYear, taxRegime, specialSituation]);
      return {
        company: companies[0], calendarYear, taxRegime, specialSituation,
        applicability: applicability.status,
        selectedPackageId: applicability.packageId,
        mappings,
        packages: packages.map(({ id, authority, sourceDocument, sourceUrl, layout, revision, coveredCalendarYears,
          coveredSpecialSituations, downloadedAt, sourceSha256, canonicalSha256, status }) => ({
          id, authority, sourceDocument, sourceUrl, layout, revision, coveredCalendarYears, coveredSpecialSituations,
          downloadedAt, sourceSha256, canonicalSha256, status,
        })),
      };
    });
  }

  criarRascunho(ator: Ator, companyId: string, input: Readonly<{
    calendarYear: number; taxRegime: RegimeReferencial; specialSituation: string | null; packageId: string;
  }>, correlationId: string) {
    return this.contexto(ator, async (cliente) => {
      const { rows: companies } = await cliente.query(`select id from app.empresa where id=$1 for update`, [companyId]);
      if (companies[0] === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const packages = await this.pacotes(cliente);
      const selected = packages.find((item) => item.id === input.packageId);
      if (selected === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_NOT_FOUND, 'Pacote referencial não encontrado.');
      if (selected.status === 'REVOKED') throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_REVOKED, 'Pacote referencial revogado.');
      const applicability = avaliarAplicabilidadeReferencial({
        regime: input.taxRegime, year: input.calendarYear, situation: input.specialSituation,
        packages: packages.map(({ id, status, coveredCalendarYears, coveredSpecialSituations }) => ({
          id, status, calendarYears: coveredCalendarYears, specialSituations: coveredSpecialSituations,
        })),
      });
      if (applicability.status === 'INDETERMINATE') {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_INDETERMINATE, 'Não há pacote oficial aplicável e disponível.');
      }
      if (applicability.packageId !== input.packageId) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_NOT_APPLICABLE, 'O pacote não cobre esta configuração.');
      }
      const { rows } = await cliente.query<{ id: string; revision: number }>(`insert into app.company_reference_mapping
        (tenant_id,company_id,calendar_year,tax_regime,special_situation,package_id,applicability,status,package_sha256,created_by,correlation_id)
        values($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10) returning id,revision`,
      [ator.tenantId, companyId, input.calendarYear, input.taxRegime, input.specialSituation, input.packageId,
        applicability.status, selected.canonicalSha256, ator.usuarioId, correlationId]);
      const mapping = rows[0];
      if (mapping === undefined) throw new Error('REFERENCE_MAPPING_DRAFT_INSERT_FAILED');
      await cliente.query(`insert into app.company_reference_mapping_event
        (tenant_id,company_id,mapping_id,actor_id,action,result,details,correlation_id)
        values($1,$2,$3,$4,'DRAFT_CREATED','SUCESSO',$5::jsonb,$6)`,
      [ator.tenantId, companyId, mapping.id, ator.usuarioId, JSON.stringify({ calendarYear: input.calendarYear, packageId: input.packageId }), correlationId]);
      return { mappingId: mapping.id, revision: mapping.revision, status: 'DRAFT' as const };
    });
  }

  atualizarDecisoes(ator: Ator, companyId: string, mappingId: string, expectedRevision: number,
    entradas: readonly DecisaoEntrada[], correlationId: string) {
    return this.contexto(ator, async (cliente) => {
      const { rows: mappings } = await cliente.query<{ id: string; packageId: string; revision: number; status: string }>(
        `select id,package_id as "packageId",revision,status from app.company_reference_mapping
         where id=$1 and company_id=$2 for update`, [mappingId, companyId]);
      const mapping = mappings[0];
      if (mapping === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_NOT_FOUND, 'Rascunho referencial não encontrado.');
      if (mapping.status !== 'DRAFT' || mapping.revision !== expectedRevision) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_VERSION_CONFLICT, 'O rascunho mudou; atualize antes de salvar.');
      }
      const { rows: accounts } = await cliente.query<{ id: string; code: string; nature: string; eligible: boolean; complete: boolean }>(
        `select id,codigo as code,natureza as nature,(tipo='analitica' and not arquivada) as eligible,
          (tipo='analitica' and not arquivada and classe_contabil is not null and politica_centro_custo is not null) as complete
         from app.conta_contabil where empresa_id=$1`, [companyId]);
      const { rows: centers } = await cliente.query<{ id: string; code: string; eligible: boolean }>(
        `select id,codigo as code,(tipo='analitica' and not arquivada) as eligible from app.centro_custo where empresa_id=$1`, [companyId]);
      const { rows: references } = await cliente.query<{ code: string; sourceNature: string; status: string }>(
        `select code,source_nature as "sourceNature",status from app.list_reference_accounting_accounts($1)`, [mapping.packageId]);
      const accountsByCode = new Map(accounts.map((item) => [item.code, item]));
      const centersByCode = new Map(centers.map((item) => [item.code, item]));
      const referencesByCode = new Map(references.map((item) => [item.code, item]));
      const seen = new Set<string>();
      const decisions: DecisaoReferencial[] = [];
      for (const item of entradas) {
        const pair = `${item.accountCode}\u0000${item.centerCode ?? ''}`;
        if (seen.has(pair)) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_DUPLICATE_PAIR, 'Há mais de uma decisão para a mesma conta e centro.');
        seen.add(pair);
        const account = accountsByCode.get(item.accountCode);
        if (account === undefined || !account.eligible || !account.complete) {
          throw new ErroDeDominio(account?.eligible === true ? CODIGOS_DE_ERRO.REFERENCE_MAPPING_ACCOUNT_INCOMPLETE : CODIGOS_DE_ERRO.REFERENCE_MAPPING_ACCOUNT_INELIGIBLE, 'A conta não está elegível para o mapeamento.');
        }
        const center = item.centerCode === null ? null : centersByCode.get(item.centerCode);
        if (item.centerCode !== null && center?.eligible !== true) {
          throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_COST_CENTER_INELIGIBLE, 'O centro não está ativo e analítico.');
        }
        if (item.kind === 'NOT_APPLICABLE') {
          if (item.referenceCode !== null) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_NOT_APPLICABLE_HAS_REFERENCE, 'Decisão não aplicável não pode indicar conta referencial.');
          if (item.reason === null || item.reason.trim() === '') throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_NOT_APPLICABLE_REVIEW_REQUIRED, 'Informe justificativa para a decisão não aplicável.');
        } else {
          if (item.reason !== null || item.referenceCode === null) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_INVALID_DECISION, 'A decisão mapeada exige somente um código referencial.');
          const reference = referencesByCode.get(item.referenceCode);
          if (reference === undefined || reference.status !== 'ACTIVE') throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_ACCOUNT_NOT_FOUND, 'Conta referencial inexistente ou inativa no pacote.');
          const nature = account.nature === 'devedora' ? 'DEBIT' : account.nature === 'credora' ? 'CREDIT' : null;
          const referenceNature = reference.sourceNature === 'DEBIT' || reference.sourceNature === 'CREDIT' ? reference.sourceNature : null;
          if (nature === null || referenceNature === null || nature !== referenceNature) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_ACCOUNT_NATURE_MISMATCH, 'A natureza da conta não é compatível com a referência.');
        }
        decisions.push({ accountId: account.id, centerId: center?.id ?? null, kind: item.kind,
          referenceCode: item.referenceCode, reason: item.reason, authorId: ator.usuarioId,
          reviewedBy: item.kind === 'NOT_APPLICABLE' ? ator.usuarioId : null });
      }
      await cliente.query(`update app.company_reference_mapping_entry set active=false where mapping_id=$1 and active`, [mappingId]);
      for (const decision of decisions) {
        await cliente.query(`insert into app.company_reference_mapping_entry
          (tenant_id,company_id,mapping_id,account_id,center_id,kind,reference_package_id,reference_code,reason,author_id,reviewed_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [ator.tenantId, companyId, mappingId, decision.accountId,
          decision.centerId, decision.kind, decision.kind === 'MAPPED' ? mapping.packageId : null, decision.referenceCode,
          decision.reason, ator.usuarioId, decision.reviewedBy]);
      }
      const revision = expectedRevision + 1;
      await cliente.query(`update app.company_reference_mapping set revision=$2 where id=$1`, [mappingId, revision]);
      await cliente.query(`insert into app.company_reference_mapping_event(tenant_id,company_id,mapping_id,actor_id,action,result,details,correlation_id)
        values($1,$2,$3,$4,'DRAFT_DECISIONS_UPDATED','SUCESSO',$5::jsonb,$6)`,
      [ator.tenantId, companyId, mappingId, ator.usuarioId, JSON.stringify({ count: decisions.length, revision }), correlationId]);
      return { mappingId, revision, decisions: decisions.length, status: 'DRAFT' as const };
    });
  }

  publicar(ator: Ator, companyId: string, mappingId: string, expectedRevision: number, correlationId: string) {
    return this.contexto(ator, async (cliente) => {
      const { rows: mappings } = await cliente.query<{ id: string; packageId: string; packageSha256: string; calendarYear: number; taxRegime: RegimeReferencial; specialSituation: string | null; revision: number; status: string }>(
        `select id,package_id as "packageId",package_sha256 as "packageSha256",calendar_year as "calendarYear",tax_regime as "taxRegime",
         special_situation as "specialSituation",revision,status
         from app.company_reference_mapping where id=$1 and company_id=$2 for update`, [mappingId, companyId]);
      const mapping = mappings[0];
      if (mapping === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_NOT_FOUND, 'Rascunho referencial não encontrado.');
      if (mapping.status !== 'DRAFT' || mapping.revision !== expectedRevision) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_VERSION_CONFLICT, 'O rascunho mudou; atualize antes de publicar.');
      }
      const packages = await this.pacotes(cliente);
      const sourcePackage = packages.find((item) => item.id === mapping.packageId);
      if (sourcePackage === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_NOT_FOUND, 'Pacote referencial não encontrado.');
      if (sourcePackage.status !== 'AVAILABLE') throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_REVOKED, 'Pacote sem disponibilidade para nova publicação.');
      if (sourcePackage.canonicalSha256 !== mapping.packageSha256) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_NOT_APPLICABLE, 'O hash do pacote diverge do rascunho.');
      const applicability = avaliarAplicabilidadeReferencial({ regime: mapping.taxRegime, year: mapping.calendarYear,
        situation: mapping.specialSituation, packages: packages.map(({ id, status, coveredCalendarYears, coveredSpecialSituations }) => ({
          id, status, calendarYears: coveredCalendarYears, specialSituations: coveredSpecialSituations,
        })) });
      if (applicability.status === 'INDETERMINATE' || applicability.packageId !== mapping.packageId) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_NOT_APPLICABLE, 'O pacote não cobre o exercício ou a situação do rascunho.');
      }
      const { rows: accountRows } = await cliente.query<{ id: string; active: boolean; analytical: boolean; complete: boolean; normalBalance: string }>(
        `select id,not arquivada as active,tipo='analitica' as analytical,
          (classe_contabil is not null and politica_centro_custo is not null) as complete,
          case natureza when 'devedora' then 'DEBIT' when 'credora' then 'CREDIT' else 'UNKNOWN' end as "normalBalance"
         from app.conta_contabil where empresa_id=$1`, [companyId]);
      const { rows: centerRows } = await cliente.query<{ id: string; active: boolean; analytical: boolean; code: string }>(
        `select id,not arquivada as active,tipo='analitica' as analytical,codigo as code from app.centro_custo where empresa_id=$1`, [companyId]);
      const { rows: references } = await cliente.query<{ packageId: string; code: string; active: boolean; normalBalance: string }>(
        `select package_id as "packageId",code,(status='ACTIVE' and source_nature in ('DEBIT','CREDIT') and (valid_from is null or valid_from<=make_date($2,12,31)) and (valid_to is null or valid_to>=make_date($2,1,1))) as active,
         case source_nature when 'DEBIT' then 'DEBIT' when 'CREDIT' then 'CREDIT' else 'UNKNOWN' end as "normalBalance"
         from app.list_reference_accounting_accounts($1)`, [mapping.packageId, mapping.calendarYear]);
      const { rows: entryRows } = await cliente.query<{ accountId: string; centerId: string | null; kind: 'MAPPED' | 'NOT_APPLICABLE'; referenceCode: string | null; reason: string | null; authorId: string; reviewedBy: string | null }>(
        `select account_id as "accountId",center_id as "centerId",kind,reference_code as "referenceCode",reason,author_id as "authorId",reviewed_by as "reviewedBy"
         from app.company_reference_mapping_entry where mapping_id=$1 and active`, [mappingId]);
      const errors = validarPublicacaoReferencial({ packageId: mapping.packageId,
        accounts: accountRows.map((item) => ({ ...item, normalBalance: item.normalBalance as 'DEBIT' | 'CREDIT' })),
        costCenters: centerRows, decisions: entryRows,
        references: references.map((item) => ({ ...item, normalBalance: item.normalBalance as 'DEBIT' | 'CREDIT' })) });
      if (errors.length > 0) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_MAPPING_INCOMPLETE,
        'A publicação foi bloqueada por pendências de cobertura ou compatibilidade.', [], { errors });
      const packageAccounts = await cliente.query<{ canonicalSha256: string }>(`select canonical_sha256 as "canonicalSha256" from app.list_reference_accounting_packages() where id=$1`, [mapping.packageId]);
      const packageCanonicalSha256 = packageAccounts.rows[0]?.canonicalSha256;
      if (packageCanonicalSha256 === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.REFERENCE_PACKAGE_NOT_FOUND, 'Hash canônico do pacote indisponível.');
      const centerIds = [...new Set(entryRows.flatMap((item) => item.centerId === null ? [] : [item.centerId]))];
      const centerCodes = centerRows.filter((item) => centerIds.includes(item.id)).map((item) => ({ id: item.id, code: item.code }));
      const canonicalSha256 = hashMapeamentoReferencial({ packageId: mapping.packageId, packageCanonicalSha256,
        calendarYear: mapping.calendarYear, taxRegime: mapping.taxRegime, specialSituation: mapping.specialSituation,
        decisions: entryRows, centerCodes });
      await cliente.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`${ator.tenantId}/${companyId}/${mapping.calendarYear}`]);
      const { rows: versions } = await cliente.query<{ version: number }>(`select coalesce(max(version),0)+1 as version from app.company_reference_mapping
        where tenant_id=$1 and company_id=$2 and calendar_year=$3`, [ator.tenantId, companyId, mapping.calendarYear]);
      const version = versions[0]?.version;
      if (version === undefined) throw new Error('REFERENCE_MAPPING_VERSION_ALLOCATION_FAILED');
      for (const center of centerCodes) await cliente.query(`insert into app.company_reference_mapping_center_snapshot(tenant_id,company_id,mapping_id,center_id,center_code)
        values($1,$2,$3,$4,$5)`, [ator.tenantId, companyId, mappingId, center.id, center.code]);
      await cliente.query(`update app.company_reference_mapping set status='SUPERSEDED' where tenant_id=$1 and company_id=$2 and calendar_year=$3 and status='PUBLISHED'`,
        [ator.tenantId, companyId, mapping.calendarYear]);
      await cliente.query(`update app.company_reference_mapping set status='PUBLISHED',version=$2,revision=revision+1,canonical_sha256=$3,published_by=$4,published_at=now()
        where id=$1`, [mappingId, version, canonicalSha256, ator.usuarioId]);
      await cliente.query(`insert into app.company_reference_mapping_event(tenant_id,company_id,mapping_id,actor_id,action,result,details,correlation_id)
        values($1,$2,$3,$4,'PUBLISHED','SUCESSO',$5::jsonb,$6)`,
      [ator.tenantId, companyId, mappingId, ator.usuarioId, JSON.stringify({ version, canonicalSha256, packageSha256: mapping.packageSha256 }), correlationId]);
      return { mappingId, version, revision: expectedRevision + 1, status: 'PUBLISHED' as const, canonicalSha256 };
    });
  }
}
