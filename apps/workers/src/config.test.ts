import { describe, expect, it } from 'vitest';

import { lerConfig } from './config.js';

const COMPLETO = {
  REDIS_URL: 'redis://redis:6379',
  WORKER_CERT_FILE: '/run/secrets/worker.crt.pem',
  WORKER_KEY_FILE: '/run/secrets/worker.key.pem',
  SIGNER_CA_INTERNA_FILE: '/run/secrets/ca-interna.pem',
} as const;

describe('configuração dos workers (falha fechada)', () => {
  it('lê o ambiente e aplica os padrões da rede privada', () => {
    expect(lerConfig(COMPLETO)).toEqual({
      portaDeSaude: 15102,
      redisUrl: 'redis://redis:6379',
      signer: { host: 'signer', porta: 8443, servername: 'signer' },
      arquivoDoCertificado: '/run/secrets/worker.crt.pem',
      arquivoDaChave: '/run/secrets/worker.key.pem',
      arquivoDaCaInterna: '/run/secrets/ca-interna.pem',
      intervaloDoMonitorMs: 60_000,
    });
  });

  it('o intervalo do monitor é de 1 minuto, e só uma variável explícita (prova E2E) o encurta', () => {
    expect(lerConfig({ ...COMPLETO, MONITOR_INTERVALO_MS: '5000' }).intervaloDoMonitorMs).toBe(5_000);
    expect(() => lerConfig({ ...COMPLETO, MONITOR_INTERVALO_MS: '10' })).toThrow(/MONITOR_INTERVALO_MS/u);
    expect(() => lerConfig({ ...COMPLETO, MONITOR_INTERVALO_MS: 'x' })).toThrow(/MONITOR_INTERVALO_MS/u);
  });

  it('aceita sobrescrever o endereço do Signer', () => {
    const config = lerConfig({ ...COMPLETO, SIGNER_HOST: 'signer.interno', SIGNER_PORT: '9443', SIGNER_SERVERNAME: 'signer.interno' });

    expect(config.signer).toEqual({ host: 'signer.interno', porta: 9443, servername: 'signer.interno' });
  });

  it.each(Object.keys(COMPLETO))('recusa subir sem %s', (faltando) => {
    const env: Record<string, string> = { ...COMPLETO };
    delete env[faltando];

    expect(() => lerConfig(env)).toThrow(new RegExp(faltando, 'u'));
  });

  it('recusa porta inválida', () => {
    expect(() => lerConfig({ ...COMPLETO, SIGNER_PORT: 'x' })).toThrow(/SIGNER_PORT/u);
    expect(() => lerConfig({ ...COMPLETO, WORKERS_PORT: '0' })).toThrow(/WORKERS_PORT/u);
  });
});
