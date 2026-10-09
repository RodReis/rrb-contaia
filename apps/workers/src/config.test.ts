import { describe, expect, it } from 'vitest';

import { lerConfig } from './config.js';

const BASE = {
  REDIS_URL: 'redis://redis:6379',
  DATABASE_APP_URL: 'postgresql://contaia_app:x@postgres:5432/contaia',
} as const;

const SIGNER = {
  WORKER_CERT_FILE: '/run/secrets/worker.crt.pem',
  WORKER_KEY_FILE: '/run/secrets/worker.key.pem',
  SIGNER_CA_INTERNA_FILE: '/run/secrets/ca-interna.pem',
} as const;

const ARMAZENAMENTO = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_BUCKET: 'contaia-documentos',
  MINIO_ROOT_USER: 'usuario',
  MINIO_ROOT_PASSWORD: 'senha',
} as const;

const COMPLETO = { ...BASE, ...SIGNER, ...ARMAZENAMENTO } as const;

const sem = (env: Record<string, string>, nome: string): Record<string, string> => {
  const copia: Record<string, string> = { ...env };
  delete copia[nome];

  return copia;
};

describe('configuração dos workers (falha fechada)', () => {
  it('lê o ambiente e aplica os padrões da rede privada', () => {
    expect(lerConfig(COMPLETO)).toEqual({
      portaDeSaude: 15102,
      redisUrl: 'redis://redis:6379',
      signer: {
        signer: { host: 'signer', porta: 8443, servername: 'signer' },
        arquivoDoCertificado: '/run/secrets/worker.crt.pem',
        arquivoDaChave: '/run/secrets/worker.key.pem',
        arquivoDaCaInterna: '/run/secrets/ca-interna.pem',
        intervaloDoMonitorMs: 60_000,
      },
      armazenamento: {
        endpoint: 'http://minio:9000',
        bucket: 'contaia-documentos',
        regiao: 'us-east-1',
        usuario: 'usuario',
        senha: 'senha',
      },
    });
  });

  it('o intervalo do monitor é de 1 minuto, e só uma variável explícita (prova E2E) o encurta', () => {
    expect(lerConfig({ ...COMPLETO, MONITOR_INTERVALO_MS: '5000' }).signer?.intervaloDoMonitorMs).toBe(5_000);
    expect(() => lerConfig({ ...COMPLETO, MONITOR_INTERVALO_MS: '10' })).toThrow(/MONITOR_INTERVALO_MS/u);
    expect(() => lerConfig({ ...COMPLETO, MONITOR_INTERVALO_MS: 'x' })).toThrow(/MONITOR_INTERVALO_MS/u);
  });

  it('aceita sobrescrever o endereço do Signer e a região do storage', () => {
    const config = lerConfig({
      ...COMPLETO,
      SIGNER_HOST: 'signer.interno',
      SIGNER_PORT: '9443',
      SIGNER_SERVERNAME: 'signer.interno',
      S3_REGION: 'sa-east-1',
    });

    expect(config.signer?.signer).toEqual({ host: 'signer.interno', porta: 9443, servername: 'signer.interno' });
    expect(config.armazenamento?.regiao).toBe('sa-east-1');
  });

  it('recusa subir sem REDIS_URL', () => {
    expect(() => lerConfig(sem(COMPLETO, 'REDIS_URL'))).toThrow(/REDIS_URL/u);
  });

  it('recusa subir sem nenhuma URL de banco; aceita DATABASE_URL no lugar da DATABASE_APP_URL', () => {
    expect(() => lerConfig(sem(COMPLETO, 'DATABASE_APP_URL'))).toThrow(/DATABASE_APP_URL/u);
    expect(lerConfig({ ...sem(COMPLETO, 'DATABASE_APP_URL'), DATABASE_URL: 'postgresql://x' }).redisUrl).toBe(
      'redis://redis:6379',
    );
  });

  it('sem os arquivos de mTLS, sobe só o plano de contas (o Signer fica desligado)', () => {
    const config = lerConfig({ ...BASE, ...ARMAZENAMENTO });

    expect(config.signer).toBeNull();
    expect(config.armazenamento).not.toBeNull();
  });

  it('sem o storage, sobe só o Signer (o plano de contas fica desligado)', () => {
    const config = lerConfig({ ...BASE, ...SIGNER });

    expect(config.armazenamento).toBeNull();
    expect(config.signer).not.toBeNull();
  });

  it('sem nenhum consumidor configurado, recusa subir', () => {
    expect(() => lerConfig(BASE)).toThrow(/Nenhum consumidor/u);
  });

  it.each([...Object.keys(SIGNER), ...Object.keys(ARMAZENAMENTO)])(
    'grupo incompleto é erro de configuração: recusa subir sem %s quando o resto do grupo está presente',
    (faltando) => {
      expect(() => lerConfig(sem(COMPLETO, faltando))).toThrow(new RegExp(faltando, 'u'));
    },
  );

  it('recusa porta inválida', () => {
    expect(() => lerConfig({ ...COMPLETO, SIGNER_PORT: 'x' })).toThrow(/SIGNER_PORT/u);
    expect(() => lerConfig({ ...COMPLETO, WORKERS_PORT: '0' })).toThrow(/WORKERS_PORT/u);
  });
});
