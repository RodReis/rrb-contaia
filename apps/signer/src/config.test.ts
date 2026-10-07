import { describe, expect, it } from 'vitest';

import { lerConfig } from './config.js';

const COMPLETO = {
  SIGNER_CERT_FILE: '/run/secrets/signer.crt.pem',
  SIGNER_KEY_FILE: '/run/secrets/signer.key.pem',
  SIGNER_CA_INTERNA_FILE: '/run/secrets/ca-interna.pem',
  VAULT_ADDR: 'http://vault:8200/',
  SIGNER_VAULT_TOKEN_FILE: '/run/secrets/token-signer-leitura',
} as const;

describe('configuração do Signer (falha fechada)', () => {
  it('lê o ambiente completo, tira a barra final do Vault e usa a porta interna 8443', () => {
    expect(lerConfig(COMPLETO)).toEqual({
      porta: 8443,
      arquivoDoCertificado: '/run/secrets/signer.crt.pem',
      arquivoDaChave: '/run/secrets/signer.key.pem',
      arquivoDaCaInterna: '/run/secrets/ca-interna.pem',
      vaultAddr: 'http://vault:8200',
      arquivoDoTokenDoVault: '/run/secrets/token-signer-leitura',
    });
  });

  it.each(Object.keys(COMPLETO))('recusa subir sem %s', (faltando) => {
    const env: Record<string, string> = { ...COMPLETO };
    delete env[faltando];

    expect(() => lerConfig(env)).toThrow(new RegExp(faltando, 'u'));
  });

  it('recusa porta inválida', () => {
    expect(() => lerConfig({ ...COMPLETO, SIGNER_PORT: 'x' })).toThrow(/SIGNER_PORT/u);
    expect(() => lerConfig({ ...COMPLETO, SIGNER_PORT: '0' })).toThrow(/SIGNER_PORT/u);
    expect(lerConfig({ ...COMPLETO, SIGNER_PORT: '9443' }).porta).toBe(9443);
  });
});
