import { accountingPeriodGateBlockers, calcularBalancete, CODIGOS_DE_ERRO, ErroDeDominio, hashAccountingClose, previousAccountingCompetence, type AccountingCloseKind, type AccountingCloseSnapshotInput, type AccountingPeriodStatus, type ContaParaBalancete, type MovimentoParaBalancete } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { PoolDoBanco } from '../banco/pool.provider';
import type { ConsultaBalancete, ConsultaRazao } from './razao-contabil.dto';

type AtorRazao = Readonly<{ tenantId: string; usuarioId: string }>;
type VersaoAtiva = Readonly<{ id: string; numero: number; integridade: 'CONSISTENT' | 'INCONSISTENT' }>;
type LinhaFonte = Readonly<{
  entryId: string; lineId: string; competence: string; accountingDate: string; accountId: string; costCenterId: string | null;
  accountCode: string; accountName: string; costCenterCode: string | null; costCenterName: string | null;
  history: string; externalReference: string | null; entryNumber: string; position: number; side: 'DEBIT' | 'CREDIT'; amountCents: string;
}>;
type PeriodCycleRow = Readonly<{ status: AccountingPeriodStatus; activeCloseId: string | null; latestVersion: number }>;

const erro = (codigo: string, mensagem: string): ErroDeDominio => new ErroDeDominio(codigo as never, mensagem);
@Injectable()
export class RazaoContabilService {
  constructor(private readonly pool: PoolDoBanco) {}

  private contexto<T>(ator: AtorRazao, executar: (client: PoolClient) => Promise<T>): Promise<T> {
    return comContextoHumano(this.pool.instancia, ator, executar);
  }

