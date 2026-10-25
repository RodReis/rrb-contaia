import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { comContextoHumano } from '@contaia/db';
import {
  CODIGOS_DE_ERRO, ErroDeDominio, calculateMonthlyOwnIcmsAssessment, calculateMonthlySimpleAssessment,
  type IcmsOwnAdjustment, type MonthlyAssessment, type MonthlyTaxComponent, type SimpleRulePackage,
} from '@contaia/domain';
import {
  MonthlyDeclarationSchema, MonthlyRulePackageSchema, PrepareMonthlyAssessmentSchema,
  ReviewMonthlyAssessmentSchema, canonicalizarJson, type MonthlyRulePackageInput,
} from '@contaia/shared';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { renderMonthlyAssessmentPdf } from './monthly-assessment-pdf';

type Row = Record<string, unknown>;
type Upload = Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>;
type StoredPackage = Readonly<{ id: string; kind: string; version: string; valid_from: string; valid_through: string | null;
  source_url: string; source_storage_key: string; source_sha256: string; content_sha256: string; canonical_json: unknown; status: string }>;
type StoredAssessment = Readonly<{ id: string; competence: string; kind: string; revision: number; status: string; content_sha256: string; canonical_json: unknown }>;

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): Row => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {};
const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const persistedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const roleAllowed = (roles: readonly string[]) => roles.includes('contador') || roles.includes('admin_escritorio');
const competenceDate = (competence: string) => `${competence}-01`;
const valueCents = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const monthOffset = (competence: string, offset: number): string => {
  const [year, month] = competence.split('-').map(Number);
  const total = year! * 12 + month! - 1 + offset;
  return `${Math.floor(total / 12).toString().padStart(4, '0')}-${(total % 12 + 1).toString().padStart(2, '0')}`;
};

const simpleDeclaration = (value: unknown) => {
  if (!isRecord(value)) return null;
  const months = value['rbt12ByMonth'];
  const revenue = value['revenue'];
  if (!Array.isArray(months) || !Array.isArray(revenue)) return null;
  const parsedMonths = months.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry['month'] !== 'string' || typeof entry['cents'] !== 'number') return [];
    return [{ month: entry['month'], cents: entry['cents'] }];
  });
  const parsedRevenue = revenue.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry['code'] !== 'string' || typeof entry['cents'] !== 'number' || !Array.isArray(entry['sourceIds']) ||
        !entry['sourceIds'].every((item) => typeof item === 'string')) return [];
    return [{ code: entry['code'], cents: entry['cents'], sourceIds: entry['sourceIds'] as string[] }];
  });
  if (parsedMonths.length !== months.length || parsedRevenue.length !== revenue.length) return null;
  return { rbt12ByMonth: parsedMonths, revenue: parsedRevenue, optionValid: value['optionValid'] === true,
    revenueReconciled: value['revenueReconciled'] === true, activityVerified: value['activityVerified'] === true,
    historyComplete: value['historyComplete'] === true };
};

const icmsDeclaration = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value['adjustments'])) return null;
  const adjustments: IcmsOwnAdjustment[] = value['adjustments'].flatMap((entry) => {
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || typeof entry['cents'] !== 'number' ||
        (entry['effect'] !== 'INCREASE_DUE' && entry['effect'] !== 'REDUCE_DUE')) return [];
    return [{ id: entry['id'], cents: entry['cents'], effect: entry['effect'] }];
  });
  if (adjustments.length !== value['adjustments'].length) return null;
  return { adjustments, priorCreditCents: valueCents(value['priorCreditCents']), priorCreditProven: value['priorCreditProven'] === true,
    priorCreditAssessmentId: typeof value['priorCreditAssessmentId'] === 'string' ? value['priorCreditAssessmentId'] : null,
    allOperationsCovered: value['allOperationsCovered'] === true, activityVerified: value['activityVerified'] === true,
    returnCancellationReconciled: value['returnCancellationReconciled'] === true,
    excludedOperationsHandled: value['excludedOperationsHandled'] === true };
};

@Injectable()
export class MonthlyAssessmentsService {
  private readonly logger = new Logger(MonthlyAssessmentsService.name);
  constructor(private readonly pool: PoolDoBanco, private readonly storage: StorageService) {}

  private async company(client: PoolClient, tenantId: string, companyId: string) {
    const result = await client.query<Row>(`select c.id,c.cnpj,c.status,c.situacao,c.regime_tributario,c.inscricao_estadual_situacao,c.inscricao_estadual_numero,
      exists(select 1 from app.empresa_endereco a where a.tenant_id=c.tenant_id and a.empresa_id=c.id and a.situacao='ativo' and a.principal and a.uf='GO') address_go
      from app.empresa c where c.id=$1 and c.tenant_id=$2 and app.empresa_autorizada(c.id)`, [companyId, tenantId]);
    return result.rows[0];
  }

