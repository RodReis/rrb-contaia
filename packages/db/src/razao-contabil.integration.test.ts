import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContextoHumano } from './contexto.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';

const admin = criarPool(); const app = criarPoolDaAplicacao(); let scenario: Cenario;
let accountIds: readonly [string, string]; let entryId: string; let lineIds: readonly [string, string]; let versionId: string; let movementId: string;
const competence = '2097-03'; const date = '2097-03-15';
const asA = <T>(run: (client: PoolClient) => Promise<T>) => comContextoHumano(app, { tenantId: scenario.tenantA, usuarioId: scenario.usuarios.naCarteira, correlationId: 'f42-razao-integration' }, run);
const code = () => `F42-${scenario.sufixo}-${crypto.randomUUID()}`;

beforeAll(async () => {
  scenario = await montarCenario(admin);
  const fixtures = await asA(async (client) => {
    const accounts = await Promise.all(['D', 'C'].map(async (suffix) => (await client.query<{ id: string }>(
      `insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo)
       values($1,$2,$3,$4,'analitica',$5,'ASSET','OPTIONAL') returning id`,
      [scenario.tenantA, scenario.empresaA1, code(), `Conta F42 ${suffix}`, suffix === 'D' ? 'devedora' : 'credora'],
    )).rows[0]!.id));
    const entry = await client.query<{ id: string }>(
      `insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
       values($1,$2,2097,$3,$4,'Prova F42',$5) returning id`, [scenario.tenantA, scenario.empresaA1, date, competence, scenario.usuarios.naCarteira],
    );
    const entryIdValue = entry.rows[0]!.id;
    for (const [position, accountId] of accounts.entries()) await client.query(
      `insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao)
       values($1,$2,$3,$4,$5,8400,$6)`, [scenario.tenantA, scenario.empresaA1, entryIdValue, accountId, position === 0 ? 'DEBIT' : 'CREDIT', position],
    );
    await client.query(`insert into app.lancamento_contabil_sequencia(tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,2097,1)`, [scenario.tenantA, scenario.empresaA1]);
    await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
    await client.query(`update app.lancamento_contabil set estado='POSTED',numero=1,efetivado_por=$1 where id=$2`, [scenario.usuarios.naCarteira, entryIdValue]);
    const sourceEvent = await client.query<{ id: string }>(
      `insert into app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,numero,usuario_id,correlation_id)
       values($1,$2,$3,'EFETIVADO','DRAFT','POSTED',1,$4,'f42-source') returning id`,
      [scenario.tenantA, scenario.empresaA1, entryIdValue, scenario.usuarios.naCarteira],
    );
    const lines = await client.query<{ id: string; accountId: string }>(`select id,conta_id as "accountId" from app.lancamento_contabil_partida where lancamento_id=$1 order by posicao`, [entryIdValue]);
    const version = await client.query<{ id: string }>(
      `insert into app.projecao_razao_versao(tenant_id,empresa_id,numero,estado,criado_por,correlation_id,ativado_em)
       values($1,$2,1,'ACTIVE',$3,'f42-source',now()) returning id`, [scenario.tenantA, scenario.empresaA1, scenario.usuarios.naCarteira],
    );
    const versionIdValue = version.rows[0]!.id;
    await client.query(`insert into app.projecao_razao(tenant_id,empresa_id,versao_ativa_id,numero_versao) values($1,$2,$3,1)`, [scenario.tenantA, scenario.empresaA1, versionIdValue]);
    const account = await client.query<{ code: string; name: string }>(`select codigo as code,nome as name from app.conta_contabil where id=$1`, [accounts[0]]);
    const movement = await client.query<{ id: string }>(
      `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,evento_origem_id,competencia,data_contabil,conta_id,codigo_conta,nome_conta,historico,numero_lancamento,posicao,lado,valor_centavos,tipo)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Prova F42',1,0,'DEBIT',8400,'POSTING') returning id`,
      [scenario.tenantA, scenario.empresaA1, versionIdValue, entryIdValue, lines.rows[0]!.id, sourceEvent.rows[0]!.id, competence, date, accounts[0], account.rows[0]!.code, account.rows[0]!.name],
    );
    await client.query(
      `insert into app.saldo_mensal_razao(tenant_id,empresa_id,versao_id,competencia,conta_id,debitos_centavos,movimentos)
       values($1,$2,$3,$4,$5,8400,1)`, [scenario.tenantA, scenario.empresaA1, versionIdValue, competence, accounts[0]],
    );
    return { accounts, entryId: entryIdValue, lines: lines.rows.map((line) => line.id) as [string, string], versionId: versionIdValue, movementId: movement.rows[0]!.id };
  });
  accountIds = fixtures.accounts as [string, string]; entryId = fixtures.entryId; lineIds = fixtures.lines; versionId = fixtures.versionId; movementId = fixtures.movementId;
}, 60_000);

