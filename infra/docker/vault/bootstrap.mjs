#!/usr/bin/env node
/**
 * Bootstrap IDEMPOTENTE do Vault local (SPEC-011 / F11, §6.1).
 *
 * O mesmo script roda em três lugares: no serviço `vault-bootstrap` do Compose
 * (modo `--vigiar`, que também desseleia o Vault depois de um reinício), na CI
 * (`node infra/docker/vault/bootstrap.mjs` contra um Vault efêmero de `docker run`)
 * e na máquina do dev (`pnpm vault:bootstrap`). Sem dependências: só Node 24.
 *
 * O que garante, sem recriar o que já existe:
 *   1. Vault inicializado (1 share / 1 threshold) → `init.json` com a chave de unseal e o root token;
 *   2. Vault desselado;
 *   3. KV v2 em `kv/`;
 *   4. audit device `file` (valores com HMAC: o log não carrega segredo);
 *   5. as três políticas mínimas (ingestão write-only, leitura do Signer, API sem acesso ao KV);
 *   6. um token periódico por política, gravado em arquivo local; um token existente só é
 *      reemitido se `lookup-self` o recusar ou a política dele divergir.
 *
 * Tudo o que é sensível fica em VAULT_LOCAL_DIR (gitignored). Nada disto é KMS/HSM nem
 * pronto para produção (SPEC-011 §6.1): é material de teste de um cofre local.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PERIODO_DO_TOKEN = '768h';
const INTERVALO_DA_VIGIA_MS = 5_000;
const INTERVALO_DE_RENOVACAO_MS = 6 * 60 * 60 * 1000;

/** Política → regras. Fonte única: a HCL abaixo é gerada daqui, e os testes leem daqui. */
export const POLITICAS = Object.freeze({
  // Write-only: cria versões e muda a visibilidade das que criou. NÃO lê, NÃO lista.
  'cofre-ingestao': [
    { caminho: 'kv/data/certificados/*', capacidades: ['create', 'update'] },
    { caminho: 'kv/delete/certificados/*', capacidades: ['update'] },
    { caminho: 'kv/undelete/certificados/*', capacidades: ['update'] },
    { caminho: 'kv/destroy/certificados/*', capacidades: ['update'] },
  ],
  // Único que lê, e só o dado: sem list, sem metadata, sem delete. Ninguém a usa nesta fatia.
  'signer-leitura': [{ caminho: 'kv/data/certificados/*', capacidades: ['read'] }],
  // Nenhuma capacidade em kv/*. O token existe só para a prova de que a API é negada.
  'api-principal': [{ caminho: 'sys/health', capacidades: ['read'] }],
});

/** Arquivo de token → política que ele carrega. */
export const TOKENS = Object.freeze([
  { arquivo: 'token-cofre-ingestao', politica: 'cofre-ingestao' },
  { arquivo: 'token-signer-leitura', politica: 'signer-leitura' },
  { arquivo: 'token-api-principal', politica: 'api-principal' },
]);

export const gerarPoliticaHcl = (regras) =>
  `${regras
    .map(
      ({ caminho, capacidades }) =>
        `path "${caminho}" {\n  capabilities = [${capacidades.map((c) => `"${c}"`).join(', ')}]\n}`,
    )
    .join('\n\n')}\n`;

export class ErroDeBootstrap extends Error {}

/** Resposta de `PUT /v1/sys/init` → o que vai para `init.json`. */
export const interpretarInit = (corpo) => {
  const chave = corpo?.keys_base64?.[0];
  const root = corpo?.root_token;
  if (typeof chave !== 'string' || typeof root !== 'string') {
    throw new ErroDeBootstrap('Resposta de init do Vault sem chave de unseal ou root token');
  }
  return { chave_unseal_base64: chave, root_token: root };
};

export const lerInitJson = (texto) => {
  const dados = JSON.parse(texto);
  if (typeof dados?.chave_unseal_base64 !== 'string' || typeof dados?.root_token !== 'string') {
    throw new ErroDeBootstrap('init.json inválido: faltam chave_unseal_base64 ou root_token');
  }
  return dados;
};

/**
 * `lookup-self` decide se o token do arquivo continua servindo: HTTP 200 e exatamente a
 * política esperada (a `default` é inerente). Token com política a mais é reemitido.
 */
export const decidirReemissao = (resposta, politicaEsperada) => {
  if (resposta.status !== 200) return true;
  const politicas = (resposta.corpo?.data?.policies ?? []).filter((p) => p !== 'default');
  return !(politicas.length === 1 && politicas[0] === politicaEsperada);
};

const sistemaDeArquivosPadrao = {
  async ler(caminho) {
    try {
      return await readFile(caminho, 'utf8');
    } catch (erro) {
      if (erro?.code === 'ENOENT') return null;
      throw erro;
    }
  },
  async gravarSecreto(caminho, texto) {
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, texto, { mode: 0o600 });
    await chmod(caminho, 0o600).catch(() => {});
  },
};

