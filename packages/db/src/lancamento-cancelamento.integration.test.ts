import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContextoHumano } from './contexto.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
const suffix = `${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
let tenantId: string; let companyId: string; let userId: string; let entryId: string;
const actor = () => ({ tenantId, usuarioId: userId, correlationId: 'f40-cancelamento-motivo' });
const context = <T>(run: (client: PoolClient) => Promise<T>) => comContextoHumano(app, actor(), run);

beforeAll(async () => {
  tenantId = (await admin.query<{ id: string }>(`insert into app.tenant(razao_social,cnpj) values($1,$2) returning id`, [`FIX F40 ${suffix}`, `M${suffix}`])).rows[0]!.id;
  companyId = (await admin.query<{ id: string }>(`insert into app.empresa(tenant_id,cnpj,razao_social,status,situacao) values($1,$2,$3,'ATIVA','ativo') returning id`, [tenantId, `E${suffix}`.slice(0, 14).padEnd(14, '0'), `Empresa FIX F40 ${suffix}`])).rows[0]!.id;
  userId = (await admin.query<{ id: string }>(`insert into app.usuario(tenant_id,sub_oidc,email,nome,estado) values($1,$2,$3,'Usuário FIX','ATIVO') returning id`, [tenantId, `fix-f40-${suffix}`, `fix-f40-${suffix}@local.test`])).rows[0]!.id;
  await admin.query(`insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id) values($1,$2,$3)`, [tenantId, userId, companyId]);
  entryId = await context(async (client) => {
    const accounts = await Promise.all(['D', 'C'].map(async (side) => (await client.query<{ id: string }>(
      `insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo)
       values($1,$2,$3,$4,'analitica',$5,'ASSET','OPTIONAL') returning id`,
      [tenantId, companyId, `FIX-${suffix}-${side}`, `Conta ${side}`, side === 'D' ? 'devedora' : 'credora'],
    )).rows[0]!.id));
    const id = (await client.query<{ id: string }>(
      `insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
       values($1,$2,2097,'2097-04-15','2097-04','Lançamento de teste',$3) returning id`, [tenantId, companyId, userId],
    )).rows[0]!.id;
    for (const [position, accountId] of accounts.entries()) await client.query(
      `insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao)
       values($1,$2,$3,$4,$5,500,$6)`, [tenantId, companyId, id, accountId, position === 0 ? 'DEBIT' : 'CREDIT', position],
    );
    await client.query(`insert into app.lancamento_contabil_sequencia(tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,2097,1)`, [tenantId, companyId]);
    await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
    await client.query(`update app.lancamento_contabil set estado='POSTED',numero=1,efetivado_por=$1 where id=$2`, [userId, id]);
    await client.query(
      `insert into app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,numero,usuario_id,correlation_id)
       values($1,$2,$3,'EFETIVADO','DRAFT','POSTED',1,$4,'fix-f40-post')`, [tenantId, companyId, id, userId],
    );
    return id;
  });
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    const client = await admin.connect();
    try {
      await client.query(`set session_replication_role=replica`);
      const { rows } = await client.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema='app' and column_name='tenant_id'`);
      for (const { table_name } of rows) await client.query(`delete from app.${table_name} where tenant_id=$1`, [tenantId]);
      await client.query(`delete from app.tenant where id=$1`, [tenantId]);
    } finally { await client.query(`reset session_replication_role`); client.release(); }
  }
  await Promise.all([admin.end(), app.end()]);
});

describe('F40: cancelamento de lançamento efetivado', () => {
  it('grava motivo na transição e preserva os demais campos imutáveis', async () => {
    await context(async (client) => {
      await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
      await client.query(`update app.lancamento_contabil set estado='CANCELLED',cancelamento_motivo='Motivo de negócio' where id=$1`, [entryId]);
      await client.query(
        `insert into app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,numero,motivo,usuario_id,correlation_id)
         values($1,$2,$3,'CANCELADO','POSTED','CANCELLED',1,'Motivo de negócio',$4,'fix-f40-cancel')`, [tenantId, companyId, entryId, userId],
      );
    });
    const source = await context(async (client) => (await client.query<{ status: string; reason: string }>(
      `select estado as status,cancelamento_motivo as reason from app.lancamento_contabil where id=$1`, [entryId],
    )).rows[0]!);
    expect(source).toEqual({ status: 'CANCELLED', reason: 'Motivo de negócio' });
    await expect(context((client) => client.query(`update app.lancamento_contabil set historico='Mutação indevida' where id=$1`, [entryId]))).rejects.toMatchObject({ code: '23001' });
    await expect(context((client) => client.query(`update app.lancamento_contabil set cancelamento_motivo='Troca indevida' where id=$1`, [entryId]))).rejects.toMatchObject({ code: '23001' });
  });
});
