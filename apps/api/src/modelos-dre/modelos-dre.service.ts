import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { comContextoHumano } from "@contaia/db";
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  hashEstruturaModeloDre,
  sanitizarEstruturaDre,
  validarEstruturaModeloDre,
} from "@contaia/domain";
import type { LinhaDre, LinhaModeloDre } from "@contaia/domain";
import type { PoolClient } from "pg";
import { PoolDoBanco } from "../banco/pool.provider";
import type { AplicarModelo, CriarModelo, CriarModeloOrigem, SalvarLinhasModelo } from "./modelos-dre.dto";

type Actor = Readonly<{ tenantId: string; usuarioId: string }>;
type Modelo = Readonly<{ id: string; name: string; description: string | null; status: "ACTIVE" | "ARCHIVED"; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string }>;
type Versao = Readonly<{ id: string; version: number; status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "DISCARDED"; revision: number; origin: "MANUAL" | "COMPANY_VERSION"; structuralHash: string | null; createdBy: string; createdAt: string; publishedBy: string | null; publishedAt: string | null }>;
type Componente = LinhaModeloDre["components"][number];

const erro = (codigo: string, mensagem: string, detalhes: Readonly<Record<string, unknown>> = {}) => new ErroDeDominio(codigo as never, mensagem, [], detalhes);
const json = (value: unknown): string => JSON.stringify(value);
const hash = (value: unknown): string => createHash("sha256").update(json(value)).digest("hex");
const ehColisaoDeIdempotencia = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const pg = cause as Readonly<{ code?: unknown; constraint?: unknown }>;
  return pg.code === "23505" && pg.constraint === "accounting_statement_template_app_tenant_id_idempotency_key_key";
};

@Injectable()
export class ModelosDreService {
  constructor(private readonly pool: PoolDoBanco) {}

  private contexto<T>(actor: Actor, run: (client: PoolClient) => Promise<T>): Promise<T> {
    return comContextoHumano(this.pool.instancia, actor, run);
  }

