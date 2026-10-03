import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import type { RequisicaoAutenticada } from '../auth/sessao.guard';
import { HistoricoDeUsuariosController } from './historico-de-usuarios.controller';

const requisicao = {
  sessao: { papeis: ['admin_escritorio'], tenantId: 'tenant-1', usuarioId: 'autor-1' },
} as unknown as RequisicaoAutenticada;

describe('HistoricoDeUsuariosController', () => {
  it('repassa ao serviço o tenant da sessão e o filtro já convertido em intervalo', async () => {
    const servico = { consultarHistorico: vi.fn(async () => ({ eventos: [], total: 0 })) };

    await new HistoricoDeUsuariosController(servico as never).listar(requisicao, {
      tipo: 'SUSPENSO',
      de: '2026-10-01',
      ate: '2026-10-02',
      tenantId: 'tenant-malicioso',
    });

    const [tenant, filtro] = servico.consultarHistorico.mock.calls[0] as unknown as [
      string,
      { tipo: string; de: Date; ate: Date; limite: number; deslocamento: number },
    ];

    expect(tenant).toBe('tenant-1');
    expect(filtro.tipo).toBe('SUSPENSO');
    expect(filtro.de.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(filtro.ate.toISOString()).toBe('2026-10-03T03:00:00.000Z');
    expect(filtro).not.toHaveProperty('tenantId');
  });

  it('filtro inválido é 422 e o serviço não é chamado', async () => {
    const servico = { consultarHistorico: vi.fn() };

    try {
      await new HistoricoDeUsuariosController(servico as never).listar(requisicao, { tipo: 'X' });
      expect.unreachable();
    } catch (erro) {
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
    }

    expect(servico.consultarHistorico).not.toHaveBeenCalled();
  });
});
