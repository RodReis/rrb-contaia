/**
 * Ticket de ingestão (SPEC-011 §6.2): assinatura HMAC, validade e formato.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { CargaDoTicket } from '@contaia/shared';

import { assinarTicket, lerTicketAssinado, verificarTicket } from './ticket';

const SEGREDO = 's'.repeat(40);
const ID = '01927b5c-8e1a-7c3d-9a1b-0123456789ab';
const AGORA = new Date('2026-10-03T15:00:00Z');

const carga = (sobre: Partial<CargaDoTicket> = {}): CargaDoTicket => ({
  jti: ID,
  tenantId: ID,
  empresaId: ID,
  usuarioId: ID,
  cnpjDaEmpresa: '11222333000181',
  responsavelId: ID,
  operacao: 'CADASTRO',
  correlationId: 'corr-1',
  exp: Math.floor(AGORA.getTime() / 1000) + 300,
  ...sobre,
});

const codigoDe = (acao: () => unknown): string => {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return 'nao_lancou';
};

const INVALIDO = CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO;

describe('ticket de ingestão', () => {
  it('ida e volta preserva a carga', () => {
    const ticket = assinarTicket(carga(), SEGREDO);

    expect(verificarTicket(ticket, SEGREDO, AGORA)).toEqual(carga());
  });

  it('tem o formato base64url(JSON).base64url(HMAC-SHA256) que o cofre confere', () => {
    const ticket = assinarTicket(carga(), SEGREDO);
    const [parteUm, assinatura] = ticket.split('.');

    expect(ticket.split('.')).toHaveLength(2);
    expect(JSON.parse(Buffer.from(parteUm ?? '', 'base64url').toString('utf8'))).toEqual(carga());
    expect(assinatura).toBe(
      createHmac('sha256', SEGREDO)
        .update(parteUm ?? '')
        .digest()
        .toString('base64url'),
    );
  });

  it('assinatura de outro segredo é recusada', () => {
    const ticket = assinarTicket(carga(), 'outro-segredo-com-mais-de-32-caracteres!');

    expect(codigoDe(() => verificarTicket(ticket, SEGREDO, AGORA))).toBe(INVALIDO);
  });

  it('carga adulterada com a assinatura original é recusada', () => {
    const [, assinatura] = assinarTicket(carga(), SEGREDO).split('.');
    const forjada = Buffer.from(JSON.stringify(carga({ empresaId: '01927b5c-8e1a-7c3d-9a1b-ffffffffffff' }))).toString(
      'base64url',
    );

    expect(codigoDe(() => verificarTicket(`${forjada}.${assinatura}`, SEGREDO, AGORA))).toBe(INVALIDO);
  });

  it('ticket vencido é recusado; o último segundo ainda vale', () => {
    const vencendo = assinarTicket(carga({ exp: Math.floor(AGORA.getTime() / 1000) }), SEGREDO);
    const valido = assinarTicket(carga({ exp: Math.floor(AGORA.getTime() / 1000) + 1 }), SEGREDO);

    expect(codigoDe(() => verificarTicket(vencendo, SEGREDO, AGORA))).toBe(INVALIDO);
    expect(codigoDe(() => verificarTicket(valido, SEGREDO, AGORA))).toBe('nao_lancou');
  });

  it('a leitura sem validade aceita ticket vencido com assinatura boa (registro da recusa)', () => {
    const vencido = assinarTicket(carga({ exp: 1 }), SEGREDO);

    expect(lerTicketAssinado(vencido, SEGREDO).jti).toBe(ID);
  });

  it.each([
    ['vazio', ''],
    ['sem ponto', 'abc'],
    ['três partes', 'a.b.c'],
    ['lixo', '!!!.???'],
  ])('formato inválido (%s) é recusado', (_nome, ticket) => {
    expect(codigoDe(() => verificarTicket(ticket, SEGREDO, AGORA))).toBe(INVALIDO);
  });

  it('carga com formato inválido, mesmo bem assinada, é recusada', () => {
    const assinar = (valor: unknown): string => {
      const parteUm = Buffer.from(JSON.stringify(valor)).toString('base64url');

      return `${parteUm}.${createHmac('sha256', SEGREDO).update(parteUm).digest().toString('base64url')}`;
    };

    expect(codigoDe(() => verificarTicket(assinar({ jti: 'x' }), SEGREDO, AGORA))).toBe(INVALIDO);
    expect(codigoDe(() => verificarTicket(assinar(carga({ operacao: 'OUTRA' as never })), SEGREDO, AGORA))).toBe(INVALIDO);
    expect(codigoDe(() => verificarTicket(assinar('texto'), SEGREDO, AGORA))).toBe(INVALIDO);
  });

  it('JSON ilegível, mesmo bem assinado, é recusado', () => {
    const parteUm = Buffer.from('{não é json').toString('base64url');
    const ticket = `${parteUm}.${createHmac('sha256', SEGREDO).update(parteUm).digest().toString('base64url')}`;

    expect(codigoDe(() => verificarTicket(ticket, SEGREDO, AGORA))).toBe(INVALIDO);
  });

  it('segredo ausente ou curto nunca valida: falha fechado', () => {
    const ticket = assinarTicket(carga(), 'curto');

    expect(codigoDe(() => verificarTicket(ticket, 'curto', AGORA))).toBe(INVALIDO);
    expect(codigoDe(() => verificarTicket(ticket, '', AGORA))).toBe(INVALIDO);
  });
});
