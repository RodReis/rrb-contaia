/**
 * Guard de permissão (SPEC-007 §3.1, SPEC-008 §3.4): cada rota declara as chaves
 * do catálogo que exige, e o servidor confere contra a permissão efetiva da
 * sessão — a união aditiva dos papéis padrão e personalizados do usuário,
 * resolvida a cada requisição.
 *
 * Falha fechada: rota autenticada sem `@ExigePermissao` nem `@AcaoLivre` é negada.
 * Esquecer a anotação nunca abre acesso — e `cobertura-de-acoes.spec.ts`
 * reprova a rota esquecida antes de chegar a produção.
 */
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CODIGOS_DE_ERRO, ErroDeDominio, type ChaveDePermissao } from '@contaia/domain';

import type { RequisicaoAutenticada } from './sessao.guard';

export const ACAO_EXIGIDA = 'acaoExigida';

type AcaoExigida = readonly ChaveDePermissao[] | 'LIVRE';

/** Exige todas as chaves listadas: cada uma precisa constar da permissão efetiva da sessão. */
export const ExigePermissao = (
  ...chaves: readonly ChaveDePermissao[]
): ClassDecorator & MethodDecorator => SetMetadata<string, AcaoExigida>(ACAO_EXIGIDA, chaves);

/** Qualquer sessão autenticada acessa; reservado a rotas que não dependem de papel. */
export const AcaoLivre = (): ClassDecorator & MethodDecorator =>
  SetMetadata<string, AcaoExigida>(ACAO_EXIGIDA, 'LIVRE');

const semAutorizacao = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Sem autorização para este recurso.');

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
    const permissoes = requisicao.sessao?.permissoes;

    const autorizado =
      exigida !== undefined &&
      exigida.length > 0 &&
      permissoes !== undefined &&
      exigida.every((chave) => permissoes.includes(chave));

    if (!autorizado) {
      throw semAutorizacao();
    }

    return true;
  }
}
