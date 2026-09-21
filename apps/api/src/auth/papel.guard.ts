/**
 * Guard de papel (SPEC-005 §5.2): restringe a rota a papéis específicos.
 * Mesmo padrão de `GuardDeCadastro` — metadado por decorator, lido via
 * `Reflector`, `getAllAndOverride` para herdar de classe ou sobrescrever no
 * método.
 */
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import type { RequisicaoAutenticada } from './sessao.guard';

export const PAPEIS_EXIGIDOS = 'papeisExigidos';
export const ExigePapel = (...papeis: readonly string[]): ClassDecorator & MethodDecorator =>
  SetMetadata(PAPEIS_EXIGIDOS, papeis);

@Injectable()
export class GuardDePapel implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const papeisExigidos = this.reflector.getAllAndOverride<readonly string[] | undefined>(
      PAPEIS_EXIGIDOS,
      [contexto.getHandler(), contexto.getClass()],
    );

    if (papeisExigidos === undefined || papeisExigidos.length === 0) {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const papelDaSessao = requisicao.sessao?.papel;

    if (papelDaSessao === undefined || !papeisExigidos.includes(papelDaSessao)) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
        'Sem autorização para este recurso.',
      );
    }

    return true;
  }
}
