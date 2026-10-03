import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CargaDoTicket } from '@contaia/shared';
import { assinarTicket, criarRegistroDeJti, verificarTicket } from './ticket.js';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-bytes!!';
const AGORA = new Date('2026-10-03T12:00:00.000Z');

const carga = (alteracoes: Partial<CargaDoTicket> = {}): CargaDoTicket => ({
  jti: 'jti-1',
  tenantId: 'tenant',
  empresaId: 'empresa',
  usuarioId: 'usuario',
  cnpjDaEmpresa: '11222333000181',
  responsavelId: 'responsavel',
  operacao: 'CADASTRO',
  correlationId: 'corr-1',
  exp: Math.floor(AGORA.getTime() / 1000) + 300,
  ...alteracoes,
});

describe('verificarTicket', () => {
  it('aceita o ticket assinado com o mesmo segredo', () => {
    expect(verificarTicket(assinarTicket(carga(), SEGREDO), SEGREDO, AGORA)).toEqual(carga());
  });

  it('recusa segredo diferente', () => {
    expect(verificarTicket(assinarTicket(carga(), SEGREDO), `${SEGREDO}x`, AGORA)).toBeNull();
  });

  it('recusa carga adulterada com a assinatura original', () => {
    const [, assinatura] = assinarTicket(carga(), SEGREDO).split('.') as [string, string];
    const adulterado = Buffer.from(JSON.stringify(carga({ empresaId: 'outra' }))).toString('base64url');

    expect(verificarTicket(`${adulterado}.${assinatura}`, SEGREDO, AGORA)).toBeNull();
  });

  it('recusa assinatura truncada, vazia ou de tamanho errado', () => {
    const [corpo] = assinarTicket(carga(), SEGREDO).split('.') as [string, string];

    expect(verificarTicket(`${corpo}.`, SEGREDO, AGORA)).toBeNull();
    expect(verificarTicket(`${corpo}.abc`, SEGREDO, AGORA)).toBeNull();
  });

  it('recusa formato sem ponto, com pontos demais e lixo', () => {
    expect(verificarTicket('semponto', SEGREDO, AGORA)).toBeNull();
    expect(verificarTicket('a.b.c', SEGREDO, AGORA)).toBeNull();
    expect(verificarTicket('', SEGREDO, AGORA)).toBeNull();
  });

  it('o instante exato de expiração já não vale; um segundo antes ainda vale', () => {
    const exp = Math.floor(AGORA.getTime() / 1000);
    const ticket = assinarTicket(carga({ exp }), SEGREDO);

    expect(verificarTicket(ticket, SEGREDO, AGORA)).toBeNull();
    expect(verificarTicket(ticket, SEGREDO, new Date(AGORA.getTime() - 1000))).not.toBeNull();
  });

  it('recusa carga assinada mas sem campo obrigatório ou com operação desconhecida', () => {
    const semJti = { ...carga(), jti: undefined } as unknown as CargaDoTicket;
    const operacaoInvalida = { ...carga(), operacao: 'APAGAR' } as unknown as CargaDoTicket;

    expect(verificarTicket(assinarTicket(semJti, SEGREDO), SEGREDO, AGORA)).toBeNull();
    expect(verificarTicket(assinarTicket(operacaoInvalida, SEGREDO), SEGREDO, AGORA)).toBeNull();
  });

  it('recusa assinatura válida sobre corpo que não é JSON', () => {
    const corpo = Buffer.from('não é json').toString('base64url');
    const assinatura = createHmac('sha256', SEGREDO).update(corpo).digest('base64url');

    expect(verificarTicket(`${corpo}.${assinatura}`, SEGREDO, AGORA)).toBeNull();
  });
});

describe('registro de jti', () => {
  it('consome na primeira vez e recusa o replay', () => {
    const registro = criarRegistroDeJti();
    const exp = Math.floor(AGORA.getTime() / 1000) + 300;

    expect(registro.consumir('a', exp, AGORA)).toBe(true);
    expect(registro.consumir('a', exp, AGORA)).toBe(false);
    expect(registro.consumir('b', exp, AGORA)).toBe(true);
  });

  it('poda o que já expirou, sem deixar o mapa crescer', () => {
    const registro = criarRegistroDeJti();
    const exp = Math.floor(AGORA.getTime() / 1000) + 10;
    registro.consumir('a', exp, AGORA);

    // Depois do exp o ticket nem passa em verificarTicket; o jti pode ser esquecido.
    expect(registro.consumir('a', exp, new Date(AGORA.getTime() + 11_000))).toBe(true);
  });
});