const criarClienteHttp = (addr, fetchImpl) => async (metodo, rota, { token, corpo } = {}) => {
  const resposta = await fetchImpl(`${addr}/v1/${rota}`, {
    method: metodo,
    headers: { ...(token ? { 'x-vault-token': token } : {}), 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: resposta.status, corpo: json };
};

const dadosOuCorpo = (corpo) => corpo?.data ?? corpo ?? {};

/**
 * @param {object} opcoes
 * @param {string} opcoes.addr             ex.: http://127.0.0.1:8200
 * @param {string} opcoes.dir              diretório local ignorado pelo Git (init.json e tokens)
 * @param {typeof fetch} [opcoes.fetchImpl]
 * @param {{ler: Function, gravarSecreto: Function}} [opcoes.arquivos]
 * @param {(ms: number) => Promise<void>} [opcoes.esperar]
 * @param {(mensagem: string) => void} [opcoes.log]
 * @param {string} [opcoes.arquivoDeAuditoria]  caminho DENTRO do contêiner do Vault
 * @param {number} [opcoes.tentativas]
 */
export const criarBootstrap = ({
  addr,
  dir,
  fetchImpl = fetch,
  arquivos = sistemaDeArquivosPadrao,
  esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  log = () => {},
  arquivoDeAuditoria = '/vault/logs/audit.log',
  tentativas = 60,
}) => {
  const http = criarClienteHttp(addr, fetchImpl);
  const caminhoDoInit = join(dir, 'init.json');

  const aguardarVault = async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        const resposta = await http('GET', 'sys/seal-status');
        if (resposta.status === 200) return resposta.corpo;
      } catch {
        // Vault ainda subindo.
      }
      await esperar(1000);
    }
    throw new ErroDeBootstrap(`Vault não respondeu em ${addr}`);
  };

  const aguardarAtivo = async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if ((await http('GET', 'sys/health?standbyok=true')).status === 200) return;
      } catch {
        // ainda abrindo o storage
      }
      await esperar(500);
    }
    throw new ErroDeBootstrap('Vault não ficou ativo depois do unseal');
  };

  const lerInit = async () => {
    const texto = await arquivos.ler(caminhoDoInit);
    if (texto === null) {
      throw new ErroDeBootstrap(
        'Vault já inicializado, mas init.json não existe em ' +
          `${dir}. Sem a chave de unseal não há recuperação: apague o volume do Vault e rode de novo.`,
      );
    }
    return lerInitJson(texto);
  };

  const inicializar = async () => {
    const resposta = await http('PUT', 'sys/init', { corpo: { secret_shares: 1, secret_threshold: 1 } });
    if (resposta.status !== 200) throw new ErroDeBootstrap(`init falhou (HTTP ${resposta.status})`);
    const init = interpretarInit(resposta.corpo);
    await arquivos.gravarSecreto(caminhoDoInit, `${JSON.stringify(init, null, 2)}\n`);
    log('Vault inicializado; init.json gravado');
    return init;
  };

  const desselar = async (init) => {
    const resposta = await http('PUT', 'sys/unseal', { corpo: { key: init.chave_unseal_base64 } });
    if (resposta.status !== 200) throw new ErroDeBootstrap(`unseal falhou (HTTP ${resposta.status})`);
    await aguardarAtivo();
    log('Vault desselado');
  };

  const garantirKv = async (token) => {
    const montagens = dadosOuCorpo((await http('GET', 'sys/mounts', { token })).corpo);
    const kv = montagens['kv/'];
    if (kv === undefined) {
      const criar = await http('POST', 'sys/mounts/kv', {
        token,
        corpo: { type: 'kv', options: { version: '2' } },
      });
      if (criar.status >= 300) throw new ErroDeBootstrap(`mount kv/ falhou (HTTP ${criar.status})`);
      log('KV v2 habilitado em kv/');
      return;
    }
    if (kv.type !== 'kv' || kv.options?.version !== '2') {
      throw new ErroDeBootstrap('kv/ existe mas não é KV v2');
    }
  };

  const garantirAuditoria = async (token) => {
    const dispositivos = dadosOuCorpo((await http('GET', 'sys/audit', { token })).corpo);
    if (dispositivos['file/'] !== undefined) return;
    const criar = await http('PUT', 'sys/audit/file', {
      token,
      corpo: { type: 'file', options: { file_path: arquivoDeAuditoria } },
    });
    if (criar.status >= 300) throw new ErroDeBootstrap(`audit device falhou (HTTP ${criar.status})`);
    log('Audit device file habilitado');
  };

  const gravarPoliticas = async (token) => {
    for (const [nome, regras] of Object.entries(POLITICAS)) {
      const resposta = await http('PUT', `sys/policies/acl/${nome}`, {
        token,
        corpo: { policy: gerarPoliticaHcl(regras) },
      });
      if (resposta.status >= 300) throw new ErroDeBootstrap(`política ${nome} falhou (HTTP ${resposta.status})`);
    }
  };

  const garantirTokens = async (tokenRoot) => {
    const reemitidos = [];
    for (const { arquivo, politica } of TOKENS) {
      const caminho = join(dir, arquivo);
      const atual = (await arquivos.ler(caminho))?.trim();
      const lookup = atual
        ? await http('GET', 'auth/token/lookup-self', { token: atual }).catch(() => ({ status: 0, corpo: null }))
        : { status: 0, corpo: null };
      if (!decidirReemissao(lookup, politica)) continue;

      const criar = await http('POST', 'auth/token/create', {
        token: tokenRoot,
        corpo: {
          policies: [politica],
          period: PERIODO_DO_TOKEN,
          renewable: true,
          // Órfão: revogar o root token (futuro) não derruba os tokens técnicos.
          no_parent: true,
          display_name: politica,
        },
      });
      const novo = criar.corpo?.auth?.client_token;
      if (criar.status !== 200 || typeof novo !== 'string') {
        throw new ErroDeBootstrap(`token ${politica} não foi emitido (HTTP ${criar.status})`);
      }
      await arquivos.gravarSecreto(caminho, `${novo}\n`);
      reemitidos.push(arquivo);
      log(`Token ${arquivo} emitido`);
    }
    return reemitidos;
  };

  /** Idempotente: pode rodar quantas vezes quiser. */
  const garantir = async () => {
    const estado = await aguardarVault();
    const init = estado.initialized ? await lerInit() : await inicializar();
    if (!estado.initialized || estado.sealed) await desselar(init);

    await garantirKv(init.root_token);
    await garantirAuditoria(init.root_token);
    await gravarPoliticas(init.root_token);
    const tokensReemitidos = await garantirTokens(init.root_token);
    return { inicializadoAgora: !estado.initialized, tokensReemitidos };
  };

  /** Tokens periódicos expiram se ninguém os renovar; a vigia renova os três. */
  const renovarTokens = async () => {
    for (const { arquivo } of TOKENS) {
      const token = (await arquivos.ler(join(dir, arquivo)))?.trim();
      if (!token) continue;
      const resposta = await http('POST', 'auth/token/renew-self', { token, corpo: {} }).catch(() => null);
      if (resposta?.status !== 200) log(`Renovação de ${arquivo} recusada; será reemitido no próximo bootstrap`);
    }
  };

  /**
   * Um ciclo da vigia. Reinício do Vault → selado → desselar. Volume apagado → não
   * inicializado → bootstrap completo (os tokens antigos já não valem e são reemitidos).
   */
  const cicloDaVigia = async () => {
    const estado = await aguardarVault();
    return !estado.initialized || estado.sealed ? garantir() : null;
  };

  return { garantir, renovarTokens, cicloDaVigia };
};

