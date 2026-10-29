import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, openingMovementDate, validarCabecalhoContabil, validarPartidasContabeis, type PartidaContabil } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';
import { RazaoContabilService } from '../razao-contabil/razao-contabil.service';

export type AtorLancamento = Readonly<{ tenantId: string; usuarioId: string }>;
export type DadosRascunho = Readonly<{ version?: number | undefined; accountingDate: string; competence: string; history: string; externalReference: string | null; lines: readonly (Omit<PartidaContabil, 'lineId'> & { lineId?: string | undefined })[] }>;
const erro = (code: string, message: string): ErroDeDominio => new ErroDeDominio(code as never, message);

@Injectable()
export class LancamentosContabeisService {
  constructor(private readonly pool: PoolDoBanco, private readonly razao: RazaoContabilService) {}
  private contexto<T>(a: AtorLancamento, fn: (c: PoolClient) => Promise<T>) { return comContextoHumano(this.pool.instancia, a, fn); }
  private validar(d: DadosRascunho, efetivar: boolean) {
    const errors = [...validarCabecalhoContabil(d), ...validarPartidasContabeis(d.lines as readonly PartidaContabil[], efetivar)];
    if (errors.length) throw new ErroDeDominio(errors[0]!.code as never, errors.map((e) => e.message).join(' '), errors.map((e) => ({ campo: e.field, codigo: e.code as never })));
  }
  private async exigirCompetenciaAberta(c: PoolClient, a: AtorLancamento, companyId: string, competence: string): Promise<void> {
    await c.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`${a.tenantId}:${companyId}:accounting-period:ledger`]);
    const opening=await c.query<{baseDate:string}>(`select base_date::text as "baseDate" from app.opening_balance_version where tenant_id=$1 and empresa_id=$2 and status='APPROVED'`,[a.tenantId,companyId]);
    if(opening.rows[0]&&competence<openingMovementDate(opening.rows[0].baseDate).competence) throw erro(CODIGOS_DE_ERRO.OPENING_BALANCE_MOVEMENT_EXISTS,'Movimentos operacionais devem começar após a data-base da abertura.');
    const cycle = await c.query(`select status from app.accounting_period_cycle where tenant_id=$1 and company_id=$2 and competence=$3`, [a.tenantId,companyId,competence]);
    if (cycle.rows[0]?.status === 'CLOSED') throw erro('ACCOUNTING_PERIOD_ALREADY_CLOSED', 'Competência fechada aceita somente estorno.');
  }
  private async gravarEvento(c: PoolClient, a: AtorLancamento, companyId: string, id: string, action: string, previous: string | null, next: string | null, corr: string, number: number | null = null, reason: string | null = null): Promise<string> {
    const { rows } = await c.query<{ id: string }>(`insert into app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,numero,motivo,usuario_id,correlation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [a.tenantId, companyId, id, action, previous, next, number, reason, a.usuarioId, corr]);
    return rows[0]!.id;
  }
  private async gravarPartidas(c: PoolClient, a: AtorLancamento, companyId: string, id: string, lines: DadosRascunho['lines']) {
    for (const [position, line] of lines.entries()) await c.query(`insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,centro_custo_id,lado,valor_centavos,complemento,posicao) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [a.tenantId, companyId, id, line.accountId, line.costCenterId, line.side, line.amountCents, line.memo, position]);
  }
  async listar(a: AtorLancamento, companyId: string, competence?: string, status?: string, limit = 50) {
    return this.contexto(a, async (c) => {
      const { rows } = await c.query(`select e.id as "entryId",e.tenant_id as "tenantId",e.empresa_id as "companyId",e.exercicio as "fiscalYear",e.numero as "entryNumber",e.data_contabil as "accountingDate",e.competencia as competence,e.historico as history,e.referencia_externa as "externalReference",e.estado as status,e.estorno_de_id as "reversalOfEntryId",e.versao as version,coalesce(sum(p.valor_centavos) filter(where p.lado='DEBIT'),0)::text as "debitCents",coalesce(sum(p.valor_centavos) filter(where p.lado='CREDIT'),0)::text as "creditCents" from app.lancamento_contabil e left join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa where e.empresa_id=$1 and ($2::text is null or e.competencia=$2) and ($3::text is null or e.estado=$3) group by e.id order by e.exercicio desc,e.numero desc nulls last,e.id limit $4`, [companyId, competence ?? null, status ?? null, limit]);
      return rows;
    });
  }
  async efetivar(a: AtorLancamento, companyId: string, id: string, version: number, corr: string) {
    return this.contexto(a, async (c) => {
      const scope = await c.query<{ competence: string }>(`select competencia as competence from app.lancamento_contabil where id=$1 and empresa_id=$2`, [id,companyId]);
      if (scope.rows[0]) await this.exigirCompetenciaAberta(c,a,companyId,scope.rows[0].competence);
      const { rows } = await c.query(`select * from app.lancamento_contabil where id=$1 and empresa_id=$2 and estado='DRAFT' for update`, [id, companyId]);
      const entry = rows[0]; if (!entry || Number(entry.versao) !== version) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_VERSION_CONFLICT, 'Rascunho não encontrado ou alterado.');
      const lines = await c.query(`select p.id as "lineId",p.conta_id as "accountId",p.centro_custo_id as "costCenterId",p.lado as side,p.valor_centavos::text as "amountCents",p.complemento as memo,p.posicao as position,cc.tipo as "accountType",cc.classe_contabil as "accountClass",cc.politica_centro_custo as "costCenterPolicy",cc.arquivada as "accountArchived",ct.tipo as "costCenterType",ct.arquivada as "costCenterArchived" from app.lancamento_contabil_partida p join app.conta_contabil cc on cc.id=p.conta_id and cc.empresa_id=p.empresa_id left join app.centro_custo ct on ct.id=p.centro_custo_id and ct.empresa_id=p.empresa_id where p.lancamento_id=$1 and p.empresa_id=$2 and p.ativa order by p.posicao`, [id, companyId]);
      const d = { accountingDate: new Date(entry.data_contabil).toISOString().slice(0, 10), competence: entry.competencia as string, history: entry.historico as string, externalReference: entry.referencia_externa as string | null, lines: lines.rows.map(l=>({...l,amountCents:Number(l.amountCents)})) as (PartidaContabil & {accountType:string;accountClass:string|null;costCenterPolicy:string|null;accountArchived:boolean;costCenterType:string|null;costCenterArchived:boolean|null})[] };
      this.validar(d, true);
      for (const l of d.lines) { if (l.accountType !== 'analitica' || l.accountArchived || !l.accountClass || !l.costCenterPolicy) throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_ACCOUNT_INVALID, 'A conta precisa ser analítica, completa e ativa.'); if (l.costCenterPolicy === 'REQUIRED' && !l.costCenterId) throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_COST_CENTER_REQUIRED, 'Esta conta exige centro de custo.'); if (l.costCenterPolicy === 'FORBIDDEN' && l.costCenterId) throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_COST_CENTER_FORBIDDEN, 'Esta conta não aceita centro de custo.'); if (l.costCenterId && (l.costCenterType !== 'analitica' || l.costCenterArchived)) throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_COST_CENTER_INVALID, 'O centro precisa ser analítico e ativo.'); }
      const year = Number(d.accountingDate.slice(0, 4)); const seq = await c.query(`insert into app.lancamento_contabil_sequencia(tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,$3,1) on conflict(tenant_id,empresa_id,exercicio) do update set ultimo_numero=app.lancamento_contabil_sequencia.ultimo_numero+1 returning ultimo_numero`, [a.tenantId, companyId, year]); const number = Number(seq.rows[0]!.ultimo_numero);
      await c.query(`select set_config('app.lancamento_contabil_transicao','true',true)`); await c.query(`update app.lancamento_contabil set estado='POSTED',numero=$1,efetivado_por=$2 where id=$3`, [number, a.usuarioId, id]);
      const eventId = await this.gravarEvento(c, a, companyId, id, 'EFETIVADO', 'DRAFT', 'POSTED', corr, number);
      await this.razao.projetarEfetivacao(c, a, companyId, id, eventId, corr);
      return {entryId:id,status:'POSTED',entryNumber:number};
    });
  }
  async detalhe(a: AtorLancamento, companyId: string, id: string) {
    return this.contexto(a, async (c) => {
      const { rows } = await c.query(`select id as "entryId",tenant_id as "tenantId",empresa_id as "companyId",exercicio as "fiscalYear",numero as "entryNumber",data_contabil as "accountingDate",competencia as competence,historico as history,referencia_externa as "externalReference",estado as status,estorno_de_id as "reversalOfEntryId",versao as version,criado_por as "createdBy",efetivado_por as "postedBy" from app.lancamento_contabil where empresa_id=$1 and id=$2`, [companyId, id]);
      if (!rows[0]) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Lançamento não encontrado.');
      const lines = await c.query(`select id as "lineId",conta_id as "accountId",centro_custo_id as "costCenterId",lado as side,valor_centavos::text as "amountCents",complemento as memo,posicao as position from app.lancamento_contabil_partida where empresa_id=$1 and lancamento_id=$2 and ativa order by posicao`, [companyId, id]);
      const events = await c.query(`select id,acao as action,estado_anterior as "previousStatus",estado_novo as "newStatus",numero as "entryNumber",motivo as reason,codigo_erro as code,usuario_id as "actorId",correlation_id as "correlationId",ocorrido_em as "occurredAt" from app.lancamento_contabil_evento where empresa_id=$1 and lancamento_id=$2 order by ocorrido_em,sequencia`, [companyId, id]);
      return { ...rows[0], lines: lines.rows, events: events.rows };
    });
  }
  async criar(a: AtorLancamento, companyId: string, d: DadosRascunho, corr: string) {
    return this.contexto(a, async (c) => {
      await this.exigirCompetenciaAberta(c,a,companyId,d.competence);
      this.validar(d, false);
      const { rows } = await c.query(`insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,referencia_externa,criado_por) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,versao`, [a.tenantId, companyId, Number(d.accountingDate.slice(0, 4)), d.accountingDate, d.competence, d.history.trim(), d.externalReference, a.usuarioId]);
      const id = rows[0]!.id as string; await this.gravarPartidas(c, a, companyId, id, d.lines); await this.gravarEvento(c, a, companyId, id, 'CRIADO', null, 'DRAFT', corr);
      return { entryId: id, version: rows[0]!.versao };
    });
  }
  async editar(a: AtorLancamento, companyId: string, id: string, d: DadosRascunho, corr: string) {
    return this.contexto(a, async (c) => {
      this.validar(d, false); if (!d.version) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_VERSION_CONFLICT, 'Informe a versão do rascunho.');
      const scope = await c.query<{ competence: string }>(`select competencia as competence from app.lancamento_contabil where id=$1 and empresa_id=$2`, [id,companyId]);
      if (scope.rows[0]) await this.exigirCompetenciaAberta(c,a,companyId,scope.rows[0].competence);
      await this.exigirCompetenciaAberta(c,a,companyId,d.competence);
      await c.query(`select id from app.lancamento_contabil where id=$1 and empresa_id=$2 for update`, [id, companyId]);
      const { rows } = await c.query(`update app.lancamento_contabil set data_contabil=$1,competencia=$2,exercicio=$3,historico=$4,referencia_externa=$5,atualizado_em=now() where id=$6 and empresa_id=$7 and estado='DRAFT' and versao=$8 returning versao`, [d.accountingDate, d.competence, Number(d.accountingDate.slice(0, 4)), d.history.trim(), d.externalReference, id, companyId, d.version]);
      if (!rows[0]) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_VERSION_CONFLICT, 'O rascunho mudou. Atualize os dados.');
      await c.query(`update app.lancamento_contabil_partida set ativa=false where lancamento_id=$1 and empresa_id=$2 and ativa`, [id, companyId]); await this.gravarPartidas(c, a, companyId, id, d.lines); await this.gravarEvento(c, a, companyId, id, 'EDITADO', 'DRAFT', 'DRAFT', corr);
      return { entryId: id, version: rows[0]!.versao };
    });
  }
  async descartar(a: AtorLancamento, companyId: string, id: string, reason: string, version: number | undefined, corr: string) {
    return this.contexto(a, async (c) => {
      const scope = await c.query<{ competence: string }>(`select competencia as competence from app.lancamento_contabil where id=$1 and empresa_id=$2`, [id,companyId]);
      if (scope.rows[0]) await this.exigirCompetenciaAberta(c,a,companyId,scope.rows[0].competence);
      await c.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
      const { rows } = await c.query(`update app.lancamento_contabil set estado='DISCARDED',cancelamento_motivo=$1,atualizado_em=now() where id=$2 and empresa_id=$3 and estado='DRAFT' and ($4::int is null or versao=$4) returning numero`, [reason.trim(), id, companyId, version ?? null]);
      if (!rows[0]) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_VERSION_CONFLICT, 'Rascunho não encontrado ou alterado.');
      await this.gravarEvento(c, a, companyId, id, 'DESCARTADO', 'DRAFT', 'DISCARDED', corr, null, reason); return { entryId: id, status: 'DISCARDED' };
    });
  }
  async cancelar(a: AtorLancamento, companyId: string, id: string, reason: string, version: number, corr: string) {
    return this.contexto(a, async (c) => {
      const scope = await c.query<{ competence: string }>(`select competencia as competence from app.lancamento_contabil where id=$1 and empresa_id=$2`, [id,companyId]);
      if (scope.rows[0]) await this.exigirCompetenciaAberta(c,a,companyId,scope.rows[0].competence);
      const { rows } = await c.query(`select estado as status,numero as "entryNumber",versao as version from app.lancamento_contabil where empresa_id=$1 and id=$2 for update`, [companyId, id]);
      const entry = rows[0] as {status:string;entryNumber:number;version:number}|undefined;
      if (!entry || entry.status !== 'POSTED') throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_CANCELLATION_FORBIDDEN, 'Lançamento não pode ser cancelado.');
      if (Number(entry.version)!==version) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_VERSION_CONFLICT,'Lançamento alterado; atualize a tela.');
      // F40 não entrega fechamento nem integrações externas estruturadas; enquanto esses módulos não existirem, o lançamento permanece cancelável.
      await c.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
      await c.query(`update app.lancamento_contabil set estado='CANCELLED',cancelamento_motivo=$1 where id=$2`, [reason.trim(), id]);
      const eventId = await this.gravarEvento(c, a, companyId, id, 'CANCELADO', 'POSTED', 'CANCELLED', corr, entry.entryNumber, reason);
      await this.razao.projetarCancelamento(c, a, companyId, id, eventId, corr);
      return {entryId:id,status:'CANCELLED'};
    });
  }
  async estornar(a: AtorLancamento, companyId: string, id: string, date: string, competence: string, reason: string, corr: string) {
    return this.contexto(a, async (c) => {
      await this.exigirCompetenciaAberta(c,a,companyId,competence);
      const {rows}=await c.query(`select estado as status,numero as "entryNumber",exercicio as "fiscalYear" from app.lancamento_contabil where empresa_id=$1 and id=$2 for update`,[companyId,id]);
      const original=rows[0] as {status:string;entryNumber:number;fiscalYear:number}|undefined;
      if(!original||original.status!=='POSTED')throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_REVERSAL_FORBIDDEN,'Lançamento não pode ser estornado.');
      const old=await c.query(`select conta_id as "accountId",centro_custo_id as "costCenterId",case lado when 'DEBIT' then 'CREDIT' else 'DEBIT' end as side,valor_centavos::text as "amountCents",complemento as memo,posicao as position from app.lancamento_contabil_partida where lancamento_id=$1 and ativa order by posicao`,[id]);
      const history=`Estorno ${original.fiscalYear}/${original.entryNumber}: ${reason.trim()}`; const d={accountingDate:date,competence,history,externalReference:null,lines:old.rows.map(l=>({...l,amountCents:Number(l.amountCents)})) as PartidaContabil[]};this.validar(d,true);
      const year=Number(date.slice(0,4));const seq=await c.query(`insert into app.lancamento_contabil_sequencia(tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,$3,1) on conflict(tenant_id,empresa_id,exercicio) do update set ultimo_numero=app.lancamento_contabil_sequencia.ultimo_numero+1 returning ultimo_numero`,[a.tenantId,companyId,year]);const number=Number(seq.rows[0]!.ultimo_numero);
      const created=await c.query(`insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,estorno_de_id,criado_por) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[a.tenantId,companyId,year,date,competence,history,id,a.usuarioId]);const reversalId=created.rows[0]!.id as string;
      await this.gravarPartidas(c,a,companyId,reversalId,d.lines);await c.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);await c.query(`update app.lancamento_contabil set estado='POSTED',numero=$1,efetivado_por=$2 where id=$3`,[number,a.usuarioId,reversalId]);await c.query(`update app.lancamento_contabil set estado='REVERSED' where id=$1`,[id]);
      const eventId = await this.gravarEvento(c,a,companyId,reversalId,'ESTORNADO',null,'POSTED',corr,number,reason);
      await this.gravarEvento(c,a,companyId,id,'ESTORNADO','POSTED','REVERSED',corr,original.entryNumber,reason);
      await this.razao.projetarEfetivacao(c, a, companyId, reversalId, eventId, corr);
      return{entryId:reversalId,status:'POSTED',entryNumber:number,reversalOfEntryId:id};
    });
  }
}
