/**
 * Guard das rotas internas do cofre (`/interno/cofre/*`, SPEC-011 §6.2).
 *
 * Essas rotas não têm sessão de usuário: quem chama é o processo do cofre, autenticado
 * por Bearer de serviço (`COFRE_SERVICE_TOKEN`, ≥ 32 bytes). A comparação é em tempo
 * constante (compara os SHA-256, que têm sempre o mesmo tamanho) e FALHA FECHADO: sem token
 * configurado, ou curto demais, ninguém entra. O que o ticket autoriza é conferido depois,
 * no caso de uso, com o usuário do ticket.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { configuracaoDoCofre } from './cofre.client';
import { TAMANHO_MINIMO_DO_SEGREDO } from './ticket';

const digest = (texto: string): Buffer => createHash('sha256').update(texto).digest();

@Injectable()
export class GuardDeServicoInterno implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const esperado = configuracaoDoCofre().serviceToken;
    const cabecalho = contexto.switchToHttp().getRequest<Request>().header('authorization') ?? '';
    const [esquema, token = ''] = cabecalho.split(' ');

    const autorizado =
      esperado.length >= TAMANHO_MINIMO_DO_SEGREDO &&
      esquema?.toLowerCase() === 'bearer' &&
      timingSafeEqual(digest(token), digest(esperado));

    if (!autorizado) {
      throw new UnauthorizedException('Serviço não autorizado.');
    }

    return true;
  }
}
