/**
 * Configuração dos workers lida do ambiente (SPEC-012 §3.1). Falha fechada: faltou variável, o
 * processo não sobe. Só caminhos de arquivos de segredo — nunca o conteúdo da chave.
 */

export type ConfigDosWorkers = Readonly<{
  portaDeSaude: number;
  redisUrl: string;
  /** Onde o Signer vive na rede privada; o nome é o que o certificado dele precisa apresentar. */
  signer: Readonly<{ host: string; porta: number; servername: string }>;
  arquivoDoCertificado: string;
  arquivoDaChave: string;
  arquivoDaCaInterna: string;
}>;

const obrigatoria = (env: NodeJS.ProcessEnv, nome: string): string => {
  const valor = env[nome];

  if (valor === undefined || valor.trim() === '') {
    throw new Error(`Variável obrigatória ausente: ${nome}`);
  }

  return valor.trim();
};

const porta = (env: NodeJS.ProcessEnv, nome: string, padrao: number): number => {
  const bruta = env[nome];
  const valor = bruta === undefined || bruta.trim() === '' ? padrao : Number(bruta);

  if (!Number.isInteger(valor) || valor < 1 || valor > 65_535) {
    throw new Error(`${nome} deve ser uma porta TCP válida`);
  }

  return valor;
};

export const lerConfig = (env: NodeJS.ProcessEnv): ConfigDosWorkers => ({
  portaDeSaude: porta(env, 'WORKERS_PORT', 15_102),
  redisUrl: obrigatoria(env, 'REDIS_URL'),
  signer: {
    host: env['SIGNER_HOST']?.trim() || 'signer',
    porta: porta(env, 'SIGNER_PORT', 8_443),
    servername: env['SIGNER_SERVERNAME']?.trim() || 'signer',
  },
  arquivoDoCertificado: obrigatoria(env, 'WORKER_CERT_FILE'),
  arquivoDaChave: obrigatoria(env, 'WORKER_KEY_FILE'),
  arquivoDaCaInterna: obrigatoria(env, 'SIGNER_CA_INTERNA_FILE'),
});
