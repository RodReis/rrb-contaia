/**
 * Autorização do catálogo tributário global (SPEC-016 §3.7).
 *
 * O catálogo não pertence a tenant, então a sessão de escritório sozinha não serve: o
 * `super_admin` da plataforma (papel de realm, sem linha em `app.usuario`) administra; os papéis de
 * escritório com a chave do catálogo consultam as regras publicadas e simulam. A decisão é da API,
 * a cada requisição; o banco só recebe o ator para a auditoria. Falha fechada: rota que não declara
 * o nível é negada.
 */
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { CODIGOS_DE_ERRO, ErroDeDominio, type ChaveDePermissao } from '@contaia/domain';

import { extrairToken } from './sessao.guard';
import { SessaoService } from './sessao.service';

export type NivelDoCatalogo = 'CONSULTA' | 'SIMULACAO' | 'ADMINISTRACAO';

export const NIVEL_DO_CATALOGO = 'nivelDoCatalogo';

export const AutorizaCatalogo = (nivel: NivelDoCatalogo): ClassDecorator & MethodDecorator =>
  SetMetadata(NIVEL_DO_CATALOGO, nivel);

/** Quem comanda, para a auditoria: o id é sempre o da sessão validada, nunca o do corpo. */
export type AtorDoCatalogo = Readonly<{ id: string; tipo: 'SUPER_ADMIN' | 'ESCRITORIO' }>;

export type RequisicaoDoCatalogo = Request & { atorDoCatalogo?: AtorDoCatalogo };

const CHAVE_DO_NIVEL: Readonly<Record<Exclude<NivelDoCatalogo, 'ADMINISTRACAO'>, ChaveDePermissao>> = {
  CONSULTA: 'fiscal.motor_tributario.consultar',
  SIMULACAO: 'fiscal.motor_tributario.simular',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const semAutorizacao = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Sem autorização para este recurso.');

@Injectable()
export class GuardDoCatalogoTributario implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessaoService: SessaoService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const requisicao = contexto.switchToHttp().getRequest<RequisicaoDoCatalogo>();
    const token = extrairToken(requisicao);
    const nivel = this.reflector.getAllAndOverride<NivelDoCatalogo | undefined>(NIVEL_DO_CATALOGO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    const sessao = await this.sessaoService.resolverParaCatalogo(token);

    if (nivel === undefined) {
      throw semAutorizacao();
    }

    if (sessao.tipo === 'PLATAFORMA') {
      // A auditoria guarda o ator como uuid: identificador de outro formato não vira ator.
      if (!UUID.test(sessao.sub)) {
        throw semAutorizacao();
      }
      requisicao.atorDoCatalogo = { id: sessao.sub, tipo: 'SUPER_ADMIN' };

      return true;
    }

    if (nivel === 'ADMINISTRACAO') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.PLATFORM_ADMIN_REQUIRED,
        'Somente o administrador da plataforma altera o catálogo tributário.',
      );
    }

    if (sessao.sessao.statusDoTenant !== 'ATIVO') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO,
        'Conclua o cadastro do escritório para acessar esta área.',
      );
    }

    if (!sessao.sessao.permissoes.includes(CHAVE_DO_NIVEL[nivel])) {
      throw semAutorizacao();
    }

    requisicao.atorDoCatalogo = { id: sessao.sessao.usuarioId, tipo: 'ESCRITORIO' };

    return true;
  }
}
