/**
 * Configuração dos workers lida do ambiente. Falha fechada: faltou variável obrigatória, o processo
 * não sobe. Cada consumidor tem o seu grupo de variáveis e só é iniciado quando o grupo está
 * completo; um grupo PARCIAL é erro de configuração (nunca se sobe "pela metade" em silêncio):
 *
 *   - base (sempre): `REDIS_URL` e a URL do banco (`DATABASE_APP_URL` ou `DATABASE_URL`);
 *   - Signer (SPEC-012 §3.1): os arquivos de identidade mTLS do worker e a CA interna;
 *   - plano de contas (SPEC-013 §6.1): o object storage local onde a API guardou o original.
 *
 * Só caminhos de arquivos de segredo — nunca o conteúdo da chave.
 */
import { INTERVALO_DO_MONITOR_MS } from '@contaia/signer-client';

export type ConfigDoSigner = Readonly<{
  /** Onde o Signer vive na rede privada; o nome é o que o certificado dele precisa apresentar. */
  signer: Readonly<{ host: string; porta: number; servername: string }>;
  arquivoDoCertificado: string;
  arquivoDaChave: string;
  arquivoDaCaInterna: string;
  /** 1 minuto (SPEC-012 §3.10). Só a prova E2E o encurta, por variável explícita. */
  intervaloDoMonitorMs: number;
}>;

export type ConfigDoArmazenamento = Readonly<{
  endpoint: string;
  bucket: string;
  regiao: string;
  usuario: string;
  senha: string;
}>;

export type ConfigDosWorkers = Readonly<{
  portaDeSaude: number;
  redisUrl: string;
  /** Nulo: sem os arquivos de mTLS, os consumidores do Signer não sobem. */
  signer: ConfigDoSigner | null;
  /** Nulo: sem o storage, o consumidor da validação do plano de contas não sobe. */
  armazenamento: ConfigDoArmazenamento | null;
}>;

const INTERVALO_MINIMO_DO_MONITOR_MS = 1_000;
const VARIAVEIS_DO_SIGNER = ['WORKER_CERT_FILE', 'WORKER_KEY_FILE', 'SIGNER_CA_INTERNA_FILE'] as const;
const VARIAVEIS_DO_ARMAZENAMENTO = ['S3_ENDPOINT', 'S3_BUCKET', 'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'] as const;

const presente = (env: NodeJS.ProcessEnv, nome: string): boolean => {
  const valor = env[nome];

  return valor !== undefined && valor.trim() !== '';
};

const obrigatoria = (env: NodeJS.ProcessEnv, nome: string): string => {
  if (!presente(env, nome)) {
    throw new Error(`Variável obrigatória ausente: ${nome}`);
  }

  return env[nome]!.trim();
};

/** Nenhuma variável do grupo → `false` (consumidor desligado); todas → `true`; parte → erro. */
const grupoCompleto = (env: NodeJS.ProcessEnv, grupo: readonly string[]): boolean => {
  const ausentes = grupo.filter((nome) => !presente(env, nome));

  if (ausentes.length === grupo.length) {
    return false;
  }
  if (ausentes.length > 0) {
    throw new Error(`Variável obrigatória ausente: ${ausentes.join(', ')}`);
  }

  return true;
};

const porta = (env: NodeJS.ProcessEnv, nome: string, padrao: number): number => {
  const bruta = env[nome];
  const valor = bruta === undefined || bruta.trim() === '' ? padrao : Number(bruta);

  if (!Number.isInteger(valor) || valor < 1 || valor > 65_535) {
    throw new Error(`${nome} deve ser uma porta TCP válida`);
  }

  return valor;
};

const intervaloDoMonitor = (env: NodeJS.ProcessEnv): number => {
  const bruta = env['MONITOR_INTERVALO_MS'];

  if (bruta === undefined || bruta.trim() === '') {
    return INTERVALO_DO_MONITOR_MS;
  }

  const valor = Number(bruta);

  if (!Number.isInteger(valor) || valor < INTERVALO_MINIMO_DO_MONITOR_MS) {
    throw new Error(`MONITOR_INTERVALO_MS deve ser um inteiro de ${INTERVALO_MINIMO_DO_MONITOR_MS} ms ou mais`);
  }

  return valor;
};

export const lerConfigDoSigner = (env: NodeJS.ProcessEnv): ConfigDoSigner | null => {
  if (!grupoCompleto(env, VARIAVEIS_DO_SIGNER)) {
    return null;
  }

  return {
    signer: {
      host: env['SIGNER_HOST']?.trim() || 'signer',
      porta: porta(env, 'SIGNER_PORT', 8_443),
      servername: env['SIGNER_SERVERNAME']?.trim() || 'signer',
    },
    arquivoDoCertificado: obrigatoria(env, 'WORKER_CERT_FILE'),
    arquivoDaChave: obrigatoria(env, 'WORKER_KEY_FILE'),
    arquivoDaCaInterna: obrigatoria(env, 'SIGNER_CA_INTERNA_FILE'),
    intervaloDoMonitorMs: intervaloDoMonitor(env),
  };
};

export const lerConfigDoArmazenamento = (env: NodeJS.ProcessEnv): ConfigDoArmazenamento | null => {
  if (!grupoCompleto(env, VARIAVEIS_DO_ARMAZENAMENTO)) {
    return null;
  }

  return {
    endpoint: obrigatoria(env, 'S3_ENDPOINT'),
    bucket: obrigatoria(env, 'S3_BUCKET'),
    regiao: env['S3_REGION']?.trim() || 'us-east-1',
    usuario: obrigatoria(env, 'MINIO_ROOT_USER'),
    senha: obrigatoria(env, 'MINIO_ROOT_PASSWORD'),
  };
};

export const lerConfig = (env: NodeJS.ProcessEnv): ConfigDosWorkers => {
  const redisUrl = obrigatoria(env, 'REDIS_URL');

  // O pool da aplicação usa `DATABASE_APP_URL` ou deriva da `DATABASE_URL` (fora de produção).
  if (!presente(env, 'DATABASE_APP_URL') && !presente(env, 'DATABASE_URL')) {
    throw new Error('Variável obrigatória ausente: DATABASE_APP_URL (ou DATABASE_URL)');
  }

  const config: ConfigDosWorkers = {
    portaDeSaude: porta(env, 'WORKERS_PORT', 15_102),
    redisUrl,
    signer: lerConfigDoSigner(env),
    armazenamento: lerConfigDoArmazenamento(env),
  };

  if (config.signer === null && config.armazenamento === null) {
    throw new Error('Nenhum consumidor configurado: informe o mTLS do Signer e/ou o storage (S3_*)');
  }

  return config;
};
