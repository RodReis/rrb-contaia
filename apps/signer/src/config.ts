/**
 * Configuração do Signer lida do ambiente (SPEC-012 §3.1). Falha fechada: faltou variável, o
 * processo não sobe. Só caminhos de arquivos de segredo — nunca o conteúdo da chave ou do token.
 */

export type ConfigDoSigner = Readonly<{
  /** Porta INTERNA da rede privada; o Signer não publica porta no host. */
  porta: number;
  arquivoDoCertificado: string;
  arquivoDaChave: string;
  /** CA interna que emite as identidades de serviço aceitas como cliente. */
  arquivoDaCaInterna: string;
  vaultAddr: string;
  arquivoDoTokenDoVault: string;
}>;

const PORTA_INTERNA_PADRAO = 8443;

const obrigatoria = (env: NodeJS.ProcessEnv, nome: string): string => {
  const valor = env[nome];

  if (valor === undefined || valor.trim() === '') {
    throw new Error(`Variável obrigatória ausente: ${nome}`);
  }

  return valor.trim();
};

const semBarraFinal = (url: string): string => url.replace(/\/+$/u, '');

export const lerConfig = (env: NodeJS.ProcessEnv): ConfigDoSigner => {
  const bruta = env['SIGNER_PORT'];
  const porta = bruta === undefined || bruta.trim() === '' ? PORTA_INTERNA_PADRAO : Number(bruta);

  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535) {
    throw new Error('SIGNER_PORT deve ser uma porta TCP válida');
  }

  return {
    porta,
    arquivoDoCertificado: obrigatoria(env, 'SIGNER_CERT_FILE'),
    arquivoDaChave: obrigatoria(env, 'SIGNER_KEY_FILE'),
    arquivoDaCaInterna: obrigatoria(env, 'SIGNER_CA_INTERNA_FILE'),
    vaultAddr: semBarraFinal(obrigatoria(env, 'VAULT_ADDR')),
    arquivoDoTokenDoVault: obrigatoria(env, 'SIGNER_VAULT_TOKEN_FILE'),
  };
};
