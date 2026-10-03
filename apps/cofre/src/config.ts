/**
 * Configuração do cofre lida do ambiente (SPEC-011 §6.2). Falha fechado: faltou
 * variável ou segredo curto, o processo não sobe.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import forge from 'node-forge';

export const TAMANHO_MINIMO_DO_SEGREDO = 32;

export type ConfigDoCofre = Readonly<{
  porta: number;
  /** Interface de escuta; padrão loopback. */
  host: string;
  vaultAddr: string;
  arquivoDoTokenDoVault: string;
  diretorioDasRaizes: string;
  apiUrl: string;
  ticketSecret: string;
  /** Bearer do sentido cofre → API (`/interno/cofre/*`). */
  serviceToken: string;
  /** Bearer do sentido API → cofre (`/segredos/*`); credencial distinta da anterior. */
  adminToken: string;
  origensPermitidas: readonly string[];
}>;

const obrigatoria = (env: NodeJS.ProcessEnv, nome: string): string => {
  const valor = env[nome];
  if (valor === undefined || valor.trim() === '') {
    throw new Error(`Variável obrigatória ausente: ${nome}`);
  }
  return valor.trim();
};

const segredo = (env: NodeJS.ProcessEnv, nome: string): string => {
  const valor = obrigatoria(env, nome);
  if (Buffer.byteLength(valor, 'utf8') < TAMANHO_MINIMO_DO_SEGREDO) {
    throw new Error(`${nome} precisa ter ao menos ${TAMANHO_MINIMO_DO_SEGREDO} bytes`);
  }
  return valor;
};

/**
 * Caminho relativo do `.env` vale a partir da raiz do repositório, mas `pnpm dev` (Turbo)
 * roda o processo em `apps/cofre`: sobe a árvore até a raiz do workspace (onde o arquivo do
 * token ainda pode nem existir) e, sem workspace, usa o diretório de trabalho.
 */
export const resolverCaminho = (caminho: string, inicio = process.cwd()): string => {
  if (isAbsolute(caminho)) return caminho;
  for (let pasta = resolve(inicio); ; pasta = dirname(pasta)) {
    if (existsSync(join(pasta, 'pnpm-workspace.yaml'))) return join(pasta, caminho);
    if (dirname(pasta) === pasta) return resolve(inicio, caminho);
  }
};

const semBarraFinal = (url: string): string => url.replace(/\/+$/, '');

export const lerConfig = (env: NodeJS.ProcessEnv): ConfigDoCofre => {
  const serviceToken = segredo(env, 'COFRE_SERVICE_TOKEN');
  const adminToken = segredo(env, 'COFRE_ADMIN_TOKEN');

  // Se fossem iguais, vazar uma credencial daria os dois sentidos: a separação não valeria nada.
  if (serviceToken === adminToken) {
    throw new Error('COFRE_ADMIN_TOKEN e COFRE_SERVICE_TOKEN precisam ser diferentes');
  }

  return {
    porta: Number(env['COFRE_PORT'] ?? 15104),
    host: env['COFRE_HOST']?.trim() || '127.0.0.1',
    vaultAddr: semBarraFinal(obrigatoria(env, 'VAULT_ADDR')),
    arquivoDoTokenDoVault: resolverCaminho(obrigatoria(env, 'COFRE_VAULT_TOKEN_FILE')),
    diretorioDasRaizes: resolverCaminho(obrigatoria(env, 'COFRE_RAIZES_ICP_DIR')),
    apiUrl: semBarraFinal(obrigatoria(env, 'COFRE_API_URL')),
    ticketSecret: segredo(env, 'COFRE_TICKET_SECRET'),
    serviceToken,
    adminToken,
    origensPermitidas: obrigatoria(env, 'COFRE_ORIGENS_PERMITIDAS')
      .split(',')
      .map((origem) => semBarraFinal(origem.trim()))
      .filter((origem) => origem !== ''),
  };
};

/**
 * Carrega as âncoras de confiança (todo `.pem` do diretório). Sem nenhuma, nada
 * é aceito: sem raiz o cofre responde "tipo incompatível" para qualquer PFX.
 */
export const carregarRaizes = async (diretorio: string): Promise<forge.pki.Certificate[]> => {
  const arquivos = (await readdir(diretorio)).filter((nome) => nome.toLowerCase().endsWith('.pem'));
  const raizes: forge.pki.Certificate[] = [];

  for (const arquivo of arquivos) {
    const pem = await readFile(join(diretorio, arquivo), 'utf8');
    for (const bloco of pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []) {
      raizes.push(forge.pki.certificateFromPem(bloco));
    }
  }

  return raizes;
};
