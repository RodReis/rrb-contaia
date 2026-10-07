/**
 * Monitor global do Signer (SPEC-012 §3.10) pelas funções estreitas, sob o contexto de serviço
 * `MONITORAMENTO_DO_SIGNER`. Toda tabela global fica fechada para a aplicação; só estas funções entram.
 */
import { randomUUID } from 'node:crypto';

import { contextoDeServico, contextoTecnico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from '../client.js';
import { comContexto, semContexto } from '../contexto.js';
import { limparCenario, montarCenario, type Cenario } from '../testes/cenario-rls.js';
import { comoUsuario } from '../testes/suporte.js';
import { estadoDoServicoParaPainel } from './signer-consultas.js';
import {
  abrirIncidente,
  encerrarIncidente,
  estadoDoMonitor,
  notificarIncidente,
  registrarVerificacao,
} from './signer-monitor.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();
let c: Cenario;

const comoMonitor = <T>(executar: (cliente: PoolClient) => Promise<T>): Promise<T> =>
  comContexto(
    app,
    contextoDeServico({
      identidadeTecnica: 'workers-monitor-signer',
      finalidade: 'MONITORAMENTO_DO_SIGNER',
      correlationId: 'teste-monitor-repo',
    }),
    executar,
  );

const limparGlobais = async (): Promise<void> => {
  const cliente = await admin.connect();

  try {
    await cliente.query('set session_replication_role = replica');
    await cliente.query('delete from app.signer_verificacao');
    await cliente.query('delete from app.signer_incidente_evento');
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }
};

/**
 * As tabelas do monitor são GLOBAIS e outras suítes (db e workers) também as usam, em paralelo:
 * um lock consultivo de sessão, mantido até o fim, serializa quem toca nelas.
 */
const CHAVE_DA_TRAVA_DO_MONITOR = 7_012_001;
let travaDoMonitor: PoolClient | null = null;

beforeAll(async () => {
  travaDoMonitor = await admin.connect();
  await travaDoMonitor.query('select pg_advisory_lock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  c = await montarCenario(admin);
  const referencia = randomUUID();
  await admin.query(
    `insert into app.empresa_certificado
       (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
        numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo, cadastrado_por)
     values ($1, $2, 1, 'VIGENTE', 'Titular', '00000000000000', 'AC', array['AC'], $3, $4,
             '2026-01-01', '2027-01-01', $5, $6, $5)`,
    [c.tenantA, c.empresaA1, `serie-${referencia}`, `imp-${referencia}`, c.usuarios.admin, referencia],
  );
  await limparGlobais();
}, 60_000);

afterAll(async () => {
  await limparGlobais();
  await limparCenario(admin, c);
  await travaDoMonitor?.query('select pg_advisory_unlock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  travaDoMonitor?.release();
  await Promise.all([admin.end(), app.end()]);
});

describe('estado e verificações', () => {
  it('sem histórico: zero falhas e nenhum incidente aberto', async () => {
    await limparGlobais();

    const estado = await comoMonitor((cli) => estadoDoMonitor(cli));

    expect(estado).toEqual({ falhasConsecutivas: 0, incidenteId: null, incidenteAbertoEm: null });
  });

  it('conta só as falhas depois da última verificação válida', async () => {
    await limparGlobais();

    for (const resultado of ['FALHA', 'FALHA', 'OK', 'FALHA', 'FALHA', 'FALHA'] as const) {
      await comoMonitor((cli) => registrarVerificacao(cli, { resultado, latenciaMs: resultado === 'OK' ? 9 : null, correlationId: 'v' }));
    }

    expect((await comoMonitor((cli) => estadoDoMonitor(cli))).falhasConsecutivas).toBe(3);
  });

  it('só o contexto de serviço alcança o monitor: o técnico da empresa não', async () => {
    await expect(
      comContexto(
        app,
        contextoTecnico({
          identidadeTecnica: 'signer',
          finalidade: 'PROCESSAMENTO_DE_EMPRESA',
          tenantId: c.tenantA,
          empresaId: c.empresaA1,
          correlationId: 'x',
        }),
        (cli) => estadoDoMonitor(cli),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('estado do serviço para o painel (leitura por contexto humano ou técnico)', () => {
  const comoHumano = <T>(executar: (cliente: PoolClient) => Promise<T>): Promise<T> =>
    comoUsuario(app, c.tenantA, c.usuarios.naCarteira, executar);

  it('sem nenhuma verificação: tudo nulo e nenhum incidente', async () => {
    await limparGlobais();

    expect(await comoHumano((cli) => estadoDoServicoParaPainel(cli))).toEqual({
      ultimaVerificacaoEm: null,
      ultimoResultado: null,
      ultimaLatenciaMs: null,
      incidenteAberto: false,
    });
  });

  it('devolve a última verificação, a última latência VÁLIDA e se há incidente aberto', async () => {
    await limparGlobais();
    await comoMonitor((cli) => registrarVerificacao(cli, { resultado: 'OK', latenciaMs: 12, correlationId: 'p1' }));
    await comoMonitor((cli) => registrarVerificacao(cli, { resultado: 'FALHA', latenciaMs: null, correlationId: 'p2' }));
    await comoMonitor((cli) => abrirIncidente(cli));

    const estado = await comoHumano((cli) => estadoDoServicoParaPainel(cli));

    expect(estado).toMatchObject({ ultimoResultado: 'FALHA', ultimaLatenciaMs: 12, incidenteAberto: true });
    expect(estado.ultimaVerificacaoEm).toBeInstanceOf(Date);
  });

  it('o contexto técnico da empresa também lê; sem contexto algum, não', async () => {
    const tecnico = await comContexto(
      app,
      contextoTecnico({
        identidadeTecnica: 'api',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId: c.tenantA,
        empresaId: c.empresaA1,
        correlationId: 'p3',
      }),
      (cli) => estadoDoServicoParaPainel(cli),
    );

    expect(tecnico).toHaveProperty('incidenteAberto');
    await expect(semContexto(app, (cli) => estadoDoServicoParaPainel(cli))).rejects.toMatchObject({ code: '42501' });
  });

  it('o contexto de serviço do monitor não é o leitor do painel', async () => {
    await expect(comoMonitor((cli) => estadoDoServicoParaPainel(cli))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('incidente', () => {
  it('abre um único incidente mesmo se pedido duas vezes e o estado o enxerga', async () => {
    await limparGlobais();

    const primeiro = await comoMonitor((cli) => abrirIncidente(cli));
    const segundo = await comoMonitor((cli) => abrirIncidente(cli));
    const estado = await comoMonitor((cli) => estadoDoMonitor(cli));

    expect(segundo).toBe(primeiro);
    expect(estado.incidenteId).toBe(primeiro);
    expect(estado.incidenteAbertoEm).toBeInstanceOf(Date);
  });

  it('notifica os administradores com A1 vigente, sem duplicar, e a recuperação vai aos mesmos', async () => {
    await limparGlobais();
    const incidente = await comoMonitor((cli) => abrirIncidente(cli));

    const criadas = await comoMonitor((cli) => notificarIncidente(cli, incidente, 'INDISPONIBILIDADE', null));
    const repetidas = await comoMonitor((cli) => notificarIncidente(cli, incidente, 'INDISPONIBILIDADE', null));

    expect(criadas).toBeGreaterThanOrEqual(1);
    expect(repetidas).toBe(0);

    await comoMonitor((cli) => encerrarIncidente(cli, incidente, 120_000));
    const recuperacoes = await comoMonitor((cli) => notificarIncidente(cli, incidente, 'RECUPERACAO', 120_000));

    expect(recuperacoes).toBe(criadas);
    expect((await comoMonitor((cli) => estadoDoMonitor(cli))).incidenteId).toBeNull();
  });
});
