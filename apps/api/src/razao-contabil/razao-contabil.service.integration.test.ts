import { criarPool, criarPoolDaAplicacao, comContextoHumano } from '@contaia/db';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PoolDoBanco } from '../banco/pool.provider';
import { LancamentosContabeisService } from '../lancamentos-contabeis/lancamentos-contabeis.service';
import { RazaoContabilService } from './razao-contabil.service';

const admin = criarPool();
const app = criarPoolDaAplicacao();
const service = new RazaoContabilService({ instancia: app } as PoolDoBanco);
const entries = new LancamentosContabeisService({ instancia: app } as PoolDoBanco, service);
let scenario: { sufixo: string; tenantA: string; empresaA1: string; usuarios: { naCarteira: string } };
let accountIds: [string, string];
let entryId: string;
let sourceEventId: string;
const competence = '2097-04';
const correlationId = 'f42-service-integration';
const actor = () => ({ tenantId: scenario.tenantA, usuarioId: scenario.usuarios.naCarteira });
const context = <T>(run: (client: PoolClient) => Promise<T>) => comContextoHumano(app, { ...actor(), correlationId }, run);

beforeAll(async () => {
  const sufixo = `${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  const tenant = (await admin.query<{ id: string }>(`insert into app.tenant(razao_social,cnpj) values($1,$2) returning id`, [`F42 ${sufixo}`, `M${sufixo}`])).rows[0]!.id;
  const empresa = (await admin.query<{ id: string }>(`insert into app.empresa(tenant_id,cnpj,razao_social,status,situacao) values($1,$2,$3,'ATIVA','ativo') returning id`, [tenant, `E${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa F42 ${sufixo}`])).rows[0]!.id;
  const usuario = (await admin.query<{ id: string }>(`insert into app.usuario(tenant_id,sub_oidc,email,nome,estado) values($1,$2,$3,$4,'ATIVO') returning id`, [tenant, `f42-${sufixo}`, `f42-${sufixo}@local.test`, 'Usuário F42'])).rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id) values($1,$2,$3)`, [tenant, usuario, empresa]);
  scenario = { sufixo, tenantA: tenant, empresaA1: empresa, usuarios: { naCarteira: usuario } };
  const fixtures = await comContextoHumano(app, { ...actor(), correlationId }, async (client) => {
    const accounts = await Promise.all(['D', 'C'].map(async (side) => (await client.query<{ id: string }>(
      `insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo)
       values($1,$2,$3,$4,'analitica',$5,'ASSET','OPTIONAL') returning id`,
      [scenario.tenantA, scenario.empresaA1, `F42-${scenario.sufixo}-${side}`, `F42 ${side}`, side === 'D' ? 'devedora' : 'credora'],
    )).rows[0]!.id));
    const entry = await client.query<{ id: string }>(
      `insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
       values($1,$2,2097,'2097-04-15',$3,'Integração F42',$4) returning id`,
      [scenario.tenantA, scenario.empresaA1, competence, scenario.usuarios.naCarteira],
    );
    const id = entry.rows[0]!.id;
    for (const [position, accountId] of accounts.entries()) await client.query(
      `insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao)
       values($1,$2,$3,$4,$5,1200,$6)`,
      [scenario.tenantA, scenario.empresaA1, id, accountId, position === 0 ? 'DEBIT' : 'CREDIT', position],
    );
    await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
    await client.query(`update app.lancamento_contabil set estado='POSTED',numero=1,efetivado_por=$1 where id=$2`, [scenario.usuarios.naCarteira, id]);
    const event = await client.query<{ id: string }>(
      `insert into app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,numero,usuario_id,correlation_id)
       values($1,$2,$3,'EFETIVADO','DRAFT','POSTED',1,$4,$5) returning id`,
      [scenario.tenantA, scenario.empresaA1, id, scenario.usuarios.naCarteira, correlationId],
    );
    return { accounts, entryId: id, sourceEventId: event.rows[0]!.id };
  });
  accountIds = fixtures.accounts as [string, string];
  entryId = fixtures.entryId;
  sourceEventId = fixtures.sourceEventId;
}, 60_000);

