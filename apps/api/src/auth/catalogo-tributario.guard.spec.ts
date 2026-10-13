/**
 * Autorização do catálogo tributário (SPEC-016 §3.7): o `super_admin` da plataforma administra; os
 * papéis de escritório com a chave do catálogo consultam as regras publicadas e simulam. A API
 * revalida tudo a cada requisição e falha fechada quando a rota não declara o nível.
 */
import 'reflect-metadata';

import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  permissoesDosPapeisPadrao,
  type ChaveDePermissao,
  type PapelPadrao,
} from '@contaia/domain';

import {
  AutorizaCatalogo,
  GuardDoCatalogoTributario,
  type AtorDoCatalogo,
  type NivelDoCatalogo,
} from './catalogo-tributario.guard';
import type { SessaoDoCatalogo, SessaoService } from './sessao.service';

const SUB = '0198f3c2-0000-7000-8000-00000000a001';
const USUARIO = '0198f3c2-0000-7000-8000-00000000b002';

class Rotas {
  @AutorizaCatalogo('CONSULTA')
  consulta(): void {}

  @AutorizaCatalogo('SIMULACAO')
  simulacao(): void {}

  @AutorizaCatalogo('ADMINISTRACAO')
  administracao(): void {}

  semNivel(): void {}
}

const sessaoService = { resolverParaCatalogo: vi.fn<(token: string) => Promise<SessaoDoCatalogo>>() };
const guard = new GuardDoCatalogoTributario(new Reflector(), sessaoService as unknown as SessaoService);

type Requisicao = { headers: Record<string, string>; header: (nome: string) => string | undefined; atorDoCatalogo?: AtorDoCatalogo };

/** `authorization` nulo = requisição sem o cabeçalho. */
const contexto = (metodo: keyof Rotas, authorization: string | null = 'Bearer token-valido') => {
  const requisicao: Requisicao = {
    headers: authorization === null ? {} : { authorization },
    header: (nome) => (nome.toLowerCase() === 'authorization' ? (authorization ?? undefined) : undefined),
  };
  const execucao = {
    switchToHttp: () => ({ getRequest: () => requisicao }),
    getHandler: () => Rotas.prototype[metodo],
    getClass: () => Rotas,
  } as unknown as ExecutionContext;

  return { execucao, requisicao };
};

const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }
    if (erro instanceof UnauthorizedException) {
      return 'HTTP_401';
    }
    throw erro;
  }
  return undefined;
};

const escritorio = (
  permissoes: readonly ChaveDePermissao[],
  statusDoTenant: 'ATIVO' | 'CADASTRO_INCOMPLETO' = 'ATIVO',
): SessaoDoCatalogo => ({
  tipo: 'ESCRITORIO',
  sessao: { usuarioId: USUARIO, tenantId: 'tenant', statusDoTenant, permissoes } as unknown as Extract<
    SessaoDoCatalogo,
    { tipo: 'ESCRITORIO' }
  >['sessao'],
});

const superAdmin = (sub = SUB): SessaoDoCatalogo => ({ tipo: 'PLATAFORMA', sub, email: 'super@plataforma.local' });

beforeEach(() => {
  sessaoService.resolverParaCatalogo.mockReset();
});

describe('GuardDoCatalogoTributario — falha fechada', () => {
  it('exige o cabeçalho Authorization e nem consulta a sessão sem ele', async () => {
    const { execucao } = contexto('consulta', null);

    expect(await codigoDe(async () => guard.canActivate(execucao))).toBe('HTTP_401');
    expect(sessaoService.resolverParaCatalogo).not.toHaveBeenCalled();
  });

  it('propaga o 401 do token inválido ou expirado', async () => {
    sessaoService.resolverParaCatalogo.mockRejectedValue(new UnauthorizedException('Sessão inválida ou expirada.'));
    const { execucao } = contexto('consulta');

    expect(await codigoDe(async () => guard.canActivate(execucao))).toBe('HTTP_401');
  });

  it('nega rota que não declara o nível, mesmo para o super_admin', async () => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(superAdmin());
    const { execucao } = contexto('semNivel');

    expect(await codigoDe(async () => guard.canActivate(execucao))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });
});

describe('super_admin da plataforma', () => {
  it.each<NivelDoCatalogo>(['CONSULTA', 'SIMULACAO', 'ADMINISTRACAO'])('acessa o nível %s e vira o ator da auditoria', async (nivel) => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(superAdmin());
    const metodo = ({ CONSULTA: 'consulta', SIMULACAO: 'simulacao', ADMINISTRACAO: 'administracao' } as const)[nivel];
    const { execucao, requisicao } = contexto(metodo);

    await expect(guard.canActivate(execucao)).resolves.toBe(true);
    expect(requisicao.atorDoCatalogo).toEqual({ id: SUB, tipo: 'SUPER_ADMIN' });
    expect(sessaoService.resolverParaCatalogo).toHaveBeenCalledWith('token-valido');
  });

  it('recusa identificador de ator que não seja UUID, que a auditoria não aceitaria', async () => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(superAdmin('nao-e-uuid'));
    const { execucao } = contexto('administracao');

    expect(await codigoDe(async () => guard.canActivate(execucao))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });
});

describe('papéis de escritório (matriz da SPEC-016 §3.7, pelo catálogo real)', () => {
  const papeis: ReadonlyArray<readonly [PapelPadrao, boolean]> = [
    ['admin_escritorio', true],
    ['contador', true],
    ['auditor_readonly', true],
    ['auxiliar', false],
  ];

  it.each(papeis)('%s: consulta e simula = %s', async (papel, permitido) => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(escritorio(permissoesDosPapeisPadrao([papel])));

    for (const metodo of ['consulta', 'simulacao'] as const) {
      const { execucao, requisicao } = contexto(metodo);
      const codigo = await codigoDe(async () => guard.canActivate(execucao));

      expect(codigo).toBe(permitido ? undefined : CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
      expect(requisicao.atorDoCatalogo).toEqual(permitido ? { id: USUARIO, tipo: 'ESCRITORIO' } : undefined);
    }
  });

  it.each(papeis)('%s nunca administra o catálogo: PLATFORM_ADMIN_REQUIRED', async (papel) => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(escritorio(permissoesDosPapeisPadrao([papel])));
    const { execucao } = contexto('administracao');

    expect(await codigoDe(async () => guard.canActivate(execucao))).toBe(CODIGOS_DE_ERRO.PLATFORM_ADMIN_REQUIRED);
  });

  it('consultar sem simular não simula; simular sem consultar não consulta', async () => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(escritorio(['fiscal.motor_tributario.consultar']));
    expect(await codigoDe(async () => guard.canActivate(contexto('simulacao').execucao))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(await codigoDe(async () => guard.canActivate(contexto('consulta').execucao))).toBeUndefined();

    sessaoService.resolverParaCatalogo.mockResolvedValue(escritorio(['fiscal.motor_tributario.simular']));
    expect(await codigoDe(async () => guard.canActivate(contexto('consulta').execucao))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(await codigoDe(async () => guard.canActivate(contexto('simulacao').execucao))).toBeUndefined();
  });

  it('exige o cadastro do escritório concluído, como as demais áreas operacionais', async () => {
    sessaoService.resolverParaCatalogo.mockResolvedValue(
      escritorio(permissoesDosPapeisPadrao(['contador']), 'CADASTRO_INCOMPLETO'),
    );

    expect(await codigoDe(async () => guard.canActivate(contexto('consulta').execucao))).toBe(CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO);
  });
});
