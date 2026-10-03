/**
 * A sessão só existe para usuário ATIVO: a identidade é relida do banco a cada
 * requisição, então suspensão, arquivamento e troca de papel valem na próxima
 * requisição mesmo com o access token ainda dentro da validade (SPEC-007 §3.4).
 */
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jwtVerifyMock, resolverIdentidadeMock } = vi.hoisted(() => ({
  jwtVerifyMock: vi.fn(),
  resolverIdentidadeMock: vi.fn(),
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

vi.mock('@contaia/db', () => ({
  semContexto: async (_pool: unknown, executar: (cliente: unknown) => Promise<unknown>) =>
    executar({}),
  resolverIdentidade: resolverIdentidadeMock,
}));

import { PoolDoBanco } from '../banco/pool.provider';
import { SessaoService } from './sessao.service';

const servico = (): SessaoService => new SessaoService({ instancia: {} } as unknown as PoolDoBanco);

describe('SessaoService.resolver', () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
    resolverIdentidadeMock.mockReset();
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'sub-1', email: 'ana@x.com' } });
  });

  it('devolve identidade com os papéis vigentes do banco', async () => {
    resolverIdentidadeMock.mockResolvedValue({
      usuarioId: 'u1',
      tenantId: 't1',
      papeis: ['contador', 'auxiliar'],
      permissoesPersonalizadas: [],
      statusDoTenant: 'ATIVO',
    });

    const sessao = await servico().resolver('token');

    expect(sessao.papeis).toEqual(['contador', 'auxiliar']);
    expect(sessao.sub).toBe('sub-1');
    expect(sessao.email).toBe('ana@x.com');
  });

  it('a permissão efetiva une papéis padrão e personalizados (SPEC-008 §3.4)', async () => {
    resolverIdentidadeMock.mockResolvedValue({
      usuarioId: 'u1',
      tenantId: 't1',
      papeis: ['auxiliar'],
      permissoesPersonalizadas: ['historico.global.consultar', 'empresas.cadastro.consultar'],
      statusDoTenant: 'ATIVO',
    });

    const { permissoes } = await servico().resolver('token');

    expect(permissoes).toContain('empresas.cadastro.criar');
    expect(permissoes).toContain('historico.global.consultar');
    expect(new Set(permissoes).size).toBe(permissoes.length);
  });

  it('só personalizado também resolve, e chave obsoleta ou exclusiva do banco não concede nada', async () => {
    resolverIdentidadeMock.mockResolvedValue({
      usuarioId: 'u1',
      tenantId: 't1',
      papeis: [],
      permissoesPersonalizadas: [
        'empresas.cadastro.consultar',
        'empresas.cadastro.excluir',
        'usuarios.usuarios_e_papeis.administrar',
      ],
      statusDoTenant: 'ATIVO',
    });

    const { permissoes } = await servico().resolver('token');

    expect(permissoes).toEqual(['empresas.cadastro.consultar']);
  });

  it('token válido de usuário suspenso, arquivado ou ainda convidado não cria sessão', async () => {
    // O banco só resolve ATIVO (app.resolver_identidade): os três chegam como null.
    resolverIdentidadeMock.mockResolvedValue(null);

    await expect(servico().resolver('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token com assinatura inválida é recusado antes de consultar o banco', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('assinatura inválida'));

    await expect(servico().resolver('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolverIdentidadeMock).not.toHaveBeenCalled();
  });

  it('token sem sub é recusado', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { email: 'ana@x.com' } });

    await expect(servico().resolver('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolverIdentidadeMock).not.toHaveBeenCalled();
  });
});
