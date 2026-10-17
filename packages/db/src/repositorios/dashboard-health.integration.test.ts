import { contextoTecnico } from '@contaia/domain';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPool, criarPoolDaAplicacao } from '../client.js';
import { comContexto, comContextoHumano } from '../contexto.js';
import { limparCenario, montarCenario, type Cenario } from '../testes/cenario-rls.js';
import { coletarSinaisDaSaude, listarDashboardDaSaude, listarMotivosDaSaude, substituirProjecaoDaSaude } from './dashboard-health.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
let cenario: Cenario | undefined;
const agora = new Date('2026-10-17T15:00:00.000Z');
const filtro = { busca: null, cor: null, regime: null, fonte: null, codigo: null, ordem: 'URGENCIA' as const, limite: 25, deslocamento: 0 };

const projetarComFonteIndisponivel = async (tenantId: string, empresaId: string): Promise<void> => {
  const correlationId = `dashboard-health-${empresaId}`;
  await comContexto(app, contextoTecnico({ identidadeTecnica: 'workers-dfe-capture', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId, empresaId, correlationId }), async (cliente) => {
    const coleta = await coletarSinaisDaSaude(cliente, { tenantId, empresaId }, agora, []);
    await substituirProjecaoDaSaude(cliente, { tenantId, empresaId }, coleta.resultado, coleta.revisoes, agora, correlationId);
  });
};

beforeAll(async () => { cenario = await montarCenario(admin); }, 60_000);
afterAll(async () => {
  if (cenario) await limparCenario(admin, cenario);
  await Promise.all([admin.end(), app.end()]);
}, 60_000);

describe('projeção do dashboard e isolamento', () => {
  it('preserva motivos de fonte incompleta, reprocessa idempotentemente e limita a carteira e o tenant', async () => {
    const c = cenario!;
    await Promise.all([
      projetarComFonteIndisponivel(c.tenantA, c.empresaA1),
      projetarComFonteIndisponivel(c.tenantA, c.empresaA2),
      projetarComFonteIndisponivel(c.tenantB, c.empresaB1),
    ]);
    await projetarComFonteIndisponivel(c.tenantA, c.empresaA1);

    const carteiraA = await comContextoHumano(app, { tenantId: c.tenantA, usuarioId: c.usuarios.naCarteira }, async (cliente) => ({
      dashboard: await listarDashboardDaSaude(cliente, c.tenantA, c.usuarios.naCarteira, filtro),
      motivos: await listarMotivosDaSaude(cliente, c.tenantA, c.usuarios.naCarteira, c.empresaA1),
    }));
    expect(carteiraA.dashboard.empresas.map((empresa) => empresa.empresa_id)).toEqual([c.empresaA1]);
    expect(carteiraA.dashboard.resumo).toMatchObject({ total: 1, amarelo: 1, vermelho: 0, verde: 0 });
    expect(carteiraA.motivos).toHaveLength(5);
    expect(carteiraA.motivos.every((motivo) => motivo.codigo === 'FONTE_INCOMPLETA')).toBe(true);

    const carteiraParcial = await comContextoHumano(app, { tenantId: c.tenantA, usuarioId: c.usuarios.fora }, (cliente) =>
      listarDashboardDaSaude(cliente, c.tenantA, c.usuarios.fora, filtro));
    expect(carteiraParcial.empresas.map((empresa) => empresa.empresa_id)).toEqual([c.empresaA2]);

    const outroTenant = await comContextoHumano(app, { tenantId: c.tenantB, usuarioId: c.usuarios.deB }, (cliente) =>
      listarDashboardDaSaude(cliente, c.tenantB, c.usuarios.deB, filtro));
    expect(outroTenant.empresas.map((empresa) => empresa.empresa_id)).toEqual([c.empresaB1]);

    const identidadeIncorreta = contextoTecnico({ identidadeTecnica: 'workers-dfe-capture', finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: c.tenantA, empresaId: c.empresaA1, correlationId: 'dashboard-health-cross-scope' });
    const coletaValida = await comContexto(app, identidadeIncorreta, (cliente) => coletarSinaisDaSaude(cliente,
      { tenantId: c.tenantA, empresaId: c.empresaA1 }, agora, []));
    await expect(comContexto(app, identidadeIncorreta, (cliente) => substituirProjecaoDaSaude(cliente,
      { tenantId: c.tenantB, empresaId: c.empresaB1 }, coletaValida.resultado, coletaValida.revisoes, agora, 'dashboard-health-cross-scope'))).rejects.toThrow();
  }, 60_000);

  it('consulta 500 empresas da carteira em menos de três segundos', async () => {
    const c = cenario!;
    const empresas = await admin.query<{ id: string }>(`insert into app.empresa(tenant_id,cnpj,razao_social,status,situacao)
      select $1, lpad((10000+n)::text,14,'0'), 'Benchmark F23 '||lpad(n::text,3,'0'), 'ATIVA','ativo'
      from generate_series(1,500) n returning id`, [c.tenantA]);
    const ids = empresas.rows.map((empresa) => empresa.id);
    await admin.query(`insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id)
      select $1,$2,empresa_id from unnest($3::uuid[]) empresa_id`, [c.tenantA,c.usuarios.naCarteira,ids]);
    await admin.query(`insert into app.dashboard_health_projection(tenant_id,empresa_id,cor,correlation_id)
      select $1,empresa_id,'VERDE','dashboard-health-500-fixture' from unnest($2::uuid[]) empresa_id`, [c.tenantA,ids]);
    await admin.query('analyze app.empresa; analyze app.dashboard_health_projection; analyze app.carteira_vinculo;');

    const inicio = performance.now();
    const resultado = await comContextoHumano(app, { tenantId: c.tenantA, usuarioId: c.usuarios.naCarteira }, (cliente) =>
      listarDashboardDaSaude(cliente, c.tenantA, c.usuarios.naCarteira, filtro));
    const duracao = performance.now() - inicio;
    expect(resultado.total).toBe(501);
    expect(resultado.empresas).toHaveLength(25);
    expect(duracao).toBeLessThan(3_000);
  }, 60_000);
});
