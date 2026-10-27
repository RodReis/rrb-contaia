import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { comContextoHumano, comFinalidade } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio, calculateCorporateTaxAssessment, type CorporateTaxDeductionInput,
  CORPORATE_TAX_RATE_SCALE, parseScaledRate, roundHalfUp, type CorporateTaxRevenue, type CorporateTaxRulePackage } from '@contaia/domain';
import {
  CorporateTaxDeclarationSchema, CorporateTaxRulePackageSchema, PrepareCorporateTaxAssessmentSchema,
  ReviewCorporateTaxAssessmentSchema, ReviewCorporateTaxRulePackageSchema, canonicalizarJson,
} from '@contaia/shared';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';

type Row = Record<string, unknown>;
type Upload = Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): Row => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {};
const rolesCanReview = (roles: readonly string[]) => roles.includes('contador') || roles.includes('admin_escritorio');
const safe = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_INSTALLMENT_INVALID, 'Valor de quota excede o limite suportado.');
  return Number(value);
};
const quarterMonths: Readonly<Record<string, readonly string[]>> = {
  '2026-Q1': ['2026-01', '2026-02', '2026-03'], '2026-Q2': ['2026-04', '2026-05', '2026-06'],
  '2026-Q3': ['2026-07', '2026-08', '2026-09'], '2026-Q4': ['2026-10', '2026-11', '2026-12'],
};
const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const assessmentContent = (snapshot: Row, status: unknown, revision: unknown, approvedBy: unknown, approvedAt: unknown): Row => ({
  ...snapshot, status, revision, approvedBy: approvedBy ?? null,
  approvedAtUtc: approvedAt ? new Date(String(approvedAt)).toISOString() : null,
});
const assessmentDto = (content: Row, preparationHash: string) => ({ ...content,
  preparationJsonHash: preparationHash, canonicalJsonHash: sha(canonicalizarJson(content)),
});

@Injectable()
export class CorporateTaxAssessmentsService {
  constructor(private readonly pool: PoolDoBanco, private readonly storage: StorageService) {}

  private async company(client: PoolClient, tenantId: string, companyId: string) {
    const result = await client.query<Row>(`select id,cnpj,regime_tributario,status,situacao from app.empresa
      where id=$1 and tenant_id=$2 and app.empresa_autorizada(id)`, [companyId, tenantId]);
    if (!result.rows[0]) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Empresa fora da carteira ativa.');
    return result.rows[0];
  }

