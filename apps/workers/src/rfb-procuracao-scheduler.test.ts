import { afterEach, describe, expect, it, vi } from 'vitest';

import { iniciarAgendadorDeAlertasDeProcuracao } from './rfb-procuracao-scheduler.js';

describe('agendador de alertas de procuração', () => {
  afterEach(() => vi.useRealTimers());

  it('executa na inicialização e repete no intervalo configurado', async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [{ total: 1 }] });
    const scheduler = iniciarAgendadorDeAlertasDeProcuracao({
      schedulerPool: { query } as never,
      intervaloMs: 10_000,
    });

    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'select app.rfb_procuracao_emitir_alertas()',
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(query).toHaveBeenCalledTimes(2);
    await scheduler.fechar();
  });

  it('registra falha sem dados de contexto sensíveis', async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockRejectedValue(new Error('detalhe interno'));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = iniciarAgendadorDeAlertasDeProcuracao({
      schedulerPool: { query } as never,
    });

    await Promise.resolve();
    expect(erro).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'rfb-procuracao-alert-scheduler-error',
        name: 'Error',
      }),
    );
    await scheduler.fechar();
    erro.mockRestore();
  });
});
