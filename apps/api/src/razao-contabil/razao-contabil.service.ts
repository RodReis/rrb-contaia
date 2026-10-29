import { calcularBalancete, CODIGOS_DE_ERRO, ErroDeDominio, type MovimentoParaBalancete } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';
import type { ConsultaBalancete, ConsultaRazao } from './razao-contabil.dto';

type AtorRazao = Readonly<{ tenantId: string; usuarioId: string }>;
type VersaoAtiva = Readonly<{ id: string; numero: number; integridade: 'CONSISTENT' | 'INCONSISTENT' }>;
type LinhaFonte = Readonly<{
  entryId: string; lineId: string; competence: string; accountingDate: string; accountId: string; costCenterId: string | null;
  accountCode: string; accountName: string; costCenterCode: string | null; costCenterName: string | null;
  history: string; externalReference: string | null; entryNumber: string; position: number; side: 'DEBIT' | 'CREDIT'; amountCents: string;
}>;

const erro = (codigo: string, mensagem: string): ErroDeDominio => new ErroDeDominio(codigo as never, mensagem);
@Injectable()
export class RazaoContabilService {
  constructor(private readonly pool: PoolDoBanco) {}

  private contexto<T>(ator: AtorRazao, executar: (client: PoolClient) => Promise<T>): Promise<T> {
    return comContextoHumano(this.pool.instancia, ator, executar);
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
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`${actor.tenantId}:${companyId}:razao`]);
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
