import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutenticada } from '../auth/sessao.guard';
import { DashboardController } from './dashboard.controller';
import type { DashboardService } from './dashboard.service';

const requisicao = { sessao: { tenantId: '11111111-1111-4111-8111-111111111111', usuarioId: '22222222-2222-4222-8222-222222222222' } } as RequisicaoAutenticada;

describe('DashboardController', () => {
  it('valida filtros e usa tenant e usuário da sessão', () => {
    const service = { consultar: vi.fn(), motivos: vi.fn() } as unknown as DashboardService;
    const controller = new DashboardController(service);
    controller.consultar(requisicao, { cor: 'AMARELO', regime: 'SIMPLES_NACIONAL', ordem: 'NOME', limite: '50', deslocamento: '25' });
    expect(service.consultar).toHaveBeenCalledWith(requisicao.sessao?.tenantId, requisicao.sessao?.usuarioId, {
      busca: null, cor: 'AMARELO', regime: 'SIMPLES_NACIONAL', fonte: null, codigo: null, ordem: 'NOME', limite: 50, deslocamento: 25,
    });
    expect(() => controller.consultar(requisicao, { cor: 'AZUL' })).toThrow();
  });

  it('recusa empresa com identificador inválido no detalhe', () => {
    const service = { consultar: vi.fn(), motivos: vi.fn() } as unknown as DashboardService;
    const controller = new DashboardController(service);
    expect(() => controller.motivos(requisicao, 'empresa-invalida')).toThrow();
    expect(service.motivos).not.toHaveBeenCalled();
  });
});
