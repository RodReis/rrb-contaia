import { avaliarAplicabilidadeReferencial, CODIGOS_DE_ERRO, ErroDeDominio, type PacoteReferencial, type RegimeReferencial } from '@contaia/domain';
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
      return {
        company: companies[0], calendarYear, taxRegime, specialSituation,
        applicability: applicability.status,
        selectedPackageId: applicability.packageId,
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
}
