import { ErroDoClienteDoSigner } from '@contaia/signer-client';
import { describe, expect, it } from 'vitest';

import { criarClienteDoSigner, criarFilaDeDiagnostico, lerConfigDoSigner } from './signer.providers';

const COMPLETO = {
  API_CERT_FILE: '/run/secrets/api.crt.pem',
  API_KEY_FILE: '/run/secrets/api.key.pem',
  SIGNER_CA_INTERNA_FILE: '/run/secrets/ca-interna.pem',
} as const;

describe('configuração do cliente do Signer na API', () => {
  it('sem as três variáveis o Signer é considerado não configurado (a API sobe sem ele)', () => {
    expect(lerConfigDoSigner({})).toBeNull();
    expect(lerConfigDoSigner({ API_CERT_FILE: 'x', API_KEY_FILE: 'y' })).toBeNull();
  });

  it('com as variáveis lê o endereço da rede privada, com padrões', () => {
    expect(lerConfigDoSigner(COMPLETO)).toEqual({
      host: 'signer',
      porta: 8443,
      servername: 'signer',
      arquivoDoCertificado: '/run/secrets/api.crt.pem',
      arquivoDaChave: '/run/secrets/api.key.pem',
      arquivoDaCaInterna: '/run/secrets/ca-interna.pem',
    });
    expect(lerConfigDoSigner({ ...COMPLETO, SIGNER_HOST: 'x', SIGNER_PORT: '9443', SIGNER_SERVERNAME: 'y' })).toMatchObject({
      host: 'x',
      porta: 9443,
      servername: 'y',
    });
  });

  it('porta inválida falha fechada, em vez de cair silenciosamente no padrão', () => {
    expect(() => lerConfigDoSigner({ ...COMPLETO, SIGNER_PORT: 'abc' })).toThrow(/SIGNER_PORT/u);
  });
});

describe('cliente do Signer desligado', () => {
  it('toda chamada falha como indisponível e transitória, sem rede', async () => {
    const cliente = criarClienteDoSigner({});

    for (const chamada of [
      () => cliente.estados({ tenantId: 't', empresaIds: ['e'], correlationId: 'c' }),
      () => cliente.historico({ tenantId: 't', empresaId: 'e', correlationId: 'c', pagina: 1 }),
      () =>
        cliente.diagnosticar({ tenantId: 't', empresaId: 'e', finalidade: 'DFE_TESTE', correlationId: 'c', origem: 'MANUAL' }),
    ]) {
      await expect(chamada()).rejects.toBeInstanceOf(ErroDoClienteDoSigner);
      await expect(chamada()).rejects.toMatchObject({ codigo: 'SIGNER_INDISPONIVEL', transitorio: true });
    }
  });
});

describe('fila de diagnóstico da API', () => {
  it('sem REDIS_URL o enfileiramento falha (e o serviço o engole), nunca derruba a API', async () => {
    const fila = criarFilaDeDiagnostico({});

    await expect(fila.add('diagnosticar', {} as never, {})).rejects.toThrow(/REDIS_URL/u);
  });
});
