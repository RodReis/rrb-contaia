/**
 * Guard de ação (SPEC-007 §3.1): cada rota declara a capacidade e a ação que
 * exige, e o servidor confere contra a matriz dos papéis padrão do usuário.
 * Permissões são aditivas: basta um dos papéis conceder a ação.
 *
 * Falha fechada: rota autenticada sem `@ExigeAcao` nem `@AcaoLivre` é negada.
 * Esquecer a anotação nunca abre acesso — e `cobertura-de-acoes.spec.ts`
 * reprova a rota esquecida antes de chegar a produção.
 */
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  podeExecutar,
  type Acao,
  type Capacidade,
} from '@contaia/domain';

import type { RequisicaoAutenticada } from './sessao.guard';

export const ACAO_EXIGIDA = 'acaoExigida';

type AcaoExigida = Readonly<{ capacidade: Capacidade; acao: Acao }> | 'LIVRE';

export const ExigeAcao = (capacidade: Capacidade, acao: Acao): ClassDecorator & MethodDecorator =>
  SetMetadata<string, AcaoExigida>(ACAO_EXIGIDA, { capacidade, acao });

/** Qualquer sessão autenticada acessa; reservado a rotas que não dependem de papel. */
export const AcaoLivre = (): ClassDecorator & MethodDecorator =>
  SetMetadata<string, AcaoExigida>(ACAO_EXIGIDA, 'LIVRE');

@Injectable()
export class GuardDeAcao implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exigida = this.reflector.getAllAndOverride<AcaoExigida | undefined>(ACAO_EXIGIDA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (exigida === 'LIVRE') {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const papeis = requisicao.sessao?.papeis;

    if (exigida === undefined || papeis === undefined || !podeExecutar(papeis, exigida.capacidade, exigida.acao)) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
        'Sem autorização para este recurso.',
      );
    }

    return true;
  }
}
