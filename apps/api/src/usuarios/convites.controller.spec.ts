import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { ConvitesController } from './convites.controller';

const TOKEN = 'a'.repeat(43);

const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('ConvitesController (público)', () => {
  it('GET /convites/:token delega a consulta e devolve só o que a página precisa', async () => {
    const servico = {
      consultar: vi.fn(async () => ({
        nome: 'Ana',
        emailMascarado: 'a***@x.com',
        expiraEm: '2026-10-04T12:00:00.000Z',
      })),
      aceitar: vi.fn(),
    };

    const resposta = await new ConvitesController(servico as never).consultar(TOKEN);

    expect(servico.consultar).toHaveBeenCalledWith(TOKEN);
    expect(Object.keys(resposta).sort()).toEqual(['emailMascarado', 'expiraEm', 'nome']);
  });

  it('POST /convites/aceitar valida o corpo e delega token e senha', async () => {
    const servico = { consultar: vi.fn(), aceitar: vi.fn(async () => undefined) };

    await new ConvitesController(servico as never).aceitar({ token: TOKEN, senha: 'senha-longa-123' });

    expect(servico.aceitar).toHaveBeenCalledWith(TOKEN, 'senha-longa-123');
  });

  it('corpo sem senha ou com tipos errados é 422 e o serviço não é chamado', async () => {
    const servico = { consultar: vi.fn(), aceitar: vi.fn() };
    const controller = new ConvitesController(servico as never);

    for (const ruim of [{ token: TOKEN }, { senha: 'x' }, null, { token: 1, senha: 2 }]) {
      expect(await codigoDe(() => controller.aceitar(ruim))).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
    }

    expect(servico.aceitar).not.toHaveBeenCalled();
  });
});
