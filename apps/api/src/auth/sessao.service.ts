/**
 * Identidade da requisição (ADR-011).
 *
 * O Keycloak responde quem é o usuário; o PostgreSQL responde a que tenant ele
 * pertence e em que estado está o cadastro. A verificação é sempre no servidor:
 * o token é validado contra o JWKS do realm, nunca decodificado por conta.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

import { resolverIdentidade, semContexto } from '@contaia/db';
import type { IdentidadeResolvida } from '@contaia/db';
import type { ChaveDePermissao } from '@contaia/domain';

import { PoolDoBanco } from '../banco/pool.provider';
import { permissoesEfetivas } from './permissoes-efetivas';

export type SessaoDaRequisicao = IdentidadeResolvida &
  Readonly<{
    sub: string;
    email: string;
    /** Permissão efetiva: união aditiva dos papéis padrão e personalizados (SPEC-008 §3.4). */
    permissoes: readonly ChaveDePermissao[];
  }>;

/**
 * Papel de realm da plataforma (SPEC-016 §3.7), pré-configurado no Keycloak local. Quem o tem não
 * pertence a escritório algum: não há linha em `app.usuario` e a sessão não carrega tenant.
 */
export const PAPEL_DA_PLATAFORMA = 'super_admin';

/** Sessão do catálogo tributário: administrador da plataforma OU usuário de escritório. */
export type SessaoDoCatalogo =
  | Readonly<{ tipo: 'PLATAFORMA'; sub: string; email: string }>
  | Readonly<{ tipo: 'ESCRITORIO'; sessao: SessaoDaRequisicao }>;

/** Papéis de realm do token JÁ VERIFICADO; claim ausente ou malformada não concede papel algum. */
const papeisDoRealm = (payload: JWTPayload): readonly string[] => {
  const acesso: unknown = payload['realm_access'];

  if (typeof acesso !== 'object' || acesso === null) {
    return [];
  }

  const papeis: unknown = (acesso as { roles?: unknown }).roles;

  return Array.isArray(papeis) ? papeis.filter((papel): papel is string => typeof papel === 'string') : [];
};

/** O `iss` que os tokens carregam: a origem que o NAVEGADOR usa para falar com o Keycloak. */
const emissor = (): string =>
  process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia';

/** Onde ESTE processo alcança o Keycloak. Em contêiner difere do público (`keycloak:8080`). */
const enderecoDoRealm = (): string => process.env['KEYCLOAK_INTERNAL_URL'] ?? emissor();

@Injectable()
export class SessaoService {
  private readonly logger = new Logger(SessaoService.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly pool: PoolDoBanco) {}

  private obterJwks(): ReturnType<typeof createRemoteJWKSet> {
    // O conjunto de chaves é cacheado pelo próprio `jose` e revalidado quando o
    // Keycloak rotaciona: criar um por requisição buscaria o JWKS toda vez.
    this.jwks ??= createRemoteJWKSet(new URL(`${enderecoDoRealm()}/protocol/openid-connect/certs`));

    return this.jwks;
  }

  private async verificarToken(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.obterJwks(), { issuer: emissor() });

      return payload;
    } catch (erro) {
      this.logger.warn(`token recusado: ${erro instanceof Error ? erro.message : 'desconhecido'}`);

      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }

  /** Resolve a sessão a partir do token. Token válido de usuário desconhecido
   *  no produto não cria sessão: identidade não é autorização. */
  async resolver(token: string): Promise<SessaoDaRequisicao> {
    return this.resolverDoPayload(await this.verificarToken(token));
  }

  /**
   * Catálogo tributário: o papel de plataforma vem do token verificado e dispensa o cadastro de
   * usuário; qualquer outra identidade segue a resolução normal de escritório.
   */
  async resolverParaCatalogo(token: string): Promise<SessaoDoCatalogo> {
    const payload = await this.verificarToken(token);

    if (papeisDoRealm(payload).includes(PAPEL_DA_PLATAFORMA)) {
      const sub = typeof payload.sub === 'string' ? payload.sub : '';

      if (sub.length === 0) {
        throw new UnauthorizedException('Sessão inválida ou expirada.');
      }

      return { tipo: 'PLATAFORMA', sub, email: typeof payload['email'] === 'string' ? payload['email'] : '' };
    }

    return { tipo: 'ESCRITORIO', sessao: await this.resolverDoPayload(payload) };
  }

  private async resolverDoPayload(payload: JWTPayload): Promise<SessaoDaRequisicao> {
    const sub = typeof payload.sub === 'string' ? payload.sub : '';

    if (sub.length === 0) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const identidade = await semContexto(this.pool.instancia, (cliente) =>
      resolverIdentidade(cliente, sub),
    );

    if (identidade === null) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const email = typeof payload['email'] === 'string' ? payload['email'] : '';

    const permissoes = permissoesEfetivas(identidade);

    return { ...identidade, sub, email, permissoes };
  }
}