  private async reconcileRevenue(client: PoolClient, tenantId: string, companyId: string, cnpj: string, recognition: string,
    quarter: string, rawRevenue: readonly Row[], evidenceById: ReadonlyMap<string, Row>, declarationEvidence: readonly Row[], packageRules: readonly Row[]) {
    const sourceIds = rawRevenue.flatMap((item) => Array.isArray(item['sourceIds']) ? item['sourceIds'].filter((source): source is string => typeof source === 'string') : []);
    const fiscalIds = sourceIds.filter((source) => !source.startsWith('evidence:') && !source.startsWith('evidence-index:') && !source.startsWith('rule:'));
    const sourceResult = await client.query<Row>(`with refs as (
        select source_id,
          case when source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}:item:[1-9][0-9]*$'
            then split_part(source_id,':',1)::uuid end document_id,
          case when source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}:item:[1-9][0-9]*$'
            then split_part(source_id,':',2) end document_hash,
          case when source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}:item:[1-9][0-9]*$'
            then split_part(source_id,':',4)::integer end item_number
        from unnest($3::text[]) item(source_id)
      )
      select r.source_id,d.emitido_em::text recognized_month,d.especie,d.modelo,d.estado,d.protocolo,d.hash_sha256,
        i.valor::numeric item_value,round(i.valor*100)::text item_cents,(i.valor*100)=trunc(i.valor*100) cents_exact,
        (select count(*)::int from app.fiscal_document_tax t where t.document_id=d.id and t.parser_version=d.parser_version and t.escopo='ITEM' and t.numero_item=i.numero) tax_classification_count
      from refs r join app.fiscal_document d on d.id=r.document_id and d.tenant_id=$1 and d.empresa_id=$2 and d.hash_sha256=r.document_hash
      join app.fiscal_document_item i on i.document_id=d.id and i.tenant_id=d.tenant_id and i.empresa_id=d.empresa_id and i.numero=r.item_number and i.parser_version=d.parser_version
      where d.especie in ('NFE_55','NFCE_65') and d.estado='PROCESSADO'
        and d.protocolo is not null and d.emitido_em is not null and app.empresa_autorizada(d.empresa_id)`, [tenantId, companyId, fiscalIds]);
    const validSourceMap = new Map(sourceResult.rows.map((row) => [String(row['source_id']), row]));
    const expectedMonths = quarterMonths[quarter] ?? [];
    const usedFiscal = new Set<string>();
    let allValid = true;
    const normalized: Row[] = rawRevenue.map((item): Row => {
      const ids = Array.isArray(item['sourceIds']) ? item['sourceIds'].filter((source): source is string => typeof source === 'string') : [];
      const evidenceRefs = ids.filter((source) => source.startsWith('evidence:')).map((source) => source.slice(9));
      const fiscalRefs = ids.filter((source) => !source.startsWith('evidence:') && !source.startsWith('evidence-index:') && !source.startsWith('rule:'));
      const unresolvedEvidenceRefs = ids.filter((source) => source.startsWith('evidence-index:'));
      const declaredRuleIds = Array.isArray(item['ruleIds']) ? item['ruleIds'].filter((id): id is string => typeof id === 'string') : [];
      const ruleRefs = declaredRuleIds.map((id) => `rule:${id}`);
      const matchingRules = packageRules.filter((rule) => declaredRuleIds.includes(String(rule['id'])) &&
        rule['activityCode'] === item['activityCode'] && rule['revenueNatureCode'] === item['revenueNatureCode'] &&
        ['IRPJ','CSLL'].includes(String(rule['tax'])));
      const validRuleCoverage = declaredRuleIds.length === 2 && new Set(declaredRuleIds).size === 2 && matchingRules.length === 2 &&
        new Set(matchingRules.map((rule) => rule['tax'])).size === 2;
      const evidenceValid = evidenceRefs.every((id) => evidenceById.has(id)) && unresolvedEvidenceRefs.length === 0 &&
        (evidenceRefs.length > 0 || fiscalRefs.length === 0);
      const documents = fiscalRefs.map((id) => validSourceMap.get(id));
      const fiscalValid = fiscalRefs.length === documents.length && documents.every((row) => row !== undefined && row['cents_exact'] === true &&
        Number(row['tax_classification_count'] ?? 0) > 0 && (recognition === 'CASH' || expectedMonths.includes(String(row['recognized_month']).slice(0, 7))));
      for (const ref of fiscalRefs) {
        if (usedFiscal.has(ref)) allValid = false;
        usedFiscal.add(ref);
      }
      if (recognition === 'ACCRUAL') {
        const documentCents = documents.reduce((sum, row) => sum + (row ? BigInt(String(row['item_cents'])) : 0n), 0n);
        const evidenceOnlyRevenue = fiscalRefs.length === 0 && evidenceValid;
        const lineType = item['lineType'];
        const eventSource = evidenceRefs.some((id) => evidenceById.get(id)?.['kind'] === 'EVENTOS_CANCELAMENTOS_DEVOLUCOES_RECONCILIADOS');
        const lineEvidence = declarationEvidence.filter((evidence) => evidenceRefs.includes(String(evidence['id'])));
        const evidencedAmount = lineEvidence.reduce((sum, evidence) => sum + BigInt(typeof evidence['amountCents'] === 'number' ? evidence['amountCents'] : 0), 0n);
        const evidenceDateMatches = lineEvidence.length === evidenceRefs.length && lineEvidence.every((evidence) =>
          typeof evidence['recognizedOn'] === 'string' && String(evidence['recognizedOn']).slice(0, 7) === item['month']);
        const lineProof = lineType === 'FISCAL_ITEM' ? evidenceRefs.length === 0 && validRuleCoverage :
          ['FINANCIAL_INCOME','CAPITAL_GAIN','OTHER_ADDITION'].includes(String(lineType)) && evidenceValid && validRuleCoverage &&
          item['grossCents'] === 0 &&
          evidenceDateMatches && lineEvidence.every((evidence) => typeof evidence['sourceReference'] === 'string') &&
          evidencedAmount === BigInt(typeof item['directAdditionCents'] === 'number' ? item['directAdditionCents'] : -1) &&
          fiscalRefs.length === 0 && ids.every((id) => id.startsWith('evidence-index:') || id.startsWith('rule:') || id.startsWith('evidence:'));
        if (!fiscalValid || (evidenceRefs.length > 0 && !evidenceValid) ||
            (!evidenceOnlyRevenue && documentCents !== BigInt(typeof item['grossCents'] === 'number' ? item['grossCents'] : -1)) || !lineProof ||
            (Number(item['adjustmentCents'] ?? 0) > 0 && !eventSource)) allValid = false;
      } else {
        const lineEvidence = declarationEvidence.filter((evidence) => evidenceRefs.includes(String(evidence['id'])));
        const evidencedAmount = lineEvidence.reduce((sum, evidence) => sum + BigInt(typeof evidence['amountCents'] === 'number' ? evidence['amountCents'] : 0), 0n);
        const receiptDateMatches = lineEvidence.length === evidenceRefs.length && lineEvidence.every((evidence) =>
          typeof evidence['recognizedOn'] === 'string' && String(evidence['recognizedOn']).slice(0, 7) === item['month']);
        const declaredAmount = BigInt(typeof item['grossCents'] === 'number' ? item['grossCents'] : -1);
        const receiptProofs = lineEvidence.filter((evidence) => evidenceById.get(String(evidence['id']))?.['kind'] === 'RECEBIMENTOS_COMPROVADOS');
        const receiptFiscalSources = [...new Set(receiptProofs.flatMap((evidence) => Array.isArray(evidence['relatedFiscalSourceIds'])
          ? evidence['relatedFiscalSourceIds'].filter((id): id is string => typeof id === 'string') : []))];
        const receiptDocumentsExist = receiptFiscalSources.length > 0 && receiptFiscalSources.every((id) => fiscalRefs.includes(id) && validSourceMap.has(id));
        const receiptAmountsFitDocuments = receiptFiscalSources.length > 0 && receiptFiscalSources.reduce((sum, id) =>
          sum + BigInt(String(validSourceMap.get(id)?.['item_cents'] ?? '0')), 0n) >= evidencedAmount;
        if (!fiscalValid || !evidenceValid || receiptProofs.length === 0 || !receiptDocumentsExist || !receiptAmountsFitDocuments ||
          !validRuleCoverage || ids.some((id) => id.startsWith('evidence-index:')) ||
          !receiptDateMatches || lineEvidence.some((evidence) => typeof evidence['sourceReference'] !== 'string') ||
          evidencedAmount !== declaredAmount || item['lineType'] !== 'FISCAL_ITEM' || typeof item['adjustmentReason'] !== 'string') allValid = false;
      }
      return { ...item, sourceIds: fiscalValid && (evidenceRefs.length === 0 || evidenceValid) && (recognition === 'ACCRUAL' || evidenceValid)
        ? [...fiscalRefs, ...evidenceRefs.map((id) => `evidence:${id}`), ...ruleRefs] : [] };
    });
    if (recognition === 'ACCRUAL') {
      const expectedResult = await client.query<Row>(`select d.id::text||':'||d.hash_sha256||':item:'||i.numero::text source_id,
          round(i.valor*100)::text item_cents,(i.valor*100)=trunc(i.valor*100) cents_exact,d.emitido_em::text recognized_date
        from app.fiscal_document d join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id
          and p.empresa_id=d.empresa_id and p.parser_version=d.parser_version and p.papel='EMITENTE'
        join app.fiscal_document_item i on i.document_id=d.id and i.tenant_id=d.tenant_id and i.empresa_id=d.empresa_id and i.parser_version=d.parser_version
        where d.tenant_id=$1 and d.empresa_id=$2 and regexp_replace(p.identificador,'[^0-9]','','g')=$3
          and d.especie in ('NFE_55','NFCE_65') and d.estado='PROCESSADO' and d.protocolo is not null
          and d.emitido_em >= ($4::date) and d.emitido_em < (($4::date)+interval '3 months')
          and i.valor is not null and i.tipo='ITEM' and app.empresa_autorizada(d.empresa_id)`,
      [tenantId, companyId, cnpj, `${expectedMonths[0]}-01`]);
      const expected = new Set(expectedResult.rows.map((row) => String(row['source_id'])));
      if (expected.size !== usedFiscal.size || [...expected].some((id) => !usedFiscal.has(id)) || [...usedFiscal].some((id) => !expected.has(id))) allValid = false;
    }
    const [from, to] = expectedMonths.length ? [`${expectedMonths[0]}-01`, `${expectedMonths[2]}-01`] : [null, null];
    let postSaleValid = false;
    if (from && to) {
      const endExclusive = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1 + 3, 1)).toISOString().slice(0, 10);
      const eventCoverage = await client.query<Row>(`select count(distinct e.id)::int event_count,
          coalesce(string_agg(e.id::text||':'||coalesce(e.hash_sha256,''),',' order by e.id),'') fingerprint
        from app.fiscal_document d join app.fiscal_document_event e on e.document_id=d.id and e.tenant_id=d.tenant_id and e.empresa_id=d.empresa_id
        join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id
          and p.parser_version=d.parser_version and p.papel='EMITENTE'
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date
          and d.emitido_em < $4::date and p.identificador=regexp_replace($5,'[^0-9]','','g')
          and (lower(e.tipo) like '%cancel%' or lower(e.tipo) like '%devol%' or e.codigo='110111') and app.empresa_autorizada(d.empresa_id)`,
      [tenantId, companyId, from, endExclusive, cnpj]);
      const cancelled = await client.query<Row>(`select count(*)::int total from app.fiscal_document d
        join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id
          and p.parser_version=d.parser_version and p.papel='EMITENTE'
        where d.tenant_id=$1 and d.empresa_id=$2 and d.estado='CANCELLED' and d.especie in ('NFE_55','NFCE_65')
          and d.emitido_em >= $3::date and d.emitido_em < $4::date and p.identificador=regexp_replace($5,'[^0-9]','','g')
          and app.empresa_autorizada(d.empresa_id)`, [tenantId, companyId, from, endExclusive, cnpj]);
      const references = await client.query<Row>(`select count(*)::int total from app.fiscal_document d
        join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id
          and p.parser_version=d.parser_version and p.papel='EMITENTE'
        join app.fiscal_document_reference r on r.document_id=d.id and r.tenant_id=d.tenant_id and r.empresa_id=d.empresa_id
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date
          and d.emitido_em < $4::date and p.identificador=regexp_replace($5,'[^0-9]','','g') and app.empresa_autorizada(d.empresa_id)`,
      [tenantId, companyId, from, endExclusive, cnpj]);
      const unresolved = Number(eventCoverage.rows[0]?.['event_count'] ?? 0) + Number(cancelled.rows[0]?.['total'] ?? 0) + Number(references.rows[0]?.['total'] ?? 0);
      const asserted = [...evidenceById.values()].some((item) => item['kind'] === 'EVENTOS_CANCELAMENTOS_DEVOLUCOES_RECONCILIADOS');
      const incomplete = await client.query<Row>(`select count(distinct d.id)::int total from app.fiscal_document d
        join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id
          and p.parser_version=d.parser_version and p.papel='EMITENTE'
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
          and p.identificador=regexp_replace($5,'[^0-9]','','g') and (d.estado<>'PROCESSADO' or d.protocolo is null)
          and app.empresa_autorizada(d.empresa_id)`, [tenantId, companyId, from, endExclusive, cnpj]);
      const postSaleEvidence = declarationEvidence.filter((item) => item['kind'] === 'EVENTOS_CANCELAMENTOS_DEVOLUCOES_RECONCILIADOS');
      const linkedPostSaleEvents = new Set(postSaleEvidence.flatMap((item) => Array.isArray(item['relatedFiscalSourceIds'])
        ? item['relatedFiscalSourceIds'].filter((id): id is string => typeof id === 'string') : []));
      const observedEvents = await client.query<Row>(`select d.id::text||':'||coalesce(d.hash_sha256,'') source_id,
          case when d.estado='CANCELLED' then 'CANCELLED' else e.codigo end event_code,
          coalesce(e.hash_sha256,d.hash_sha256,'') event_hash
        from app.fiscal_document d join app.fiscal_document_party p on p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id
          and p.parser_version=d.parser_version and p.papel='EMITENTE'
        left join app.fiscal_document_event e on e.document_id=d.id and e.tenant_id=d.tenant_id and e.empresa_id=d.empresa_id
          and (lower(e.tipo) like '%cancel%' or lower(e.tipo) like '%devol%' or e.codigo='110111')
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date
          and d.emitido_em < $4::date and p.identificador=regexp_replace($5,'[^0-9]','','g')
          and (d.estado='CANCELLED' or e.id is not null) and app.empresa_autorizada(d.empresa_id)`,
      [tenantId, companyId, from, endExclusive, cnpj]);
      const observedEventIds = observedEvents.rows.map((event) => `${String(event['source_id'])}:event:${String(event['event_hash'])}`);
      const observedSourceIds = observedEvents.rows.map((event) => String(event['source_id']));
      const eventCoverageValid = unresolved === 0 || (asserted && observedEventIds.every((id) => linkedPostSaleEvents.has(id)) &&
        observedSourceIds.every((id) => linkedPostSaleEvents.has(id)) && observedEventIds.length > 0);
      postSaleValid = eventCoverageValid && Number(incomplete.rows[0]?.['total'] ?? 0) === 0;
      if (!postSaleValid) allValid = false;
    }
    return { revenue: normalized, allValid: allValid && postSaleValid };
  }

  async listRulePackages(tenantId: string, userId: string, companyId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      return comFinalidade(client, 'COMUM', async () => {
      await this.company(client, tenantId, companyId);
      const result = await client.query<Row>(`select p.id,p.version,p.valid_from,p.valid_through,p.consulted_at,p.official_basis,p.source_url,
          p.source_sha256,p.content_sha256,p.canonical_json,coalesce((select e.action from app.corporate_tax_rule_package_event e
            where e.package_id=p.id and e.action in ('APPROVED','REJECTED') order by e.occurred_at desc limit 1),'PENDING_REVIEW') status
        from app.corporate_tax_rule_package p where p.tenant_id=$1 and p.empresa_id=$2 order by p.created_at desc,p.id`, [tenantId, companyId]);
      return result.rows;
      });
    });
  }

  async importRulePackage(tenantId: string, userId: string, companyId: string, roles: readonly string[], input: unknown,
    file: Upload | undefined, correlationId: string) {
    if (!roles.includes('contador') && !roles.includes('admin_escritorio'))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente contador ou admin_escritorio importa pacotes fiscais.');
    const content = CorporateTaxRulePackageSchema.parse(input);
    if (!file || file.buffer.length === 0 || file.buffer.length > 20 * 1024 * 1024 || file.mimetype !== 'application/pdf' ||
        !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Anexe fonte normativa oficial em PDF válido, até 20 MB.');
    const sourceSha = sha(file.buffer), packageHash = sha(canonicalizarJson({ content, sourceSha }));
    const id = randomUUID(), storageKey = `${tenantId}/${companyId}/fiscal/corporate-tax-rule-packages/${id}/${sourceSha}`;
    await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      await comFinalidade(client, 'COMUM', async () => this.company(client, tenantId, companyId));
    });
    await this.storage.enviarComChave(storageKey, file.buffer, file.mimetype);
    try {
      return await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        return comFinalidade(client, 'COMUM', async () => {
        await this.company(client, tenantId, companyId);
        await client.query(`insert into app.corporate_tax_rule_package(id,tenant_id,empresa_id,version,valid_from,valid_through,consulted_at,
          official_basis,source_url,source_storage_key,source_sha256,content_sha256,canonical_json,requested_by,created_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,now())`,
        [id, tenantId, companyId, content.version, content.validFrom, content.validThrough, content.consultedAt, content.officialBasis,
          content.sourceUrl, storageKey, sourceSha, packageHash, canonicalizarJson(content), userId]);
        await client.query(`insert into app.corporate_tax_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'IMPORTED',$4,now(),$5,$6::jsonb)`,
        [tenantId, companyId, id, userId, correlationId, JSON.stringify({ version: content.version, contentHash: packageHash, sourceHash: sourceSha })]);
        return { id, version: content.version, status: 'PENDING_REVIEW', sourceSha256: sourceSha, contentSha256: packageHash };
        });
      });
    } catch (error) { await this.storage.remover(storageKey).catch(() => undefined); throw error; }
  }

  async reviewRulePackage(tenantId: string, userId: string, companyId: string, packageId: string, roles: readonly string[], input: unknown, correlationId: string) {
    const parsed = ReviewCorporateTaxRulePackageSchema.parse(input);
    if (!rolesCanReview(roles))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente contador ou admin_escritorio revisa pacote fiscal.');
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      return comFinalidade(client, 'COMUM', async () => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`corporate-tax-rule-package:${tenantId}:${companyId}:${packageId}`]);
      const result = await client.query<Row>(`select p.*,exists(select 1 from app.corporate_tax_rule_package_event e where e.package_id=p.id
          and e.action in ('APPROVED','REJECTED')) decided
        from app.corporate_tax_rule_package p where p.id=$1 and p.tenant_id=$2 and p.empresa_id=$3`, [packageId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row || row['decided'] === true) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_REVISION_CONFLICT, 'Pacote inexistente ou já revisado.');
      const previousDecision = await client.query<Row>(`select id from app.corporate_tax_rule_package_event
        where package_id=$1 and action in ('APPROVED','REJECTED')`, [packageId]);
      if (previousDecision.rows.length) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_REVISION_CONFLICT, 'Pacote já decidido por outra revisão concorrente.');
      const file = await this.storage.obter(String(row['source_storage_key']));
      const content = CorporateTaxRulePackageSchema.parse(row['canonical_json']);
      if (sha(file.conteudo) !== row['source_sha256'] || sha(canonicalizarJson({ content, sourceSha: row['source_sha256'] })) !== row['content_sha256'])
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da fonte ou do pacote não confere.');
      if (parsed.action === 'APPROVED') {
        const overlaps = await client.query<Row>(`select exists(select 1 from app.corporate_tax_rule_package p
          where p.tenant_id=$1 and p.empresa_id=$2 and p.id<>$3
            and coalesce((select terminal.action from app.corporate_tax_rule_package_event terminal where terminal.package_id=p.id and terminal.action in ('APPROVED','REJECTED','SUPERSEDED') order by terminal.occurred_at desc,terminal.id desc limit 1),'PENDING_REVIEW') in ('APPROVED','PENDING_REVIEW')
            and (select valid_through from app.corporate_tax_rule_package where id=$3) is not null
            and p.valid_from <= (select valid_through from app.corporate_tax_rule_package where id=$3)
            and (p.valid_through is null or p.valid_through >= (select valid_from from app.corporate_tax_rule_package where id=$3)))
          or exists(select 1 from app.corporate_tax_rule_package p
            where p.tenant_id=$1 and p.empresa_id=$2 and p.id<>$3
              and coalesce((select terminal.action from app.corporate_tax_rule_package_event terminal where terminal.package_id=p.id and terminal.action in ('APPROVED','REJECTED','SUPERSEDED') order by terminal.occurred_at desc,terminal.id desc limit 1),'PENDING_REVIEW') in ('APPROVED','PENDING_REVIEW')
              and (select valid_through from app.corporate_tax_rule_package where id=$3) is null
              and (p.valid_through is null or p.valid_through >= (select valid_from from app.corporate_tax_rule_package where id=$3))) conflict`,
        [tenantId,companyId,packageId]);
        if (overlaps.rows[0]?.['conflict'] === true) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_RULE_CONFLICT, 'Pacote concorre com outra versão vigente ou pendente.');
      }
      await client.query(`insert into app.corporate_tax_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,$4,$5,now(),$6,$7::jsonb)`, [tenantId, companyId, packageId, parsed.action, userId, correlationId, JSON.stringify({ reason: parsed.reason, contentHash: row['content_sha256'] })]);
      if (parsed.action === 'APPROVED') await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        select a.tenant_id,a.empresa_id,a.id,'INVALIDATED',$4,now(),$5,jsonb_build_object('reason','CORPORATE_TAX_RULE_PACKAGE_APPROVED','packageId',$3::uuid)
        from app.corporate_tax_assessment a join app.corporate_tax_rule_package newp on newp.id=$3 and newp.tenant_id=$1 and newp.empresa_id=$2
          and newp.valid_from <= (case a.quarter when '2026-Q1' then date '2026-03-31' when '2026-Q2' then date '2026-06-30' when '2026-Q3' then date '2026-09-30' else date '2026-12-31' end)
          and (newp.valid_through is null or newp.valid_through >= (case a.quarter when '2026-Q1' then date '2026-01-01' when '2026-Q2' then date '2026-04-01' when '2026-Q3' then date '2026-07-01' else date '2026-10-01' end))
          where a.tenant_id=$1 and a.empresa_id=$2 and a.package_id<>$3
          and exists(select 1 from app.corporate_tax_assessment_event approved where approved.assessment_id=a.id and approved.action='APPROVED')
          and not exists(select 1 from app.corporate_tax_assessment_event prior where prior.assessment_id=a.id and prior.action in ('INVALIDATED','SUPERSEDED'))`,
      [tenantId, companyId, packageId, userId, correlationId]);
      return { id: packageId, status: parsed.action };
      });
    });
  }

  async declare(tenantId: string, userId: string, companyId: string, input: unknown, files: readonly Upload[], correlationId: string) {
    const parsed = CorporateTaxDeclarationSchema.parse(input);
    const allowedTypes = new Set(['application/pdf', 'image/png', 'image/jpeg']);
    if (files.length !== parsed.evidence.length || files.some((file) => {
      const signatureValid = file.mimetype === 'application/pdf' ? file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) :
        file.mimetype === 'image/png' ? file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
        file.mimetype === 'image/jpeg' ? file.buffer.subarray(0, 3).equals(Buffer.from([255,216,255])) : false;
      return file.buffer.length === 0 || file.buffer.length > 20 * 1024 * 1024 || !allowedTypes.has(file.mimetype) || !signatureValid;
    }))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EVIDENCE_REQUIRED, 'Cada evidência exige PDF, PNG ou JPEG válido de até 20 MB.');
    if (parsed.deductions.some((item) => item.evidenceIndex >= files.length))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EVIDENCE_REQUIRED, 'Dedução referencia evidência inexistente.');
    const evidence = files.map((file, index) => ({ id: randomUUID(), file, metadata: parsed.evidence[index]!, sha: sha(file.buffer) }));
    const digest = sha(canonicalizarJson({ ...parsed, evidence: evidence.map((item) => ({ ...item.metadata, sha256: item.sha })) }));
    const storageKeys: string[] = [];
    try {
      for (const item of evidence) {
        const key = `${tenantId}/${companyId}/fiscal/corporate-tax-evidence/${item.id}/${item.sha}`;
        await this.storage.enviarComChave(key, item.file.buffer, item.file.mimetype);
        storageKeys.push(key);
      }
      return await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        return comFinalidade(client, 'COMUM', async () => {
        await this.company(client, tenantId, companyId);
        const repeated = await client.query<Row>(`select id,revision,content_sha256 from app.corporate_tax_declaration
          where tenant_id=$1 and empresa_id=$2 and idempotency_sha256=$3`, [tenantId, companyId, digest]);
        if (repeated.rows[0]) {
          await Promise.all(storageKeys.map((key) => this.storage.remover(key).catch(() => undefined)));
          storageKeys.length = 0;
          return { id: repeated.rows[0]['id'], quarter: parsed.quarter, revision: repeated.rows[0]['revision'],
            contentSha256: repeated.rows[0]['content_sha256'], reproduced: true };
        }
        const previousResult = await client.query<{ id: string; revision: number }>(`select id,revision from app.corporate_tax_declaration
          where tenant_id=$1 and empresa_id=$2 and quarter=$3 order by revision desc limit 1`, [tenantId, companyId, parsed.quarter]);
        const previous = previousResult.rows[0];
        if ((previous && parsed.supersedesId !== previous.id) || (!previous && parsed.supersedesId))
          throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_REVISION_CONFLICT, 'Declaração mudou; atualize a revisão vinculada.');
        const id = randomUUID(), createdAt = new Date().toISOString();
        const evidenceSnapshot = evidence.map((item) => ({ id: item.id, ...item.metadata,
          fileName: item.file.originalname.slice(0, 255), sha256: item.sha }));
        const declaration = { ...parsed,
          revenue: parsed.revenue.map((item) => ({ ...item, sourceIds: item.sourceIds.map((source) => {
            const match = /^evidence-index:(\d+)$/u.exec(source);
            const evidenceId = match ? evidenceSnapshot[Number(match[1])]?.id : undefined;
            return evidenceId ? `evidence:${evidenceId}` : source;
          }) })),
          evidence: evidenceSnapshot, supersedesId: previous?.id ?? null, preparedBy: userId, createdAtUtc: createdAt };
        const canonical = canonicalizarJson(declaration), contentHash = sha(canonical), revision = (previous?.revision ?? 0) + 1;
        await client.query(`insert into app.corporate_tax_declaration(id,tenant_id,empresa_id,quarter,recognition,revision,supersedes_id,
          idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at,correlation_id)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
        [id, tenantId, companyId, parsed.quarter, parsed.recognition, revision, previous?.id ?? null, digest, contentHash, canonical, userId, createdAt, correlationId]);
        for (const [index, item] of evidence.entries()) {
          await client.query(`insert into app.corporate_tax_evidence(id,tenant_id,empresa_id,declaration_id,kind,description,file_name,storage_key,
            content_sha256,requested_by,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [item.id, tenantId, companyId, id, item.metadata.kind, item.metadata.description, item.file.originalname.slice(0, 255), storageKeys[index], item.sha, userId, createdAt]);
          await client.query(`insert into app.corporate_tax_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
            values($1,$2,$3,'EVIDENCE_ATTACHED',$4,$5,$6,$7::jsonb)`, [tenantId, companyId, id, userId, createdAt, correlationId, JSON.stringify({ evidenceId: item.id, kind: item.metadata.kind, sha256: item.sha })]);
        }
        await client.query(`insert into app.corporate_tax_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'DECLARED',$4,$5,$6,$7::jsonb)`, [tenantId, companyId, id, userId, createdAt, correlationId, JSON.stringify({ revision, contentHash })]);
      await client.query(`insert into app.corporate_tax_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'JUSTIFIED',$4,$5,$6,$7::jsonb)`, [tenantId,companyId,id,userId,createdAt,correlationId,JSON.stringify({ justification: parsed.justification })]);
        if (previous) await client.query(`insert into app.corporate_tax_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'SUPERSEDED',$4,$5,$6,$7::jsonb)`, [tenantId, companyId, previous.id, userId, createdAt, correlationId, JSON.stringify({ supersededBy: id })]);
        if (previous) await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
          select a.tenant_id,a.empresa_id,a.id,'INVALIDATED',$1,$2,$3,jsonb_build_object('reason','DECLARATION_SUPERSEDED','declarationId',$4::uuid)
          from app.corporate_tax_assessment a where a.declaration_id=$4
            and exists(select 1 from app.corporate_tax_assessment_event approved where approved.assessment_id=a.id and approved.action='APPROVED')
            and not exists(select 1 from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='INVALIDATED')`,
        [userId, createdAt, correlationId, previous.id]);
        return { id, quarter: parsed.quarter, revision, contentSha256: sha(canonical), evidence: evidenceSnapshot };
        });
      });
    } catch (error) { await Promise.all(storageKeys.map((key) => this.storage.remover(key).catch(() => undefined))); throw error; }
  }

  private installments(packageContent: Row, quarter: string, tax: 'IRPJ' | 'CSLL', payable: number, count: number) {
    const terms = record(packageContent['installmentTerms']);
    const dueDates = Array.isArray(terms['dueDates']) ? terms['dueDates'].map(record) : [];
    const maximum = typeof terms['maximumInstallments'] === 'number' ? terms['maximumInstallments'] : 0;
    const minimum = typeof terms['minimumPrincipalCents'] === 'number' ? terms['minimumPrincipalCents'] : Number.MAX_SAFE_INTEGER;
    if (count > maximum || (count > 1 && payable < minimum * count))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_INSTALLMENT_INVALID, 'Quantidade ou valor mínimo de quotas não coberto pelo pacote.');
    if (payable > 0 && payable < minimum)
      throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_INSTALLMENT_INVALID, 'Saldo inferior ao mínimo oficial de recolhimento sem cobertura de quota única.');
    if (payable === 0) return [];
    const base = Math.floor(payable / count), remainder = payable % count;
    return Array.from({ length: count }, (_, index) => {
      const entry = dueDates.find((item) => item['quarter'] === quarter && item['tax'] === tax && item['installmentNumber'] === index + 1);
      if (!entry || typeof entry['dueDate'] !== 'string' || typeof entry['additionRateScaled'] !== 'string' || !Array.isArray(entry['sourceIds']))
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_INSTALLMENT_INVALID, 'Vencimento ou regra de acréscimo sem cobertura.');
      const principalCents = base + (index < remainder ? 1 : 0);
      const rate = parseScaledRate(entry['additionRateScaled']);
      if (rate === null) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_INSTALLMENT_INVALID, 'Taxa de quota inválida.');
      const additionCents = safe(roundHalfUp(BigInt(principalCents) * rate, CORPORATE_TAX_RATE_SCALE));
      return { tax, installmentNumber: index + 1, principalCents, additionCents, totalCents: principalCents + additionCents,
        dueDate: entry['dueDate'], draftArtifactId: randomUUID(), ruleSourceIds: entry['sourceIds'], additionRateScaled: entry['additionRateScaled'], ruleId: `INSTALLMENT_${tax}_${quarter}_${index + 1}` };
    });
  }

  async prepare(tenantId: string, userId: string, companyId: string, input: unknown, correlationId: string) {
    const parsed = PrepareCorporateTaxAssessmentSchema.parse(input);
    const artifactKeys: string[] = [];
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      return comFinalidade(client, 'COMUM', async () => {
      const company = await this.company(client, tenantId, companyId);
      const declarationResult = await client.query<Row>(`select d.* from app.corporate_tax_declaration d
        where d.id=$1 and d.tenant_id=$2 and d.empresa_id=$3 and d.quarter=$4 and not exists(
          select 1 from app.corporate_tax_declaration_event e where e.declaration_id=d.id and e.action='SUPERSEDED')`,
      [parsed.revenueDeclarationId, tenantId, companyId, parsed.quarter]);
      const declarationRow = declarationResult.rows[0];
      const packageResult = await client.query<Row>(`select p.* from app.corporate_tax_rule_package p
        where p.id=$1 and p.tenant_id=$2 and p.empresa_id=$3 and exists(select 1 from app.corporate_tax_rule_package_event e where e.package_id=p.id and e.action='APPROVED')
          and not exists(select 1 from app.corporate_tax_rule_package_event e where e.package_id=p.id and e.action in ('REJECTED','SUPERSEDED'))`,
      [parsed.packageId, tenantId, companyId]);
      const packageRow = packageResult.rows[0];
      if (!declarationRow || !packageRow) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_RULE_MISSING, 'Declaração vigente ou pacote aprovado não encontrado.');
      const ruleFile = await this.storage.obter(String(packageRow['source_storage_key']));
      const packageContent = CorporateTaxRulePackageSchema.parse(packageRow['canonical_json']);
      if (sha(ruleFile.conteudo) !== packageRow['source_sha256'] ||
          sha(canonicalizarJson({ content: packageContent, sourceSha: packageRow['source_sha256'] })) !== packageRow['content_sha256'])
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da fonte normativa ou pacote diverge.');
      const quarterStart = `${quarterMonths[parsed.quarter]![0]}-01`;
      const quarterEnd = new Date(Date.UTC(Number(quarterStart.slice(0,4)), Number(quarterStart.slice(5,7)) - 1 + 3, 0)).toISOString().slice(0,10);
      const competingPackages = await client.query<{ count: string }>(`select count(*)::text count from app.corporate_tax_rule_package p
        where p.tenant_id=$1 and p.empresa_id=$2 and p.id<>$3 and p.valid_from <= $5::date
          and (p.valid_through is null or p.valid_through >= $4::date)
          and exists(select 1 from app.corporate_tax_rule_package_event e where e.package_id=p.id and e.action='APPROVED')
          and not exists(select 1 from app.corporate_tax_rule_package_event e where e.package_id=p.id and e.action in ('REJECTED','SUPERSEDED'))`,
      [tenantId, companyId, parsed.packageId, quarterStart, quarterEnd]);
      if (Number(competingPackages.rows[0]?.count ?? '0') > 0)
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_RULE_CONFLICT, 'Mais de um pacote aprovado cobre o trimestre.');
      if (company['status'] !== 'ATIVA' || company['situacao'] !== 'ativo' || company['regime_tributario'] !== 'LUCRO_PRESUMIDO')
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_REGIME_MISMATCH, 'Empresa inativa ou fora do Lucro Presumido no cadastro atual.');
      const declaration = record(declarationRow['canonical_json']);
      const declarationBytes = canonicalizarJson(declaration);
      if (sha(declarationBytes) !== declarationRow['content_sha256'])
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da declaração ou evidências diverge.');
      const declarationEvidence = Array.isArray(declaration['evidence']) ? declaration['evidence'].map(record) : [];
      const persistedEvidence = await client.query<Row>(`select id,kind,content_sha256 from app.corporate_tax_evidence
        where tenant_id=$1 and empresa_id=$2 and declaration_id=$3`, [tenantId,companyId,parsed.revenueDeclarationId]);
      const persistedEvidenceById = new Map(persistedEvidence.rows.map((item) => [String(item['id']), item]));
      if (declarationEvidence.length !== persistedEvidenceById.size || new Set(declarationEvidence.map((item) => item['id'])).size !== declarationEvidence.length ||
          declarationEvidence.some((item) => {
            const persisted = persistedEvidenceById.get(String(item['id']));
            return item['kind'] !== persisted?.['kind'] || item['sha256'] !== persisted?.['content_sha256'];
          }))
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Lista ou hash de evidências da declaração diverge dos anexos persistidos.');
      if (declaration['recognition'] !== parsed.recognition)
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_RECOGNITION_OPTION_CONFLICT, 'Critério informado diverge da opção anual declarada.');
      const evidenceResult = await client.query<Row>(`select id,kind,content_sha256 from app.corporate_tax_evidence
        where tenant_id=$1 and empresa_id=$2 and declaration_id=$3`, [tenantId, companyId, parsed.revenueDeclarationId]);
      const evidenceById = new Map(evidenceResult.rows.map((item) => [String(item['id']), item]));
      const hasEvidenceSource = (kind: string) => declarationEvidence.some((item) => item['kind'] === kind && typeof item['sourceReference'] === 'string');
      const selectedEvidence = [...evidenceById.values()].filter((item) => parsed.deductionEvidenceIds.includes(String(item['id'])));
      const rawRevenue = Array.isArray(declaration['revenue']) ? declaration['revenue'].filter(isRecord) : [];
      const reconciliation = await this.reconcileRevenue(client, tenantId, companyId, String(company['cnpj']), parsed.recognition,
        parsed.quarter, rawRevenue, evidenceById, declarationEvidence, packageContent.rules.map((rule) => record(rule)));
      const revenue: CorporateTaxRevenue[] = reconciliation.revenue.flatMap((item): CorporateTaxRevenue[] => {
        if (typeof item['id'] !== 'string' || typeof item['activityCode'] !== 'string' || typeof item['revenueNatureCode'] !== 'string' ||
            typeof item['month'] !== 'string' || typeof item['grossCents'] !== 'number' || typeof item['adjustmentCents'] !== 'number' ||
            typeof item['directAdditionCents'] !== 'number' || !Array.isArray(item['sourceIds']) || !item['sourceIds'].every((source) => typeof source === 'string') ||
            !Array.isArray(item['ruleIds']) || !item['ruleIds'].every((id) => typeof id === 'string')) return [];
        return [{ id: item['id'], activityCode: item['activityCode'], revenueNatureCode: item['revenueNatureCode'], month: item['month'],
          grossCents: item['grossCents'], adjustmentCents: item['adjustmentCents'], directAdditionCents: item['directAdditionCents'],
          lineType: item['lineType'] as NonNullable<CorporateTaxRevenue['lineType']>, adjustmentReason: typeof item['adjustmentReason'] === 'string' ? item['adjustmentReason'] : null,
          sourceIds: [...item['sourceIds'].map((source) => {
            const match = /^evidence-index:(\d+)$/u.exec(source as string);
            return match && evidenceResult.rows[Number(match[1])] ? `evidence:${String(evidenceResult.rows[Number(match[1])]!['id'])}` : source as string;
          }), ...item['ruleIds'].map((id) => `rule:${String(id)}`)] }];
      });
      const deductions: CorporateTaxDeductionInput[] = Array.isArray(declaration['deductions']) ? declaration['deductions'].flatMap((item): CorporateTaxDeductionInput[] => {
        if (!isRecord(item) || (item['tax'] !== 'IRPJ' && item['tax'] !== 'CSLL') ||
            (item['kind'] !== 'WITHHOLDING' && item['kind'] !== 'ADVANCE_PAYMENT') || typeof item['amountCents'] !== 'number' ||
            typeof item['evidenceIndex'] !== 'number' || typeof item['ruleId'] !== 'string') return [];
        const declaredEvidence = Array.isArray(declaration['evidence']) ? declaration['evidence'][item['evidenceIndex']] : null;
        const evidence = evidenceResult.rows.find((candidate) => candidate['id'] === record(declaredEvidence)['id']);
        if (!evidence || evidence['kind'] !== item['evidenceKind'] || !parsed.deductionEvidenceIds.includes(String(evidence['id']))) return [];
        const rule = packageContent.deductionRules.find((candidate) => candidate.id === item['ruleId'] && candidate.tax === item['tax'] &&
          candidate.kind === item['kind'] && candidate.evidenceKind === item['evidenceKind']);
        if (!rule) return [];
        const recognizedOn = typeof record(declaredEvidence)['recognizedOn'] === 'string' ? String(record(declaredEvidence)['recognizedOn']) : null;
        return [{ tax: item['tax'] as 'IRPJ' | 'CSLL', kind: item['kind'] as 'WITHHOLDING' | 'ADVANCE_PAYMENT',
          amountCents: item['amountCents'], recognizedOn, evidenceId: String(evidence['id']), ruleId: item['ruleId'],
          sourceIds: [...rule.sourceIds, String(evidence['content_sha256'])] }];
      }) : [];
      const packageForDomain: CorporateTaxRulePackage = {
        version: packageContent.version, approved: true, validFrom: packageContent.validFrom, validThrough: packageContent.validThrough,
        sourceIds: [packageContent.sourceUrl, String(packageRow['source_sha256'])],
        rules: packageContent.rules.map((rule) => ({ ...rule, sourceIds: [...rule.sourceIds] })),
        additionalIrpjRateScaled: packageContent.additionalIrpjRateScaled,
        additionalIrpjThresholdCentsByMonth: packageContent.additionalIrpjThresholdCentsByMonth,
        additionalIrpjRuleId: packageContent.additionalIrpjRuleId, additionalIrpjSourceIds: packageContent.additionalIrpjSourceIds,
        rounding: packageContent.rounding,
      };
      const historicalOptions = await client.query<{ recognition: string | null }>(`select distinct canonical_json->>'recognition' recognition
        from app.corporate_tax_declaration where tenant_id=$1 and empresa_id=$2 and quarter like '2026-%'
          and not exists(select 1 from app.corporate_tax_declaration_event e where e.declaration_id=corporate_tax_declaration.id and e.action='SUPERSEDED')`,
      [tenantId, companyId]);
      const recognitionConflict = historicalOptions.rows.some((item) => item.recognition !== null && item.recognition !== parsed.recognition);
      const rawDeductions = Array.isArray(declaration['deductions']) ? declaration['deductions'].map(record) : [];
      const deductionsCovered = deductions.length === rawDeductions.length && deductions.every((item) => {
        const rule = packageContent.deductionRules.find((candidate) => candidate.id === item.ruleId && candidate.tax === item.tax && candidate.kind === item.kind);
        const declarationItem = rawDeductions.find((candidate) => candidate['ruleId'] === item.ruleId && candidate['evidenceKind'] === rule?.evidenceKind &&
          typeof candidate['evidenceIndex'] === 'number' && declarationEvidence[candidate['evidenceIndex']]?.['id'] === item.evidenceId);
        if (!rule || !declarationItem || typeof declarationItem['evidenceIndex'] !== 'number') return false;
        const evidence = declarationEvidence[declarationItem['evidenceIndex']];
        return evidence?.['kind'] === rule.evidenceKind && rule.sourceIds.length > 0 && evidence['sourceReference'] !== null &&
          evidence['amountCents'] === item.amountCents && declarationItem['amountCents'] === item.amountCents;
      });
      const deductionsAmountComplete = deductions.reduce((sum, item) => sum + BigInt(item.amountCents), 0n) ===
        (Array.isArray(declaration['deductions']) ? declaration['deductions'].map(record).reduce((sum, item) => sum + BigInt(typeof item['amountCents'] === 'number' ? item['amountCents'] : -1), 0n) : 0n);
      const result = calculateCorporateTaxAssessment({ quarter: parsed.quarter, recognition: parsed.recognition,
        recognitionOptionValid: declaration['recognitionOptionValid'] === true && hasEvidenceSource('OPCAO_ANUAL_RECONHECIMENTO') && !recognitionConflict,
        regimeVerified: declaration['regimeVerified'] === true && company['regime_tributario'] === 'LUCRO_PRESUMIDO' && hasEvidenceSource('ENQUADRAMENTO_LUCRO_PRESUMIDO'),
        activityVerified: declaration['activityVerified'] === true && hasEvidenceSource('ATIVIDADE_COMERCIO_AUTOPECAS'),
        revenueReconciled: declaration['revenueReconciled'] === true && reconciliation.allValid && hasEvidenceSource('RECONCILIACAO_RECEITAS') &&
          hasEvidenceSource('EVENTOS_CANCELAMENTOS_DEVOLUCOES_RECONCILIADOS') && revenue.length === rawRevenue.length,
        deductionsComplete: deductions.length === (Array.isArray(declaration['deductions']) ? declaration['deductions'].length : 0) && deductionsCovered && deductionsAmountComplete,
        package: packageForDomain, revenue, deductions });
      const assessmentId = randomUUID(), createdAt = new Date().toISOString();
      const idempotencyHash = sha(canonicalizarJson({ declarationHash: declarationRow['content_sha256'], packageHash: packageRow['content_sha256'],
        recognition: parsed.recognition, deductionEvidenceIds: selectedEvidence.map((item) => item['id']).sort(), installmentCount: parsed.installmentCount, contractVersion: 'SPEC-038-v1' }));
      const existing = await client.query<Row>(`select a.*,coalesce((select case e.action when 'RETURNED' then 'INCOMPLETE' when 'INVALIDATED' then 'POSSIBLY_OUTDATED' else e.action end from app.corporate_tax_assessment_event e where e.assessment_id=a.id
        and e.action in ('APPROVED','REJECTED','RETURNED','INVALIDATED','SUPERSEDED') order by e.occurred_at desc limit 1),a.status) current_status,
        (select actor_id from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_by,
        (select occurred_at from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_at
        from app.corporate_tax_assessment a where a.tenant_id=$1 and a.empresa_id=$2 and a.idempotency_sha256=$3`,
      [tenantId, companyId, idempotencyHash]);
      if (existing.rows[0]) {
        const prior = existing.rows[0];
        const body = record(prior['canonical_json']);
        if (sha(canonicalizarJson(body)) !== prior['content_sha256']) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da apuração não confere.');
        await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'REPRODUCED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, prior['id'], userId, correlationId, JSON.stringify({ contentHash: prior['content_sha256'] })]);
        const view = assessmentContent(body, prior['current_status'], prior['revision'], prior['approved_by'], prior['approved_at']);
        return { ...assessmentDto(view, String(prior['content_sha256'])), reproduced: true };
      }
      const previous = await client.query<{ revision: number }>('select coalesce(max(revision),0)+1 revision from app.corporate_tax_assessment where tenant_id=$1 and empresa_id=$2 and quarter=$3',
        [tenantId, companyId, parsed.quarter]);
      const revision = previous.rows[0]?.revision ?? 1;
      const rawInstallments = result.status === 'READY_FOR_REVIEW'
        ? [...this.installments(packageContent, parsed.quarter, 'IRPJ', result.irpjPayableCents!, parsed.installmentCount),
          ...this.installments(packageContent, parsed.quarter, 'CSLL', result.csllPayableCents!, parsed.installmentCount)] : [];
      const artifactIdsByTax = new Map<'IRPJ' | 'CSLL', string>();
      for (const tax of ['IRPJ', 'CSLL'] as const) {
        const payable = tax === 'IRPJ' ? result.irpjPayableCents : result.csllPayableCents;
        if (payable !== null && payable > 0) artifactIdsByTax.set(tax, randomUUID());
      }
      const installments = rawInstallments.map((item) => ({ ...item, draftArtifactId: artifactIdsByTax.get(item['tax'] as 'IRPJ' | 'CSLL')! }));
      const approvals = await client.query<Row>(`select a.id from app.corporate_tax_assessment a
        where a.tenant_id=$1 and a.empresa_id=$2 and a.quarter=$3
          and exists(select 1 from app.corporate_tax_assessment_event approved where approved.assessment_id=a.id and approved.action='APPROVED')
          and not exists(select 1 from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action in ('INVALIDATED','SUPERSEDED'))`,
      [tenantId,companyId,parsed.quarter]);
      for (const prior of approvals.rows) await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'SUPERSEDED',$4,$5,$6,$7::jsonb)`, [tenantId,companyId,prior['id'],userId,createdAt,correlationId,
        JSON.stringify({ reason:'NEW_CORPORATE_TAX_REVISION', replacementAssessmentId:assessmentId })]);
      const artifactByTax = new Map<'IRPJ' | 'CSLL', { id: string; key: string; digest: string }>();
      for (const tax of ['IRPJ', 'CSLL'] as const) {
        const taxInstallments = installments.filter((item) => item['tax'] === tax);
        if (taxInstallments.length === 0) continue;
        const artifactId = String(taxInstallments[0]!['draftArtifactId']);
        const bytes = renderCorporateTaxPdf({ quarter: parsed.quarter, companyId, revision, status: 'RASCUNHO_LOCAL', rulePackageVersion: packageContent.version,
          revisionCreatedAtUtc: createdAt, irpjPayableCents: tax === 'IRPJ' ? result.irpjPayableCents : null,
          csllPayableCents: tax === 'CSLL' ? result.csllPayableCents : null, components: result.components.filter((item) => tax === 'IRPJ' ? item.tax !== 'CSLL' : item.tax === 'CSLL'),
          deductions: result.deductions.filter((item) => item.tax === tax), installments: taxInstallments }, tax);
        const digest = sha(bytes), key = `${tenantId}/${companyId}/fiscal/corporate-tax-artifacts/${artifactId}/${digest}.pdf`;
        await this.storage.enviarComChave(key, bytes, 'application/pdf'); artifactKeys.push(key);
        artifactByTax.set(tax, { id: artifactId, key, digest });
      }
      if (result.status === 'READY_FOR_REVIEW' && selectedEvidence.length !== parsed.deductionEvidenceIds.length)
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EVIDENCE_REQUIRED, 'Evidência selecionada não pertence à declaração.');
      const snapshot = { assessmentId, tenantId, companyId, quarter: parsed.quarter, revenueRecognition: parsed.recognition, status: result.status,
        rulePackageVersion: packageContent.version, components: result.components, deductions: result.deductions, installments,
        draftArtifactIds: [...artifactByTax.values()].map((item) => item.id),
        irpjPayableCents: result.irpjPayableCents, csllPayableCents: result.csllPayableCents, installmentCount: parsed.installmentCount, gapCodes: result.gapCodes,
        preparedBy: userId, approvedBy: null, approvedAtUtc: null, contractVersion: 'SPEC-038-v1', revisionCreatedAtUtc: createdAt, revision };
      const canonical = canonicalizarJson(snapshot), contentHash = sha(canonical);
      await client.query(`insert into app.corporate_tax_assessment(id,tenant_id,empresa_id,quarter,revision,status,recognition,package_id,declaration_id,
        installment_count,idempotency_sha256,content_sha256,canonical_json,prepared_by,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
      [assessmentId, tenantId, companyId, parsed.quarter, revision, result.status, parsed.recognition, parsed.packageId, parsed.revenueDeclarationId,
        parsed.installmentCount, idempotencyHash, contentHash, canonical, userId, createdAt]);
      await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'PREPARED',$4,$5,$6,$7::jsonb)`, [tenantId, companyId, assessmentId, userId, createdAt, correlationId,
        JSON.stringify({ status: result.status, contentHash, declarationId: parsed.revenueDeclarationId, packageId: parsed.packageId })]);
      for (const [tax, artifact] of artifactByTax) {
        await client.query(`insert into app.corporate_tax_artifact(id,tenant_id,empresa_id,assessment_id,format,storage_key,artifact_sha256,canonical_sha256,created_by,created_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [artifact.id,tenantId,companyId,assessmentId,
          tax === 'IRPJ' ? 'IRPJ_DARF_DRAFT' : 'CSLL_DARF_DRAFT',artifact.key,artifact.digest,contentHash,userId,createdAt]);
      }
      return { ...assessmentDto(snapshot, contentHash) };
      });
    }).catch(async (error: unknown) => { await Promise.all(artifactKeys.map((key) => this.storage.remover(key).catch(() => undefined))); throw error; });
  }

  async get(tenantId: string, userId: string, companyId: string, assessmentId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      return comFinalidade(client, 'COMUM', async () => {
      const result = await client.query<Row>(`select a.*,coalesce((select case e.action when 'RETURNED' then 'INCOMPLETE' when 'INVALIDATED' then 'POSSIBLY_OUTDATED' when 'SUPERSEDED' then 'SUPERSEDED' else e.action end from app.corporate_tax_assessment_event e where e.assessment_id=a.id
        and e.action in ('APPROVED','REJECTED','RETURNED','INVALIDATED','SUPERSEDED') order by e.occurred_at desc limit 1),a.status) current_status
        ,(select actor_id from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_by
        ,(select occurred_at from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_at
        from app.corporate_tax_assessment a where a.id=$1 and a.tenant_id=$2 and a.empresa_id=$3 and app.empresa_autorizada(a.empresa_id)`,
      [assessmentId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Apuração fora do escopo autorizado.');
      const content = record(row['canonical_json']);
      const canonical = canonicalizarJson(content);
      if (sha(canonical) !== row['content_sha256']) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da apuração não confere.');
      const view = assessmentContent(content, row['current_status'], row['revision'], row['approved_by'], row['approved_at']);
      return assessmentDto(view, String(row['content_sha256']));
      });
    });
  }

  async review(tenantId: string, userId: string, companyId: string, assessmentId: string, roles: readonly string[], input: unknown, correlationId: string) {
    if (!rolesCanReview(roles)) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente contador ou admin_escritorio aprova a apuração.');
    const parsed = ReviewCorporateTaxAssessmentSchema.parse(input);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      return comFinalidade(client, 'COMUM', async () => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`corporate-tax-assessment:${tenantId}:${companyId}:${assessmentId}`]);
      const result = await client.query<Row>(`select a.*,coalesce((select e.action from app.corporate_tax_assessment_event e where e.assessment_id=a.id
        and e.action in ('APPROVED','REJECTED','RETURNED','INVALIDATED','SUPERSEDED') order by e.occurred_at desc limit 1),a.status) current_status
        from app.corporate_tax_assessment a where a.id=$1 and a.tenant_id=$2 and a.empresa_id=$3 and app.empresa_autorizada(a.empresa_id)`,
      [assessmentId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Apuração fora do escopo autorizado.');
      const previousDecision = await client.query<Row>(`select id from app.corporate_tax_assessment_event
        where assessment_id=$1 and action in ('APPROVED','REJECTED','RETURNED')`, [assessmentId]);
      if (previousDecision.rows.length || row['content_sha256'] !== parsed.expectedHash || row['current_status'] !== 'READY_FOR_REVIEW' || parsed.installmentCount !== row['installment_count'])
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_REVISION_CONFLICT, 'Apuração mudou ou ainda tem lacunas; recarregue antes da decisão.');
      const action = parsed.action === 'APPROVED' ? 'APPROVED' : parsed.action === 'REJECTED' ? 'REJECTED' : 'RETURNED';
      await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,$4,$5,now(),$6,$7::jsonb)`, [tenantId, companyId, assessmentId, action, userId, correlationId,
        JSON.stringify({ justification: parsed.justification, declarationsConfirmed: parsed.declarationsConfirmed, localDraftsAcknowledged: parsed.localDraftsAcknowledged, contentHash: parsed.expectedHash })]);
      return { id: assessmentId, status: action };
      });
    });
  }

  async history(tenantId: string, userId: string, companyId: string, quarter: string | undefined, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      return comFinalidade(client, 'COMUM', async () => {
      await this.company(client, tenantId, companyId);
      const result = await client.query<Row>(`select a.id,a.quarter,a.revision,a.status,a.content_sha256,a.canonical_json,a.created_at,
        coalesce((select case e.action when 'RETURNED' then 'INCOMPLETE' else e.action end from app.corporate_tax_assessment_event e
          where e.assessment_id=a.id and e.action in ('APPROVED','REJECTED','RETURNED','INVALIDATED','SUPERSEDED') order by e.occurred_at desc limit 1),a.status) current_status
        ,(select actor_id from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_by
        ,(select occurred_at from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_at
        from app.corporate_tax_assessment a where a.tenant_id=$1 and a.empresa_id=$2 and ($3::text is null or a.quarter=$3)
        order by a.quarter desc,a.revision desc,a.created_at desc limit 100`, [tenantId, companyId, quarter ?? null]);
      return { items: result.rows.map((row) => {
        const content = record(row['canonical_json']);
        if (sha(canonicalizarJson(content)) !== row['content_sha256'])
          throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da apuração no histórico diverge.');
        const view = assessmentContent(content, row['current_status'], row['revision'], row['approved_by'], row['approved_at']);
        return { id: row['id'], quarter: row['quarter'], revision: row['revision'], status: row['current_status'],
          canonicalJsonHash: sha(canonicalizarJson(view)), createdAtUtc: row['created_at'] };
      }) };
      });
    });
  }

  async downloadPackageSource(tenantId: string, userId: string, companyId: string, packageId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<Row>(`select id,source_storage_key,source_sha256 from app.corporate_tax_rule_package
        where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)`, [packageId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Fonte do pacote fora do escopo autorizado.');
      const file = await this.storage.obter(String(row['source_storage_key']));
      if (sha(file.conteudo) !== row['source_sha256']) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da fonte oficial diverge.');
      await client.query(`insert into app.corporate_tax_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'DOWNLOADED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, packageId, userId, correlationId, JSON.stringify({ sourceSha256: row['source_sha256'] })]);
      return { bytes: file.conteudo, contentType: file.tipoConteudo ?? 'application/pdf', hash: String(row['source_sha256']) };
    });
  }

  async downloadEvidence(tenantId: string, userId: string, companyId: string, declarationId: string, evidenceId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<Row>(`select id,file_name,storage_key,content_sha256 from app.corporate_tax_evidence
        where id=$1 and declaration_id=$2 and tenant_id=$3 and empresa_id=$4 and app.empresa_autorizada(empresa_id)`,
      [evidenceId, declarationId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Evidência fora do escopo autorizado.');
      const file = await this.storage.obter(String(row['storage_key']));
      if (sha(file.conteudo) !== row['content_sha256']) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash da evidência diverge.');
      await client.query(`insert into app.corporate_tax_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'EVIDENCE_DOWNLOADED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, declarationId, userId, correlationId, JSON.stringify({ evidenceId, contentSha256: row['content_sha256'] })]);
      return { bytes: file.conteudo, fileName: String(row['file_name']), contentType: file.tipoConteudo ?? 'application/octet-stream', hash: String(row['content_sha256']) };
    });
  }

  async downloadArtifact(tenantId: string, userId: string, companyId: string, assessmentId: string, artifactId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<Row>(`select id,format,storage_key,artifact_sha256,canonical_sha256 from app.corporate_tax_artifact
        where id=$1 and assessment_id=$2 and tenant_id=$3 and empresa_id=$4 and app.empresa_autorizada(empresa_id)`,
      [artifactId, assessmentId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Artefato fora do escopo autorizado.');
      const file = await this.storage.obter(String(row['storage_key']));
      if (sha(file.conteudo) !== row['artifact_sha256']) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash do artefato fiscal diverge.');
      const assessment = await client.query<Row>(`select content_sha256 from app.corporate_tax_assessment
        where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)`, [assessmentId,tenantId,companyId]);
      if (assessment.rows[0]?.['content_sha256'] !== row['canonical_sha256'])
        throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Artefato não corresponde à memória canônica desta revisão.');
      await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'DOWNLOADED',$4,now(),$5,$6::jsonb)`, [tenantId,companyId,assessmentId,userId,correlationId,
        JSON.stringify({ artifactId, format: row['format'], artifactSha256: row['artifact_sha256'] })]);
      return { bytes: file.conteudo, contentType: file.tipoConteudo ?? 'application/octet-stream', format: String(row['format']),
        hash: String(row['artifact_sha256']), canonicalHash: String(row['canonical_sha256']) };
    });
  }

  async export(tenantId: string, userId: string, companyId: string, assessmentId: string, format: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<Row>(`select a.*,exists(select 1 from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED') approved,
          exists(select 1 from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action in ('INVALIDATED','SUPERSEDED')) invalid,
          coalesce((select case e.action when 'RETURNED' then 'INCOMPLETE' when 'INVALIDATED' then 'POSSIBLY_OUTDATED' when 'SUPERSEDED' then 'SUPERSEDED' else e.action end
            from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action in ('APPROVED','REJECTED','RETURNED','INVALIDATED','SUPERSEDED')
            order by e.occurred_at desc limit 1),a.status) current_status,
          (select actor_id from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_by,
          (select occurred_at from app.corporate_tax_assessment_event e where e.assessment_id=a.id and e.action='APPROVED' order by e.occurred_at desc limit 1) approved_at
        from app.corporate_tax_assessment a where a.id=$1 and a.tenant_id=$2 and a.empresa_id=$3 and app.empresa_autorizada(a.empresa_id)`,
      [assessmentId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Apuração fora do escopo autorizado.');
      const snapshot = record(row['canonical_json']), canonical = canonicalizarJson(snapshot);
      if (sha(canonical) !== row['content_sha256']) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_EXPORT_HASH_MISMATCH, 'Hash canônico da apuração diverge.');
      if (row['approved'] !== true || row['invalid'] === true) throw new ErroDeDominio(CODIGOS_DE_ERRO.CORPORATE_TAX_INDETERMINATE, 'Somente revisão vigente e aprovada pode gerar artefatos fiscais.');
      const view = assessmentContent(snapshot, row['current_status'], row['revision'], row['approved_by'], row['approved_at']);
      const canonicalView = canonicalizarJson(view), canonicalHash = sha(canonicalView);
      let bytes: Buffer, contentType: string, extension: string;
      if (format === 'JSON') { bytes = Buffer.from(canonicalView, 'utf8'); contentType = 'application/json; charset=utf-8'; extension = 'json'; }
      else if (format === 'CSV') {
        const cells: unknown[][] = [['tipo','tributo','atividade','natureza','receita_centavos','ajuste_centavos','base_presumida_centavos','adicao_direta_centavos','aliquota_presuncao','aliquota_tributo','tributo_centavos','regra','formula','numerador','denominador','arredondamento','fontes']];
        const components = Array.isArray(view['components']) ? view['components'].map(record) : [];
        for (const component of components) { const trace = record(component['calculationTrace']); cells.push(['COMPONENTE',component['tax'],component['activityCode'],component['revenueNatureCode'],component['grossRevenueCents'],
          component['adjustmentCents'],component['presumedBaseCents'],component['directAdditionCents'],component['presumptionRateScaled'],component['taxRateScaled'],
          component['grossTaxCents'],component['ruleId'],trace['formula'],trace['numerator'],trace['denominator'],trace['rounding'],Array.isArray(component['sourceIds']) ? component['sourceIds'].join('|') : '']); }
        const deductions = Array.isArray(view['deductions']) ? view['deductions'].map(record) : [];
        for (const item of deductions) cells.push(['DEDUCAO',item['tax'],'','','','','',item['amountCents'],'','','',item['ruleId'],'','','','',`${String(item['evidenceId'])}|${Array.isArray(item['sourceIds']) ? item['sourceIds'].join('|') : ''}`]);
        const installments = Array.isArray(view['installments']) ? view['installments'].map(record) : [];
        for (const item of installments) cells.push(['QUOTA',item['tax'],'','','','','','','','',item['totalCents'],item['ruleId'],`quota ${String(item['installmentNumber'])}; vence ${String(item['dueDate'])}`,item['principalCents'],item['additionCents'],item['additionRateScaled'],Array.isArray(item['ruleSourceIds']) ? item['ruleSourceIds'].join('|') : '']);
        for (const gap of Array.isArray(view['gapCodes']) ? view['gapCodes'] : []) cells.push(['LACUNA',String(gap)]);
        bytes = Buffer.from(cells.map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/gu, '""')}"`).join(';')).join('\r\n'), 'utf8');
        contentType = 'text/csv; charset=utf-8'; extension = 'csv';
      } else {
        const tax = format === 'IRPJ_DARF_DRAFT' ? 'IRPJ' : format === 'CSLL_DARF_DRAFT' ? 'CSLL' : null;
        if (format !== 'PDF' && tax === null) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Formato de exportação inválido.');
        bytes = renderCorporateTaxPdf({ ...view, canonicalJsonHash: canonicalHash }, tax); contentType = 'application/pdf'; extension = `${tax?.toLowerCase() ?? 'apuracao'}.pdf`;
      }
      const exportHash = sha(bytes);
      const artifactId = randomUUID(), storageKey = `${tenantId}/${companyId}/fiscal/corporate-tax-artifacts/${assessmentId}/${artifactId}.${extension}`;
      await this.storage.enviarComChave(storageKey, bytes, contentType);
      try {
      await client.query(`insert into app.corporate_tax_artifact(id,tenant_id,empresa_id,assessment_id,format,storage_key,artifact_sha256,canonical_sha256,created_by,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [artifactId,tenantId,companyId,assessmentId,format,storageKey,exportHash,canonicalHash,userId]);
      await client.query(`insert into app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'EXPORTED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, assessmentId, userId, correlationId,
        JSON.stringify({ artifactId, format, contentSha256: exportHash, canonicalJsonHash: canonicalHash })]);
      } catch (error) { await this.storage.remover(storageKey).catch(() => undefined); throw error; }
      return { bytes, contentType, filename: `apuracao-corporativa-${String(snapshot['quarter'])}-${assessmentId}-${extension}`,
        hash: exportHash, canonicalJsonHash: canonicalHash, artifactId };
    });
  }
}

