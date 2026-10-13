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

  it('API em contêiner: o JWKS vem do endereço interno, mas o emissor validado segue o público', async () => {
    process.env['KEYCLOAK_ISSUER_URL'] = 'http://127.0.0.1:18080/realms/contaia';
    process.env['KEYCLOAK_INTERNAL_URL'] = 'http://keycloak:8080/realms/contaia';
    resolverIdentidadeMock.mockResolvedValue(null);

    try {
      await servico().resolver('token').catch(() => undefined);
    } finally {
      delete process.env['KEYCLOAK_INTERNAL_URL'];
      delete process.env['KEYCLOAK_ISSUER_URL'];
    }

    const { createRemoteJWKSet } = await import('jose');

    expect(vi.mocked(createRemoteJWKSet).mock.calls.at(-1)?.[0].toString()).toBe(
      'http://keycloak:8080/realms/contaia/protocol/openid-connect/certs',
    );
    expect(jwtVerifyMock.mock.calls.at(-1)?.[2]).toEqual({ issuer: 'http://127.0.0.1:18080/realms/contaia' });
  });

  it('token sem sub é recusado', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { email: 'ana@x.com' } });

    await expect(servico().resolver('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolverIdentidadeMock).not.toHaveBeenCalled();
  });
});

/**
 * Decisão de acesso crítica (SPEC-016 §3.7): o papel de plataforma só vale vindo do papel de REALM
 * do token verificado, emitido para o cliente web. Nenhuma outra origem de claim o concede.
 */
describe('SessaoService.resolverParaCatalogo', () => {
  const comPayload = (payload: Record<string, unknown>): void => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'sub-9', email: 'root@x.com', azp: 'contaia-web', ...payload } });
  };

  beforeEach(() => {
    jwtVerifyMock.mockReset();
    resolverIdentidadeMock.mockReset();
    resolverIdentidadeMock.mockResolvedValue(null);
  });

  it('papel de realm super_admin vira sessão de plataforma, sem consultar usuário no banco', async () => {
    comPayload({ realm_access: { roles: ['offline_access', 'super_admin'] } });

    await expect(servico().resolverParaCatalogo('token')).resolves.toEqual({
      tipo: 'PLATAFORMA',
      sub: 'sub-9',
      email: 'root@x.com',
    });
    expect(resolverIdentidadeMock).not.toHaveBeenCalled();
  });

  it('super_admin só em resource_access (papel de cliente) NÃO concede plataforma: segue o escritório e cai em 401', async () => {
    comPayload({ resource_access: { 'contaia-web': { roles: ['super_admin'] } } });

    await expect(servico().resolverParaCatalogo('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolverIdentidadeMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['realm_access ausente', {}],
    ['realm_access como texto', { realm_access: 'super_admin' }],
    ['roles como texto', { realm_access: { roles: 'super_admin' } }],
    ['roles com item que não é texto', { realm_access: { roles: [{ nome: 'super_admin' }, 1] } }],
    ['realm_access nulo', { realm_access: null }],
  ])('claim malformada (%s) não concede papel algum', async (_nome, extra) => {
    comPayload(extra);

    await expect(servico().resolverParaCatalogo('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolverIdentidadeMock).toHaveBeenCalledTimes(1);
  });

  it('papel de plataforma sem sub é recusado', async () => {
    comPayload({ sub: '', realm_access: { roles: ['super_admin'] } });

    await expect(servico().resolverParaCatalogo('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token de outro cliente do realm (azp diferente) não vira plataforma, mesmo com o papel de realm', async () => {
    comPayload({ azp: 'admin-cli', realm_access: { roles: ['super_admin'] } });

    await expect(servico().resolverParaCatalogo('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolverIdentidadeMock).toHaveBeenCalledTimes(1);
  });

  it('usuário de escritório segue a resolução normal', async () => {
    comPayload({});
    resolverIdentidadeMock.mockResolvedValue({
      usuarioId: 'u1',
      tenantId: 't1',
      papeis: ['contador'],
      permissoesPersonalizadas: [],
      statusDoTenant: 'ATIVO',
    });

    const sessao = await servico().resolverParaCatalogo('token');

    expect(sessao).toMatchObject({ tipo: 'ESCRITORIO', sessao: { papeis: ['contador'] } });
  });
});