export const vigiar = async (bootstrap, { log, esperar, deveParar = () => false, agora = Date.now } = {}) => {
  let ultimaRenovacao = agora();
  while (!deveParar()) {
    try {
      await bootstrap.cicloDaVigia();
      if (agora() - ultimaRenovacao >= INTERVALO_DE_RENOVACAO_MS) {
        await bootstrap.renovarTokens();
        ultimaRenovacao = agora();
      }
    } catch (erro) {
      // A vigia não morre: o Vault pode estar reiniciando. Mensagem sem corpo de resposta.
      log?.(`vigia: ${erro instanceof Error ? erro.message : 'erro'}`);
    }
    await esperar(INTERVALO_DA_VIGIA_MS);
  }
};

const executarComoCli = async () => {
  const raizDoScript = dirname(fileURLToPath(import.meta.url));
  const addr = (process.env.VAULT_ADDR ?? 'http://127.0.0.1:8200').replace(/\/+$/, '');
  const dir = resolve(process.env.VAULT_LOCAL_DIR ?? join(raizDoScript, '..', '.vault-local'));
  const log = (mensagem) => console.warn(`[vault-bootstrap] ${mensagem}`);

  const bootstrap = criarBootstrap({
    addr,
    dir,
    log,
    arquivoDeAuditoria: process.env.VAULT_AUDIT_FILE ?? '/vault/logs/audit.log',
    tentativas: Number(process.env.VAULT_BOOTSTRAP_TENTATIVAS ?? 90),
  });

  try {
    const resultado = await bootstrap.garantir();
    log(
      `pronto em ${addr} (${resultado.inicializadoAgora ? 'inicializado agora' : 'já inicializado'}; ` +
        `tokens reemitidos: ${resultado.tokensReemitidos.length})`,
    );
  } catch (erro) {
    console.error(`[vault-bootstrap] FALHOU: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
    process.exit(1);
  }

  if (process.argv.includes('--vigiar')) {
    let parar = false;
    for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => (parar = true));
    await vigiar(bootstrap, { log, esperar: (ms) => new Promise((r) => setTimeout(r, ms)), deveParar: () => parar });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await executarComoCli();
}