const pdfEscape = (value: string) => value.replace(/[^\x20-\xff]/gu, '?').replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)');
const renderCorporateTaxPdf = (snapshot: Row, contribution: 'IRPJ' | 'CSLL' | null): Buffer => {
  const components = Array.isArray(snapshot['components']) ? snapshot['components'].map(record) : [];
  const installments = Array.isArray(snapshot['installments']) ? snapshot['installments'].map(record) : [];
  const filtered = contribution ? installments.filter((item) => item['tax'] === contribution) : installments;
  const lines = [
    contribution ? `RASCUNHO LOCAL ${contribution} - NAO OFICIAL - NAO PAGAVEL` : 'ContaIA - Apuracao trimestral IRPJ e CSLL',
    `Empresa ${String(snapshot['companyId'])} | Trimestre ${String(snapshot['quarter'])} | Estado ${String(snapshot['status'])}`,
    `Pacote ${String(snapshot['rulePackageVersion'])} | Revisao UTC ${String(snapshot['revisionCreatedAtUtc'])}`,
    `IRPJ preliminar ${String(snapshot['irpjPayableCents'] ?? 'indeterminado')} centavos | CSLL preliminar ${String(snapshot['csllPayableCents'] ?? 'indeterminado')}`,
    `Hash SHA-256 ${String(snapshot['canonicalJsonHash'] ?? 'consultar arquivo JSON canonico')}`,
    'Documento interno. Sem codigo de barras, linha digitavel, autenticacao ou efeito de pagamento.', '', 'Componentes:',
    ...components.map((item) => { const trace = record(item['calculationTrace']); return `${String(item['tax'])} | ${String(item['activityCode'])}/${String(item['revenueNatureCode'])} | receita ${String(item['grossRevenueCents'])} | ajuste ${String(item['adjustmentCents'])} | base ${String(item['presumedBaseCents'])} + adicao ${String(item['directAdditionCents'])} | aliquota ${String(item['presumptionRateScaled'])}/${String(item['taxRateScaled'])} | imposto ${String(item['grossTaxCents'])} | regra ${String(item['ruleId'])} | ${String(trace['formula'])} | fontes ${Array.isArray(item['sourceIds']) ? item['sourceIds'].join('|') : ''}`; }),
    '', 'Deducoes comprovadas:', ...(Array.isArray(snapshot['deductions']) ? snapshot['deductions'].map(record).map((item) => `${String(item['tax'])} ${String(item['kind'])} | ${String(item['amountCents'])} centavos | regra ${String(item['ruleId'])} | evidencias ${String(item['evidenceId'])} ${Array.isArray(item['sourceIds']) ? item['sourceIds'].join('|') : ''}`) : []),
    '', 'Quotas locais:', ...filtered.map((item) => `${String(item['tax'])} #${String(item['installmentNumber'])} | principal ${String(item['principalCents'])} | acrescimo ${String(item['additionCents'])} | total ${String(item['totalCents'])} | vence ${String(item['dueDate'])}`),
  ];
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  for (const page of pages) {
    const stream = `BT\n/F1 9 Tf\n48 790 Td\n14 TL\n${page.map((line, index) => `${index ? 'T*\n' : ''}(${pdfEscape(line)}) Tj`).join('\n')}\nET`;
    const pageId = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'latin1');
};
