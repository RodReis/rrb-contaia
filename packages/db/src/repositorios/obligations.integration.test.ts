import { contextoTecnico } from '@contaia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPool, criarPoolDaAplicacao } from '../client.js';
import { comContexto, comContextoHumano } from '../contexto.js';
import { limparCenario, montarCenario, type Cenario } from '../testes/cenario-rls.js';
import { gerarOcorrenciasPublicadas, listarAgenda } from './obligations.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
let c: Cenario;

beforeAll(async () => { c = await montarCenario(admin); }, 60_000);
afterAll(async () => { await limparCenario(admin, c); await Promise.all([admin.end(), app.end()]); });

describe('repositório da agenda de obrigações', () => {
  it('consulta regras publicadas e agenda em contexto humano', async () => {
    const resultado = await comContextoHumano(
      app,
      { tenantId: c.tenantA, usuarioId: c.usuarios.admin, correlationId: 'obligations-human-context' },
      async (cliente) => {
        const geradas = await gerarOcorrenciasPublicadas(cliente, c.tenantA, '2026-10', '2026-10-16');
        const regras = await cliente.query<{ id: string }>(
          'select id from app.obligation_published_rules(current_date) limit 1',
        );
        await cliente.query(
          "select app.obligation_calendar_has_coverage('ESTADUAL','SP',null,date '2026-10-01')",
        );
        const nome = regras.rows[0]
          ? await cliente.query('select app.obligation_rule_name($1::uuid)', [regras.rows[0].id])
          : null;
        const agenda = await listarAgenda(cliente, c.tenantA, c.usuarios.admin, {
          competencia: '2026-10',
          limite: 20,
          deslocamento: 0,
        });
        return { geradas, possuiRegra: regras.rowCount !== 0, nomeLido: nome !== null, agenda };
      },
    );

    expect(resultado.agenda.total).toBe(0);
    expect(resultado.agenda.ocorrencias).toEqual([]);
    if (resultado.possuiRegra) expect(resultado.nomeLido).toBe(true);
  });

  it('permite ao scheduler ler regras e calendário no contexto técnico da empresa', async () => {
    await comContexto(
      app,
      contextoTecnico({
        identidadeTecnica: 'workers-dfe-capture',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId: c.tenantA,
        empresaId: c.empresaA1,
        correlationId: 'obligations-technical-context',
      }),
      async (cliente) => {
        await cliente.query("select * from app.obligation_published_rules(date '2026-10-01')");
        await cliente.query("select * from app.obligation_holiday_list(date '2026-10-01',date '2026-10-31')");
        await cliente.query(
          "select app.obligation_calendar_has_coverage('ESTADUAL','SP',null,date '2026-10-01')",
        );
      },
    );
  });
});
