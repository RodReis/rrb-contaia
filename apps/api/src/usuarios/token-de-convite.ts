/**
 * Token do convite (SPEC-007 §3.2): 256 bits aleatórios, uso único. Só o hash
 * sha256 chega ao banco; o token existe apenas no link enviado por e-mail e
 * nunca em resposta administrativa, log ou auditoria.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Forma exata de um token emitido: qualquer outra entrada é recusada sem consultar o banco. */
export const TOKEN_DE_CONVITE = /^[A-Za-z0-9_-]{43}$/;

export const gerarTokenDeConvite = (): string => randomBytes(32).toString('base64url');

export const hashDoToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
