/** Configuração do dublê a partir do ambiente. Falha fechada: variável ausente não tem padrão. */

const PORTA_INTERNA_PADRAO = 8443;

const exigir = (env, nome) => {
  const valor = env[nome];

  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new Error(`${nome} é obrigatória para subir o dublê`);
  }

  return valor;
};

export const lerConfiguracaoDoDuble = (env) => {
  const bruta = env['DUBLE_PORTA'];
  const porta = bruta === undefined || bruta === '' ? PORTA_INTERNA_PADRAO : Number(bruta);

  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535) {
    throw new Error('DUBLE_PORTA deve ser uma porta TCP válida');
  }

  return {
    nome: exigir(env, 'DUBLE_NOME'),
    porta,
    arquivoDoCertificado: exigir(env, 'DUBLE_CERT_FILE'),
    arquivoDaChave: exigir(env, 'DUBLE_KEY_FILE'),
    arquivoDaCaDosClientes: exigir(env, 'DUBLE_CA_CLIENTES_FILE'),
  };
};
