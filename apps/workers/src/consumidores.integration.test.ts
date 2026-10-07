/**
 * Filas do Signer no Redis real (SPEC-012 §3.8–§3.10): diagnóstico com retry exponencial, teto e
 * DLQ, e o agendador do monitor. O prefixo isola esta execução de qualquer outra fila do Redis.
 */
import {
  ErroDoClienteDoSigner,
  FILA_DE_DIAGNOSTICO,
  FILA_DE_DIAGNOSTICO_MORTA,
  FILA_DO_MONITOR,
  ID_DO_AGENDADOR_DO_MONITOR,
  conexaoDoRedis,
  enfileirarDiagnostico,
  idDoJobDeDiagnostico,
} from '@contaia/signer-client';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { iniciarConsumidores, type Consumidores } from './consumidores.js';
import { criarConexaoRedis } from './redis.js';

const conexao = conexaoDoRedis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:26379');
const prefixo = `teste-${process.pid}-${Date.now()}`;

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const comando = (correlationId: string, finalidade: 'DFE_TESTE' | 'ESOCIAL_TESTE' = 'DFE_TESTE') =>
  ({ tenantId: TENANT, empresaId: EMPRESA, finalidade, correlationId, origem: 'AUTOMATICO' }) as const;

const resposta = { operacaoId: 'op-1', reutilizado: false, resultado: 'SUCESSO', codigo: null } as const;
const diagnosticar = vi.fn();
const verificar = vi.fn(async () => ({ resultado: 'OK', efeitos: [] }));

const redisDoTeste = criarConexaoRedis(conexao);
let fila: Queue;
let morta: Queue;
let consumidores: Consumidores;

/** Opções rápidas para o teste: o padrão de produção espera segundos entre as tentativas. */
const RAPIDAS = { attempts: 3, backoff: { type: 'fixed', delay: 30 }, removeOnFail: false } as const;