afterAll(async () => {
  if (scenario) {
    const client = await admin.connect();
    try {
      await client.query(`set session_replication_role=replica`);
      const { rows } = await client.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema='app' and column_name='tenant_id'`);
      for (const { table_name } of rows) await client.query(`delete from app.${table_name} where tenant_id=$1`, [scenario.tenantA]);
      await client.query(`delete from app.tenant where id=$1`, [scenario.tenantA]);
    } finally { await client.query(`reset session_replication_role`); client.release(); }
  }
  await Promise.all([admin.end(), app.end()]);
});

describe('F42/F43: razão e fechamento da API no PostgreSQL', () => {
  it('projeta uma efetivação de forma idempotente e gera o balancete', async () => {
    await context(async (client) => {
      await service.projetarEfetivacao(client, actor(), scenario.empresaA1, entryId, sourceEventId, correlationId);
      await service.projetarEfetivacao(client, actor(), scenario.empresaA1, entryId, sourceEventId, correlationId);
    });
    const result = await service.balancete(actor(), scenario.empresaA1, { de: competence, ate: competence, somenteMovimento: true }, correlationId);
    expect(Object.fromEntries(result.lines.map((line) => [line.accountId, [line.debitCents, line.creditCents]]))).toEqual({
      [accountIds[0]]: [1200, 0], [accountIds[1]]: [0, 1200],
    });
    const counts = await context(async (client) => (await client.query<{ count: string; movements: string }>(
      `select (select count(*) from app.movimento_razao where empresa_id=$1)::text as count,
              (select sum(movimentos) from app.saldo_mensal_razao where empresa_id=$1)::text as movements`,
      [scenario.empresaA1],
    )).rows[0]!);
    expect(counts).toEqual({ count: '2', movements: '2' });
    expect((await service.verificar(actor(), scenario.empresaA1, correlationId)).status).toBe('CONSISTENT');

    const competingCloses=await Promise.all([
      service.fecharCompetencia(actor(),scenario.empresaA1,competence,0,'f43-close-001',false,['contabil.fechamento.consultar','contabil.fechamento.fechar_competencia'],correlationId),
      service.fecharCompetencia(actor(),scenario.empresaA1,competence,0,'f43-close-race-002',false,['contabil.fechamento.consultar','contabil.fechamento.fechar_competencia'],correlationId),
    ]);
    const closed=competingCloses.find((result)=>result['status']==='CLOSED');
    expect(competingCloses.filter((result)=>result['status']==='CLOSED')).toHaveLength(1);
    expect(competingCloses.some((result)=>result['status']==='CONFLICT'&&result['code']==='ACCOUNTING_PERIOD_ALREADY_CLOSED')).toBe(true);
    if(!closed)throw new Error('fechamento concorrente não escolheu vencedor');
    expect(closed).toMatchObject({status:'CLOSED',competence,version:1});
    const repeated=await service.fecharCompetencia(actor(),scenario.empresaA1,competence,0,'f43-close-001',false,['contabil.fechamento.consultar','contabil.fechamento.fechar_competencia'],correlationId);
    expect(repeated).toEqual(closed);
    await expect(entries.criar(actor(),scenario.empresaA1,{accountingDate:'2097-04-23',competence,history:'Bloqueado após fechamento',externalReference:null,lines:[{accountId:accountIds[0],costCenterId:null,side:'DEBIT',amountCents:100,memo:null,position:0},{accountId:accountIds[1],costCenterId:null,side:'CREDIT',amountCents:100,memo:null,position:1}]},correlationId)).rejects.toMatchObject({codigo:'ACCOUNTING_PERIOD_ALREADY_CLOSED'});
    const closeRead=await service.consultarFechamentos(actor(),scenario.empresaA1,competence,competence,correlationId);
    expect(closeRead.closes[0]).toMatchObject({version:1,snapshotValid:true,cycleStatus:'CLOSED'});
    const laterClose=await service.fecharCompetencia(actor(),scenario.empresaA1,'2097-05',0,'f43-close-empty-001',true,['contabil.fechamento.consultar','contabil.fechamento.fechar_competencia'],correlationId);
    expect(laterClose).toMatchObject({status:'CLOSED',competence:'2097-05',version:1,kind:'EMPTY_CONFIRMED'});
    const blockedReopen=await service.reabrirCompetencia(actor(),scenario.empresaA1,competence,1,'f43-reopen-blocked-001','Correção autorizada',['contabil.fechamento.consultar','contabil.fechamento.reabrir'],correlationId);
    expect(blockedReopen).toMatchObject({status:'BLOCKED',code:'ACCOUNTING_PERIOD_LATER_CLOSE_EXISTS'});
    const laterReopen=await service.reabrirCompetencia(actor(),scenario.empresaA1,'2097-05',1,'f43-reopen-empty-001','Ajustar sequência',['contabil.fechamento.consultar','contabil.fechamento.reabrir'],correlationId);
    expect(laterReopen).toMatchObject({status:'REOPENED',version:1});
    const reopened=await service.reabrirCompetencia(actor(),scenario.empresaA1,competence,1,'f43-reopen-001','Correção autorizada',['contabil.fechamento.consultar','contabil.fechamento.reabrir'],correlationId);
    expect(reopened).toMatchObject({status:'REOPENED',version:1,reason:'Correção autorizada'});
    const reopenedAgain=await service.reabrirCompetencia(actor(),scenario.empresaA1,competence,1,'f43-reopen-001','Correção autorizada',['contabil.fechamento.consultar','contabil.fechamento.reabrir'],correlationId);
    expect(reopenedAgain).toEqual(reopened);
    const rebuilt = await service.reconstruir(actor(), scenario.empresaA1, competence, competence, scenario.empresaA1, correlationId);
    expect(rebuilt).toMatchObject({ status: 'CONSISTENT', projectionVersion: 2, movementCount: 2 });
    expect((await service.balancete(actor(), scenario.empresaA1, { de: competence, ate: competence, somenteMovimento: true }, correlationId)).totalDebitCents).toBe(1200);
    await entries.cancelar(actor(), scenario.empresaA1, entryId, 'Correção de integração', 1, correlationId);
    const cancelledBalance = await service.balancete(actor(), scenario.empresaA1, { de: competence, ate: competence, somenteMovimento: true }, correlationId);
    expect(cancelledBalance.totalDebitCents).toBe(2400);
    expect(cancelledBalance.totalCreditCents).toBe(2400);
    expect((await service.verificar(actor(), scenario.empresaA1, correlationId)).status).toBe('CONSISTENT');
    const secondClose=await service.fecharCompetencia(actor(),scenario.empresaA1,competence,1,'f43-close-002',false,['contabil.fechamento.consultar','contabil.fechamento.fechar_competencia'],correlationId);
    expect(secondClose).toMatchObject({status:'CLOSED',competence,version:2});

    await context(async (client) => {
      const brokenSource = await client.query<{ id: string }>(
        `insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
         values($1,$2,2097,'2097-04-20',$3,'Fonte sem evento de efetivação',$4) returning id`,
        [scenario.tenantA, scenario.empresaA1, competence, scenario.usuarios.naCarteira],
      );
      const brokenEntryId = brokenSource.rows[0]!.id;
      await client.query(
        `insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao)
         values($1,$2,$3,$4,'DEBIT',100,0),($1,$2,$3,$5,'CREDIT',100,1)`,
        [scenario.tenantA, scenario.empresaA1, brokenEntryId, accountIds[0], accountIds[1]],
      );
      await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
      await client.query(`update app.lancamento_contabil set estado='POSTED',numero=2,efetivado_por=$1 where id=$2`, [scenario.usuarios.naCarteira, brokenEntryId]);
    });

    const failedRebuild = await service.reconstruir(actor(), scenario.empresaA1, competence, competence, scenario.empresaA1, correlationId);
    expect(failedRebuild).toMatchObject({ status: 'FAILED', code: 'LEDGER_REBUILD_FAILED', projectionVersion: 2 });
    const preserved = await service.balancete(actor(), scenario.empresaA1, { de: competence, ate: competence, somenteMovimento: true }, correlationId);
    expect(preserved).toMatchObject({ projectionVersion: 2, totalDebitCents: 2400, totalCreditCents: 2400 });

    // The malformed source leaves the projection inconsistent; restore scenario isolation by
    // recording no successful close. The standalone integration below uses its own clean database.
  });
});
