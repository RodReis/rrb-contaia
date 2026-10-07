/**
 * Configuração do Signer lida do ambiente (SPEC-012 §3.1). Falha fechada: faltou variável, o
 * processo não sobe. Só caminhos de arquivos de segredo — nunca o conteúdo da chave, do token ou do
 * pepper. Destino e CA dos dublês pertencem à configuração da finalidade, não ao chamador (§3.3).
 */
import type { Finalidade } from '@contaia/domain';

import type { Destino } from './destino.js';

export type ConfigDoSigner = Readonly<{
  /** Porta INTERNA da rede privada; o Signer não publica porta no host. */
  porta: number;
  arquivoDoCertificado: string;
  arquivoDaChave: string;
  /** CA interna que emite as identidades de serviço aceitas como cliente. */
  arquivoDaCaInterna: string;
  vaultAddr: string;
  arquivoDoTokenDoVault: string;
  /** Papel da aplicação (`contaia_app`, sem BYPASSRLS): o Signer age sempre por contexto técnico. */
  urlDoBanco: string;
  /** Arquivo com o pepper do HMAC da chave idempotente; o conteúdo nunca vai para o ambiente. */
  arquivoDoPepper: string;
  /** CA em que o Signer confia ao falar com os dublês governamentais. */
  arquivoDaCaDosDubles: string;
  destinos: Readonly<Record<Finalidade, Destino>>;
  tempoLimiteDoDestinoMs: number;
}>;

const PORTA_INTERNA_PADRAO = 8443;
const TEMPO_LIMITE_PADRAO_MS = 5_000;
/** Rota única do dublê de recepção: fixa, nenhuma variável a altera. */
const CAMINHO_DA_RECEPCAO = '/v1/recepcao';

const obrigatoria = (env: NodeJS.ProcessEnv, nome: string): string => {
  const valor = env[nome];

  if (valor === undefined || valor.trim() === '') {
    throw new Error(`Variável obrigatória ausente: ${nome}`);
  }

  return valor.trim();
};

const semBarraFinal = (url: string): string => url.replace(/\/+$/u, '');

const inteiroOpcional = (
  env: NodeJS.ProcessEnv,
  nome: string,
  padrao: number,
  minimo: number,
  maximo: number,
): number => {
  const bruta = env[nome];

  if (bruta === undefined || bruta.trim() === '') {
    return padrao;
  }

  const valor = Number(bruta);

  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${nome} deve ser um inteiro entre ${minimo} e ${maximo}`);
  }

  return valor;
};

const destinoDa = (env: NodeJS.ProcessEnv, prefixo: string): Destino => ({
  host: obrigatoria(env, `${prefixo}_HOST`),
  porta: inteiroOpcional(env, `${prefixo}_PORT`, PORTA_INTERNA_PADRAO, 1, 65_535),
  servername: obrigatoria(env, `${prefixo}_SERVERNAME`),
  caminho: CAMINHO_DA_RECEPCAO,
});

const TAMANHO_MINIMO_DO_PEPPER = 32;

/** Conteúdo do arquivo de segredo → pepper. Curto demais é recusado: o HMAC não protegeria nada. */
export const validarPepper = (conteudoDoArquivo: string): string => {
  const pepper = conteudoDoArquivo.trim();

  if (pepper.length < TAMANHO_MINIMO_DO_PEPPER) {
    throw new Error(`O pepper da chave idempotente precisa ter ao menos ${TAMANHO_MINIMO_DO_PEPPER} caracteres`);
  }

  return pepper;
};

export const lerConfig = (env: NodeJS.ProcessEnv): ConfigDoSigner => ({
  porta: inteiroOpcional(env, 'SIGNER_PORT', PORTA_INTERNA_PADRAO, 1, 65_535),
  arquivoDoCertificado: obrigatoria(env, 'SIGNER_CERT_FILE'),
  arquivoDaChave: obrigatoria(env, 'SIGNER_KEY_FILE'),
  arquivoDaCaInterna: obrigatoria(env, 'SIGNER_CA_INTERNA_FILE'),
  vaultAddr: semBarraFinal(obrigatoria(env, 'VAULT_ADDR')),
  arquivoDoTokenDoVault: obrigatoria(env, 'SIGNER_VAULT_TOKEN_FILE'),
  urlDoBanco: obrigatoria(env, 'SIGNER_DATABASE_URL'),
  arquivoDoPepper: obrigatoria(env, 'SIGNER_PEPPER_FILE'),
  arquivoDaCaDosDubles: obrigatoria(env, 'SIGNER_CA_DUBLES_FILE'),
  destinos: {
    DFE_TESTE: destinoDa(env, 'SIGNER_DESTINO_DFE'),
    ESOCIAL_TESTE: destinoDa(env, 'SIGNER_DESTINO_ESOCIAL'),
  },
  tempoLimiteDoDestinoMs: inteiroOpcional(
    env,
    'SIGNER_TEMPO_LIMITE_DESTINO_MS',
    TEMPO_LIMITE_PADRAO_MS,
    1,
    60_000,
  ),
});
