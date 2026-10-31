import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { Injectable } from "@nestjs/common";
import { comContextoHumano } from "@contaia/db";
import {
  calculateStatementReport,
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  hashAccountingClose,
  previousAccountingCompetence,
  validateStatementStructure,
} from "@contaia/domain";
import type {
  AccountingCloseSnapshotInput,
  ContaResultadoDre,
  LinhaDre,
  ModoPeriodoDre,
  MovimentoDre,
  RelatorioDre,
  TipoLinhaDre,
  VisaoDre,
} from "@contaia/domain";
import type { PoolClient } from "pg";
import { PoolDoBanco } from "../banco/pool.provider";
import type { ExportarDre, StatementLineInput } from "./dre-gerencial.dto";

type Actor = Readonly<{ tenantId: string; usuarioId: string }>;
type Version = Readonly<{
  id: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  revision: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
}>;
type Account = ContaResultadoDre & Readonly<{ active: boolean }>;
type Mapping = Readonly<{
  lineCode: string;
  accountId: string;
  accountClass: "REVENUE" | "EXPENSE";
  accountCode: string;
  accountName: string;
}>;
type Component = Readonly<{ code: string; operator: "ADD" | "SUBTRACT" }>;
type StatementStructure = Readonly<{
  version: Version;
  lines: readonly LinhaDre[];
  mappings: readonly Mapping[];
}>;
type ClosedLine = Readonly<{
  accountId: string;
  code: string;
  name: string;
  type: "ANALYTICAL" | "SYNTHETIC";
  accountClass: string | null;
  debitCents: number;
  creditCents: number;
  monthlyDebitCents: number | null;
  monthlyCreditCents: number | null;
}>;
type Closed = Readonly<{
  id: string;
  hash: string;
  snapshot: AccountingCloseSnapshotInput;
  lines: readonly ClosedLine[];
}>;
export type DreExport = Readonly<{
  contentType: string;
  fileName: string;
  body: Buffer;
}>;

const error = (
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): ErroDeDominio => new ErroDeDominio(code as never, message, [], details);
const json = (value: unknown): string => JSON.stringify(value);
const sha = (value: unknown): string =>
  createHash("sha256").update(json(value)).digest("hex");
const resultClass = (value: string | null): value is "REVENUE" | "EXPENSE" =>
  value === "REVENUE" || value === "EXPENSE";
const centsNumber = (value: string | number): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw error(
      CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
      "Valor do razão fora do intervalo seguro.",
    );
  return n;
};
const moeda = (cents: number | null): string =>
  cents === null
    ? "N/D"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(cents / 100);