  private async lock(client: PoolClient, actor: Actor, key: string): Promise<void> {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.tenantId}:statement-template:${key}`]);
  }

  private async lockCompanyStatement(client: PoolClient, actor: Actor, companyId: string): Promise<void> {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.tenantId}:${companyId}:statement`]);
  }

  private async event(client: PoolClient, actor: Actor, templateId: string, versionId: string | null, action: string, correlationId: string, details: unknown = {}): Promise<void> {
    await client.query(
      `insert into app.accounting_statement_template_event(tenant_id,template_id,version_id,actor_id,action,result,details,correlation_id) values($1,$2,$3,$4,$5,'SUCESSO',$6::jsonb,$7)`,
      [actor.tenantId, templateId, versionId, actor.usuarioId, action, json(details), correlationId],
    );
  }

  private async model(client: PoolClient, actor: Actor, templateId: string, lock = false): Promise<Modelo> {
    const out = await client.query<Modelo>(
      `select id,name,description,status,created_by as "createdBy",updated_by as "updatedBy",created_at as "createdAt",updated_at as "updatedAt" from app.accounting_statement_template where tenant_id=$1 and id=$2 ${lock ? "for update" : ""}`,
      [actor.tenantId, templateId],
    );
    const value = out.rows[0];
    if (!value) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_NOT_FOUND, "Modelo de DRE não encontrado.");
    return value;
  }

  private async version(client: PoolClient, actor: Actor, templateId: string, version: number, lock = false): Promise<Versao> {
    const out = await client.query<Versao>(
      `select id,version,status,revision,origin,structural_hash as "structuralHash",created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt" from app.accounting_statement_template_version where tenant_id=$1 and template_id=$2 and version=$3 ${lock ? "for update" : ""}`,
      [actor.tenantId, templateId, version],
    );
    const value = out.rows[0];
    if (!value) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_NOT_FOUND, "Versão do modelo não encontrada.");
    return value;
  }

  private async lines(client: PoolClient, actor: Actor, templateId: string, versionId: string): Promise<LinhaModeloDre[]> {
    const [lines, components] = await Promise.all([
      client.query<Omit<LinhaModeloDre, "components">>(
        `select line_code as code,title,line_type as type,display_order as "order",level,parent_code as "parentCode",presentation_sign as "presentationSign",vertical_basis as "verticalBasis" from app.accounting_statement_template_line where tenant_id=$1 and template_id=$2 and version_id=$3 order by display_order,line_code`,
        [actor.tenantId, templateId, versionId],
      ),
      client.query<{ lineCode: string; code: string; operator: "ADD" | "SUBTRACT" }>(
        `select line_code as "lineCode",component_code as code,operator from app.accounting_statement_template_component where tenant_id=$1 and template_id=$2 and version_id=$3 order by line_code,component_code`,
        [actor.tenantId, templateId, versionId],
      ),
    ]);
    const byLine = new Map<string, Componente[]>();
    for (const component of components.rows) {
      const group = byLine.get(component.lineCode) ?? [];
      group.push({ code: component.code, operator: component.operator });
      byLine.set(component.lineCode, group);
    }
    return lines.rows.map((line) => ({ ...line, components: byLine.get(line.code) ?? [] }));
  }

  private async insertLines(client: PoolClient, actor: Actor, templateId: string, versionId: string, lines: readonly LinhaModeloDre[]): Promise<void> {
    for (const line of lines) {
      await client.query(
        `insert into app.accounting_statement_template_line(tenant_id,template_id,version_id,line_code,title,line_type,display_order,level,parent_code,presentation_sign,vertical_basis) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [actor.tenantId, templateId, versionId, line.code, line.title, line.type, line.order, line.level, line.parentCode, line.presentationSign, line.verticalBasis],
      );
      for (const component of line.components) await client.query(
        `insert into app.accounting_statement_template_component(tenant_id,template_id,version_id,line_code,component_code,operator) values($1,$2,$3,$4,$5,$6)`,
        [actor.tenantId, templateId, versionId, line.code, component.code, component.operator],
      );
    }
  }

  async listar(actor: Actor, query: string, status: "ACTIVE" | "ARCHIVED" | null) {
    return this.contexto(actor, async (client) => {
      const out = await client.query<Modelo & { activeVersion: number | null; activeOrigin: string | null; updatedByName: string | null }>(
        `select t.id,t.name,t.description,t.status,t.created_by as "createdBy",t.updated_by as "updatedBy",u.nome as "updatedByName",t.created_at as "createdAt",t.updated_at as "updatedAt",v.version as "activeVersion",v.origin as "activeOrigin" from app.accounting_statement_template t left join app.usuario u on u.tenant_id=t.tenant_id and u.id=t.updated_by left join app.accounting_statement_template_version v on v.tenant_id=t.tenant_id and v.template_id=t.id and v.status='ACTIVE' where t.tenant_id=$1 and ($2='' or t.name ilike '%'||$2||'%') and ($3::text is null or t.status=$3) order by t.updated_at desc,t.name limit 200`,
        [actor.tenantId, query.trim().slice(0, 120), status],
      );
      return { items: out.rows };
    });
  }

  async criar(actor: Actor, input: CriarModelo, correlationId: string) {
    return this.contexto(actor, async (client) => {
      const created = await client.query<{ id: string }>(
        `insert into app.accounting_statement_template(tenant_id,name,description,created_by,updated_by) values($1,$2,$3,$4,$4) returning id`,
        [actor.tenantId, input.name, input.description ?? null, actor.usuarioId],
      );
      const templateId = created.rows[0]!.id;
      const version = await client.query<{ id: string }>(
        `insert into app.accounting_statement_template_version(tenant_id,template_id,version,status,origin,created_by,correlation_id) values($1,$2,1,'DRAFT','MANUAL',$3,$4) returning id`,
        [actor.tenantId, templateId, actor.usuarioId, correlationId],
      );
      await this.event(client, actor, templateId, version.rows[0]!.id, "CREATED", correlationId, { origin: "MANUAL" });
      return { templateId, version: 1, versionId: version.rows[0]!.id };
    });
  }

  async criarDaEmpresa(actor: Actor, input: CriarModeloOrigem, correlationId: string) {
    return this.contexto(actor, async (client) => {
      const source = await client.query<{ id: string; version: number; status: string }>(
        `select id,version,status from app.accounting_statement_version where tenant_id=$1 and company_id=$2 and id=$3 and status in ('ACTIVE','SUPERSEDED')`,
        [actor.tenantId, input.companyId, input.sourceVersionId],
      );
      const sourceVersion = source.rows[0];
      if (!sourceVersion) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_SOURCE_NOT_FOUND, "Versão empresarial não encontrada.");
      const raw = await client.query<Omit<LinhaDre, "accountIds"> & { accountIds: string[] }>(
        `select l.line_code as code,l.title,l.line_type as type,l.display_order as "order",l.level,l.parent_code as "parentCode",l.presentation_sign as "presentationSign",l.vertical_basis as "verticalBasis",coalesce((select array_agg(c.component_code order by c.component_code) from app.accounting_statement_component c where c.tenant_id=l.tenant_id and c.company_id=l.company_id and c.version_id=l.version_id and c.line_code=l.line_code and c.active),array[]::text[]) as "componentCodes",coalesce((select array_agg(m.account_id) from app.accounting_statement_mapping m where m.tenant_id=l.tenant_id and m.company_id=l.company_id and m.version_id=l.version_id and m.line_code=l.line_code and m.active),array[]::uuid[]) as "accountIds" from app.accounting_statement_line l where l.tenant_id=$1 and l.company_id=$2 and l.version_id=$3 and l.active order by l.display_order`,
        [actor.tenantId, input.companyId, input.sourceVersionId],
      );
      const componentRows = await client.query<{ lineCode: string; code: string; operator: "ADD" | "SUBTRACT" }>(
        `select line_code as "lineCode",component_code as code,operator from app.accounting_statement_component where tenant_id=$1 and company_id=$2 and version_id=$3 and active order by line_code,component_code`,
        [actor.tenantId, input.companyId, input.sourceVersionId],
      );
      const componentsByLine = new Map<string, Componente[]>();
      for (const item of componentRows.rows) componentsByLine.set(item.lineCode, [...(componentsByLine.get(item.lineCode) ?? []), { code: item.code, operator: item.operator }]);
      const sourceLines: LinhaDre[] = raw.rows.map((line) => ({
        code: line.code, title: line.title, type: line.type, order: line.order, level: line.level, parentCode: line.parentCode,
        presentationSign: line.presentationSign, accountIds: line.accountIds, components: componentsByLine.get(line.code) ?? [], verticalBasis: line.verticalBasis,
      }));
      const sanitized = sanitizarEstruturaDre(sourceLines);
      const invalid = validarEstruturaModeloDre(sanitized);
      if (invalid.length) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_INVALID, "Estrutura de origem inválida para modelo.", { errors: invalid });
      const created = await client.query<{ id: string }>(
        `insert into app.accounting_statement_template(tenant_id,name,description,created_by,updated_by) values($1,$2,$3,$4,$4) returning id`,
        [actor.tenantId, input.name, input.description ?? null, actor.usuarioId],
      );
      const templateId = created.rows[0]!.id;
      const version = await client.query<{ id: string }>(
        `insert into app.accounting_statement_template_version(tenant_id,template_id,version,status,origin,created_by,correlation_id) values($1,$2,1,'DRAFT','COMPANY_VERSION',$3,$4) returning id`,
        [actor.tenantId, templateId, actor.usuarioId, correlationId],
      );
      const versionId = version.rows[0]!.id;
      await this.insertLines(client, actor, templateId, versionId, sanitized);
      await client.query(
        `insert into app.accounting_statement_template_source(tenant_id,template_id,template_version_id,company_id,source_statement_version_id,actor_id,correlation_id) values($1,$2,$3,$4,$5,$6,$7)`,
        [actor.tenantId, templateId, versionId, input.companyId, input.sourceVersionId, actor.usuarioId, correlationId],
      );
      await this.event(client, actor, templateId, versionId, "CREATED", correlationId, { origin: "COMPANY_VERSION", sourceVersion: sourceVersion.version });
      return { templateId, version: 1, versionId };
    });
  }

  async atualizar(actor: Actor, templateId: string, input: CriarModelo, correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, templateId);
      const model = await this.model(client, actor, templateId, true);
      await client.query(`update app.accounting_statement_template set name=$3,description=$4,updated_by=$5,updated_at=now() where tenant_id=$1 and id=$2`, [actor.tenantId, templateId, input.name, input.description ?? null, actor.usuarioId]);
      await this.event(client, actor, templateId, null, "RENAMED", correlationId, { previousName: model.name, name: input.name });
      return this.model(client, actor, templateId);
    });
  }

  async alterarStatus(actor: Actor, templateId: string, status: "ACTIVE" | "ARCHIVED", correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, templateId);
      const model = await this.model(client, actor, templateId, true);
      if (model.status === status) return model;
      await client.query(`update app.accounting_statement_template set status=$3,updated_by=$4,updated_at=now() where tenant_id=$1 and id=$2`, [actor.tenantId, templateId, status, actor.usuarioId]);
      await this.event(client, actor, templateId, null, status === "ARCHIVED" ? "ARCHIVED" : "REACTIVATED", correlationId);
      return this.model(client, actor, templateId);
    });
  }

  async listarVersoes(actor: Actor, templateId: string) {
    return this.contexto(actor, async (client) => {
      await this.model(client, actor, templateId);
      const versions = await client.query<Versao>(
        `select id,version,status,revision,origin,structural_hash as "structuralHash",created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt" from app.accounting_statement_template_version where tenant_id=$1 and template_id=$2 order by version desc`,
        [actor.tenantId, templateId],
      );
      return { items: versions.rows };
    });
  }

  async obterVersao(actor: Actor, templateId: string, version: number) {
    return this.contexto(actor, async (client) => {
      const model = await this.model(client, actor, templateId);
      const selected = await this.version(client, actor, templateId, version);
      return { model, version: selected, lines: await this.lines(client, actor, templateId, selected.id) };
    });
  }

  async criarVersao(actor: Actor, templateId: string, correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, templateId);
      const model = await this.model(client, actor, templateId, true);
      if (model.status !== "ACTIVE") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_ARCHIVED, "Modelo arquivado não aceita novas versões.");
      const active = await client.query<{ id: string; origin: Versao["origin"] }>(`select id,origin from app.accounting_statement_template_version where tenant_id=$1 and template_id=$2 and status='ACTIVE'`, [actor.tenantId, templateId]);
      const next = await client.query<{ version: number }>(`select coalesce(max(version),0)+1 as version from app.accounting_statement_template_version where tenant_id=$1 and template_id=$2`, [actor.tenantId, templateId]);
      const inserted = await client.query<{ id: string }>(`insert into app.accounting_statement_template_version(tenant_id,template_id,version,status,origin,created_by,correlation_id) values($1,$2,$3,'DRAFT',$4,$5,$6) returning id`, [actor.tenantId, templateId, next.rows[0]!.version, active.rows[0]?.origin ?? "MANUAL", actor.usuarioId, correlationId]);
      const versionId = inserted.rows[0]!.id;
      if (active.rows[0]) await this.insertLines(client, actor, templateId, versionId, await this.lines(client, actor, templateId, active.rows[0].id));
      await this.event(client, actor, templateId, versionId, "DRAFT_CREATED", correlationId, { version: next.rows[0]!.version });
      return { version: next.rows[0]!.version, versionId, status: "DRAFT", revision: 0 };
    });
  }

  async salvarLinhas(actor: Actor, templateId: string, versionNo: number, input: SalvarLinhasModelo, correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, templateId);
      const model = await this.model(client, actor, templateId, true);
      if (model.status !== "ACTIVE") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_ARCHIVED, "Modelo arquivado não pode ser editado.");
      const version = await this.version(client, actor, templateId, versionNo, true);
      if (version.status !== "DRAFT") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_VERSION_CONFLICT, "Versão publicada é imutável.");
      if (version.revision !== input.expectedRevision) throw new ErroDeConflito(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_VERSION_CONFLICT, "Revisão do rascunho desatualizada.");
      const invalid = validarEstruturaModeloDre(input.lines);
      if (invalid.length) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_INVALID, "Revise a estrutura do modelo.", { errors: invalid });
      await client.query(`select app.accounting_statement_template_clear_draft_lines($1,$2,$3)`, [actor.tenantId, templateId, version.id]);
      await this.insertLines(client, actor, templateId, version.id, input.lines);
      await client.query(`update app.accounting_statement_template_version set revision=revision+1 where tenant_id=$1 and template_id=$2 and id=$3 and status='DRAFT' and revision=$4`, [actor.tenantId, templateId, version.id, input.expectedRevision]);
      await this.event(client, actor, templateId, version.id, "DRAFT_UPDATED", correlationId, { revision: input.expectedRevision + 1, lineCount: input.lines.length });
      return { ...version, revision: input.expectedRevision + 1, lines: input.lines };
    });
  }

  async publicar(actor: Actor, templateId: string, versionNo: number, expectedRevision: number, correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, templateId);
      const model = await this.model(client, actor, templateId, true);
      if (model.status !== "ACTIVE") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_ARCHIVED, "Modelo arquivado não pode ser publicado.");
      const version = await this.version(client, actor, templateId, versionNo, true);
      if (version.status !== "DRAFT") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_VERSION_CONFLICT, "Somente rascunho pode ser publicado.");
      if (version.revision !== expectedRevision) throw new ErroDeConflito(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_VERSION_CONFLICT, "Revisão do rascunho desatualizada.");
      const lines = await this.lines(client, actor, templateId, version.id);
      const invalid = validarEstruturaModeloDre(lines);
      if (invalid.length) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_INVALID, "Modelo inválido para publicação.", { errors: invalid });
      const previous = await client.query<{ id: string; version: number }>(`select id,version from app.accounting_statement_template_version where tenant_id=$1 and template_id=$2 and status='ACTIVE' for update`, [actor.tenantId, templateId]);
      if (previous.rows[0]) {
        await client.query(`update app.accounting_statement_template_version set status='SUPERSEDED' where tenant_id=$1 and template_id=$2 and id=$3 and status='ACTIVE'`, [actor.tenantId, templateId, previous.rows[0].id]);
        await this.event(client, actor, templateId, previous.rows[0].id, "SUPERSEDED", correlationId, { byVersion: versionNo });
      }
      const structuralHash = hashEstruturaModeloDre(lines);
      const updated = await client.query(`update app.accounting_statement_template_version set status='ACTIVE',revision=revision+1,structural_hash=$4,published_by=$5,published_at=now() where tenant_id=$1 and template_id=$2 and id=$3 and status='DRAFT' and revision=$6`, [actor.tenantId, templateId, version.id, structuralHash, actor.usuarioId, expectedRevision]);
      if (!updated.rowCount) throw new ErroDeConflito(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_VERSION_CONFLICT, "Versão alterada durante publicação.");
      await this.event(client, actor, templateId, version.id, "PUBLISHED", correlationId, { version: versionNo, structuralHash });
      return { ...version, status: "ACTIVE", revision: expectedRevision + 1, structuralHash, lines };
    });
  }

  async descartarRascunho(actor: Actor, templateId: string, versionNo: number, correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, templateId);
      await this.model(client, actor, templateId);
      const version = await this.version(client, actor, templateId, versionNo, true);
      if (version.status !== "DRAFT") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_VERSION_CONFLICT, "Somente rascunho pode ser descartado.");
      await client.query(`update app.accounting_statement_template_version set status='DISCARDED',revision=revision+1 where tenant_id=$1 and template_id=$2 and id=$3 and status='DRAFT'`, [actor.tenantId, templateId, version.id]);
      await this.event(client, actor, templateId, version.id, "DRAFT_DISCARDED", correlationId, { version: versionNo });
      return { version: versionNo, status: "DISCARDED" as const };
    });
  }

  async aplicar(actor: Actor, templateId: string, input: AplicarModelo, correlationId: string) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, `application:${input.idempotencyKey}`);
      await this.lockCompanyStatement(client, actor, input.companyId);
      const requestHash = hash({ templateId, templateVersion: input.templateVersion, companyId: input.companyId, expectedCompanyRevision: input.expectedCompanyRevision });
      const authorized = await client.query<{ allowed: boolean }>(`select app.empresa_autorizada($1) as allowed`, [input.companyId]);
      if (!authorized.rows[0]?.allowed) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_COMPANY_FORBIDDEN, "Empresa fora da carteira autorizada.");
      const existing = await client.query<{ statementVersionId: string; requestHash: string }>(`select statement_version_id as "statementVersionId",request_hash as "requestHash" from app.accounting_statement_template_application where tenant_id=$1 and idempotency_key=$2`, [actor.tenantId, input.idempotencyKey]);
      if (existing.rows[0]) {
        if (existing.rows[0].requestHash !== requestHash) throw new ErroDeConflito(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_APPLICATION_CONFLICT, "Chave idempotente já usada por outra aplicação.");
        return { companyStatementDraftId: existing.rows[0].statementVersionId, templateId, templateVersion: input.templateVersion, created: false };
      }
      await this.lock(client, actor, `${templateId}:${input.companyId}`);
      const model = await this.model(client, actor, templateId, true);
      if (model.status !== "ACTIVE") throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_ARCHIVED, "Modelo arquivado não pode ser aplicado.");
      const selected = await client.query<Versao>(`select id,version,status,revision,origin,structural_hash as "structuralHash",created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt" from app.accounting_statement_template_version where tenant_id=$1 and template_id=$2 and version=$3 and status='ACTIVE' for update`, [actor.tenantId, templateId, input.templateVersion]);
      const version = selected.rows[0];
      if (!version) throw erro(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_NOT_FOUND, "Versão publicada ativa não encontrada.");
      const current = await client.query<{ revision: number }>(`select revision from app.accounting_statement_version where tenant_id=$1 and company_id=$2 order by version desc limit 1 for update`, [actor.tenantId, input.companyId]);
      const revision = current.rows[0]?.revision ?? 0;
      if (revision !== input.expectedCompanyRevision) throw new ErroDeConflito(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_APPLICATION_CONFLICT, "Revisão da DRE empresarial mudou; atualize antes de aplicar.");
      const sourceLines = await this.lines(client, actor, templateId, version.id);
      const next = await client.query<{ version: number }>(`select coalesce(max(version),0)+1 as version from app.accounting_statement_version where tenant_id=$1 and company_id=$2`, [actor.tenantId, input.companyId]);
      const statement = await client.query<{ id: string }>(`insert into app.accounting_statement_version(tenant_id,company_id,version,status,created_by,correlation_id) values($1,$2,$3,'DRAFT',$4,$5) returning id`, [actor.tenantId, input.companyId, next.rows[0]!.version, actor.usuarioId, correlationId]);
      const statementVersionId = statement.rows[0]!.id;
      for (const line of sourceLines) {
        await client.query(`insert into app.accounting_statement_line(tenant_id,company_id,version_id,line_code,title,line_type,display_order,level,parent_code,presentation_sign,vertical_basis) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [actor.tenantId, input.companyId, statementVersionId, line.code, line.title, line.type, line.order, line.level, line.parentCode, line.presentationSign, line.verticalBasis]);
        for (const component of line.components) await client.query(`insert into app.accounting_statement_component(tenant_id,company_id,version_id,line_code,component_code,operator) values($1,$2,$3,$4,$5,$6)`, [actor.tenantId, input.companyId, statementVersionId, line.code, component.code, component.operator]);
      }
      try {
        await client.query(`insert into app.accounting_statement_template_application(tenant_id,template_id,template_version_id,company_id,statement_version_id,idempotency_key,request_hash,actor_id,correlation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [actor.tenantId, templateId, version.id, input.companyId, statementVersionId, input.idempotencyKey, requestHash, actor.usuarioId, correlationId]);
      } catch (cause) {
        if (ehColisaoDeIdempotencia(cause)) throw new ErroDeConflito(CODIGOS_DE_ERRO.STATEMENT_TEMPLATE_APPLICATION_CONFLICT, "Chave idempotente já usada por outra aplicação.");
        throw cause;
      }
      await this.event(client, actor, templateId, version.id, "APPLIED", correlationId, { templateVersion: input.templateVersion });
      return { companyStatementDraftId: statementVersionId, templateId, templateVersion: input.templateVersion, created: true };
    });
  }

  async proveniencia(actor: Actor, templateId: string, versionNo: number) {
    return this.contexto(actor, async (client) => {
      const version = await this.version(client, actor, templateId, versionNo);
      const [source, applications] = await Promise.all([
        client.query(`select company_id as "companyId",source_statement_version_id as "sourceStatementVersionId",actor_id as "actorId",created_at as "createdAt" from app.accounting_statement_template_source where tenant_id=$1 and template_id=$2 order by created_at asc limit 1`, [actor.tenantId, templateId]),
        client.query(`select company_id as "companyId",statement_version_id as "statementDraftId",actor_id as "actorId",created_at as "createdAt" from app.accounting_statement_template_application where tenant_id=$1 and template_version_id=$2 order by created_at desc`, [actor.tenantId, version.id]),
      ]);
      return { origin: source.rows[0] ?? { type: "MANUAL" }, applications: applications.rows };
    });
  }
}
