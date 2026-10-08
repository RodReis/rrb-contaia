/**
 * Enfileiramento da validação (SPEC-013 §6.4): id determinístico, comando validado pelo contrato,
 * reenfileiramento só quando o job anterior já terminou e prazo contra Redis travado.
 */
import { idDoJobDeValidacao } from '@contaia/shared';
import { describe, expect, it, vi } from 'vitest';

import { criarFilaDeValidacaoDoPlano, enfileirarValidacao, type JobDoBullmq } from './plano-contas.fila';

const COMANDO = {
  tenantId: '0198f3c2-0000-7000-8000-000000000001',
  empresaId: '0198f3c2-0000-7000-8000-000000000002',
  tentativaId: '0198f3c2-0000-7000-8000-000000000003',
  correlationId: 'corr-fila-0001',
} as const;

const filaDublada = (existente: JobDoBullmq | undefined = undefined) => ({
  add: vi.fn().mockResolvedValue({}),
  getJob: vi.fn().mockResolvedValue(existente),
});

const job = (estado: string) => ({ getState: vi.fn().mockResolvedValue(estado), remove: vi.fn().mockResolvedValue(undefined) });

describe('enfileirarValidacao', () => {
  it('adiciona o job com o id determinístico da tentativa e as opções de retry', async () => {
    const fila = filaDublada();

    await enfileirarValidacao(fila, COMANDO);

    expect(fila.add).toHaveBeenCalledWith(
      'validar-importacao',
      COMANDO,
      expect.objectContaining({ jobId: idDoJobDeValidacao(COMANDO.tentativaId), attempts: 5 }),
    );
  });

  it.each(['waiting', 'active', 'delayed'])('job ainda %s: não adiciona outro', async (estado) => {
    const anterior = job(estado);
    const fila = filaDublada(anterior);

    await enfileirarValidacao(fila, COMANDO);

    expect(fila.add).not.toHaveBeenCalled();
    expect(anterior.remove).not.toHaveBeenCalled();
  });

  it.each(['failed', 'completed'])('job anterior %s: remove e adiciona de novo', async (estado) => {
    const anterior = job(estado);
    const fila = filaDublada(anterior);

    await enfileirarValidacao(fila, COMANDO);

    expect(anterior.remove).toHaveBeenCalledTimes(1);
    expect(fila.add).toHaveBeenCalledTimes(1);
  });

  it('comando fora do contrato (campo extra ou id malformado) não sai do processo', async () => {
    const fila = filaDublada();

    await expect(enfileirarValidacao(fila, { ...COMANDO, mapeamento: {} } as never)).rejects.toThrow();
    await expect(enfileirarValidacao(fila, { ...COMANDO, tentativaId: 'x' })).rejects.toThrow();
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('Redis travado: desiste no prazo em vez de esperar para sempre', async () => {
    const fila = { add: vi.fn(), getJob: vi.fn(() => new Promise<never>(() => undefined)) };

    await expect(enfileirarValidacao(fila, COMANDO, 20)).rejects.toThrow(/prazo/u);
  });
});

describe('criarFilaDeValidacaoDoPlano', () => {
  it('sem REDIS_URL a fila falha sem rede (o caso de uso responde fila indisponível)', async () => {
    await expect(criarFilaDeValidacaoDoPlano({}).enfileirar(COMANDO)).rejects.toThrow(/REDIS_URL/u);
  });
});
