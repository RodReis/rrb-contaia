/**
 * Guards de acesso (SPEC-001 §3.1).
 *
 * `GuardDeSessao` exige token válido e usuário conhecido. `GuardDeCadastro`
 * bloqueia área operacional enquanto o tenant estiver `CADASTRO_INCOMPLETO` —
 * no servidor, porque esconder navegação no cliente não é controle de acesso.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { SessaoService, type SessaoDaRequisicao } from './sessao.service';

export type RequisicaoAutenticada = Request & { sessao?: SessaoDaRequisicao };

/** Rota liberada para tenant ainda em cadastro: o próprio wizard e o perfil. */
export const PERMITE_CADASTRO_INCOMPLETO = 'permiteCadastroIncompleto';
export const PermiteCadastroIncompleto = (): ClassDecorator & MethodDecorator =>
  SetMetadata(PERMITE_CADASTRO_INCOMPLETO, true);

const extrairToken = (requisicao: Request): string => {
  const cabecalho = requisicao.header('authorization') ?? '';
  const [esquema, token] = cabecalho.split(' ');

  if (esquema?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    throw new UnauthorizedException('Sessão inválida ou expirada.');
  }

  return token;
};

@Injectable()
export class GuardDeSessao implements CanActivate {
  constructor(private readonly sessaoService: SessaoService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();

    requisicao.sessao = await this.sessaoService.resolver(extrairToken(requisicao));

    return true;
  }
}

@Injectable()
export class GuardDeCadastro implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permitido = this.reflector.getAllAndOverride<boolean>(PERMITE_CADASTRO_INCOMPLETO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (permitido === true) {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();

    if (requisicao.sessao?.statusDoTenant !== 'ATIVO') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO,
        'Conclua o cadastro do escritório para acessar esta área.',
      );
    }

    return true;
  }
}
