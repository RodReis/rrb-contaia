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

import { PoolDoBanco } from '../banco/pool.provider';

export type SessaoDaRequisicao = IdentidadeResolvida & Readonly<{ sub: string; email: string }>;

const emissor = (): string =>
  process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia';

@Injectable()
export class SessaoService {
  private readonly logger = new Logger(SessaoService.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly pool: PoolDoBanco) {}

  private obterJwks(): ReturnType<typeof createRemoteJWKSet> {
    // O conjunto de chaves é cacheado pelo próprio `jose` e revalidado quando o
    // Keycloak rotaciona: criar um por requisição buscaria o JWKS toda vez.
    this.jwks ??= createRemoteJWKSet(new URL(`${emissor()}/protocol/openid-connect/certs`));

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
    const payload = await this.verificarToken(token);
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

    return { ...identidade, sub, email };
  }
}
