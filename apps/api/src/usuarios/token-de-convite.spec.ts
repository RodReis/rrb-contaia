import { describe, expect, it } from 'vitest';

import { TOKEN_DE_CONVITE, gerarTokenDeConvite, hashDoToken } from './token-de-convite';

describe('token de convite', () => {
  it('tem 43 caracteres URL-safe (256 bits em base64url)', () => {
    expect(gerarTokenDeConvite()).toMatch(TOKEN_DE_CONVITE);
  });

  it('não repete entre emissões', () => {
    const emitidos = new Set(Array.from({ length: 1000 }, () => gerarTokenDeConvite()));

    expect(emitidos.size).toBe(1000);
  });

  it('o hash é sha256 hexadecimal, determinístico e diferente do token', () => {
    const token = gerarTokenDeConvite();

    expect(hashDoToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoToken(token)).toBe(hashDoToken(token));
    expect(hashDoToken(token)).not.toBe(token);
    expect(hashDoToken('a')).not.toBe(hashDoToken('b'));
  });

  it('o padrão recusa token malformado, vazio ou gigante', () => {
    for (const ruim of ['', 'a', 'x'.repeat(44), `${'a'.repeat(42)}%`, `${'a'.repeat(42)}\0`]) {
      expect(TOKEN_DE_CONVITE.test(ruim)).toBe(false);
    }
  });
});