const taxa = (value: number | "NOT_APPLICABLE" | "NOT_AVAILABLE"): string =>
  typeof value === "number"
    ? `${(value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : value === "NOT_AVAILABLE"
      ? "N/D"
      : "N/A";
const csvCell = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const maskCnpj = (value: string): string => {
  const digits = value.replace(/\D/gu, "");
  return digits.length === 14
    ? `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`
    : "CNPJ não informado";
};

const gerarPdf = async (
  payload: Readonly<{
    report: RelatorioDre;
    companyName: string;
    cnpj: string;
    actorName: string;
    generatedAt: string;
    competence: string;
    periodMode: ModoPeriodoDre;
    periodStatus: "OPEN" | "CLOSED";
    statementVersion: number;
  }>,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 38, bottom: 38, left: 38, right: 38 },
      info: {
        Title: "DRE Gerencial",
        Author: payload.actorName,
        Subject: `DRE ${payload.competence}`,
        CreationDate: new Date(payload.generatedAt),
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const lines = payload.report.lines;
    const rowsPerPage = 24;
    const pages = Math.max(1, Math.ceil(lines.length / rowsPerPage));
    for (let page = 0; page < pages; page++) {
      if (page > 0) doc.addPage();
      doc
        .fillColor("#101c2d")
        .font("Helvetica-Bold")
        .fontSize(17)
        .text("DRE GERENCIAL", 38, 38);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#45464d")
        .text(
          `${payload.companyName} · CNPJ ${maskCnpj(payload.cnpj)}`,
          38,
          64,
        );
      doc.text(
        `Competência ${payload.competence} · ${payload.periodMode === "MONTH" ? "Mensal" : "Acumulado no exercício"} · ${payload.periodStatus === "OPEN" ? "PRÉVIA" : "DEFINITIVA"} · Estrutura v${payload.statementVersion}`,
        38,
        78,
      );
      if (payload.report.status === "INCOMPLETE")
        doc
          .fillColor("#991b1b")
          .font("Helvetica-Bold")
          .text(
            `INCOMPLETA · ${payload.report.unmappedAccounts.length} conta(s) sem vínculo; exportação bloqueada.`,
            38,
            94,
          );
      const headerY = payload.report.status === "INCOMPLETE" ? 116 : 102;
      doc
        .fillColor("#101c2d")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("LINHA", 38, headerY, { width: 355 })
        .text("ATUAL", 400, headerY, { width: 90, align: "right" })
        .text("ANTERIOR", 495, headerY, { width: 90, align: "right" })
        .text("AV", 590, headerY, { width: 50, align: "right" })
        .text("AH (R$)", 645, headerY, { width: 70, align: "right" })
        .text("AH (%)", 720, headerY, { width: 65, align: "right" });
      doc
        .moveTo(38, headerY + 14)
        .lineTo(787, headerY + 14)
        .strokeColor("#c6c6cd")
        .stroke();
      const start = page * rowsPerPage;
      const end = Math.min(start + rowsPerPage, lines.length);
      for (let index = start; index < end; index++) {
        const line = lines[index]!;
        const y = headerY + 20 + (index - start) * 20;
        const isSubtotal = line.type === "SUBTOTAL";
        doc
          .font(isSubtotal ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8)
          .fillColor("#101c2d");
        doc.text(
          `${"  ".repeat(line.level)}${line.code}  ${line.title}`,
          38,
          y,
          { width: 355, ellipsis: true, lineBreak: false },
        );
        doc
          .text(moeda(line.currentCents), 400, y, { width: 90, align: "right" })
          .text(moeda(line.previousCents), 495, y, {
            width: 90,
            align: "right",
          })
          .text(taxa(line.verticalBasisPoints), 590, y, {
            width: 50,
            align: "right",
          })
          .text(moeda(line.horizontalCents), 645, y, {
            width: 70,
            align: "right",
          })
          .text(taxa(line.horizontalBasisPoints), 720, y, {
            width: 65,
            align: "right",
          });
        if (isSubtotal)
          doc
            .moveTo(38, y + 15)
            .lineTo(787, y + 15)
            .strokeColor("#dde1e8")
            .stroke();
      }
      const footerY = 555;
      doc
        .moveTo(38, footerY)
        .lineTo(787, footerY)
        .strokeColor("#c6c6cd")
        .stroke();
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#45464d")
        .text(
          `Gerado em ${new Date(payload.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${payload.actorName} · SHA-256 ${payload.report.hash}`,
          38,
          footerY + 7,
          { width: 670, ellipsis: true, lineBreak: false },
        );
      doc.text(`Página ${page + 1} de ${pages}`, 720, footerY + 7, {
        width: 67,
        align: "right",
      });
    }
    doc.end();
  });

@Injectable()
export class DreGerencialService {
  constructor(private readonly pool: PoolDoBanco) {}
  private contexto<T>(
    actor: Actor,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return comContextoHumano(this.pool.instancia, actor, run);
  }
  private async lock(
    client: PoolClient,
    actor: Actor,
    companyId: string,
  ): Promise<void> {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${actor.tenantId}:${companyId}:statement`,
    ]);
  }
  private async event(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    versionId: string | null,
    action: string,
    result: "SUCESSO" | "RECUSADO" | "FALHA",
    correlationId: string,
    details: unknown = {},
    competence: string | null = null,
    periodMode: ModoPeriodoDre | null = null,
    reportHash: string | null = null,
  ): Promise<void> {
    await client.query(
      `insert into app.accounting_statement_event(tenant_id,company_id,version_id,action,result,actor_id,competence,period_mode,report_hash,details,correlation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [
        actor.tenantId,
        companyId,
        versionId,
        action,
        result,
        actor.usuarioId,
        competence,
        periodMode,
        reportHash,
        json(details),
        correlationId,
      ],
    );
  }
  private async readVersion(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    versionId: string,
    lock = false,
  ): Promise<Version> {
    const out = await client.query<Version>(
      `select id,version,status,revision,effective_from as "effectiveFrom",effective_to as "effectiveTo",created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt" from app.accounting_statement_version where tenant_id=$1 and company_id=$2 and id=$3 ${lock ? "for update" : ""}`,
      [actor.tenantId, companyId, versionId],
    );
    if (!out.rows[0])
      throw error(
        CODIGOS_DE_ERRO.STATEMENT_STRUCTURE_NOT_FOUND,
        "Versão de estrutura não encontrada.",
      );
    return out.rows[0];
  }
  private async accounts(
    client: PoolClient,
    actor: Actor,
    companyId: string,
  ): Promise<Account[]> {
    const out = await client.query<{
      accountId: string;
      code: string;
      name: string;
      class: string | null;
      active: boolean;
      type: string;
      hasMovement: boolean;
    }>(
      `select a.id as "accountId",a.codigo as code,a.nome as name,a.classe_contabil as class,not a.arquivada as active,a.tipo as type,exists(select 1 from app.movimento_razao m join app.projecao_razao p on p.tenant_id=m.tenant_id and p.empresa_id=m.empresa_id and p.versao_ativa_id=m.versao_id where m.tenant_id=a.tenant_id and m.empresa_id=a.empresa_id and m.conta_id=a.id) as "hasMovement" from app.conta_contabil a where a.tenant_id=$1 and a.empresa_id=$2 and a.tipo='analitica' and (not a.arquivada or exists(select 1 from app.movimento_razao m join app.projecao_razao p on p.tenant_id=m.tenant_id and p.empresa_id=m.empresa_id and p.versao_ativa_id=m.versao_id where m.tenant_id=a.tenant_id and m.empresa_id=a.empresa_id and m.conta_id=a.id)) order by a.codigo`,
      [actor.tenantId, companyId],
    );
    return out.rows.map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      nature: resultClass(row.class) ? row.class : "OTHER",
      eligible: resultClass(row.class) && (row.active || row.hasMovement),
      active: row.active,
    }));
  }
  private async structure(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    versionId: string,
  ): Promise<StatementStructure> {
    const version = await this.readVersion(client, actor, companyId, versionId);
    const [lineRows, mappingRows, componentRows] = await Promise.all([
      client.query<{
        code: string;
        title: string;
        type: TipoLinhaDre;
        order: number;
        level: number;
        parentCode: string | null;
        presentationSign: 1 | -1;
        verticalBasis: boolean;
      }>(
        `select line_code as code,title,line_type as type,display_order as "order",level,parent_code as "parentCode",presentation_sign as "presentationSign",vertical_basis as "verticalBasis" from app.accounting_statement_line where tenant_id=$1 and company_id=$2 and version_id=$3 and active order by display_order,line_code`,
        [actor.tenantId, companyId, versionId],
      ),
      client.query<Mapping>(
        `select line_code as "lineCode",account_id as "accountId",account_class as "accountClass",account_code as "accountCode",account_name as "accountName" from app.accounting_statement_mapping where tenant_id=$1 and company_id=$2 and version_id=$3 and active order by account_code`,
        [actor.tenantId, companyId, versionId],
      ),
      client.query<{
        lineCode: string;
        code: string;
        operator: "ADD" | "SUBTRACT";
      }>(
        `select line_code as "lineCode",component_code as code,operator from app.accounting_statement_component where tenant_id=$1 and company_id=$2 and version_id=$3 and active order by line_code,component_code`,
        [actor.tenantId, companyId, versionId],
      ),
    ]);
    const mappingsByLine = new Map<string, Mapping[]>();
    for (const mapping of mappingRows.rows) {
      const items = mappingsByLine.get(mapping.lineCode) ?? [];
      items.push(mapping);
      mappingsByLine.set(mapping.lineCode, items);
    }
    const componentsByLine = new Map<string, Component[]>();
    for (const component of componentRows.rows) {
      const items = componentsByLine.get(component.lineCode) ?? [];
      items.push({ code: component.code, operator: component.operator });
      componentsByLine.set(component.lineCode, items);
    }
    return {
      version,
      lines: lineRows.rows.map((line) => ({
        ...line,
        presentationSign: line.presentationSign as 1 | -1,
        accountIds: (mappingsByLine.get(line.code) ?? []).map(
          (mapping) => mapping.accountId,
        ),
        components: componentsByLine.get(line.code) ?? [],
      })),
      mappings: mappingRows.rows,
    };
  }
  private async validate(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    structure: StatementStructure,
  ) {
    const accounts = await this.accounts(client, actor, companyId);
    const lines: StatementLineInput[] = structure.lines.map((line) => ({
      ...line,
      accountIds: [...line.accountIds],
      components: line.components.map((component) => ({ ...component })),
    }));
    const errors = validateStatementStructure(lines, accounts);
    return {
      errors,
      publishable: errors.length === 0,
      eligibleAccounts: accounts.filter((account) => account.eligible).length,
      mappedAccounts: new Set(
        structure.lines.flatMap((line) => line.accountIds),
      ).size,
    };
  }
  private async insertStructure(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    versionId: string,
    lines: readonly StatementLineInput[],
  ): Promise<void> {
    const accountIds = [...new Set(lines.flatMap((line) => line.accountIds))];
    const found = await client.query<{
      accountId: string;
      class: string | null;
      code: string;
      name: string;
      active: boolean;
      type: string;
      hasMovement: boolean;
      previouslyMapped: boolean;
    }>(
      `select a.id as "accountId",a.classe_contabil as class,a.codigo as code,a.nome as name,not a.arquivada as active,a.tipo as type,exists(select 1 from app.movimento_razao m join app.projecao_razao p on p.tenant_id=m.tenant_id and p.empresa_id=m.empresa_id and p.versao_ativa_id=m.versao_id where m.tenant_id=a.tenant_id and m.empresa_id=a.empresa_id and m.conta_id=a.id) as "hasMovement",exists(select 1 from app.accounting_statement_mapping m join app.accounting_statement_version v on v.id=m.version_id and v.tenant_id=m.tenant_id and v.company_id=m.company_id where m.tenant_id=a.tenant_id and m.company_id=a.empresa_id and m.account_id=a.id and m.active and v.status in ('ACTIVE','SUPERSEDED')) as "previouslyMapped" from app.conta_contabil a where a.tenant_id=$1 and a.empresa_id=$2 and a.id=any($3::uuid[])`,
      [actor.tenantId, companyId, accountIds],
    );
    const byId = new Map(found.rows.map((row) => [row.accountId, row]));
    for (const id of accountIds) {
      const account = byId.get(id);
      if (
        !account ||
        account.type !== "analitica" ||
        !resultClass(account.class) ||
        (!account.active && !account.hasMovement && !account.previouslyMapped)
      )
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_ACCOUNT_NOT_ELIGIBLE,
          "Somente conta analítica de resultado ativa, movimentada ou já vinculada historicamente pode ser vinculada.",
          { accountId: id },
        );
    }
    await client.query(
      `delete from app.accounting_statement_component where tenant_id=$1 and company_id=$2 and version_id=$3`,
      [actor.tenantId, companyId, versionId],
    );
    await client.query(
      `delete from app.accounting_statement_mapping where tenant_id=$1 and company_id=$2 and version_id=$3`,
      [actor.tenantId, companyId, versionId],
    );
    await client.query(
      `delete from app.accounting_statement_line where tenant_id=$1 and company_id=$2 and version_id=$3`,
      [actor.tenantId, companyId, versionId],
    );
    for (const line of lines)
      await client.query(
        `insert into app.accounting_statement_line(tenant_id,company_id,version_id,line_code,title,line_type,display_order,level,parent_code,presentation_sign,vertical_basis) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          actor.tenantId,
          companyId,
          versionId,
          line.code,
          line.title,
          line.type,
          line.order,
          line.level,
          line.parentCode,
          line.presentationSign,
          line.verticalBasis,
        ],
      );
    for (const line of lines) {
      for (const accountId of line.accountIds) {
        const account = byId.get(accountId)!;
        await client.query(
          `insert into app.accounting_statement_mapping(tenant_id,company_id,version_id,line_code,account_id,account_class,account_code,account_name,active) values($1,$2,$3,$4,$5,$6,$7,$8,true) on conflict(tenant_id,company_id,version_id,line_code,account_id) do update set account_class=excluded.account_class,account_code=excluded.account_code,account_name=excluded.account_name,active=true`,
          [
            actor.tenantId,
            companyId,
            versionId,
            line.code,
            accountId,
            account.class,
            account.code,
            account.name,
          ],
        );
      }
      for (const component of line.components)
        await client.query(
          `insert into app.accounting_statement_component(tenant_id,company_id,version_id,line_code,component_code,operator,active) values($1,$2,$3,$4,$5,$6,true) on conflict(tenant_id,company_id,version_id,line_code,component_code) do update set operator=excluded.operator,active=true`,
          [
            actor.tenantId,
            companyId,
            versionId,
            line.code,
            component.code,
            component.operator,
          ],
        );
    }
  }
  async criarRascunho(
    actor: Actor,
    companyId: string,
    fromVersion: number | undefined,
    correlationId: string,
  ) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, companyId);
      let source: StatementStructure | undefined;
      if (fromVersion !== undefined) {
        const found = await client.query<{ id: string }>(
          `select id from app.accounting_statement_version where tenant_id=$1 and company_id=$2 and version=$3 and status in ('ACTIVE','SUPERSEDED')`,
          [actor.tenantId, companyId, fromVersion],
        );
        if (!found.rows[0])
          throw error(
            CODIGOS_DE_ERRO.STATEMENT_STRUCTURE_NOT_FOUND,
            "Versão publicada para clonagem não encontrada.",
          );
        source = await this.structure(
          client,
          actor,
          companyId,
          found.rows[0].id,
        );
      }
      const next = await client.query<{ version: number }>(
        `select coalesce(max(version),0)+1 as version from app.accounting_statement_version where tenant_id=$1 and company_id=$2`,
        [actor.tenantId, companyId],
      );
      const inserted = await client.query<{ id: string }>(
        `insert into app.accounting_statement_version(tenant_id,company_id,version,status,created_by,correlation_id) values($1,$2,$3,'DRAFT',$4,$5) returning id`,
        [
          actor.tenantId,
          companyId,
          next.rows[0]!.version,
          actor.usuarioId,
          correlationId,
        ],
      );
      const versionId = inserted.rows[0]!.id;
      if (source)
        await this.insertStructure(
          client,
          actor,
          companyId,
          versionId,
          source.lines.map((line) => ({
            code: line.code,
            title: line.title,
            type: line.type,
            order: line.order,
            level: line.level,
            parentCode: line.parentCode,
            presentationSign: line.presentationSign,
            accountIds: [...line.accountIds],
            components: line.components.map((component) => ({ ...component })),
            verticalBasis: line.verticalBasis,
          })),
        );
      await this.event(
        client,
        actor,
        companyId,
        versionId,
        "DRAFT_CREATED",
        "SUCESSO",
        correlationId,
        { fromVersion: source?.version.version ?? null },
      );
      return this.structure(client, actor, companyId, versionId);
    });
  }
  async listarVersoes(actor: Actor, companyId: string) {
    return this.contexto(actor, async (client) => {
      const versions = await client.query<Version>(
        `select id,version,status,revision,effective_from as "effectiveFrom",effective_to as "effectiveTo",created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt" from app.accounting_statement_version where tenant_id=$1 and company_id=$2 order by version desc`,
        [actor.tenantId, companyId],
      );
      return Promise.all(
        versions.rows.map(async (version) => {
          const structure = await this.structure(
            client,
            actor,
            companyId,
            version.id,
          );
          const validation = await this.validate(
            client,
            actor,
            companyId,
            structure,
          );
          return {
            ...structure,
            validation,
            lines: structure.lines.map((line) => ({
              ...line,
              accountIds: [...line.accountIds],
              components: line.components.map((component) => ({
                ...component,
              })),
            })),
          };
        }),
      );
    });
  }
  async obterVersao(actor: Actor, companyId: string, versionId: string) {
    return this.contexto(actor, async (client) => {
      const structure = await this.structure(
        client,
        actor,
        companyId,
        versionId,
      );
      return {
        ...structure,
        validation: await this.validate(client, actor, companyId, structure),
        lines: structure.lines.map((line) => ({
          ...line,
          accountIds: [...line.accountIds],
          components: line.components.map((component) => ({ ...component })),
        })),
      };
    });
  }
  async salvarEstrutura(
    actor: Actor,
    companyId: string,
    versionId: string,
    expectedRevision: number,
    lines: readonly StatementLineInput[],
    correlationId: string,
  ) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, companyId);
      const current = await this.readVersion(
        client,
        actor,
        companyId,
        versionId,
        true,
      );
      if (current.status !== "DRAFT")
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_EDIT_FORBIDDEN,
          "Versão publicada é imutável.",
        );
      if (current.revision !== expectedRevision)
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.STATEMENT_VERSION_CONFLICT,
          "Revisão do rascunho desatualizada.",
        );
      await this.insertStructure(client, actor, companyId, versionId, lines);
      await client.query(
        `update app.accounting_statement_version set revision=revision+1 where tenant_id=$1 and company_id=$2 and id=$3 and status='DRAFT' and revision=$4`,
        [actor.tenantId, companyId, versionId, expectedRevision],
      );
      await this.event(
        client,
        actor,
        companyId,
        versionId,
        "DRAFT_UPDATED",
        "SUCESSO",
        correlationId,
        { revision: expectedRevision + 1, lineCount: lines.length },
      );
      const structure = await this.structure(
        client,
        actor,
        companyId,
        versionId,
      );
      return {
        ...structure,
        validation: await this.validate(client, actor, companyId, structure),
      };
    });
  }
  async publicar(
    actor: Actor,
    companyId: string,
    versionId: string,
    expectedRevision: number,
    effectiveFrom: string,
    correlationId: string,
  ) {
    return this.contexto(actor, async (client) => {
      await this.lock(client, actor, companyId);
      const version = await this.readVersion(
        client,
        actor,
        companyId,
        versionId,
        true,
      );
      if (version.status !== "DRAFT")
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_PUBLISH_FORBIDDEN,
          "Somente rascunho pode ser publicado.",
        );
      if (version.revision !== expectedRevision)
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.STATEMENT_VERSION_CONFLICT,
          "Revisão do rascunho desatualizada.",
        );
      const structure = await this.structure(
        client,
        actor,
        companyId,
        versionId,
      );
      const validation = await this.validate(
        client,
        actor,
        companyId,
        structure,
      );
      if (validation.errors.length)
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_STRUCTURE_INVALID,
          "Estrutura não pode ser publicada.",
          { errors: validation.errors },
        );
      const lastClose = await client.query<{ competence: string }>(
        `select max(competence) as competence from app.accounting_period_cycle where tenant_id=$1 and company_id=$2 and status='CLOSED'`,
        [actor.tenantId, companyId],
      );
      if (
        lastClose.rows[0]?.competence &&
        effectiveFrom <= lastClose.rows[0].competence
      )
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_PERIOD_OVERLAP,
          "Nova vigência deve começar após a última competência fechada.",
          { lastClosedCompetence: lastClose.rows[0].competence },
        );
      const active = await client.query<{ id: string; effectiveFrom: string }>(
        `select id,effective_from as "effectiveFrom" from app.accounting_statement_version where tenant_id=$1 and company_id=$2 and status='ACTIVE' for update`,
        [actor.tenantId, companyId],
      );
      if (active.rows[0]) {
        if (effectiveFrom <= active.rows[0].effectiveFrom)
          throw error(
            CODIGOS_DE_ERRO.STATEMENT_PERIOD_OVERLAP,
            "Nova versão deve iniciar depois da versão ativa.",
          );
        const end = previousAccountingCompetence(effectiveFrom);
        await client.query(
          `update app.accounting_statement_version set status='SUPERSEDED',effective_to=$1 where tenant_id=$2 and company_id=$3 and id=$4 and status='ACTIVE'`,
          [end, actor.tenantId, companyId, active.rows[0].id],
        );
      }
      await client.query(
        `update app.accounting_statement_version set status='ACTIVE',revision=revision+1,effective_from=$1,published_by=$2,published_at=now() where tenant_id=$3 and company_id=$4 and id=$5 and status='DRAFT' and revision=$6`,
        [
          effectiveFrom,
          actor.usuarioId,
          actor.tenantId,
          companyId,
          versionId,
          expectedRevision,
        ],
      );
      await this.event(
        client,
        actor,
        companyId,
        versionId,
        "PUBLISHED",
        "SUCESSO",
        correlationId,
        { revision: expectedRevision + 1, effectiveFrom },
      );
      return this.structure(client, actor, companyId, versionId);
    });
  }
  private async closed(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    competence: string,
  ): Promise<Closed | null> {
    const out = await client.query<{
      id: string;
      hash: string;
      content: unknown;
      statementVersionId: string | null;
      lines: Array<{
        accountId: string;
        code: string;
        name: string;
        accountClass: string | null;
        type: "ANALYTICAL" | "SYNTHETIC";
        debitCents: string;
        creditCents: string;
        monthlyDebitCents: string | null;
        monthlyCreditCents: string | null;
      }>;
    }>(
      `select c.id,c.content_hash as hash,c.content,c.statement_version_id as "statementVersionId",coalesce(jsonb_agg(jsonb_build_object('accountId',l.account_id,'code',l.code,'name',l.name,'accountClass',l.account_class,'type',l.account_type,'debitCents',l.debit_cents,'creditCents',l.credit_cents,'monthlyDebitCents',l.monthly_debit_cents,'monthlyCreditCents',l.monthly_credit_cents) order by l.code) filter(where l.account_id is not null),'[]'::jsonb) as lines from app.accounting_period_cycle cy join app.accounting_period_close c on c.id=cy.active_close_id and c.tenant_id=cy.tenant_id and c.company_id=cy.company_id left join app.accounting_period_close_snapshot_line l on l.tenant_id=c.tenant_id and l.company_id=c.company_id and l.close_id=c.id where cy.tenant_id=$1 and cy.company_id=$2 and cy.competence=$3 and cy.status='CLOSED' group by c.id`,
      [actor.tenantId, companyId, competence],
    );
    if (!out.rows[0]) return null;
    const snapshot =
      typeof out.rows[0].content === "string"
        ? (JSON.parse(out.rows[0].content) as AccountingCloseSnapshotInput)
        : (out.rows[0].content as AccountingCloseSnapshotInput);
    if (
      out.rows[0].statementVersionId !== null &&
      snapshot.statementVersionId !== out.rows[0].statementVersionId
    )
      throw error(
        CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
        "Versão DRE associada ao fechamento diverge do conteúdo.",
      );
    const hash = hashAccountingClose({
      ...snapshot,
      closedAt: new Date(snapshot.closedAt).toISOString(),
    });
    if (hash !== out.rows[0].hash.trim())
      throw error(
        CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
        "Hash do fechamento F43 diverge do snapshot.",
      );
    const lines = out.rows[0].lines.map((line) => ({
      ...line,
      debitCents: centsNumber(line.debitCents),
      creditCents: centsNumber(line.creditCents),
      monthlyDebitCents:
        line.monthlyDebitCents === null
          ? null
          : centsNumber(line.monthlyDebitCents),
      monthlyCreditCents:
        line.monthlyCreditCents === null
          ? null
          : centsNumber(line.monthlyCreditCents),
    }));
    return {
      id: out.rows[0].id,
      hash: out.rows[0].hash.trim(),
      snapshot,
      lines,
    };
  }
  private snapshotMovements(
    end: Closed,
    baseline: Closed | null,
    periodEnd: string,
  ): MovimentoDre[] {
    const first = end.snapshot.firstCompetence;
    if (!baseline && first < periodEnd)
      throw error(
        CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
        "Fechamento anterior necessário para reconstruir débitos e créditos mensais.",
        { periodEnd, firstCompetence: first },
      );
    const old = new Map(
      (baseline?.lines ?? []).map((line) => [line.accountId, line]),
    );
    return end.lines
      .filter((line) => line.type === "ANALYTICAL")
      .map((line) => {
        const prior = old.get(line.accountId);
        const debit =
          line.monthlyDebitCents ?? line.debitCents - (prior?.debitCents ?? 0);
        const credit =
          line.monthlyCreditCents ??
          line.creditCents - (prior?.creditCents ?? 0);
        if (debit < 0 || credit < 0)
          throw error(
            CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
            "Snapshot acumulado diverge do fechamento anterior.",
            { periodEnd, accountId: line.accountId },
          );
        return {
          accountId: line.accountId,
          competence: periodEnd,
          debitCents: debit,
          creditCents: credit,
        };
      });
  }
  private accountsFromClosed(
    snapshots: readonly (Closed | null)[],
    mappings: readonly Mapping[],
  ): ContaResultadoDre[] {
    const byId = new Map<string, ContaResultadoDre>();
    for (const close of snapshots)
      for (const line of close?.lines ?? []) {
        if (line.type !== "ANALYTICAL") continue;
        const mapped = mappings.find(
          (item) => item.accountId === line.accountId,
        );
        const nature = line.accountClass ?? mapped?.accountClass ?? "OTHER";
        byId.set(line.accountId, {
          accountId: line.accountId,
          code: line.code,
          name: line.name,
          nature: resultClass(nature) ? nature : "OTHER",
          eligible: resultClass(nature),
        });
      }
    for (const item of mappings) {
      const old = byId.get(item.accountId);
      if (!old)
        byId.set(item.accountId, {
          accountId: item.accountId,
          code: item.accountCode,
          name: item.accountName,
          nature: item.accountClass,
          eligible: true,
        });
      else if (old.nature === "OTHER")
        byId.set(item.accountId, {
          ...old,
          nature: item.accountClass,
          eligible: true,
        });
    }
    return [...byId.values()];
  }
  private async report(
    client: PoolClient,
    actor: Actor,
    companyId: string,
    query: ExportarDre & { viewMode: VisaoDre },
  ): Promise<
    Readonly<{
      report: RelatorioDre;
      version: Version;
      status: "OPEN" | "CLOSED";
      sourceHash: string;
      effectiveFrom: string;
    }>
  > {
    const currentClose = await this.closed(
      client,
      actor,
      companyId,
      query.competence,
    );
    let versionId = currentClose?.snapshot.statementVersionId ?? null;
    if (currentClose && versionId === null) {
      const legacy = await client.query<{ id: string }>(
        `select id from app.accounting_statement_version where tenant_id=$1 and company_id=$2 and status in ('ACTIVE','SUPERSEDED') and effective_from<=$3 and effective_to>=$3`,
        [actor.tenantId, companyId, query.competence],
      );
      if (legacy.rows.length !== 1)
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_STRUCTURE_NOT_FOUND,
          "Fechamento antigo sem versão DRE associada e sem versão histórica aplicável.",
        );
      versionId = legacy.rows[0]!.id;
    }
    if (!versionId) {
      const current = await client.query<{ id: string }>(
        `select id from app.accounting_statement_version where tenant_id=$1 and company_id=$2 and status in ('ACTIVE','SUPERSEDED') and effective_from<=$3 and (effective_to is null or effective_to>=$3)`,
        [actor.tenantId, companyId, query.competence],
      );
      if (current.rows.length !== 1)
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_STRUCTURE_NOT_FOUND,
          "Não há uma estrutura publicada aplicável à competência.",
        );
      versionId = current.rows[0]!.id;
    }
    const structure = await this.structure(client, actor, companyId, versionId);
    const accountsCurrent = await this.accounts(client, actor, companyId);
    let movements: MovimentoDre[];
    let accounts: ContaResultadoDre[];
    let comparisonAvailable: boolean;
    let sourceHash: string;
    let status: "OPEN" | "CLOSED";
    const previousBase = `${String(Number(query.competence.slice(0, 4)) - 1).padStart(4, "0")}-${query.competence.slice(5)}`;
    const currentStart =
      query.periodMode === "MONTH"
        ? query.competence
        : `${query.competence.slice(0, 4)}-01`;
    const previousStart =
      query.periodMode === "MONTH"
        ? previousBase
        : `${previousBase.slice(0, 4)}-01`;
    if (currentClose) {
      status = "CLOSED";
      const currentBaseline = await this.closed(
        client,
        actor,
        companyId,
        previousAccountingCompetence(query.competence),
      );
      const monthlyCurrent = this.snapshotMovements(
        currentClose,
        currentBaseline,
        query.competence,
      );
      const currentValues: MovimentoDre[] = [];
      if (query.periodMode === "YEAR_TO_DATE") {
        for (
          let month = 1;
          month <= Number(query.competence.slice(5));
          month++
        ) {
          const competence = `${query.competence.slice(0, 4)}-${String(month).padStart(2, "0")}`;
          const close = await this.closed(client, actor, companyId, competence);
          if (!close)
            throw error(
              CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
              "Competência fechada ausente no acumulado do exercício.",
              { competence },
            );
          const baseline =
            month === 1
              ? null
              : await this.closed(
                  client,
                  actor,
                  companyId,
                  previousAccountingCompetence(competence),
                );
          currentValues.push(
            ...this.snapshotMovements(close, baseline, competence),
          );
        }
      } else currentValues.push(...monthlyCurrent);
      const comparisonClose = await this.closed(
        client,
        actor,
        companyId,
        previousBase,
      );
      comparisonAvailable = comparisonClose !== null;
      const previousValues: MovimentoDre[] = [];
      if (comparisonClose && query.periodMode === "YEAR_TO_DATE") {
        for (let month = 1; month <= Number(previousBase.slice(5)); month++) {
          const competence = `${previousBase.slice(0, 4)}-${String(month).padStart(2, "0")}`;
          const close = await this.closed(client, actor, companyId, competence);
          if (!close)
            throw error(
              CODIGOS_DE_ERRO.STATEMENT_RECONCILIATION_FAILED,
              "Competência comparativa fechada ausente no acumulado.",
              { competence },
            );
          const baseline =
            month === 1
              ? null
              : await this.closed(
                  client,
                  actor,
                  companyId,
                  previousAccountingCompetence(competence),
                );
          previousValues.push(
            ...this.snapshotMovements(close, baseline, competence),
          );
        }
      } else if (comparisonClose) {
        const baseline = await this.closed(
          client,
          actor,
          companyId,
          previousAccountingCompetence(previousBase),
        );
        previousValues.push(
          ...this.snapshotMovements(comparisonClose, baseline, previousBase),
        );
      }
      movements = [...currentValues, ...previousValues];
      accounts = this.accountsFromClosed(
        [currentClose, comparisonClose],
        structure.mappings,
      );
      sourceHash = sha({
        current: currentValues,
        previous: previousValues,
        currentHash: currentClose.hash,
        previousHash: comparisonClose?.hash ?? null,
      });
    } else {
      status = "OPEN";
      const projection = await client.query<{ id: string; version: number }>(
        `select p.versao_ativa_id as id,p.numero_versao as version from app.projecao_razao p where p.tenant_id=$1 and p.empresa_id=$2 and p.integridade='CONSISTENT'`,
        [actor.tenantId, companyId],
      );
      if (!projection.rows[0])
        throw error(
          CODIGOS_DE_ERRO.STATEMENT_PERIOD_NOT_FOUND,
          "Projeção íntegra do razão não disponível.",
        );
      const rows = await client.query<{
        accountId: string;
        competence: string;
        debit: string;
        credit: string;
        count: string;
      }>(
        `select conta_id as "accountId",competencia,coalesce(sum(valor_centavos) filter(where lado='DEBIT'),0)::text as debit,coalesce(sum(valor_centavos) filter(where lado='CREDIT'),0)::text as credit,count(*)::text as count from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3 and ((competencia between $4 and $5) or (competencia between $6 and $7)) group by conta_id,competencia order by conta_id,competencia`,
        [
          actor.tenantId,
          companyId,
          projection.rows[0].id,
          currentStart,
          query.competence,
          previousStart,
          previousBase,
        ],
      );
      movements = rows.rows.map((row) => ({
        accountId: row.accountId,
        competence: row.competence,
        debitCents: centsNumber(row.debit),
        creditCents: centsNumber(row.credit),
      }));
      const comparisonClose = await this.closed(
        client,
        actor,
        companyId,
        previousBase,
      );
      const comparatorHasMovements = rows.rows.some(
        (row) =>
          row.competence >= previousStart && row.competence <= previousBase,
      );
      comparisonAvailable = comparisonClose !== null || comparatorHasMovements;
      accounts = accountsCurrent.map(
        ({ accountId, code, name, nature, eligible }) => ({
          accountId,
          code,
          name,
          nature,
          eligible,
        }),
      );
      for (const mapping of structure.mappings)
        if (
          !accounts.some((account) => account.accountId === mapping.accountId)
        )
          accounts.push({
            accountId: mapping.accountId,
            code: mapping.accountCode,
            name: mapping.accountName,
            nature: mapping.accountClass,
            eligible: true,
          });
      sourceHash = sha({
        projectionId: projection.rows[0].id,
        projectionVersion: projection.rows[0].version,
        movements: rows.rows.map((row) => ({
          ...row,
          debit: centsNumber(row.debit),
          credit: centsNumber(row.credit),
        })),
      });
    }
    const report = calculateStatementReport({
      companyId,
      statementVersion: structure.version.version,
      viewMode: query.viewMode,
      lines: structure.lines,
      accounts,
      movements,
      basePeriod: query.competence,
      periodMode: query.periodMode,
      comparisonAvailable,
      sourceHash,
    });
    return {
      report,
      version: structure.version,
      status,
      sourceHash,
      effectiveFrom: structure.version.effectiveFrom!,
    };
  }
  async consultar(
    actor: Actor,
    companyId: string,
    query: ExportarDre & { viewMode: VisaoDre },
    correlationId: string,
  ) {
    return this.contexto(actor, async (client) => {
      const result = await this.report(client, actor, companyId, query);
      await this.event(
        client,
        actor,
        companyId,
        result.version.id,
        "REPORT_QUERIED",
        "SUCESSO",
        correlationId,
        {},
        query.competence,
        query.periodMode,
        result.report.hash,
      );
      const company = await client.query<{ name: string; cnpj: string }>(
        `select razao_social as name,cnpj from app.empresa where tenant_id=$1 and id=$2`,
        [actor.tenantId, companyId],
      );
      return {
        ...result.report,
        companyId,
        basePeriod: query.competence,
        periodMode: query.periodMode,
        viewMode: query.viewMode,
        statementVersion: result.version.version,
        statementEffectiveFrom: result.effectiveFrom,
        accountingPeriodStatus: result.status,
        companyName: company.rows[0]?.name ?? "Empresa",
        cnpj: company.rows[0]?.cnpj ?? null,
        sourceHash: result.sourceHash,
        lines:
          query.viewMode === "ANALYTIC"
            ? result.report.lines
            : result.report.lines.map((line) => ({ ...line, accounts: [] })),
      };
    });
  }
  private async gerarArquivo(
    format: "PDF" | "CSV",
    stored: Record<string, unknown>,
  ): Promise<DreExport> {
    const report = stored["report"] as RelatorioDre;
    const competence = String(stored["competence"]);
    const mode = stored["periodMode"] as ModoPeriodoDre;
    const version = Number(stored["statementVersion"]);
    if (format === "CSV") {
      const headers = [
        "empresa_id",
        "competencia_base",
        "period_mode",
        "statement_version",
        "statement_line_code",
        "statement_line_title",
        "account_code",
        "account_name",
        "current_cents",
        "previous_cents",
        "vertical_basis_points",
        "horizontal_basis_points",
        "report_status",
        "report_hash",
      ];
      const rows: string[] = [headers.join(",")];
      for (const line of report.lines.filter(
        (item) => item.type === "DETAIL",
      )) {
        if (line.accounts.length === 0)
          rows.push(
            [
              String(stored["companyId"]),
              competence,
              mode,
              version,
              line.code,
              line.title,
              "",
              "",
              0,
              "NOT_AVAILABLE",
              line.verticalBasisPoints,
              line.horizontalBasisPoints,
              report.status,
              report.hash,
            ]
              .map(csvCell)
              .join(","),
          );
        for (const account of line.accounts) {
          rows.push(
            [
              String(stored["companyId"]),
              competence,
              mode,
              version,
              line.code,
              line.title,
              account.code,
              account.name,
              account.currentCents,
              account.previousCents ?? "NOT_AVAILABLE",
              line.verticalBasisPoints,
              line.horizontalBasisPoints,
              report.status,
              report.hash,
            ]
              .map(csvCell)
              .join(","),
          );
        }
      }
      return {
        contentType: "text/csv; charset=utf-8",
        fileName: `dre-${competence}-${mode.toLowerCase()}.csv`,
        body: Buffer.from(`\uFEFF${rows.join("\r\n")}\r\n`, "utf8"),
      };
    }
    const body = await gerarPdf({
      report,
      companyName: String(stored["companyName"]),
      cnpj: String(stored["cnpj"] ?? ""),
      actorName: String(stored["actorName"]),
      generatedAt: String(stored["generatedAt"]),
      competence,
      periodMode: mode,
      periodStatus: stored["periodStatus"] as "OPEN" | "CLOSED",
      statementVersion: version,
    });
    return {
      contentType: "application/pdf",
      fileName: `dre-${competence}-${mode.toLowerCase()}.pdf`,
      body,
    };
  }
  async exportar(
    actor: Actor,
    companyId: string,
    query: ExportarDre,
    format: "PDF" | "CSV",
    idempotencyKey: string | undefined,
    correlationId: string,
  ): Promise<DreExport> {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey))
      throw error(
        CODIGOS_DE_ERRO.STATEMENT_EXPORT_KEY_REUSED,
        "Informe Idempotency-Key válida.",
      );
    const result = await this.contexto(actor, async (client) => {
      await this.lock(client, actor, companyId);
      const existing = await client.query<{
        requestHash: string;
        canonicalResult: Record<string, unknown>;
        format: "PDF" | "CSV";
      }>(
        `select request_hash as "requestHash",canonical_result as "canonicalResult",format from app.accounting_statement_export where tenant_id=$1 and company_id=$2 and idempotency_key=$3`,
        [actor.tenantId, companyId, idempotencyKey],
      );
      const requestHash = sha({ companyId, query });
      if (existing.rows[0]) {
        if (
          existing.rows[0].requestHash.trim() !== requestHash ||
          existing.rows[0].format !== format
        )
          throw new ErroDeConflito(
            CODIGOS_DE_ERRO.STATEMENT_EXPORT_KEY_REUSED,
            "Chave idempotente já usada para outro conteúdo.",
          );
        await this.event(
          client,
          actor,
          companyId,
          null,
          "EXPORT_REPLAYED",
          "SUCESSO",
          correlationId,
          { format, idempotencyKey },
          query.competence,
          query.periodMode,
          (existing.rows[0].canonicalResult["report"] as RelatorioDre).hash,
        );
        return { canonical: existing.rows[0].canonicalResult };
      }
      const assembled = await this.report(client, actor, companyId, {
        ...query,
        viewMode: "ANALYTIC",
      });
      if (assembled.report.status === "INCOMPLETE") {
        await this.event(
          client,
          actor,
          companyId,
          assembled.version.id,
          "EXPORT_REJECTED",
          "RECUSADO",
          correlationId,
          {
            unmappedAccountIds: assembled.report.unmappedAccounts.map(
              (account) => account.accountId,
            ),
          },
          query.competence,
          query.periodMode,
          assembled.report.hash,
        );
        return { blocked: true as const };
      }
      const company = await client.query<{ name: string; cnpj: string }>(
        `select razao_social as name,cnpj from app.empresa where tenant_id=$1 and id=$2`,
        [actor.tenantId, companyId],
      );
      const user = await client.query<{ name: string }>(
        `select nome as name from app.usuario where tenant_id=$1 and id=$2`,
        [actor.tenantId, actor.usuarioId],
      );
      const canonical = {
        report: assembled.report,
        companyId,
        companyName: company.rows[0]?.name ?? "Empresa",
        cnpj: company.rows[0]?.cnpj ?? "",
        actorName: user.rows[0]?.name ?? "Usuário",
        generatedAt: new Date().toISOString(),
        competence: query.competence,
        periodMode: query.periodMode,
        periodStatus: assembled.status,
        statementVersion: assembled.version.version,
      };
      await client.query(
        `insert into app.accounting_statement_export(tenant_id,company_id,version_id,competence,period_mode,format,idempotency_key,request_hash,report_hash,canonical_result,actor_id,correlation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [
          actor.tenantId,
          companyId,
          assembled.version.id,
          query.competence,
          query.periodMode,
          format,
          idempotencyKey,
          requestHash,
          assembled.report.hash,
          json(canonical),
          actor.usuarioId,
          correlationId,
        ],
      );
      await this.event(
        client,
        actor,
        companyId,
        assembled.version.id,
        "EXPORT_CREATED",
        "SUCESSO",
        correlationId,
        { format, idempotencyKey },
        query.competence,
        query.periodMode,
        assembled.report.hash,
      );
      return { canonical };
    });
    if ("blocked" in result)
      throw error(
        CODIGOS_DE_ERRO.STATEMENT_COVERAGE_INCOMPLETE,
        "Cobertura incompleta: vincule todas as contas movimentadas antes de exportar.",
      );
    return this.gerarArquivo(format, result.canonical);
  }
}
