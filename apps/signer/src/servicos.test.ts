import { describe, expect, it } from 'vitest';

import { criarServicosDeSaude } from './servicos.js';

const AGORA = new Date('2026-10-07T12:00:00.000Z');

describe('saúde do Signer (SPEC-012 §3.10, §5.2)', () => {
  it('é operacional quando o Vault responde pronto, com o instante em UTC', async () => {
    const servicos = criarServicosDeSaude({ vault: { pronto: async () => true }, agora: () => AGORA });

    await expect(servicos.saude()).resolves.toEqual({
      versaoDoContrato: 'v1',
      estado: 'OPERACIONAL',
      verificadoEm: '2026-10-07T12:00:00.000Z',
    });
  });

  it('degrada, mas continua respondendo, quando o Vault não está pronto', async () => {
    const servicos = criarServicosDeSaude({ vault: { pronto: async () => false }, agora: () => AGORA });

    await expect(servicos.saude()).resolves.toMatchObject({ estado: 'DEGRADADO' });
  });

  it('as demais operações ainda não existem neste ponto e falham explicitamente', async () => {
    const servicos = criarServicosDeSaude({ vault: { pronto: async () => true }, agora: () => AGORA });

    await expect(servicos.assinar('worker', {} as never)).rejects.toMatchObject({
      codigo: 'SIGNER_INDISPONIVEL',
      status: 501,
    });
  });
});
