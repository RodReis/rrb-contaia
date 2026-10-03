/**
 * Alçada por empresa (SPEC-009 §3.5): o guard delega a decisão ao serviço de
 * carteira e nunca decide pelo papel — nem para o administrador.
 */
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import type { CarteiraService } from '../carteira/carteira.service';
import { GuardDeEscopoDeEmpresa } from './escopo';
import type { RequisicaoAutenticada } from './sessao.guard';

const requisicaoCom = (params: Record<string, string> = {}): RequisicaoAutenticada =>
  ({
    sessao: { papeis: ['admin_escritorio'], tenantId: 'tenant-1', usuarioId: 'usuario-1' },
    params,
  }) as unknown as RequisicaoAutenticada;

const contexto = (requisicao: RequisicaoAutenticada): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => requisicao }) }) as unknown as ExecutionContext;

describe('GuardDeEscopoDeEmpresa', () => {
  it('rota por empresa pergunta à carteira com tenant e usuário da sessão', async () => {
    const carteira = { exigirAcessoAEmpresa: vi.fn().mockResolvedValue(undefined) };
    const guard = new GuardDeEscopoDeEmpresa(carteira as unknown as CarteiraService);

    await expect(guard.canActivate(contexto(requisicaoCom({ empresaId: 'e-1' })))).resolves.toBe(
      true,
    );
    expect(carteira.exigirAcessoAEmpresa).toHaveBeenCalledWith('tenant-1', 'usuario-1', 'e-1', true);
  });

  it('empresa fora da carteira nega a rota, mesmo para o administrador', async () => {
    const negado = new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA, 'fora');
    const carteira = { exigirAcessoAEmpresa: vi.fn().mockRejectedValue(negado) };
    const guard = new GuardDeEscopoDeEmpresa(carteira as unknown as CarteiraService);

    await expect(guard.canActivate(contexto(requisicaoCom({ empresaId: 'e-1' })))).rejects.toBe(
      negado,
    );
  });

  it('rota sem empresaId não é decidida por este guard', async () => {
    const carteira = { exigirAcessoAEmpresa: vi.fn() };
    const guard = new GuardDeEscopoDeEmpresa(carteira as unknown as CarteiraService);

    await expect(guard.canActivate(contexto(requisicaoCom()))).resolves.toBe(true);
    expect(carteira.exigirAcessoAEmpresa).not.toHaveBeenCalled();
  });
});
