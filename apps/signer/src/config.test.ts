import { describe, expect, it } from 'vitest';

import { lerConfig, validarPepper } from './config.js';

const COMPLETO = {
  SIGNER_CERT_FILE: '/run/secrets/signer.crt.pem',
  SIGNER_KEY_FILE: '/run/secrets/signer.key.pem',
  SIGNER_CA_INTERNA_FILE: '/run/secrets/ca-interna.pem',
  VAULT_ADDR: 'http://vault:8200/',
  SIGNER_VAULT_TOKEN_FILE: '/run/secrets/token-signer-leitura',
  SIGNER_DATABASE_URL: 'postgresql://contaia_app:senha@postgres:5432/contaia',
  SIGNER_PEPPER_FILE: '/run/secrets/signer-pepper',
  SIGNER_CA_DUBLES_FILE: '/run/secrets/ca-dubles.pem',
  SIGNER_DESTINO_DFE_HOST: 'duble-dfe',
  SIGNER_DESTINO_DFE_SERVERNAME: 'duble-dfe',
  SIGNER_DESTINO_ESOCIAL_HOST: 'duble-esocial',
  SIGNER_DESTINO_ESOCIAL_SERVERNAME: 'duble-esocial',
} as const;

describe('configuração do Signer (falha fechada)', () => {
  it('lê o ambiente completo, tira a barra final do Vault e usa as portas internas padrão', () => {
    expect(lerConfig(COMPLETO)).toEqual({
      porta: 8443,
      arquivoDoCertificado: '/run/secrets/signer.crt.pem',
      arquivoDaChave: '/run/secrets/signer.key.pem',
      arquivoDaCaInterna: '/run/secrets/ca-interna.pem',
      vaultAddr: 'http://vault:8200',
      arquivoDoTokenDoVault: '/run/secrets/token-signer-leitura',
      urlDoBanco: 'postgresql://contaia_app:senha@postgres:5432/contaia',
      arquivoDoPepper: '/run/secrets/signer-pepper',
      arquivoDaCaDosDubles: '/run/secrets/ca-dubles.pem',
      destinos: {
        DFE_TESTE: { host: 'duble-dfe', porta: 8443, servername: 'duble-dfe', caminho: '/v1/recepcao' },
        ESOCIAL_TESTE: { host: 'duble-esocial', porta: 8443, servername: 'duble-esocial', caminho: '/v1/recepcao' },
      },
      tempoLimiteDoDestinoMs: 5_000,
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

  it('a porta e o tempo limite do destino são configuráveis e validados', () => {
    const configurado = lerConfig({
      ...COMPLETO,
      SIGNER_DESTINO_DFE_PORT: '9443',
      SIGNER_TEMPO_LIMITE_DESTINO_MS: '1500',
    });

    expect(configurado.destinos.DFE_TESTE.porta).toBe(9443);
    expect(configurado.destinos.ESOCIAL_TESTE.porta).toBe(8443);
    expect(configurado.tempoLimiteDoDestinoMs).toBe(1_500);
    expect(() => lerConfig({ ...COMPLETO, SIGNER_DESTINO_DFE_PORT: '70000' })).toThrow(/SIGNER_DESTINO_DFE_PORT/u);
    expect(() => lerConfig({ ...COMPLETO, SIGNER_TEMPO_LIMITE_DESTINO_MS: '0' })).toThrow(/SIGNER_TEMPO_LIMITE_DESTINO_MS/u);
  });

  it('o pepper do arquivo precisa ter 32 caracteres ou mais, sem a quebra de linha final', () => {
    const longo = 'p'.repeat(48);

    expect(validarPepper(`${longo}\n`)).toBe(longo);
    expect(() => validarPepper('curto\n')).toThrow(/pepper/iu);
    expect(() => validarPepper('')).toThrow(/pepper/iu);
  });

  it('o caminho do destino é fixo: nenhuma variável o altera', () => {
    const configurado = lerConfig({ ...COMPLETO, SIGNER_DESTINO_DFE_CAMINHO: '/outro' });

    expect(configurado.destinos.DFE_TESTE.caminho).toBe('/v1/recepcao');
  });
});
