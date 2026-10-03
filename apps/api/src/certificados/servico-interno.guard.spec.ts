/**
 * Guard das rotas internas do cofre: Bearer de serviço em tempo constante, falha fechado.
 */
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GuardDeServicoInterno } from './servico-interno.guard';

const TOKEN = 't'.repeat(48);

const contexto = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ header: (nome: string) => (nome === 'authorization' ? authorization : undefined) }),
    }),
  }) as unknown as ExecutionContext;

const guard = new GuardDeServicoInterno();
const original = process.env['COFRE_SERVICE_TOKEN'];

beforeEach(() => {
  process.env['COFRE_SERVICE_TOKEN'] = TOKEN;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env['COFRE_SERVICE_TOKEN'];
  } else {
    process.env['COFRE_SERVICE_TOKEN'] = original;
  }
});

describe('GuardDeServicoInterno', () => {
  it('aceita o Bearer de serviço', () => {
    expect(guard.canActivate(contexto(`Bearer ${TOKEN}`))).toBe(true);
    expect(guard.canActivate(contexto(`bearer ${TOKEN}`))).toBe(true);
  });

  it.each([
    ['sem cabeçalho', undefined],
    ['vazio', ''],
    ['esquema errado', `Basic ${TOKEN}`],
    ['token errado', `Bearer ${'x'.repeat(48)}`],
    ['token com o mesmo prefixo', `Bearer ${TOKEN.slice(0, -1)}`],
    ['sem token', 'Bearer'],
  ])('recusa %s', (_nome, cabecalho) => {
    expect(() => guard.canActivate(contexto(cabecalho))).toThrow(UnauthorizedException);
  });

  it('sem token configurado ninguém entra, nem com cabeçalho vazio', () => {
    delete process.env['COFRE_SERVICE_TOKEN'];

    expect(() => guard.canActivate(contexto('Bearer '))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contexto(`Bearer ${TOKEN}`))).toThrow(UnauthorizedException);
  });

  it('token configurado curto demais não vale', () => {
    process.env['COFRE_SERVICE_TOKEN'] = 'curto';

    expect(() => guard.canActivate(contexto('Bearer curto'))).toThrow(UnauthorizedException);
  });
});