  async listRulePackages(tenantId: string, userId: string, companyId: string, correlationId: string, kind?: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<Row>(`select p.id,p.kind,p.version,p.valid_from::text,p.valid_through::text,p.consulted_at::text,
        p.official_basis,p.source_url,p.source_sha256,p.content_sha256,p.canonical_json,p.created_at,
        (select e.action from app.tax_monthly_rule_package_event e where e.package_id=p.id and e.action<>'FAILED' order by e.occurred_at desc,e.id desc limit 1) status
        from app.tax_monthly_rule_package p where p.tenant_id=$1 and p.empresa_id=$2 and ($3::text is null or p.kind=$3)
        and app.empresa_autorizada(p.empresa_id) order by p.created_at desc,p.id`, [tenantId, companyId, kind ?? null]);
      return { items: result.rows.map((row) => ({ ...row, id: String(row['id']), status: String(row['status'] ?? 'IMPORTED') })) };
    });
  }

  async importRulePackage(tenantId: string, userId: string, companyId: string, roles: readonly string[], input: unknown,
    file: Upload | undefined, correlationId: string) {
    if (!roleAllowed(roles)) throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente contador ou admin_escritorio pode importar pacote.');
    if (!file || file.buffer.length === 0 || file.buffer.length > 20 * 1024 * 1024) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Anexe fonte oficial com até 20 MB.');
    const content = MonthlyRulePackageSchema.parse(input);
    if (content.validThrough !== null && content.validThrough < content.validFrom) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Vigência do pacote inválida.');
    const sourceSha = sha(file.buffer);
    const packageHash = sha(canonicalizarJson({ content, sourceSha }));
    const storageKey = `${tenantId}/${companyId}/fiscal/monthly-rule-packages/${randomUUID()}/${sourceSha}`;
    await this.storage.enviarComChave(storageKey, file.buffer, file.mimetype || 'application/octet-stream');
    try {
      return await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        const id = randomUUID();
        await client.query(`insert into app.tax_monthly_rule_package(id,tenant_id,empresa_id,kind,version,valid_from,valid_through,consulted_at,
          official_basis,source_url,source_storage_key,source_sha256,content_sha256,canonical_json,requested_by,created_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,now())`,
        [id, tenantId, companyId, content.kind, content.version, content.validFrom, content.validThrough, content.consultedAt,
          content.officialBasis, content.sourceUrl, storageKey, sourceSha, packageHash, canonicalizarJson(content), userId]);
        await client.query(`insert into app.tax_monthly_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'IMPORTED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, id, userId, correlationId, JSON.stringify({ sourceSha256: sourceSha, packageSha256: packageHash })]);
        return { id, kind: content.kind, version: content.version, sourceSha256: sourceSha, contentSha256: packageHash, status: 'IMPORTED' };
      });
    } catch (error) { await this.storage.remover(storageKey); throw error; }
  }

  async reviewRulePackage(tenantId: string, userId: string, companyId: string, packageId: string, roles: readonly string[], input: unknown, correlationId: string) {
    if (!roleAllowed(roles)) {
      const error = new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente contador ou admin_escritorio pode revisar pacote.');
      await this.auditDeniedRulePackage(tenantId, userId, companyId, packageId, correlationId, error);
      throw error;
    }
    if (!persistedUuid.test(packageId)) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Identificador de pacote inválido.');
    const parsed = ReviewMonthlyAssessmentSchema.pick({ action: true, reason: true }).safeParse(input);
    if (!parsed.success || (parsed.data.action !== 'APPROVED' && parsed.data.action !== 'REJECTED'))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Decisão de pacote inválida.');
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`f36/package/${tenantId}/${companyId}/${packageId}`]);
      const row = await this.loadPackage(client, tenantId, companyId, packageId);
      const current = await client.query<{ status: string | null }>(`select (select e.action from app.tax_monthly_rule_package_event e where e.package_id=p.id
        and e.action<>'FAILED' order by e.occurred_at desc,e.id desc limit 1) status from app.tax_monthly_rule_package p where p.id=$1 and p.tenant_id=$2 and p.empresa_id=$3`, [packageId, tenantId, companyId]);
      if (current.rows[0]?.status !== 'IMPORTED') throw new ErroDeDominio(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO, 'Pacote já revisado ou indisponível.');
      const source = await this.storage.obter(row.source_storage_key);
      if (sha(source.conteudo) !== row.source_sha256 || sha(canonicalizarJson({ content: MonthlyRulePackageSchema.parse(row.canonical_json), sourceSha: row.source_sha256 })) !== row.content_sha256)
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Hash da fonte ou pacote diverge.');
      await client.query(`insert into app.tax_monthly_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,$4,$5,now(),$6,$7::jsonb)`, [tenantId, companyId, packageId, parsed.data.action, userId, correlationId, JSON.stringify({ reason: parsed.data.reason })]);
      if (parsed.data.action === 'APPROVED') await client.query(`insert into app.tax_monthly_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        select a.tenant_id,a.empresa_id,a.id,'INVALIDATED',$4,now(),$5,jsonb_build_object('reason','RULE_PACKAGE_APPROVED','packageId',$3)
        from app.tax_monthly_assessment a where a.tenant_id=$1 and a.empresa_id=$2 and a.kind=$6 and a.status='APPROVED'
          and a.competence >= $7::date and ($8::date is null or a.competence <= $8::date)
          and not exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='INVALIDATED')`,
      [tenantId, companyId, packageId, userId, correlationId, row.kind, `${row.valid_from.slice(0, 7)}-01`, row.valid_through]);
      return { id: packageId, status: parsed.data.action };
    });
  }

  async declare(tenantId: string, userId: string, companyId: string, input: unknown, files: readonly Upload[], correlationId: string) {
    const parsed = MonthlyDeclarationSchema.parse(input);
    if (files.length !== parsed.evidence.length || files.some((file) => file.buffer.length === 0 || file.buffer.length > 20 * 1024 * 1024))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED, 'Cada evidência declarada precisa de arquivo válido de até 20 MB.');
    const acceptedTypes = new Set(['application/pdf', 'image/png', 'image/jpeg']);
    if (files.some((file) => !acceptedTypes.has(file.mimetype))) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Evidência deve ser PDF, PNG ou JPEG.');
    const evidence = files.map((file, index) => ({ id: randomUUID(), file, metadata: parsed.evidence[index]!, sha: sha(file.buffer) }));
    const requestIdempotency = sha(canonicalizarJson({ competence: parsed.competence, kind: parsed.kind, justification: parsed.justification,
      declaration: parsed.declaration, supersedesId: parsed.supersedesId ?? null,
      evidence: evidence.map((item) => ({ kind: item.metadata.kind, description: item.metadata.description, fileName: item.file.originalname.slice(0, 255), sha256: item.sha })) }));
    const savedKeys: string[] = [];
    try {
      for (const item of evidence) {
        const key = `${tenantId}/${companyId}/fiscal/monthly-assessment-evidence/${item.id}/${item.sha}`;
        await this.storage.enviarComChave(key, item.file.buffer, item.file.mimetype);
        savedKeys.push(key);
      }
      return await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`f36/declaration/${tenantId}/${companyId}/${parsed.competence}/${parsed.kind}`]);
        const duplicate = await client.query<{ id: string; revision: number; content_sha256: string; canonical_json: unknown }>(`select id,revision,content_sha256,canonical_json
          from app.tax_monthly_declaration where tenant_id=$1 and empresa_id=$2 and idempotency_sha256=$3`, [tenantId, companyId, requestIdempotency]);
        if (duplicate.rows[0]) {
          await Promise.all(savedKeys.map((key) => this.storage.remover(key)));
          savedKeys.length = 0;
          const canonicalData = object(duplicate.rows[0].canonical_json);
          return { id: duplicate.rows[0].id, revision: duplicate.rows[0].revision, competence: parsed.competence, kind: parsed.kind,
            hash: duplicate.rows[0].content_sha256, evidence: Array.isArray(canonicalData['evidence']) ? canonicalData['evidence'] : [] };
        }
        const latest = await client.query<{ id: string; revision: number }>(`select id,revision from app.tax_monthly_declaration where tenant_id=$1 and empresa_id=$2
          and competence=$3::date and kind=$4 order by revision desc limit 1`, [tenantId, companyId, competenceDate(parsed.competence), parsed.kind]);
        const previous = latest.rows[0];
        if ((previous && parsed.supersedesId !== previous.id) || (!previous && parsed.supersedesId))
          throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_REVISION_CONFLICT, 'Declaração mudou; recarregue e vincule a revisão mais recente.');
        const id = randomUUID();
        const evidenceSnapshot = evidence.map((item, index) => ({ id: item.id, kind: parsed.evidence[index]!.kind,
          description: parsed.evidence[index]!.description, fileName: item.file.originalname.slice(0, 255), sha256: item.sha }));
        const canonical = canonicalizarJson({ competence: parsed.competence, kind: parsed.kind, justification: parsed.justification, declaration: parsed.declaration,
          evidence: evidenceSnapshot, supersedesId: previous?.id ?? null, preparedBy: userId });
        const contentHash = sha(canonical);
        const idem = requestIdempotency;
        const revision = (previous?.revision ?? 0) + 1;
        await client.query(`insert into app.tax_monthly_declaration(id,tenant_id,empresa_id,competence,kind,revision,supersedes_id,idempotency_sha256,
          content_sha256,canonical_json,prepared_by,created_at,correlation_id) values($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10::jsonb,$11,now(),$12)`,
        [id, tenantId, companyId, competenceDate(parsed.competence), parsed.kind, revision, previous?.id ?? null, idem, contentHash, canonical, userId, correlationId]);
        for (const [index, item] of evidence.entries()) {
          await client.query(`insert into app.tax_monthly_evidence(id,tenant_id,empresa_id,declaration_id,kind,description,file_name,storage_key,content_sha256,requested_by,created_at)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [item.id, tenantId, companyId, id, parsed.evidence[index]!.kind,
            parsed.evidence[index]!.description, item.file.originalname.slice(0, 255), savedKeys[index], item.sha, userId]);
          await client.query(`insert into app.tax_monthly_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
            values($1,$2,$3,'EVIDENCE_ATTACHED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, id, userId, correlationId,
            JSON.stringify({ evidenceId: item.id, sha256: item.sha, kind: parsed.evidence[index]!.kind })]);
        }
        if (previous) await client.query(`insert into app.tax_monthly_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'SUPERSEDED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, previous.id, userId, correlationId, JSON.stringify({ supersededBy: id })]);
        await client.query(`insert into app.tax_monthly_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
          select a.tenant_id,a.empresa_id,a.id,'INVALIDATED',$4,now(),$5,jsonb_build_object('reason','DECLARATION_CHANGED','declarationId',$3)
          from app.tax_monthly_assessment a where a.tenant_id=$1 and a.empresa_id=$2 and a.competence=$6::date and a.kind=$7 and a.status='APPROVED'
            and not exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='INVALIDATED')`,
        [tenantId, companyId, id, userId, correlationId, competenceDate(parsed.competence), parsed.kind]);
        await client.query(`insert into app.tax_monthly_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'DECLARED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, id, userId, correlationId, JSON.stringify({ revision, evidenceCount: evidence.length, contentHash })]);
        return { id, revision, competence: parsed.competence, kind: parsed.kind, hash: contentHash, evidence: evidenceSnapshot };
      });
    } catch (error) { await Promise.all(savedKeys.map((key) => this.storage.remover(key))); throw error; }
  }

  async prepare(tenantId: string, userId: string, companyId: string, input: unknown, correlationId: string) {
    const parsed = PrepareMonthlyAssessmentSchema.parse(input);
    const kind = parsed.kind;
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await this.company(client, tenantId, companyId);
      if (!company || company['status'] !== 'ATIVA' || company['situacao'] !== 'ativo') throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada ou inativa.');
      const expectedRegime = kind === 'SIMPLES_NACIONAL_DAS' ? 'SIMPLES_NACIONAL' : 'LUCRO_PRESUMIDO';
      const regimeMatches = company['regime_tributario'] === expectedRegime && company['address_go'] === true &&
        company['inscricao_estadual_situacao'] === 'POSSUI' && typeof company['inscricao_estadual_numero'] === 'string' && company['inscricao_estadual_numero'].trim() !== '';
      const rule = await this.loadPackage(client, tenantId, companyId, parsed.rulePackageId);
      if (rule.kind !== kind) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_REGIME_MISMATCH, 'Pacote não corresponde à trilha solicitada.');
      const ruleStatus = await this.packageStatus(client, rule.id, tenantId, companyId);
      const content = MonthlyRulePackageSchema.parse(rule.canonical_json);
      const source = await this.storage.obter(rule.source_storage_key);
      const validRule = sha(source.conteudo) === rule.source_sha256 &&
        sha(canonicalizarJson({ content, sourceSha: rule.source_sha256 })) === rule.content_sha256;
      const declarationResult = await client.query<Row>(`select id,revision,content_sha256,canonical_json from app.tax_monthly_declaration where tenant_id=$1 and empresa_id=$2
        and competence=$3::date and kind=$4 order by revision desc limit 1`, [tenantId, companyId, competenceDate(parsed.competence), kind]);
      const declarationRow = declarationResult.rows[0];
      const declaration = object(declarationRow?.['canonical_json']);
      const evidenceResult = declarationRow ? await client.query<{ id: string; content_sha256: string; storage_key: string }>(
        'select id,content_sha256,storage_key from app.tax_monthly_evidence where declaration_id=$1 and tenant_id=$2 and empresa_id=$3 order by id',
        [declarationRow['id'], tenantId, companyId]) : { rows: [] };
      const evidenceValid = evidenceResult.rows.length > 0 && (await Promise.all(evidenceResult.rows.map(async (item) => {
        const file = await this.storage.obter(item.storage_key);
        return sha(file.conteudo) === item.content_sha256;
      }))).every(Boolean);
      const documentWindowStart = `${monthOffset(parsed.competence, -12)}-01`;
      const cnpj = String(company['cnpj']).replace(/\D/gu, '');
      const documents = await this.loadDocuments(client, tenantId, companyId, cnpj, documentWindowStart, `${monthOffset(parsed.competence, 1)}-01`);
      const postSaleCoverage = await this.loadPostSaleCoverage(client, tenantId, companyId, cnpj, documentWindowStart, `${monthOffset(parsed.competence, 1)}-01`);
      const data = object(declaration['declaration']);
      let calculated: MonthlyAssessment;
      if (kind === 'SIMPLES_NACIONAL_DAS' && content.kind === 'SIMPLES_NACIONAL_DAS') {
        const inputData = simpleDeclaration(data);
        const documentGaps = this.reconcileSimpleRevenue(inputData, documents, parsed.competence);
        const mappedContent: SimpleRulePackage = { version: content.version, approved: ruleStatus === 'APPROVED' && validRule,
          validFrom: content.validFrom, validThrough: content.validThrough, sourceIds: [content.sourceUrl, rule.source_sha256],
          brackets: content.brackets, segregations: content.segregations, rounding: content.rounding };
        calculated = inputData ? calculateMonthlySimpleAssessment({ competence: parsed.competence, package: mappedContent,
          rbt12ByMonth: inputData.rbt12ByMonth, revenue: inputData.revenue, revenueReconciled: inputData.revenueReconciled && inputData.historyComplete,
          activityVerified: inputData.activityVerified,
          optionValid: inputData.optionValid && inputData.activityVerified }) : this.indeterminate('SIMPLES_NACIONAL_DAS', parsed.competence,
          ['MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED'], rule.version);
        if (documentGaps.length > 0 || postSaleCoverage.unresolved || postSaleCoverage.incompleteDocuments || !evidenceValid || !regimeMatches) calculated = this.indeterminate(kind, parsed.competence,
          [...calculated.gapCodes, ...documentGaps, ...(!evidenceValid ? ['MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED'] : []),
            ...(postSaleCoverage.unresolved ? ['MONTHLY_ASSESSMENT_POST_SALE_EVENT_UNRESOLVED'] : []),
            ...(postSaleCoverage.incompleteDocuments ? ['MONTHLY_ASSESSMENT_DOCUMENT_GAP'] : []),
            ...(!regimeMatches ? ['MONTHLY_ASSESSMENT_REGIME_MISMATCH'] : [])], rule.version, calculated.components);
      } else if (kind === 'LUCRO_PRESUMIDO_ICMS_DARE' && content.kind === 'LUCRO_PRESUMIDO_ICMS_DARE') {
        const inputData = icmsDeclaration(data);
        const priorCreditVerified = inputData ? await this.verifyPriorCredit(client, tenantId, companyId, parsed.competence,
          inputData.priorCreditAssessmentId, inputData.priorCreditCents) : false;
        const mapped = this.mapIcmsDocuments(documents, parsed.competence, content.operations, inputData?.excludedOperationsHandled === true);
        if (postSaleCoverage.unresolved) mapped.gaps.push('MONTHLY_ASSESSMENT_POST_SALE_EVENT_UNRESOLVED');
        if (postSaleCoverage.incompleteDocuments) mapped.gaps.push('MONTHLY_ASSESSMENT_DOCUMENT_GAP');
        const unsupportedAdjustment = inputData?.adjustments.some((adjustment) =>
          !content.allowedAdjustments.some((rule) => rule.id === adjustment.id && rule.effect === adjustment.effect)) ?? false;
        if (unsupportedAdjustment) mapped.gaps.push('MONTHLY_ASSESSMENT_RULE_COVERAGE_INCOMPLETE');
        const mappedPackage = { version: content.version, approved: ruleStatus === 'APPROVED' && validRule, validFrom: content.validFrom,
          validThrough: content.validThrough, sourceIds: [content.sourceUrl, rule.source_sha256], allowedOperations: content.operations.map((operation) => operation.id), rounding: content.rounding } as const;
        calculated = inputData ? calculateMonthlyOwnIcmsAssessment({ competence: parsed.competence, package: mappedPackage,
          debits: mapped.debits, credits: mapped.credits, estornos: [], adjustments: inputData.adjustments,
          priorCreditCents: inputData.priorCreditCents, priorCreditProven: inputData.priorCreditProven && priorCreditVerified,
          allOperationsCovered: inputData.allOperationsCovered && inputData.returnCancellationReconciled && mapped.gaps.length === 0 }) :
          this.indeterminate(kind, parsed.competence, ['MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED'], rule.version);
        if (mapped.gaps.length > 0 || !inputData?.activityVerified || !evidenceValid || !regimeMatches || !priorCreditVerified)
          calculated = this.indeterminate(kind, parsed.competence, [...calculated.gapCodes, ...mapped.gaps,
            ...(!inputData?.activityVerified ? ['MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED'] : []), ...(!evidenceValid ? ['MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED'] : []),
            ...(!priorCreditVerified ? ['MONTHLY_ASSESSMENT_PRIOR_CREDIT_UNPROVEN'] : []),
            ...(!regimeMatches ? ['MONTHLY_ASSESSMENT_REGIME_MISMATCH'] : [])], rule.version, calculated.components);
      } else calculated = this.indeterminate(kind, parsed.competence, ['MONTHLY_ASSESSMENT_RULE_CONFLICT'], rule.version);

      const documentIds = [...new Set(documents.map((item) => `${item.id}:${item.hash}`))].sort();
      const declarationHash = String(declarationRow?.['content_sha256'] ?? 'missing');
      const idempotencyHash = sha(canonicalizarJson({ tenantId, companyId, competence: parsed.competence, kind, rulePackageHash: rule.content_sha256,
        declarationHash, documentIds, postSaleCoverage: postSaleCoverage.fingerprint,
        companyFacts: { status: company['status'], situation: company['situacao'], regime: company['regime_tributario'],
          stateRegistration: company['inscricao_estadual_situacao'], stateRegistrationNumber: company['inscricao_estadual_numero'],
          addressGo: company['address_go'] }, contractVersion: 'SPEC-036-v1' }));
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`f36/assessment/${tenantId}/${companyId}/${idempotencyHash}`]);
      const prior = await client.query<StoredAssessment>(`select a.id,a.competence::text,a.kind,a.revision,
        case when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='SUPERSEDED') then 'SUPERSEDED'
          when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='INVALIDATED') then 'POSSIBLY_OUTDATED' else a.status end status,
        a.content_sha256,a.canonical_json from app.tax_monthly_assessment a where a.tenant_id=$1 and a.empresa_id=$2 and a.idempotency_sha256=$3`,
        [tenantId, companyId, idempotencyHash]);
      if (prior.rows[0]) {
        let current = prior.rows[0];
        const visited = new Set<string>();
        while (!visited.has(current.id)) {
          visited.add(current.id);
          const next = await client.query<StoredAssessment>(`select child.id,child.competence::text,child.kind,child.revision,child.status,child.content_sha256,child.canonical_json
            from app.tax_monthly_assessment_event e join app.tax_monthly_assessment child on child.id=(e.details->>'supersededBy')::uuid
              and child.tenant_id=e.tenant_id and child.empresa_id=e.empresa_id
            where e.assessment_id=$1 and e.tenant_id=$2 and e.empresa_id=$3 and e.action='SUPERSEDED' order by child.revision desc limit 1`,
          [current.id, tenantId, companyId]);
          if (!next.rows[0]) break;
          current = next.rows[0];
        }
        if (current.status === 'APPROVED') {
          const integrity = await client.query<{ invalid: boolean; superseded: boolean }>(`select
            exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=$1 and e.action='INVALIDATED') invalid,
            exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=$1 and e.action='SUPERSEDED') superseded`, [current.id]);
          if (integrity.rows[0]?.invalid || integrity.rows[0]?.superseded) {
            // A revisão aprovada nunca é reativada: entradas mudaram e exigem novo preparo e revisão humana.
            current = { ...current, status: 'POSSIBLY_OUTDATED' };
          }
        }
        await this.assessmentEvent(client, tenantId, companyId, current.id, 'REPRODUCED', userId, correlationId, { hash: current.content_sha256 });
        return this.assessmentDto(current);
      }
      const latest = await client.query<{ revision: number }>('select coalesce(max(revision),0)+1 revision from app.tax_monthly_assessment where tenant_id=$1 and empresa_id=$2 and competence=$3::date and kind=$4',
        [tenantId, companyId, competenceDate(parsed.competence), kind]);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const snapshot = { assessmentId: id, tenantId, companyId, competence: parsed.competence, kind, status: calculated.status,
        rulePackageVersion: rule.version, components: calculated.components, totalCents: calculated.totalCents, gapCodes: calculated.gapCodes,
        preparedBy: userId, approvedBy: null, approvedAtUtc: null, contractVersion: 'SPEC-036-v1', revisionCreatedAtUtc: createdAt,
      };
      const canonical = canonicalizarJson(snapshot);
      const hash = sha(canonical);
      const revision = latest.rows[0]?.revision ?? 1;
      await client.query(`insert into app.tax_monthly_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
        select a.tenant_id,a.empresa_id,a.id,'INVALIDATED',$4,now(),$5,jsonb_build_object('reason','ASSESSMENT_INPUTS_CHANGED','replacementId',$8,'replacementHash',$6)
        from app.tax_monthly_assessment a where a.tenant_id=$1 and a.empresa_id=$2 and a.competence=$3::date and a.kind=$7 and a.status='APPROVED'
          and a.idempotency_sha256<>$6
          and not exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='INVALIDATED')`,
      [tenantId, companyId, competenceDate(parsed.competence), userId, correlationId, idempotencyHash, kind, id]);
      await client.query(`insert into app.tax_monthly_assessment(id,tenant_id,empresa_id,competence,kind,revision,rule_package_id,declaration_id,
        idempotency_sha256,content_sha256,status,canonical_json,prepared_by,revision_created_at,correlation_id)
        values($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
      [id, tenantId, companyId, competenceDate(parsed.competence), kind, revision, rule.id, declarationRow?.['id'] ?? null, idempotencyHash, hash,
        calculated.status, canonical, userId, createdAt, correlationId]);
      await this.assessmentEvent(client, tenantId, companyId, id, 'CREATED', userId, correlationId, { status: calculated.status, hash });
      return { ...snapshot, canonicalJsonHash: hash };
    });
  }

  private async loadPackage(client: PoolClient, tenantId: string, companyId: string, id: string): Promise<StoredPackage> {
    if (!persistedUuid.test(id)) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_RULE_MISSING, 'Pacote normativo não encontrado.');
    const result = await client.query<StoredPackage>(`select p.id,p.kind,p.version,p.valid_from::text,p.valid_through::text,p.source_url,p.source_storage_key,
      p.source_sha256,p.content_sha256,p.canonical_json,(select e.action from app.tax_monthly_rule_package_event e where e.package_id=p.id and e.action<>'FAILED'
        order by e.occurred_at desc,e.id desc limit 1) status from app.tax_monthly_rule_package p
      where p.id=$1 and p.tenant_id=$2 and p.empresa_id=$3 and app.empresa_autorizada(p.empresa_id)`, [id, tenantId, companyId]);
    const row = result.rows[0];
    if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_RULE_MISSING, 'Pacote normativo não encontrado.');
    return row;
  }

  private packageStatus(client: PoolClient, id: string, tenantId: string, companyId: string) {
    return client.query<{ action: string }>(`select action from app.tax_monthly_rule_package_event where package_id=$1 and tenant_id=$2 and empresa_id=$3
      and action<>'FAILED' order by occurred_at desc,id desc limit 1`, [id, tenantId, companyId]).then((result) => result.rows[0]?.action ?? 'IMPORTED');
  }

  private async loadDocuments(client: PoolClient, tenantId: string, companyId: string, cnpj: string, from: string, to: string) {
    const result = await client.query<Row>(`select d.id,d.especie,d.hash_sha256,d.chave_acesso,to_char(d.emitido_em,'YYYY-MM') competence,
      round(d.total*100)::bigint::text total_cents,i.numero,i.cfop,i.cst_csosn,
      round(t.base_calculo*100)::bigint::text icms_base_cents,round(t.valor*100)::bigint::text icms_value_cents,t.situacao tax_situation,
      (exists(select 1 from app.fiscal_document_party party where party.document_id=d.id and party.tenant_id=d.tenant_id and party.empresa_id=d.empresa_id
        and party.papel='EMITENTE' and party.identificador=$5) or exists(select 1 from app.fiscal_document_party party where party.document_id=d.id and party.tenant_id=d.tenant_id and party.empresa_id=d.empresa_id
        and party.papel='DESTINATARIO' and party.identificador=$5)) is_company_party,
      exists(select 1 from app.fiscal_document_party party where party.document_id=d.id and party.tenant_id=d.tenant_id and party.empresa_id=d.empresa_id
        and party.papel='EMITENTE' and party.identificador=$5) is_sales
      from app.fiscal_document d join app.fiscal_document_item i on i.document_id=d.id and i.parser_version=d.parser_version and i.tipo='ITEM'
      left join app.fiscal_document_tax t on t.document_id=i.document_id and t.parser_version=i.parser_version and t.escopo='ITEM'
        and t.numero_item=i.numero and t.codigo='ICMS'
      where d.tenant_id=$1 and d.empresa_id=$2 and d.estado='PROCESSADO' and d.protocolo is not null and d.especie in ('NFE_55','NFCE_65')
        and d.emitido_em >= $3::date and d.emitido_em < $4::date and app.empresa_autorizada(d.empresa_id)
      order by d.emitido_em,d.id,i.numero`, [tenantId, companyId, from, to, cnpj]);
    return result.rows.map((row) => ({ id: String(row['id']), hash: String(row['hash_sha256']), competence: String(row['competence']),
      species: String(row['especie']), key: row['chave_acesso'] === null ? null : String(row['chave_acesso']),
      documentTotalCents: valueCents(row['total_cents']), itemNumber: Number(row['numero']), cfop: row['cfop'] === null ? null : String(row['cfop']),
      isSales: row['is_sales'] === true, isCompanyParty: row['is_company_party'] === true,
      cst: row['cst_csosn'] === null ? (row['tax_situation'] === null ? null : String(row['tax_situation'])) : String(row['cst_csosn']),
      icmsBaseCents: valueCents(row['icms_base_cents']), icmsValueCents: valueCents(row['icms_value_cents']) }));
  }

  private async loadPostSaleCoverage(client: PoolClient, tenantId: string, companyId: string, cnpj: string, from: string, to: string) {
    const result = await client.query<{ cancelled: number; events: number; reference_count: number; incomplete: number; fingerprint: string | null }>(`select
      (select count(distinct d.id)::int from app.fiscal_document d where d.tenant_id=$1 and d.empresa_id=$2 and d.estado='CANCELLED'
        and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
        and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))) cancelled,
      (select count(distinct d.id)::int from app.fiscal_document d join app.fiscal_document_event e on e.document_id=d.id and e.tenant_id=d.tenant_id and e.empresa_id=d.empresa_id
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
          and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))
          and (lower(e.tipo) like '%cancel%' or lower(e.tipo) like '%devol%' or e.codigo='110111')) events,
      (select count(distinct d.id)::int from app.fiscal_document d join app.fiscal_document_reference r on r.document_id=d.id and r.tenant_id=d.tenant_id and r.empresa_id=d.empresa_id
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
          and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))) reference_count,
      (select count(distinct d.id)::int from app.fiscal_document d where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65')
        and d.emitido_em >= $3::date and d.emitido_em < $4::date and (d.estado<>'PROCESSADO' or d.protocolo is null)
        and (exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))
          or regexp_replace(coalesce(d.emitente,''),'[^0-9]','','g')=regexp_replace($5,'[^0-9]','','g') or regexp_replace(coalesce(d.destinatario,''),'[^0-9]','','g')=regexp_replace($5,'[^0-9]','','g'))) incomplete,
      coalesce((select string_agg(d.id::text||':'||e.id::text||':'||coalesce(e.hash_sha256,''),',' order by d.id,e.id)
        from app.fiscal_document d join app.fiscal_document_event e on e.document_id=d.id and e.tenant_id=d.tenant_id and e.empresa_id=d.empresa_id
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
          and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))), '') || ':' ||
      coalesce((select string_agg(d.id::text||':'||d.hash_sha256,',' order by d.id) from app.fiscal_document d
        where d.tenant_id=$1 and d.empresa_id=$2 and d.estado='CANCELLED' and d.especie in ('NFE_55','NFCE_65')
          and d.emitido_em >= $3::date and d.emitido_em < $4::date and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id
            and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))), '') || ':' ||
      coalesce((select string_agg(d.id::text||':'||d.hash_sha256||':'||d.estado||':'||coalesce(d.protocolo,''),',' order by d.id) from app.fiscal_document d
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
          and (d.estado<>'PROCESSADO' or d.protocolo is null) and (exists(select 1 from app.fiscal_document_party p where p.document_id=d.id
            and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))
            or regexp_replace(coalesce(d.emitente,''),'[^0-9]','','g')=regexp_replace($5,'[^0-9]','','g') or regexp_replace(coalesce(d.destinatario,''),'[^0-9]','','g')=regexp_replace($5,'[^0-9]','','g'))), '') || ':' ||
      coalesce((select string_agg(d.id::text||':'||r.tipo||':'||r.chave,',' order by d.id,r.tipo,r.chave)
        from app.fiscal_document d join app.fiscal_document_reference r on r.document_id=d.id and r.tenant_id=d.tenant_id and r.empresa_id=d.empresa_id
        where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.emitido_em >= $3::date and d.emitido_em < $4::date
          and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.tenant_id=d.tenant_id and p.empresa_id=d.empresa_id and p.identificador=regexp_replace($5,'[^0-9]','','g'))), '') fingerprint`,
    [tenantId, companyId, from, to, cnpj]);
    const row = result.rows[0];
    const cancelled = Number(row?.cancelled ?? 0); const events = Number(row?.events ?? 0); const referenceCount = Number(row?.reference_count ?? 0);
    const incomplete = Number(row?.incomplete ?? 0);
    return { unresolved: cancelled > 0 || events > 0 || referenceCount > 0, incompleteDocuments: incomplete > 0,
      fingerprint: sha(`${cancelled}:${events}:${referenceCount}:${incomplete}:${row?.fingerprint ?? ''}`) };
  }

  private async verifyPriorCredit(client: PoolClient, tenantId: string, companyId: string, competence: string,
    assessmentId: string | null, declaredCents: number | null): Promise<boolean> {
    if (declaredCents === 0 && assessmentId === null) return true;
    if (!assessmentId || !persistedUuid.test(assessmentId) || declaredCents === null) return false;
    const result = await client.query<StoredAssessment>(`select a.id,a.competence::text,a.kind,a.revision,a.status,a.content_sha256,a.canonical_json
      from app.tax_monthly_assessment a where a.id=$1 and a.tenant_id=$2 and a.empresa_id=$3 and a.kind='LUCRO_PRESUMIDO_ICMS_DARE'
        and a.status='APPROVED' and a.competence<$4::date and app.empresa_autorizada(a.empresa_id)
        and not exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action in ('INVALIDATED','SUPERSEDED'))`,
    [assessmentId, tenantId, companyId, competenceDate(competence)]);
    const row = result.rows[0];
    if (!row || sha(canonicalizarJson(row.canonical_json)) !== row.content_sha256) return false;
    const components = object(row.canonical_json)['components'];
    if (!Array.isArray(components)) return false;
    const carry = components.find((item) => isRecord(item) && item['code'] === 'ICMS_SALDO_CREDOR_TRANSPORTAVEL');
    return isRecord(carry) && carry['amountCents'] === declaredCents;
  }

  private reconcileSimpleRevenue(input: ReturnType<typeof simpleDeclaration>, documents: Awaited<ReturnType<MonthlyAssessmentsService['loadDocuments']>>, competence: string) {
    const gaps: string[] = [];
    if (!input) return ['MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED'];
    const lastTwelve = Array.from({ length: 12 }, (_, index) => monthOffset(competence, index - 12));
    const amountsByMonth = new Map<string, bigint>(lastTwelve.map((month) => [month, 0n]));
    const byDocument = new Map<string, { month: string; total: number | null }>();
    for (const item of documents.filter((document) => document.isSales)) {
      const key = `${item.id}:${item.hash}`;
      if (!byDocument.has(key)) byDocument.set(key, { month: item.competence, total: item.documentTotalCents });
    }
    for (const [key, document] of byDocument) {
      if (!amountsByMonth.has(document.month)) continue;
      if (document.total === null) { gaps.push('MONTHLY_ASSESSMENT_DOCUMENT_GAP'); continue; }
      const current = amountsByMonth.get(document.month) ?? 0n;
      amountsByMonth.set(document.month, current + BigInt(document.total));
      if (!input.revenue.some((segment) => segment.sourceIds.includes(key) || segment.sourceIds.includes(key.split(':')[0]!)))
        gaps.push('MONTHLY_ASSESSMENT_REVENUE_RECONCILIATION_FAILED');
    }
    for (const month of lastTwelve) {
      const declared = input.rbt12ByMonth.find((item) => item.month === month);
      if (!declared || !Number.isSafeInteger(declared.cents) || declared.cents !== Number(amountsByMonth.get(month) ?? 0n))
        gaps.push('MONTHLY_ASSESSMENT_RBT12_INCOMPLETE');
    }
    const currentTotal = [...byDocument.values()].filter((item) => item.month === competence).reduce((sum, item) => sum + (item.total ?? 0), 0);
    if (currentTotal === 0 || input.revenue.reduce((sum, item) => sum + item.cents, 0) !== currentTotal)
      gaps.push('MONTHLY_ASSESSMENT_REVENUE_RECONCILIATION_FAILED');
    return [...new Set(gaps)];
  }

  private mapIcmsDocuments(documents: Awaited<ReturnType<MonthlyAssessmentsService['loadDocuments']>>, competence: string,
    rules: Extract<MonthlyRulePackageInput, { kind: 'LUCRO_PRESUMIDO_ICMS_DARE' }>['operations'], excludedHandled: boolean) {
    const debits: { id: string; cents: number }[] = [];
    const credits: { id: string; cents: number }[] = [];
    const gaps: string[] = [];
    const seen = new Set<string>();
    for (const item of documents.filter((row) => row.competence === competence && row.isCompanyParty)) {
      const identity = `${item.id}:${item.itemNumber}`;
      if (seen.has(identity)) { gaps.push('MONTHLY_ASSESSMENT_DUPLICATE_DOCUMENT'); continue; }
      seen.add(identity);
      if (!item.cfop || !item.cst) { gaps.push('MONTHLY_ASSESSMENT_DOCUMENT_GAP'); continue; }
      const matched = rules.filter((rule) => rule.cfops.includes(item.cfop!) && rule.cstCsosn.includes(item.cst!));
      if (matched.length !== 1) { gaps.push(matched.length ? 'MONTHLY_ASSESSMENT_RULE_CONFLICT' : 'MONTHLY_ASSESSMENT_RULE_COVERAGE_INCOMPLETE'); continue; }
      const rule = matched[0]!;
      if (rule.effect === 'EXCLUDED') { if (!excludedHandled) gaps.push('MONTHLY_ASSESSMENT_OPERATION_UNCOVERED'); continue; }
      let amount: number | null = item.icmsValueCents;
      if (rule.amountSource === 'BASE_RATE') {
        if (item.icmsBaseCents === null || rule.rateBasisPoints === null) amount = null;
        else {
          const calculated = (BigInt(item.icmsBaseCents) * BigInt(rule.rateBasisPoints) + 5_000n) / 10_000n;
          amount = calculated <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(calculated) : null;
        }
      }
      if (amount === null || !Number.isSafeInteger(amount)) { gaps.push('MONTHLY_ASSESSMENT_DOCUMENT_GAP'); continue; }
      const row = { id: `${identity}:${rule.id}:${item.hash}`, cents: amount };
      if (rule.effect === 'DEBIT') debits.push(row); else credits.push(row);
    }
    return { debits, credits, gaps: [...new Set(gaps)] };
  }

  private indeterminate(kind: MonthlyAssessment['kind'], competence: string, gapCodes: readonly string[], version: string,
    components: readonly MonthlyTaxComponent[] = []): MonthlyAssessment {
    return { kind, status: 'INDETERMINATE', competence, rulePackageVersion: version, components, totalCents: null, gapCodes: [...new Set(gapCodes)].sort() };
  }

  private async assessmentEvent(client: PoolClient, tenantId: string, companyId: string, assessmentId: string, action: string, userId: string,
    correlationId: string, details: Row) {
    await client.query(`insert into app.tax_monthly_assessment_event(tenant_id,empresa_id,assessment_id,action,actor_id,occurred_at,correlation_id,details)
      values($1,$2,$3,$4,$5,now(),$6,$7::jsonb)`, [tenantId, companyId, assessmentId, action, userId, correlationId, JSON.stringify(details)]);
  }

  private assessmentDto(row: StoredAssessment) {
    return { ...object(row.canonical_json), assessmentId: row.id, canonicalJsonHash: row.content_sha256, status: row.status };
  }

  async list(tenantId: string, userId: string, companyId: string, correlationId: string, filters: Readonly<{ competence?: string; kind?: string; page: number; pageSize: number }>) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<StoredAssessment>(`select id,competence::text,kind,revision,
        case when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=tax_monthly_assessment.id and e.action='SUPERSEDED') then 'SUPERSEDED'
          when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=tax_monthly_assessment.id and e.action='INVALIDATED') then 'POSSIBLY_OUTDATED' else status end status,
        content_sha256,canonical_json from app.tax_monthly_assessment
        where tenant_id=$1 and empresa_id=$2 and ($3::date is null or competence=$3::date) and ($4::text is null or kind=$4)
        and app.empresa_autorizada(empresa_id) order by competence desc,kind,revision desc limit $5 offset $6`,
      [tenantId, companyId, filters.competence ? competenceDate(filters.competence) : null, filters.kind ?? null, filters.pageSize, (filters.page - 1) * filters.pageSize]);
      return { items: result.rows.map((row) => this.assessmentDto(row)) };
    });
  }

  async get(tenantId: string, userId: string, companyId: string, assessmentId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<StoredAssessment>(`select id,competence::text,kind,revision,
        case when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=tax_monthly_assessment.id and e.action='SUPERSEDED') then 'SUPERSEDED'
          when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=tax_monthly_assessment.id and e.action='INVALIDATED') then 'POSSIBLY_OUTDATED' else status end status,
        content_sha256,canonical_json from app.tax_monthly_assessment
        where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)`, [assessmentId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_INDETERMINATE, 'Avaliação mensal não encontrada.');
      if (sha(canonicalizarJson(row.canonical_json)) !== row.content_sha256) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_EXPORT_HASH_MISMATCH, 'Hash da revisão diverge.');
      return this.assessmentDto(row);
    });
  }

  async review(tenantId: string, userId: string, companyId: string, assessmentId: string, roles: readonly string[], input: unknown, correlationId: string) {
    if (!roleAllowed(roles)) {
      const error = new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente contador ou admin_escritorio pode revisar a apuração.');
      await this.auditDeniedAssessment(tenantId, userId, companyId, assessmentId, correlationId, error);
      throw error;
    }
    const parsed = ReviewMonthlyAssessmentSchema.parse(input);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`f36/review/${tenantId}/${companyId}/${assessmentId}`]);
      const result = await client.query<StoredAssessment & { prepared_by: string }>(`select a.id,a.competence::text,a.kind,a.revision,
        case when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='SUPERSEDED') then 'SUPERSEDED'
          when exists(select 1 from app.tax_monthly_assessment_event e where e.assessment_id=a.id and e.action='INVALIDATED') then 'POSSIBLY_OUTDATED' else a.status end status,
        a.content_sha256,a.canonical_json,a.prepared_by
        from app.tax_monthly_assessment a where a.id=$1 and a.tenant_id=$2 and a.empresa_id=$3 and app.empresa_autorizada(a.empresa_id)`, [assessmentId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_INDETERMINATE, 'Avaliação mensal não encontrada.');
      if (row.content_sha256 !== parsed.expectedHash || sha(canonicalizarJson(row.canonical_json)) !== row.content_sha256)
        throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_REVISION_CONFLICT, 'Revisão mudou ou hash não confere.');
      if (row.status !== 'READY_FOR_REVIEW') throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_INDETERMINATE, 'Somente revisão determinada pode receber decisão.');
      const status = parsed.action === 'APPROVED' ? 'APPROVED' : parsed.action === 'REJECTED' ? 'REJECTED' : 'INCOMPLETE';
      const priorJson = object(row.canonical_json);
      const newId = randomUUID();
      const snapshot = { ...priorJson, assessmentId: newId, status, approvedBy: parsed.action === 'APPROVED' ? userId : null,
        approvedAtUtc: parsed.action === 'APPROVED' ? new Date().toISOString() : null, revisionCreatedAtUtc: new Date().toISOString() };
      const canonical = canonicalizarJson(snapshot);
      const hash = sha(canonical);
      const latestRevision = await client.query<{ revision: number }>('select coalesce(max(revision),0)+1 revision from app.tax_monthly_assessment where tenant_id=$1 and empresa_id=$2 and competence=$3::date and kind=$4',
        [tenantId, companyId, competenceDate(row.competence.slice(0, 7)), row.kind]);
      const nextRevision = latestRevision.rows[0]?.revision ?? row.revision + 1;
      const idem = sha(canonicalizarJson({ parentHash: row.content_sha256, action: parsed.action, reason: parsed.reason, actor: userId }));
      await client.query(`insert into app.tax_monthly_assessment(id,tenant_id,empresa_id,competence,kind,revision,rule_package_id,declaration_id,
        idempotency_sha256,content_sha256,status,canonical_json,prepared_by,revision_created_at,correlation_id)
        select $1,tenant_id,empresa_id,competence,kind,$2,rule_package_id,declaration_id,$3,$4,$5,$6::jsonb,$7,$8,$9
        from app.tax_monthly_assessment where id=$10 and tenant_id=$11 and empresa_id=$12`,
      [newId, nextRevision, idem, hash, status, canonical, row.prepared_by, snapshot.revisionCreatedAtUtc, correlationId, row.id, tenantId, companyId]);
      const action = parsed.action === 'APPROVED' ? 'APPROVED' : parsed.action === 'REJECTED' ? 'REJECTED' : 'RETURNED_FOR_EVIDENCE';
      await this.assessmentEvent(client, tenantId, companyId, newId, action, userId, correlationId, { reason: parsed.reason, parentAssessmentId: row.id, hash });
      await this.assessmentEvent(client, tenantId, companyId, row.id, 'SUPERSEDED', userId, correlationId, { supersededBy: newId });
    return { ...snapshot, canonicalJsonHash: hash };
    });
  }

  private async auditDeniedAssessment(tenantId: string, userId: string, companyId: string, assessmentId: string, correlationId: string, error: unknown) {
    try {
      await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        const exists = await client.query<{ id: string }>('select id from app.tax_monthly_assessment where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)', [assessmentId, tenantId, companyId]);
        if (!exists.rows[0]) return;
        const code = error instanceof ErroDeDominio ? error.codigo : 'MONTHLY_ASSESSMENT_REVIEW_FAILED';
        await this.assessmentEvent(client, tenantId, companyId, assessmentId, 'FAILED', userId, correlationId, { code });
      });
    } catch { this.logger.error(`Falha ao auditar tentativa de revisão da apuração [${correlationId}]`); }
  }

  private async auditDeniedRulePackage(tenantId: string, userId: string, companyId: string, packageId: string, correlationId: string, error: unknown) {
    try {
      await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        const exists = await client.query<{ id: string }>('select id from app.tax_monthly_rule_package where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)', [packageId, tenantId, companyId]);
        if (!exists.rows[0]) return;
        const code = error instanceof ErroDeDominio ? error.codigo : 'MONTHLY_ASSESSMENT_REVIEW_FAILED';
        await client.query(`insert into app.tax_monthly_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
          values($1,$2,$3,'FAILED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, packageId, userId, correlationId, JSON.stringify({ code })]);
      });
    } catch { this.logger.error(`Falha ao auditar tentativa de revisão do pacote [${correlationId}]`); }
  }

  async export(tenantId: string, userId: string, companyId: string, assessmentId: string, format: 'PDF' | 'CSV' | 'JSON', correlationId: string) {
    const data: Row = await this.get(tenantId, userId, companyId, assessmentId, correlationId);
    if (data['status'] === 'INDETERMINATE' || data['status'] === 'INCOMPLETE' || data['status'] === 'DRAFT' || data['status'] === 'REJECTED' ||
        data['status'] === 'POSSIBLY_OUTDATED' || data['status'] === 'SUPERSEDED')
      throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_INDETERMINATE, 'Revisão indeterminada não pode ser exportada como guia.');
    const { canonicalJsonHash: declaredHash, ...payload } = data;
    const canonical = canonicalizarJson(payload);
    const hash = sha(canonical);
    if (hash !== declaredHash) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_EXPORT_HASH_MISMATCH, 'Hash canônico da revisão diverge.');
    let bytes: Buffer;
    let contentType: string;
    if (format === 'PDF') { bytes = renderMonthlyAssessmentPdf(data); contentType = 'application/pdf'; }
    else if (format === 'CSV') {
      const escape = (value: unknown) => `"${String(value ?? '').replace(/"/gu, '""')}"`;
      const rows = [['assessmentId', 'competence', 'kind', 'status', 'component', 'baseCents', 'rateScaled', 'amountCents', 'ruleId', 'sourceIds', 'totalCents', 'gapCodes', 'canonicalJsonHash'],
        ...(Array.isArray(data['components']) ? data['components'].map((raw) => { const item = object(raw); return [data['assessmentId'], data['competence'], data['kind'], data['status'], item['code'], item['baseCents'], item['rateScaled'], item['amountCents'], item['ruleId'], Array.isArray(item['sourceIds']) ? item['sourceIds'].join('|') : '', data['totalCents'], Array.isArray(data['gapCodes']) ? data['gapCodes'].join('|') : '', hash]; }) : [])];
      bytes = Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\r\n'), 'utf8'); contentType = 'text/csv; charset=utf-8';
    } else { bytes = Buffer.from(canonicalizarJson({ assessment: payload, canonicalJsonHash: hash }), 'utf8'); contentType = 'application/json'; }
    await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      await this.assessmentEvent(client, tenantId, companyId, assessmentId, 'EXPORTED', userId, correlationId, { format, hash });
      await this.assessmentEvent(client, tenantId, companyId, assessmentId, 'DOWNLOADED', userId, correlationId, { format, bytes: bytes.byteLength });
    });
    return { bytes, contentType, filename: `apuracao-fiscal-${String(data['competence'])}.${format.toLowerCase()}`, hash, canonicalJsonHash: declaredHash };
  }

  async downloadRuleSource(tenantId: string, userId: string, companyId: string, packageId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const row = await this.loadPackage(client, tenantId, companyId, packageId);
      const file = await this.storage.obter(row.source_storage_key);
      if (sha(file.conteudo) !== row.source_sha256) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_EXPORT_HASH_MISMATCH, 'Hash da fonte oficial diverge.');
      await client.query(`insert into app.tax_monthly_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'DOWNLOADED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, packageId, userId, correlationId,
        JSON.stringify({ sourceSha256: row.source_sha256 })]);
      return { bytes: file.conteudo, contentType: file.tipoConteudo ?? 'application/octet-stream', filename: 'fonte-normativa' };
    });
  }

  async downloadEvidence(tenantId: string, userId: string, companyId: string, declarationId: string, evidenceId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const result = await client.query<{ id: string; kind: string; file_name: string; storage_key: string; content_sha256: string }>(
        `select id,kind,file_name,storage_key,content_sha256 from app.tax_monthly_evidence where id=$1 and declaration_id=$2
          and tenant_id=$3 and empresa_id=$4 and app.empresa_autorizada(empresa_id)`, [evidenceId, declarationId, tenantId, companyId]);
      const row = result.rows[0];
      if (!row) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INDISPONIVEL, 'Evidência não encontrada.');
      const file = await this.storage.obter(row.storage_key);
      if (sha(file.conteudo) !== row.content_sha256) throw new ErroDeDominio(CODIGOS_DE_ERRO.MONTHLY_ASSESSMENT_EXPORT_HASH_MISMATCH, 'Hash da evidência diverge.');
      await client.query(`insert into app.tax_monthly_declaration_event(tenant_id,empresa_id,declaration_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'EVIDENCE_DOWNLOADED',$4,now(),$5,$6::jsonb)`, [tenantId, companyId, declarationId, userId, correlationId,
        JSON.stringify({ evidenceId, sha256: row.content_sha256 })]);
      return { bytes: file.conteudo, contentType: file.tipoConteudo ?? 'application/octet-stream', filename: row.file_name };
    });
  }
}
