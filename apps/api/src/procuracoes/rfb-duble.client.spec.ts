import { afterEach, describe, expect, it, vi } from 'vitest';

import { RfbDubleClient } from './rfb-duble.client';

const entrada = {
  poder: 'RFB_CNPJ_STATUS_READ' as const,
  cnpj: '11222333000181',
  idempotencyKey: 'f'.repeat(64),
  correlationId: 'corr-rfb-1',
};

describe('RfbDubleClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aceita somente os campos tipados e descarta o restante da resposta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'OK',
            summary: {
              operacao: 'CNPJ_STATUS',
              cnpj: entrada.cnpj,
              numero: null,
              token: 'segredo',
              payload: { conteudo: 'não guardar' },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(new RfbDubleClient().executar(entrada)).resolves.toEqual({
      code: 'OK',
      summary: { operacao: 'CNPJ_STATUS', cnpj: entrada.cnpj },
    });
  });

  it('recusa operação ou CNPJ divergentes sem expor o conteúdo recebido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'OK',
            summary: {
              operacao: 'OUTRA_OPERACAO',
              cnpj: entrada.cnpj,
              token: 'segredo',
            },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(new RfbDubleClient().executar(entrada)).resolves.toEqual({
      code: 'RESPOSTA_INVALIDA',
      summary: { sucesso: false },
    });
  });

  it('limita o tamanho da resposta antes de interpretar JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(' '.repeat(16_385), { status: 200 })),
    );
    await expect(new RfbDubleClient().executar(entrada)).resolves.toEqual({
      code: 'RESPOSTA_INVALIDA',
      summary: { sucesso: false },
    });
  });
});