afterAll(async () => { if (scenario) await limparCenario(admin, scenario); await Promise.all([admin.end(), app.end()]); });

describe('F42: razão contábil no PostgreSQL', () => {
  it('isola projeção, movimentos e saldos por carteira e tenant', async () => {
    const own = await asA(async (client) => ({
      projection: (await client.query(`select versao_ativa_id from app.projecao_razao where empresa_id=$1`, [scenario.empresaA1])).rowCount,
      movement: (await client.query(`select id from app.movimento_razao where id=$1`, [movementId])).rowCount,
      balance: (await client.query(`select movimentos from app.saldo_mensal_razao where empresa_id=$1`, [scenario.empresaA1])).rowCount,
    }));
    const outside = await comContextoHumano(app, { tenantId: scenario.tenantA, usuarioId: scenario.usuarios.fora }, async (client) => (await client.query(`select id from app.movimento_razao where id=$1`, [movementId])).rowCount);
    const otherTenant = await comContextoHumano(app, { tenantId: scenario.tenantB, usuarioId: scenario.usuarios.deB }, async (client) => (await client.query(`select versao_ativa_id from app.projecao_razao where empresa_id=$1`, [scenario.empresaA1])).rowCount);
    expect(own).toEqual({ projection: 1, movement: 1, balance: 1 }); expect(outside).toBe(0); expect(otherTenant).toBe(0);
  });

  it('protege movimentos e eventos contra update/delete e bloqueia duplicidade idempotente', async () => {
    await expect(admin.query(`update app.movimento_razao set valor_centavos=valor_centavos where id=$1`, [movementId])).rejects.toMatchObject({ code: '23001' });
    await expect(admin.query(`delete from app.movimento_razao where id=$1`, [movementId])).rejects.toMatchObject({ code: '23001' });
    await expect(asA((client) => client.query(
      `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,evento_origem_id,competencia,data_contabil,conta_id,codigo_conta,nome_conta,historico,numero_lancamento,posicao,lado,valor_centavos,tipo)
       select tenant_id,empresa_id,versao_id,lancamento_id,partida_id,app.uuid_v7(),competencia,data_contabil,conta_id,codigo_conta,nome_conta,historico,numero_lancamento,posicao,lado,valor_centavos,tipo from app.movimento_razao where id=$1`, [movementId],
    ))).rejects.toMatchObject({ code: '23505' });
    await asA((client) => client.query(
      `insert into app.evento_razao(tenant_id,empresa_id,versao_id,acao,resultado,usuario_id,correlation_id)
       values($1,$2,$3,'VERIFICADO','SUCESSO',$4,'f42-audit')`, [scenario.tenantA, scenario.empresaA1, versionId, scenario.usuarios.naCarteira],
    ));
    await expect(admin.query(`update app.evento_razao set resultado='FALHA' where correlation_id='f42-audit'`)).rejects.toMatchObject({ code: '23001' });
  });

  it('mantém vínculo de cada movimento com lançamento, partida e empresa', async () => {
    const source = await asA(async (client) => (await client.query(
      `select m.lancamento_id as "entryId",m.partida_id as "lineId",l.empresa_id as "entryCompany",p.empresa_id as "lineCompany",m.evento_origem_id as "sourceEventId"
       from app.movimento_razao m join app.lancamento_contabil l on l.id=m.lancamento_id and l.tenant_id=m.tenant_id and l.empresa_id=m.empresa_id
       join app.lancamento_contabil_partida p on p.id=m.partida_id and p.tenant_id=m.tenant_id and p.empresa_id=m.empresa_id where m.id=$1`, [movementId])).rows[0]);
    expect(source).toMatchObject({ entryId, lineId: lineIds[0], entryCompany: scenario.empresaA1, lineCompany: scenario.empresaA1 });
    expect(accountIds).toHaveLength(2); expect(source?.sourceEventId).toBeTruthy();
  });
});