  private async lockAccountingPeriod(client: PoolClient, tenantId: string, companyId: string): Promise<void> {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`${tenantId}:${companyId}:accounting-period:ledger`]);
  }

  private async periodCycle(client: PoolClient, tenantId: string, companyId: string, competence: string): Promise<PeriodCycleRow> {
    await client.query(`insert into app.accounting_period_cycle(tenant_id,company_id,competence,status,latest_version) values($1,$2,$3,'OPEN',0) on conflict(tenant_id,company_id,competence) do nothing`,[tenantId,companyId,competence]);
    const result = await client.query<{ status: AccountingPeriodStatus; activeCloseId: string | null; latestVersion: number }>(
      `select status,active_close_id as "activeCloseId",latest_version as "latestVersion" from app.accounting_period_cycle where tenant_id=$1 and company_id=$2 and competence=$3 for update`, [tenantId,companyId,competence],
    );
    return result.rows[0]!;
  }

  private async closeSnapshot(client: PoolClient, actor: AtorRazao, companyId: string, competence: string, expectedVersion: number, correlationId: string, permissions: readonly string[], idempotencyKey: string, confirmEmpty: boolean): Promise<Readonly<Record<string, unknown>>> {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/u.test(competence)) throw erro('ACCOUNTING_PERIOD_INVALID','Competência contábil inválida.');
    await this.lockAccountingPeriod(client,actor.tenantId,companyId);
    const key = await client.query<{ requestHash: string; response: Record<string, unknown> }>(
      `select request_hash as "requestHash",response from app.accounting_period_idempotency where tenant_id=$1 and company_id=$2 and competence=$3 and operation='CLOSE' and expected_version=$4 and idempotency_key=$5`,
      [actor.tenantId,companyId,competence,expectedVersion,idempotencyKey],
    );
    const keyHash = createHash('sha256').update(JSON.stringify({competence,expectedVersion,confirmEmpty,permissions:[...permissions].sort()})).digest('hex');
    if (key.rows[0]) {
      if (key.rows[0].requestHash !== keyHash) throw erro('ACCOUNTING_PERIOD_CONFLICT','Chave de idempotência reutilizada com outro comando.');
      return key.rows[0].response;
    }
    const cycle = await this.periodCycle(client,actor.tenantId,companyId,competence);
    if (cycle.status === 'CLOSED' || expectedVersion !== cycle.latestVersion) {
      const code=cycle.status==='CLOSED'?'ACCOUNTING_PERIOD_ALREADY_CLOSED':'ACCOUNTING_PERIOD_CONFLICT';
      const response={status:'CONFLICT',code,competence,latestVersion:cycle.latestVersion,correlationId};
      await client.query(`insert into app.accounting_period_event(tenant_id,company_id,competence,action,result,actor_id,correlation_id,operation,expected_version,idempotency_key,blockers) values($1,$2,$3,'CONFLICT','RECUSADO',$4,$5,'CLOSE',$6,$7,$8::jsonb)`,[actor.tenantId,companyId,competence,actor.usuarioId,correlationId,expectedVersion,idempotencyKey,JSON.stringify([code])]);
      await this.saveIdempotency(client,actor,companyId,competence,'CLOSE',expectedVersion,idempotencyKey,keyHash,response); return response;
    }

    const projection = await client.query<{ id: string; version: number; integrity: 'CONSISTENT' | 'INCONSISTENT' }>(
      `select versao_ativa_id as id,numero_versao::int as version,integridade as integrity from app.projecao_razao where tenant_id=$1 and empresa_id=$2 for update`,[actor.tenantId,companyId],
    );
    const initial = await client.query<{ competence: string | null }>(`select to_char(min(to_date(competencia||'-01','YYYY-MM-DD')),'YYYY-MM') as competence from app.movimento_razao where tenant_id=$1 and empresa_id=$2`,[actor.tenantId,companyId]);
    const firstCompetence = initial.rows[0]?.competence;
    if (!firstCompetence || !projection.rows[0]) throw erro('ACCOUNTING_PERIOD_SEQUENCE_GAP','Razão ainda não possui marco inicial conhecido para fechar.');
    const prior = competence <= firstCompetence ? { rows: [{ status: 'CLOSED' }] } : await client.query(
      `select c.status from app.accounting_period_cycle c where c.tenant_id=$1 and c.company_id=$2 and c.competence=$3`,[actor.tenantId,companyId,previousAccountingCompetence(competence)],
    );
    const source = await client.query<{ drafts: string; debit: string; credit: string; movements: string; entries: string; projectionIntegrity: string }>(
      `with source as (select e.id,p.lado,p.valor_centavos from app.lancamento_contabil e join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa where e.tenant_id=$1 and e.empresa_id=$2 and e.competencia=$3 and e.numero is not null and e.estado in ('POSTED','CANCELLED','REVERSED') union all select e.id,case p.lado when 'DEBIT' then 'CREDIT' else 'DEBIT' end,p.valor_centavos from app.lancamento_contabil e join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa where e.tenant_id=$1 and e.empresa_id=$2 and e.competencia=$3 and e.estado='CANCELLED')
       select (select count(*) from app.lancamento_contabil where tenant_id=$1 and empresa_id=$2 and competencia=$3 and estado='DRAFT')::text drafts,
       coalesce((select sum(valor_centavos) from source where lado='DEBIT'),0)::text debit,coalesce((select sum(valor_centavos) from source where lado='CREDIT'),0)::text credit,count(m.id)::text movements,count(distinct m.lancamento_id)::text entries,
       (select integridade from app.projecao_razao where tenant_id=$1 and empresa_id=$2) as "projectionIntegrity"
       from app.movimento_razao m where m.tenant_id=$1 and m.empresa_id=$2 and m.versao_id=$4 and m.competencia=$3`,[actor.tenantId,companyId,competence,projection.rows[0].id],
    );
    const totals=source.rows[0]!;
    const projectionTotals=await client.query<{debit:string;credit:string}>(`select coalesce(sum(valor_centavos) filter(where lado='DEBIT'),0)::text debit,coalesce(sum(valor_centavos) filter(where lado='CREDIT'),0)::text credit from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3 and competencia=$4`,[actor.tenantId,companyId,projection.rows[0].id,competence]);
    const blockers = accountingPeriodGateBlockers({ competence, firstCompetence, previousClosed: prior.rows[0]?.status === 'CLOSED', integrity: totals.projectionIntegrity === 'CONSISTENT' ? projection.rows[0].integrity : 'INCONSISTENT', draftCount:Number(totals.drafts), sourceDebitCents:Number(totals.debit),sourceCreditCents:Number(totals.credit),projectionDebitCents:Number(projectionTotals.rows[0]!.debit),projectionCreditCents:Number(projectionTotals.rows[0]!.credit),movementCount:Number(totals.movements),confirmEmpty });
    if (blockers.length) {
      await client.query(`insert into app.accounting_period_event(tenant_id,company_id,competence,action,result,actor_id,correlation_id,operation,expected_version,idempotency_key,blockers) values($1,$2,$3,'CLOSE_REJECTED','RECUSADO',$4,$5,'CLOSE',$6,$7,$8::jsonb)`,[actor.tenantId,companyId,competence,actor.usuarioId,correlationId,expectedVersion,idempotencyKey,JSON.stringify(blockers)]);
      const response={ status:'BLOCKED',blockers,competence,latestVersion:cycle.latestVersion,correlationId };
      await this.saveIdempotency(client,actor,companyId,competence,'CLOSE',expectedVersion,idempotencyKey,keyHash,response); return response;
    }
    const balances = await this.trialBalanceInTransaction(client,actor.tenantId,companyId,projection.rows[0].id,competence,firstCompetence);
    const closedAt = new Date().toISOString(); const version=cycle.latestVersion+1; const kind:AccountingCloseKind=Number(totals.movements)===0?'EMPTY_CONFIRMED':'REGULAR';
    const snapshot={tenantId:actor.tenantId,companyId,competence,version,ledgerProjectionVersion:projection.rows[0].version,firstCompetence,kind,debitCents:Number(totals.debit),creditCents:Number(totals.credit),movementCount:Number(totals.movements),entryCount:Number(totals.entries),lines:balances.lines,closedBy:actor.usuarioId,closedAt,correlationId,permissions:permissions.filter((permission)=>permission==='contabil.fechamento.consultar'||permission==='contabil.fechamento.fechar_competencia').sort(),emptyConfirmation:confirmEmpty};
    const content=JSON.parse(JSON.stringify(snapshot)) as Record<string,unknown>; const hash=hashAccountingClose(snapshot);
    const close=await client.query<{id:string}>(`insert into app.accounting_period_close(tenant_id,company_id,competence,version,projection_version,kind,debit_cents,credit_cents,movement_count,entry_count,first_competence,content,content_hash,closed_by,closed_at,correlation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) returning id`,[actor.tenantId,companyId,competence,version,projection.rows[0].version,kind,totals.debit,totals.credit,totals.movements,totals.entries,firstCompetence,JSON.stringify(content),hash,actor.usuarioId,closedAt,correlationId]);
    for(const line of balances.lines) await client.query(`insert into app.accounting_period_close_snapshot_line(tenant_id,company_id,close_id,account_id,code,name,account_type,normal_balance,level,parent_account_id,opening_balance_cents,debit_cents,credit_cents,closing_balance_cents,closing_nature,movement_count) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[actor.tenantId,companyId,close.rows[0]!.id,line.accountId,line.code,line.name,line.type,line.normalBalance,line.level,line.parentAccountId,line.openingBalanceCents,line.debitCents,line.creditCents,line.closingBalanceCents,line.closingNature,line.movementCount]);
    await client.query(`update app.accounting_period_cycle set status='CLOSED',active_close_id=$1,latest_version=$2,updated_at=now() where tenant_id=$3 and company_id=$4 and competence=$5 and latest_version=$6`,[close.rows[0]!.id,version,actor.tenantId,companyId,competence,expectedVersion]);
    await client.query(`insert into app.accounting_period_event(tenant_id,company_id,competence,action,result,close_id,version,actor_id,correlation_id,operation,expected_version,idempotency_key,blockers) values($1,$2,$3,'CLOSED','SUCESSO',$4,$5,$6,$7,'CLOSE',$8,$9,'[]'::jsonb)`,[actor.tenantId,companyId,competence,close.rows[0]!.id,version,actor.usuarioId,correlationId,expectedVersion,idempotencyKey]);
    const response={status:'CLOSED',closeId:close.rows[0]!.id,competence,version,projectionVersion:projection.rows[0].version,kind,contentHash:hash,closedAt,correlationId};
    await this.saveIdempotency(client,actor,companyId,competence,'CLOSE',expectedVersion,idempotencyKey,keyHash,response); return response;
  }

  private async saveIdempotency(client:PoolClient,actor:AtorRazao,companyId:string,competence:string,operation:'CLOSE'|'REOPEN',expectedVersion:number,key:string,requestHash:string,response:Readonly<Record<string,unknown>>):Promise<void>{
    await client.query(`insert into app.accounting_period_idempotency(tenant_id,company_id,competence,operation,expected_version,idempotency_key,request_hash,response) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[actor.tenantId,companyId,competence,operation,expectedVersion,key,requestHash,JSON.stringify(response)]);
  }

  private async trialBalanceInTransaction(client:PoolClient,tenantId:string,companyId:string,projectionId:string,competence:string,firstCompetence:string){
    const balances=await client.query<{accountId:string;costCenterId:string|null;competence:string;debitCents:string;creditCents:string;movementCount:string}>(`select conta_id as "accountId",centro_custo_id as "costCenterId",to_char(to_date(competencia||'-01','YYYY-MM-DD'),'YYYY-MM') as "competence",debitos_centavos::text as "debitCents",creditos_centavos::text as "creditCents",movimentos::text as "movementCount" from app.saldo_mensal_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3 and competencia<=$4`,[tenantId,companyId,projectionId,competence]);
    const catalog=await client.query<ContaParaBalancete>(`select child.id as "accountId",child.codigo as code,child.nome as name,parent.id as "parentAccountId",case when child.tipo='analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,case when child.natureza='devedora' then 'DEBIT' else 'CREDIT' end as "normalBalance" from app.conta_contabil child left join app.conta_contabil parent on parent.empresa_id=child.empresa_id and parent.tenant_id=child.tenant_id and parent.codigo=child.conta_pai where child.tenant_id=$1 and child.empresa_id=$2 and not child.arquivada order by child.codigo`,[tenantId,companyId]);
    const movements:MovimentoParaBalancete[]=balances.rows.flatMap((row)=>{const out:MovimentoParaBalancete[]=[]; const d=Number(row.debitCents);const c=Number(row.creditCents);if(d>0)out.push({accountId:row.accountId,costCenterId:row.costCenterId,competence:row.competence,side:'DEBIT',amountCents:d});if(c>0)out.push({accountId:row.accountId,costCenterId:row.costCenterId,competence:row.competence,side:'CREDIT',amountCents:c});return out;});
    return calcularBalancete(movements,catalog.rows,firstCompetence,competence,{tipo:'TODOS'},true);
  }

  async fecharCompetencia(actor:AtorRazao,companyId:string,competence:string,expectedVersion:number,idempotencyKey:string,confirmEmpty:boolean,permissions:readonly string[],correlationId:string){
    return this.contexto(actor,(client)=>this.closeSnapshot(client,actor,companyId,competence,expectedVersion,correlationId,permissions,idempotencyKey,confirmEmpty));
  }

  async reabrirCompetencia(actor:AtorRazao,companyId:string,competence:string,expectedVersion:number,idempotencyKey:string,reason:string,permissions:readonly string[],correlationId:string){
    return this.contexto(actor,async(client)=>{
      await this.lockAccountingPeriod(client,actor.tenantId,companyId);
      const keyHash=createHash('sha256').update(JSON.stringify({competence,expectedVersion,reason:reason.trim(),permissions:[...permissions].sort()})).digest('hex');
      const key=await client.query<{requestHash:string;response:Record<string,unknown>}>(`select request_hash as "requestHash",response from app.accounting_period_idempotency where tenant_id=$1 and company_id=$2 and competence=$3 and operation='REOPEN' and expected_version=$4 and idempotency_key=$5`,[actor.tenantId,companyId,competence,expectedVersion,idempotencyKey]);
      if(key.rows[0]){if(key.rows[0].requestHash!==keyHash)throw erro('ACCOUNTING_PERIOD_CONFLICT','Chave de idempotência reutilizada com outro comando.');return key.rows[0].response;}
      if(!reason.trim()) throw erro('ACCOUNTING_REOPEN_REASON_REQUIRED','Motivo da reabertura é obrigatório.');
      const cycle=await this.periodCycle(client,actor.tenantId,companyId,competence);
      if(cycle.status!=='CLOSED'||!cycle.activeCloseId||expectedVersion!==cycle.latestVersion){
        const code='ACCOUNTING_PERIOD_CONFLICT';const response={status:'CONFLICT',code,competence,latestVersion:cycle.latestVersion,correlationId};
        await client.query(`insert into app.accounting_period_event(tenant_id,company_id,competence,action,result,actor_id,reason,blockers,correlation_id,operation,expected_version,idempotency_key) values($1,$2,$3,'CONFLICT','RECUSADO',$4,$5,$6::jsonb,$7,'REOPEN',$8,$9)`,[actor.tenantId,companyId,competence,actor.usuarioId,reason.trim()||null,JSON.stringify([code]),correlationId,expectedVersion,idempotencyKey]);
        await this.saveIdempotency(client,actor,companyId,competence,'REOPEN',expectedVersion,idempotencyKey,keyHash,response);return response;
      }
      const later=await client.query(`select 1 from app.accounting_period_cycle where tenant_id=$1 and company_id=$2 and competence>$3 and status='CLOSED' limit 1`,[actor.tenantId,companyId,competence]);
      if(later.rowCount){const code='ACCOUNTING_PERIOD_LATER_CLOSE_EXISTS';const response={status:'BLOCKED',code,competence,latestVersion:cycle.latestVersion,correlationId};await client.query(`insert into app.accounting_period_event(tenant_id,company_id,competence,action,result,actor_id,reason,blockers,correlation_id,operation,expected_version,idempotency_key) values($1,$2,$3,'REOPEN_REJECTED','RECUSADO',$4,$5,$6::jsonb,$7,'REOPEN',$8,$9)`,[actor.tenantId,companyId,competence,actor.usuarioId,reason.trim(),JSON.stringify([code]),correlationId,expectedVersion,idempotencyKey]);await this.saveIdempotency(client,actor,companyId,competence,'REOPEN',expectedVersion,idempotencyKey,keyHash,response);return response;}
      await client.query(`update app.accounting_period_cycle set status='REOPENED',active_close_id=null,updated_at=now() where tenant_id=$1 and company_id=$2 and competence=$3 and latest_version=$4`,[actor.tenantId,companyId,competence,expectedVersion]);
      await client.query(`insert into app.accounting_period_event(tenant_id,company_id,competence,action,result,close_id,version,actor_id,reason,correlation_id,operation,expected_version,idempotency_key) values($1,$2,$3,'REOPENED','SUCESSO',$4,$5,$6,$7,$8,'REOPEN',$9,$10)`,[actor.tenantId,companyId,competence,cycle.activeCloseId,cycle.latestVersion,actor.usuarioId,reason.trim(),correlationId,expectedVersion,idempotencyKey]);
      const response={status:'REOPENED',competence,version:cycle.latestVersion,closeId:cycle.activeCloseId,reason:reason.trim(),correlationId};
      await this.saveIdempotency(client,actor,companyId,competence,'REOPEN',expectedVersion,idempotencyKey,keyHash,response);return response;
    });
  }

  async consultarFechamentos(actor:AtorRazao,companyId:string,from:string,to:string,correlationId:string){
    return this.contexto(actor,async(client)=>{
      if(from>to)throw erro('ACCOUNTING_PERIOD_INVALID','Competência inicial posterior à final.');
      const cycles=await client.query(`with months as(select to_char(g,'YYYY-MM') competence from generate_series(to_date($3||'-01','YYYY-MM-DD'),to_date($4||'-01','YYYY-MM-DD'),interval '1 month') g) select m.competence,coalesce(c.status,'OPEN') status,c.active_close_id as "activeCloseId",coalesce(c.latest_version,0) as "latestVersion" from months m left join app.accounting_period_cycle c on c.tenant_id=$1 and c.company_id=$2 and c.competence=m.competence order by m.competence`,[actor.tenantId,companyId,from,to]);
      const closes=await client.query(`select c.id as "closeId",c.competence,c.version,c.projection_version as "projectionVersion",c.kind,c.debit_cents::text as "debitCents",c.credit_cents::text as "creditCents",c.movement_count::text as "movementCount",c.entry_count::text as "entryCount",c.first_competence as "firstCompetence",c.content_hash as "contentHash",c.closed_by as "closedBy",c.closed_at as "closedAt",c.correlation_id as "correlationId",c.content,c.created_at as "createdAt",u.nome as "closedByName",cy.status as "cycleStatus" from app.accounting_period_close c join app.accounting_period_cycle cy on cy.tenant_id=c.tenant_id and cy.company_id=c.company_id and cy.competence=c.competence left join app.usuario u on u.id=c.closed_by where c.tenant_id=$1 and c.company_id=$2 and c.competence between $3 and $4 order by c.competence,c.version desc`,[actor.tenantId,companyId,from,to]);
      for(const close of closes.rows as Array<Record<string,unknown>>){const stored=close['content'] as AccountingCloseSnapshotInput;const content={...stored,closedAt:new Date(String(stored.closedAt)).toISOString()};let snapshotValid=false;try{snapshotValid=hashAccountingClose(content)===String(close['contentHash']).trim();}catch{snapshotValid=false;}close['snapshotValid']=snapshotValid;}
      const events=await client.query(`select e.competence,e.action,e.result,e.version,e.reason,e.blockers,e.actor_id as "actorId",u.nome as "actorName",e.correlation_id as "correlationId",e.occurred_at as "occurredAt" from app.accounting_period_event e left join app.usuario u on u.id=e.actor_id where e.tenant_id=$1 and e.company_id=$2 and e.competence between $3 and $4 order by e.competence,e.occurred_at,e.id`,[actor.tenantId,companyId,from,to]);
      return {cycles:cycles.rows,closes:closes.rows,events:events.rows,correlationId};
    });
  }

  private async evento(client: PoolClient, actor: AtorRazao, companyId: string, versionId: string | null, action: string, result: string, correlationId: string, details: unknown): Promise<void> {
    await client.query(
      `insert into app.evento_razao(tenant_id,empresa_id,versao_id,acao,resultado,usuario_id,correlation_id,detalhes)
       values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [actor.tenantId, companyId, versionId, action, result, actor.usuarioId, correlationId, JSON.stringify(details)],
    );
  }

  private async criarVersao(client: PoolClient, actor: AtorRazao, companyId: string, number: number, correlationId: string, state: 'BUILDING' | 'ACTIVE' = 'BUILDING'): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into app.projecao_razao_versao(tenant_id,empresa_id,numero,estado,criado_por,correlation_id,ativado_em)
       values($1,$2,$3,$4,$5,$6,case when $4='ACTIVE' then now() else null end) returning id`,
      [actor.tenantId, companyId, number, state, actor.usuarioId, correlationId],
    );
    return rows[0]!.id;
  }

  private async construirVersao(client: PoolClient, tenantId: string, companyId: string, versionId: string): Promise<number> {
    const posts = await client.query(
      `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,evento_origem_id,competencia,data_contabil,conta_id,centro_custo_id,codigo_conta,nome_conta,codigo_centro,nome_centro,historico,referencia_externa,numero_lancamento,posicao,lado,valor_centavos,tipo)
       select e.tenant_id,e.empresa_id,$3,e.id,p.id,ev.id,e.competencia,e.data_contabil,p.conta_id,p.centro_custo_id,cc.codigo,cc.nome,ct.codigo,ct.nome,e.historico,e.referencia_externa,e.numero,p.posicao,p.lado,p.valor_centavos,'POSTING'
       from app.lancamento_contabil e
       join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa
       join app.conta_contabil cc on cc.id=p.conta_id and cc.empresa_id=p.empresa_id and cc.tenant_id=p.tenant_id
       left join app.centro_custo ct on ct.id=p.centro_custo_id and ct.empresa_id=p.empresa_id and ct.tenant_id=p.tenant_id
       join lateral (select id from app.lancamento_contabil_evento where tenant_id=e.tenant_id and empresa_id=e.empresa_id and lancamento_id=e.id and estado_novo='POSTED' and acao in ('EFETIVADO','ESTORNADO') order by ocorrido_em,sequencia limit 1) ev on true
       where e.tenant_id=$1 and e.empresa_id=$2 and e.numero is not null and e.estado in ('POSTED','CANCELLED','REVERSED')
       on conflict do nothing`, [tenantId, companyId, versionId],
    );
    await client.query(
      `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,ajuste_de_id,evento_origem_id,competencia,data_contabil,conta_id,centro_custo_id,codigo_conta,nome_conta,codigo_centro,nome_centro,historico,referencia_externa,numero_lancamento,posicao,lado,valor_centavos,tipo)
       select m.tenant_id,m.empresa_id,$3,m.lancamento_id,m.partida_id,m.id,ev.id,m.competencia,m.data_contabil,m.conta_id,m.centro_custo_id,m.codigo_conta,m.nome_conta,m.codigo_centro,m.nome_centro,m.historico,m.referencia_externa,m.numero_lancamento,m.posicao,case m.lado when 'DEBIT' then 'CREDIT' else 'DEBIT' end,m.valor_centavos,'CANCELLATION_ADJUSTMENT'
       from app.movimento_razao m
       join app.lancamento_contabil e on e.id=m.lancamento_id and e.tenant_id=m.tenant_id and e.empresa_id=m.empresa_id and e.estado='CANCELLED'
       join app.lancamento_contabil_evento ev on ev.lancamento_id=e.id and ev.tenant_id=e.tenant_id and ev.empresa_id=e.empresa_id and ev.acao='CANCELADO'
       where m.tenant_id=$1 and m.empresa_id=$2 and m.versao_id=$3 and m.tipo='POSTING'
       on conflict do nothing`, [tenantId, companyId, versionId],
    );
    await client.query(
      `insert into app.saldo_mensal_razao(tenant_id,empresa_id,versao_id,competencia,conta_id,centro_custo_id,debitos_centavos,creditos_centavos,movimentos)
       select tenant_id,empresa_id,versao_id,competencia,conta_id,centro_custo_id,
         coalesce(sum(valor_centavos) filter(where lado='DEBIT'),0),coalesce(sum(valor_centavos) filter(where lado='CREDIT'),0),count(*)
       from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3
       group by tenant_id,empresa_id,versao_id,competencia,conta_id,centro_custo_id`, [tenantId, companyId, versionId],
    );
    return posts.rowCount ?? 0;
  }

  private async versaoAtiva(client: PoolClient, actor: AtorRazao, companyId: string, correlationId: string): Promise<VersaoAtiva> {
    await this.lockAccountingPeriod(client,actor.tenantId,companyId);
    const current = await client.query<{ id: string; numero: string; integridade: 'CONSISTENT' | 'INCONSISTENT' }>(
      `select v.id,p.numero_versao::text as numero,p.integridade from app.projecao_razao p
       join app.projecao_razao_versao v on v.id=p.versao_ativa_id and v.tenant_id=p.tenant_id and v.empresa_id=p.empresa_id
       where p.tenant_id=$1 and p.empresa_id=$2 for update of p`, [actor.tenantId, companyId],
    );
    if (current.rows[0]) return { id: current.rows[0].id, numero: Number(current.rows[0].numero), integridade: current.rows[0].integridade };

    const id = await this.criarVersao(client, actor, companyId, 1, correlationId);
    const count = await this.construirVersao(client, actor.tenantId, companyId, id);
    await client.query(`update app.projecao_razao_versao set estado='ACTIVE',ativado_em=now() where id=$1`, [id]);
    await client.query(
      `insert into app.projecao_razao(tenant_id,empresa_id,versao_ativa_id,numero_versao,integridade,reconstrucao_em)
       values($1,$2,$3,1,'CONSISTENT',now())`, [actor.tenantId, companyId, id],
    );
    await this.evento(client, actor, companyId, id, 'RECONSTRUCAO_ATIVADA', 'SUCESSO', correlationId, { movimentos: count, inicial: true });
    return { id, numero: 1, integridade: 'CONSISTENT' };
  }

  private async aplicarSaldo(client: PoolClient, tenantId: string, companyId: string, versionId: string, movement: Pick<LinhaFonte, 'competence' | 'accountId' | 'costCenterId' | 'side' | 'amountCents'>): Promise<void> {
    const debits = movement.side === 'DEBIT' ? movement.amountCents : '0';
    const credits = movement.side === 'CREDIT' ? movement.amountCents : '0';
    const updated = await client.query(
      `update app.saldo_mensal_razao set debitos_centavos=debitos_centavos+$1::bigint,creditos_centavos=creditos_centavos+$2::bigint,movimentos=movimentos+1,atualizado_em=now()
       where tenant_id=$3 and empresa_id=$4 and versao_id=$5 and competencia=$6 and conta_id=$7 and centro_custo_id is not distinct from $8::uuid`,
      [debits, credits, tenantId, companyId, versionId, movement.competence, movement.accountId, movement.costCenterId],
    );
    if ((updated.rowCount ?? 0) === 0) await client.query(
      `insert into app.saldo_mensal_razao(tenant_id,empresa_id,versao_id,competencia,conta_id,centro_custo_id,debitos_centavos,creditos_centavos,movimentos)
       values($1,$2,$3,$4,$5,$6,$7,$8,1)`,
      [tenantId, companyId, versionId, movement.competence, movement.accountId, movement.costCenterId, debits, credits],
    );
  }

  async projetarEfetivacao(client: PoolClient, actor: AtorRazao, companyId: string, entryId: string, sourceEventId: string, correlationId: string): Promise<void> {
    const version = await this.versaoAtiva(client, actor, companyId, correlationId);
    const { rows } = await client.query<LinhaFonte>(
      `select e.id as "entryId",p.id as "lineId",e.competencia as competence,e.data_contabil::text as "accountingDate",p.conta_id as "accountId",p.centro_custo_id as "costCenterId",
       cc.codigo as "accountCode",cc.nome as "accountName",ct.codigo as "costCenterCode",ct.nome as "costCenterName",e.historico as history,e.referencia_externa as "externalReference",e.numero::text as "entryNumber",p.posicao as position,p.lado as side,p.valor_centavos::text as "amountCents"
       from app.lancamento_contabil e join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa
       join app.conta_contabil cc on cc.id=p.conta_id and cc.empresa_id=p.empresa_id and cc.tenant_id=p.tenant_id
       left join app.centro_custo ct on ct.id=p.centro_custo_id and ct.empresa_id=p.empresa_id and ct.tenant_id=p.tenant_id
       where e.tenant_id=$1 and e.empresa_id=$2 and e.id=$3 and e.estado in ('POSTED','REVERSED') order by p.posicao`,
      [actor.tenantId, companyId, entryId],
    );
    if (rows.length === 0) throw erro(CODIGOS_DE_ERRO.ACCOUNTING_ENTRY_ACCOUNT_INVALID, 'Partidas efetivadas não encontradas para projetar o razão.');
    let created = 0;
    for (const row of rows) {
      const inserted = await client.query(
        `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,evento_origem_id,competencia,data_contabil,conta_id,centro_custo_id,codigo_conta,nome_conta,codigo_centro,nome_centro,historico,referencia_externa,numero_lancamento,posicao,lado,valor_centavos,tipo)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'POSTING') on conflict do nothing returning id`,
        [actor.tenantId, companyId, version.id, row.entryId, row.lineId, sourceEventId, row.competence, row.accountingDate, row.accountId, row.costCenterId, row.accountCode, row.accountName, row.costCenterCode, row.costCenterName, row.history, row.externalReference, row.entryNumber, row.position, row.side, row.amountCents],
      );
      if (inserted.rowCount) { await this.aplicarSaldo(client, actor.tenantId, companyId, version.id, row); created += 1; }
    }
    await this.evento(client, actor, companyId, version.id, 'MOVIMENTO_CRIADO', 'SUCESSO', correlationId, { lancamentoId: entryId, quantidade: created, versao: version.numero });
  }

  async projetarCancelamento(client: PoolClient, actor: AtorRazao, companyId: string, entryId: string, cancellationEventId: string, correlationId: string): Promise<void> {
    const version = await this.versaoAtiva(client, actor, companyId, correlationId);
    const { rows } = await client.query<LinhaFonte & { movementId: string }>(
      `select id as "movementId",lancamento_id as "entryId",partida_id as "lineId",competencia as competence,data_contabil::text as "accountingDate",conta_id as "accountId",centro_custo_id as "costCenterId",codigo_conta as "accountCode",nome_conta as "accountName",codigo_centro as "costCenterCode",nome_centro as "costCenterName",historico as history,referencia_externa as "externalReference",numero_lancamento::text as "entryNumber",posicao as position,case lado when 'DEBIT' then 'CREDIT' else 'DEBIT' end as side,valor_centavos::text as "amountCents"
       from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3 and lancamento_id=$4 and tipo='POSTING' order by posicao`,
      [actor.tenantId, companyId, version.id, entryId],
    );
    if (rows.length === 0) throw erro('LEDGER_SOURCE_INVALID', 'Movimentos originais do lançamento não encontrados.');
    let created = 0;
    for (const row of rows) {
      const inserted = await client.query(
        `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,ajuste_de_id,evento_origem_id,competencia,data_contabil,conta_id,centro_custo_id,codigo_conta,nome_conta,codigo_centro,nome_centro,historico,referencia_externa,numero_lancamento,posicao,lado,valor_centavos,tipo)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'CANCELLATION_ADJUSTMENT') on conflict do nothing returning id`,
        [actor.tenantId, companyId, version.id, row.entryId, row.lineId, row.movementId, cancellationEventId, row.competence, row.accountingDate, row.accountId, row.costCenterId, row.accountCode, row.accountName, row.costCenterCode, row.costCenterName, row.history, row.externalReference, row.entryNumber, row.position, row.side, row.amountCents],
      );
      if (inserted.rowCount) { await this.aplicarSaldo(client, actor.tenantId, companyId, version.id, row); created += 1; }
    }
    await this.evento(client, actor, companyId, version.id, 'AJUSTE_CRIADO', 'SUCESSO', correlationId, { lancamentoId: entryId, quantidade: created, versao: version.numero });
  }

  async listar(actor: AtorRazao, companyId: string, query: ConsultaRazao, correlationId: string) {
    return this.contexto(actor, async (client) => {
      const version = await this.versaoAtiva(client, actor, companyId, correlationId);
      if (query.de > query.ate) throw erro('LEDGER_PERIOD_INVALID', 'Competência inicial não pode ser posterior à final.');
      const { rows } = await client.query(
        `select m.id as "movementId",m.data_contabil::text as "accountingDate",m.competencia as competence,m.numero_lancamento::text as "entryNumber",m.conta_id as "accountId",m.codigo_conta as "accountCode",m.nome_conta as "accountName",m.centro_custo_id as "costCenterId",m.codigo_centro as "costCenterCode",m.nome_centro as "costCenterName",m.historico as history,m.referencia_externa as "externalReference",m.lado as side,m.valor_centavos::text as "amountCents",m.tipo as kind,m.lancamento_id as "entryId",m.partida_id as "entryLineId",m.ajuste_de_id as "adjustmentOfMovementId",m.posicao as position
         from app.movimento_razao m where m.tenant_id=$1 and m.empresa_id=$2 and m.versao_id=$3 and m.competencia between $4 and $5
           and ($6::uuid is null or m.conta_id=$6) and ($7::text is null or m.lado=$7)
           and ($8::text='todos' or ($8::text='sem-centro' and m.centro_custo_id is null) or ($8::text is null and true) or m.centro_custo_id=$9::uuid)
           and ($10::text is null or concat_ws(' ',m.historico,m.referencia_externa,m.codigo_conta,m.nome_conta,m.numero_lancamento::text) ilike '%'||$10||'%')
         order by m.data_contabil,m.numero_lancamento,m.posicao,m.id limit $11 offset $12`,
        [actor.tenantId, companyId, version.id, query.de, query.ate, query.contaId ?? null, query.lado ?? null, query.centroId ?? null, query.centroId && !['todos','sem-centro'].includes(query.centroId) ? query.centroId : null, query.busca?.trim() || null, query.limite + 1, (query.pagina - 1) * query.limite],
      );
      const initial = await client.query<{ competence: string | null }>(`select min(competencia) as competence from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3`, [actor.tenantId, companyId, version.id]);
      return { items: rows.slice(0, query.limite), hasMore: rows.length > query.limite, page: query.pagina, pageSize: query.limite, firstCompetence: initial.rows[0]?.competence ?? null, projectionVersion: version.numero, integrity: version.integridade };
    });
  }

  async balancete(actor: AtorRazao, companyId: string, query: ConsultaBalancete, correlationId: string) {
    return this.contexto(actor, async (client) => {
      const version = await this.versaoAtiva(client, actor, companyId, correlationId);
      if (query.de > query.ate) throw erro('LEDGER_PERIOD_INVALID', 'Competência inicial não pode ser posterior à final.');
      const balances = await client.query<{ accountId: string; costCenterId: string | null; competence: string; debitCents: string; creditCents: string; movementCount: string }>(
        `select conta_id as "accountId",centro_custo_id as "costCenterId",competencia as competence,debitos_centavos::text as "debitCents",creditos_centavos::text as "creditCents",movimentos::text as "movementCount"
         from app.saldo_mensal_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3 and competencia<=$4`,
        [actor.tenantId, companyId, version.id, query.ate],
      );
      const catalog = await client.query<{ accountId: string; code: string; name: string; parentAccountId: string | null; type: 'ANALYTICAL' | 'SYNTHETIC'; normalBalance: 'DEBIT' | 'CREDIT' }>(
        `select child.id as "accountId",child.codigo as code,child.nome as name,parent.id as "parentAccountId",case when child.tipo='analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,case when child.natureza='devedora' then 'DEBIT' else 'CREDIT' end as "normalBalance"
         from app.conta_contabil child left join app.conta_contabil parent on parent.empresa_id=child.empresa_id and parent.tenant_id=child.tenant_id and parent.codigo=child.conta_pai
         where child.tenant_id=$1 and child.empresa_id=$2 order by child.codigo`, [actor.tenantId, companyId],
      );
      const movements: MovimentoParaBalancete[] = balances.rows.flatMap((balance) => {
        if (query.centroId === 'sem-centro' && balance.costCenterId !== null) return [];
        if (query.centroId && !['sem-centro','todos'].includes(query.centroId) && balance.costCenterId !== query.centroId) return [];
        const result: MovimentoParaBalancete[] = [];
        const debit = Number(balance.debitCents); const credit = Number(balance.creditCents);
        if (debit > 0) result.push({ accountId: balance.accountId, costCenterId: balance.costCenterId, competence: balance.competence, side: 'DEBIT', amountCents: debit });
        if (credit > 0) result.push({ accountId: balance.accountId, costCenterId: balance.costCenterId, competence: balance.competence, side: 'CREDIT', amountCents: credit });
        return result;
      });
      const result = calcularBalancete(movements, catalog.rows, query.de, query.ate, { tipo: 'TODOS' }, !query.somenteMovimento);
      const initial = await client.query<{ competence: string | null }>(`select min(competencia) as competence from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3`, [actor.tenantId, companyId, version.id]);
      return { ...result, firstCompetence: initial.rows[0]?.competence ?? null, projectionVersion: version.numero, integrity: version.integridade };
    });
  }

  async detalhe(actor: AtorRazao, companyId: string, movementId: string, correlationId: string) {
    return this.contexto(actor, async (client) => {
      const version = await this.versaoAtiva(client, actor, companyId, correlationId);
      const result = await client.query(
        `select m.id as "movementId",m.data_contabil::text as "accountingDate",m.competencia as competence,m.numero_lancamento::text as "entryNumber",m.conta_id as "accountId",m.codigo_conta as "accountCode",m.nome_conta as "accountName",m.centro_custo_id as "costCenterId",m.codigo_centro as "costCenterCode",m.nome_centro as "costCenterName",m.historico as history,m.referencia_externa as "externalReference",m.lado as side,m.valor_centavos::text as "amountCents",m.tipo as kind,m.lancamento_id as "entryId",m.partida_id as "entryLineId",m.ajuste_de_id as "adjustmentOfMovementId",m.posicao as position,e.estado as "entryStatus",e.estorno_de_id as "reversalOfEntryId",p.complemento as memo,
         (select jsonb_agg(jsonb_build_object('action',ev.acao,'previousStatus',ev.estado_anterior,'newStatus',ev.estado_novo,'reason',ev.motivo,'correlationId',ev.correlation_id,'occurredAt',ev.ocorrido_em) order by ev.ocorrido_em,ev.sequencia) from app.lancamento_contabil_evento ev where ev.lancamento_id=e.id) as events
         from app.movimento_razao m join app.lancamento_contabil e on e.id=m.lancamento_id and e.tenant_id=m.tenant_id and e.empresa_id=m.empresa_id
         join app.lancamento_contabil_partida p on p.id=m.partida_id and p.tenant_id=m.tenant_id and p.empresa_id=m.empresa_id
         where m.tenant_id=$1 and m.empresa_id=$2 and m.versao_id=$3 and m.id=$4`, [actor.tenantId, companyId, version.id, movementId],
      );
      if (!result.rows[0]) throw erro('LEDGER_SOURCE_INVALID', 'Movimento do razão não encontrado.');
      return result.rows[0];
    });
  }

  async verificar(actor: AtorRazao, companyId: string, correlationId: string) {
    return this.contexto(actor, async (client) => {
      const version = await this.versaoAtiva(client, actor, companyId, correlationId);
      const rows = await this.compararFonte(client, actor.tenantId, companyId, version.id);
      const status = rows.length === 0 ? 'CONSISTENT' : 'INCONSISTENT';
      await client.query(`update app.projecao_razao set integridade=$1,atualizado_em=now() where tenant_id=$2 and empresa_id=$3`, [status, actor.tenantId, companyId]);
      await this.evento(client, actor, companyId, version.id, 'VERIFICADO', 'SUCESSO', correlationId, { status, differences: rows.length });
      return { status, differences: rows, projectionVersion: version.numero, correlationId };
    });
  }

  private async compararFonte(client: PoolClient, tenantId: string, companyId: string, versionId: string) {
    const { rows } = await client.query<{ competence: string; accountId: string; costCenterId: string | null; sourceCount: string; sourceDebit: string; sourceCredit: string; projectionCount: string; projectionDebit: string; projectionCredit: string }>(
        `with source as (
           select e.competencia,p.conta_id,p.centro_custo_id,p.lado,p.valor_centavos from app.lancamento_contabil e join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa where e.tenant_id=$1 and e.empresa_id=$2 and e.numero is not null and e.estado in ('POSTED','CANCELLED','REVERSED')
           union all select e.competencia,p.conta_id,p.centro_custo_id,case p.lado when 'DEBIT' then 'CREDIT' else 'DEBIT' end,p.valor_centavos from app.lancamento_contabil e join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.tenant_id=e.tenant_id and p.empresa_id=e.empresa_id and p.ativa where e.tenant_id=$1 and e.empresa_id=$2 and e.estado='CANCELLED'
         ), src as (select competencia,conta_id,centro_custo_id,count(*)::text n,coalesce(sum(valor_centavos) filter(where lado='DEBIT'),0)::text d,coalesce(sum(valor_centavos) filter(where lado='CREDIT'),0)::text c from source group by competencia,conta_id,centro_custo_id), prj as (select competencia,conta_id,centro_custo_id,count(*)::text n,coalesce(sum(valor_centavos) filter(where lado='DEBIT'),0)::text d,coalesce(sum(valor_centavos) filter(where lado='CREDIT'),0)::text c from app.movimento_razao where tenant_id=$1 and empresa_id=$2 and versao_id=$3 group by competencia,conta_id,centro_custo_id)
         select coalesce(src.competencia,prj.competencia) competence,coalesce(src.conta_id,prj.conta_id) as "accountId",coalesce(src.centro_custo_id,prj.centro_custo_id) as "costCenterId",coalesce(src.n,'0') as "sourceCount",coalesce(src.d,'0') as "sourceDebit",coalesce(src.c,'0') as "sourceCredit",coalesce(prj.n,'0') as "projectionCount",coalesce(prj.d,'0') as "projectionDebit",coalesce(prj.c,'0') as "projectionCredit"
         from src full join prj on src.competencia=prj.competencia and src.conta_id=prj.conta_id and src.centro_custo_id is not distinct from prj.centro_custo_id
            where src.n is distinct from prj.n or src.d is distinct from prj.d or src.c is distinct from prj.c`,
      [tenantId, companyId, versionId],
    );
    return rows;
  }

  async reconstruir(actor: AtorRazao, companyId: string, from: string, to: string, confirmationCompany: string, correlationId: string) {
    return this.contexto(actor, async (client) => {
      if (companyId !== confirmationCompany) throw erro('LEDGER_REBUILD_FAILED', 'Confirmação da empresa não corresponde à operação.');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) throw erro('LEDGER_PERIOD_INVALID', 'Período informado é inválido.');
      const active = await this.versaoAtiva(client, actor, companyId, correlationId);
      const next = await this.criarVersao(client, actor, companyId, active.numero + 1, correlationId);
      await client.query('SAVEPOINT ledger_rebuild');
      await this.evento(client, actor, companyId, next, 'RECONSTRUCAO_INICIADA', 'SUCESSO', correlationId, { from, to, previousVersion: active.numero });
      try {
        const movementCount = await this.construirVersao(client, actor.tenantId, companyId, next);
        const differences = await this.compararFonte(client, actor.tenantId, companyId, next);
        if (differences.length > 0) throw new Error('LEDGER_REBUILD_SOURCE_MISMATCH');
        await client.query(`update app.projecao_razao_versao set estado='SUPERSEDED' where id=$1`, [active.id]);
        await client.query(`update app.projecao_razao_versao set estado='ACTIVE',ativado_em=now() where id=$1`, [next]);
        await client.query(`update app.projecao_razao set versao_ativa_id=$1,numero_versao=$2,integridade='CONSISTENT',reconstrucao_em=now(),atualizado_em=now() where tenant_id=$3 and empresa_id=$4`, [next, active.numero + 1, actor.tenantId, companyId]);
        await this.evento(client, actor, companyId, next, 'RECONSTRUCAO_ATIVADA', 'SUCESSO', correlationId, { movimentos: movementCount, from, to });
        await client.query('RELEASE SAVEPOINT ledger_rebuild');
        return { status: 'CONSISTENT', projectionVersion: active.numero + 1, movementCount, correlationId };
      } catch (cause) {
        await client.query('ROLLBACK TO SAVEPOINT ledger_rebuild');
        await client.query(`update app.projecao_razao_versao set estado='FAILED' where id=$1`, [next]);
        const message = cause instanceof Error ? cause.message.slice(0, 240) : 'LEDGER_REBUILD_FAILED';
        await this.evento(client, actor, companyId, next, 'RECONSTRUCAO_FALHOU', 'FALHA', correlationId, { code: 'LEDGER_REBUILD_FAILED', reason: message, activeVersionPreserved: active.numero });
        return { status: 'FAILED', code: 'LEDGER_REBUILD_FAILED', projectionVersion: active.numero, correlationId };
      }
    });
  }
}