const esperar = async (condicao: () => boolean | Promise<boolean>, ms = 8_000): Promise<void> => {
  const limite = Date.now() + ms;

  while (!(await condicao())) {
    if (Date.now() > limite) {
      throw new Error('a condição não ocorreu a tempo');
    }
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
};

beforeAll(async () => {
  fila = new Queue(FILA_DE_DIAGNOSTICO, { connection: redisDoTeste, prefix: prefixo });
  morta = new Queue(FILA_DE_DIAGNOSTICO_MORTA, { connection: redisDoTeste, prefix: prefixo });
  consumidores = await iniciarConsumidores({
    conexao,
    prefixo,
    cliente: { diagnosticar },
    verificar,
    intervaloDoMonitorMs: 150,
  });
}, 30_000);

afterAll(async () => {
  await consumidores.fechar();
  await fila.obliterate({ force: true });
  await morta.obliterate({ force: true });
  await new Queue(FILA_DO_MONITOR, { connection: redisDoTeste, prefix: prefixo }).obliterate({ force: true });
  await Promise.all([fila.close(), morta.close()]);
  redisDoTeste.disconnect();
});

beforeEach(async () => {
  diagnosticar.mockReset();
  await fila.obliterate({ force: true });
  await morta.obliterate({ force: true });
});

describe('diagnóstico na fila', () => {
  it('processa o job pelo cliente do Signer e o conclui', async () => {
    diagnosticar.mockResolvedValue(resposta);

    await enfileirarDiagnostico(fila, comando('fila-0001-abcd'));
    await esperar(() => diagnosticar.mock.calls.length === 1);

    expect(diagnosticar).toHaveBeenCalledWith(comando('fila-0001-abcd'));
    await esperar(async () => (await fila.getJobCounts('completed')).completed === 1);
  });

  it('o mesmo diagnóstico enfileirado duas vezes roda uma vez (id determinístico)', async () => {
    diagnosticar.mockResolvedValue(resposta);

    await enfileirarDiagnostico(fila, comando('fila-0002-abcd'));
    await enfileirarDiagnostico(fila, comando('fila-0002-abcd'));
    await esperar(() => diagnosticar.mock.calls.length >= 1);
    await new Promise((resolver) => setTimeout(resolver, 300));

    expect(diagnosticar).toHaveBeenCalledTimes(1);
    expect(await fila.getJob(idDoJobDeDiagnostico(comando('fila-0002-abcd')))).toBeDefined();
  });

  it('falha transitória repete com backoff e termina em sucesso, sem ir para a fila morta', async () => {
    const transitoria = new ErroDoClienteDoSigner('SIGNER_DESTINO_INDISPONIVEL', 504, 'x', true);
    diagnosticar.mockRejectedValueOnce(transitoria).mockRejectedValueOnce(transitoria).mockResolvedValue(resposta);

    await fila.add('diagnosticar', comando('fila-0003-abcd'), { ...RAPIDAS, jobId: 'job-transitorio' });
    await esperar(async () => (await fila.getJobCounts('completed')).completed === 1);

    expect(diagnosticar).toHaveBeenCalledTimes(3);
    expect(await morta.getJobCounts('waiting', 'completed', 'failed')).toMatchObject({ waiting: 0 });
  });

  it('esgotadas as tentativas, o job vai para a fila morta com o código estável e o total de tentativas', async () => {
    diagnosticar.mockRejectedValue(new ErroDoClienteDoSigner('SIGNER_DESTINO_INDISPONIVEL', 504, 'x', true));

    await fila.add('diagnosticar', comando('fila-0004-abcd'), { ...RAPIDAS, jobId: 'job-esgotado' });
    await esperar(async () => (await morta.getJobCounts('waiting')).waiting === 1);

    expect(diagnosticar).toHaveBeenCalledTimes(3);
    const [item] = await morta.getJobs(['waiting']);
    expect(item?.data).toMatchObject({ ...comando('fila-0004-abcd'), motivo: 'SIGNER_DESTINO_INDISPONIVEL', tentativas: 3 });
  });

  it('falha definitiva não repete: vai à fila morta na primeira tentativa', async () => {
    diagnosticar.mockRejectedValue(new ErroDoClienteDoSigner('SIGNER_CERTIFICADO_VENCIDO', 409, 'x', false));

    await fila.add('diagnosticar', comando('fila-0005-abcd'), { ...RAPIDAS, jobId: 'job-definitivo' });
    await esperar(async () => (await morta.getJobCounts('waiting')).waiting === 1);

    expect(diagnosticar).toHaveBeenCalledTimes(1);
    const [item] = await morta.getJobs(['waiting']);
    expect(item?.data).toMatchObject({ motivo: 'SIGNER_CERTIFICADO_VENCIDO', tentativas: 1 });
  });

  it('a mensagem crua de uma exceção qualquer nunca chega à fila morta', async () => {
    diagnosticar.mockRejectedValue(new Error('SENHA-SENTINELA-NAO-PODE-VAZAR'));

    await fila.add('diagnosticar', comando('fila-0006-abcd'), { attempts: 1, removeOnFail: false, jobId: 'job-sentinela' });
    await esperar(async () => (await morta.getJobCounts('waiting')).waiting === 1);

    const [item] = await morta.getJobs(['waiting']);
    expect(JSON.stringify(item?.data)).not.toContain('SENTINELA');
    expect(item?.data).toMatchObject({ motivo: 'SIGNER_INDISPONIVEL' });
  });
});

describe('monitor agendado', () => {
  it('registra o agendador do monitor e a verificação roda repetidamente', async () => {
    const fila_do_monitor = new Queue(FILA_DO_MONITOR, { connection: redisDoTeste, prefix: prefixo });

    await esperar(() => verificar.mock.calls.length >= 2);

    const agendadores = await fila_do_monitor.getJobSchedulers();
    expect(agendadores.map((a) => a.key)).toContain(ID_DO_AGENDADOR_DO_MONITOR);
    expect(agendadores.find((a) => a.key === ID_DO_AGENDADOR_DO_MONITOR)?.every).toBe(150);
    await fila_do_monitor.close();
  });
});
