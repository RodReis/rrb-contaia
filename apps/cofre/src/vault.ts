/**
 * Adaptador do Vault KV v2 (SPEC-011 §6.1/§6.2).
 *
 * O cofre usa o token `cofre-ingestao` (WRITE-ONLY): só grava e muda a visibilidade
 * de versões que ele mesmo criou. Não existe método de leitura aqui — nem por
 * conveniência de teste: a leitura é o que a política do Vault nega.
 *
 * O token é lido do arquivo a CADA uso (o bootstrap pode reemiti-lo sem reiniciar
 * o cofre) e nunca é guardado em variável de módulo, log ou erro.
 */
import { readFile } from 'node:fs/promises';

export type DadosDoSegredo = Readonly<{
  pkcs12Base64: string;
  senha: string;
  impressaoDigital: string;
}>;

export type EscopoDoSegredo = Readonly<{ tenantId: string; empresaId: string; referencia: string }>;

export type FalhaDoVault = 'INDISPONIVEL' | 'NEGADO' | 'CONFLITO' | 'INESPERADA';

export class ErroDoVault extends Error {
  constructor(
    readonly tipo: FalhaDoVault,
    readonly statusHttp: number | null,
  ) {
    // Sem corpo da resposta: o Vault pode ecoar caminho; o status basta para o log.
    super(`Vault respondeu ${tipo}${statusHttp === null ? '' : ` (HTTP ${statusHttp})`}`);
    this.name = 'ErroDoVault';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids vêm de fora (ticket assinado, corpo da API): só UUID entra no caminho do KV. */
export const caminhoDoSegredo = (escopo: EscopoDoSegredo): string => {
  for (const id of [escopo.tenantId, escopo.empresaId, escopo.referencia]) {
    if (!UUID.test(id)) throw new ErroDoVault('INESPERADA', null);
  }
  return `certificados/${escopo.tenantId}/${escopo.empresaId}/${escopo.referencia}`;
};

export type ClienteDoVault = Readonly<{
  /** Devolve a versão criada (sempre 1: a referência é um UUID novo e `cas: 0` recusa sobrescrita). */
  gravar(escopo: EscopoDoSegredo, dados: DadosDoSegredo): Promise<number>;
  /** Soft delete (reversível por `restaurar`). */
  inutilizar(escopo: EscopoDoSegredo, versao?: number): Promise<void>;
  restaurar(escopo: EscopoDoSegredo, versao?: number): Promise<void>;
  /** Remove a versão definitivamente: só a compensação de ingestão não ativada usa. */
  destruir(escopo: EscopoDoSegredo, versao?: number): Promise<void>;
  /** `true` se o Vault responde inicializado e desselado. */
  pronto(): Promise<boolean>;
}>;

export type OpcoesDoClienteDoVault = Readonly<{
  endereco: string;
  arquivoDoToken: string;
  fetchImpl?: typeof fetch;
  lerArquivo?: (caminho: string) => Promise<string>;
  tempoLimiteMs?: number;
}>;

export const criarClienteDoVault = (opcoes: OpcoesDoClienteDoVault): ClienteDoVault => {
  const {
    endereco,
    arquivoDoToken,
    fetchImpl = fetch,
    lerArquivo = (caminho: string) => readFile(caminho, 'utf8'),
    tempoLimiteMs = 5000,
  } = opcoes;

  const chamar = async (
    metodo: 'POST' | 'PUT',
    rota: string,
    corpo: unknown,
  ): Promise<Record<string, unknown>> => {
    let token: string;
    try {
      token = (await lerArquivo(arquivoDoToken)).trim();
    } catch {
      throw new ErroDoVault('INDISPONIVEL', null);
    }

    let resposta: Response;
    try {
      resposta = await fetchImpl(`${endereco}/v1/${rota}`, {
        method: metodo,
        headers: { 'x-vault-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
    } catch {
      throw new ErroDoVault('INDISPONIVEL', null);
    }

    if (resposta.ok) {
      // 204 sem corpo é o normal de delete/undelete/destroy.
      return (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
    }
    if (resposta.status === 403 || resposta.status === 401) throw new ErroDoVault('NEGADO', resposta.status);
    if (resposta.status === 400 || resposta.status === 409) throw new ErroDoVault('CONFLITO', resposta.status);
    // 5xx e 429: selado, em standby ou sobrecarregado.
    throw new ErroDoVault(resposta.status >= 500 || resposta.status === 429 ? 'INDISPONIVEL' : 'INESPERADA', resposta.status);
  };

  const mudarVersao = async (
    metodo: 'POST' | 'PUT',
    operacao: 'delete' | 'undelete' | 'destroy',
    escopo: EscopoDoSegredo,
    versao: number,
  ): Promise<void> => {
    await chamar(metodo, `kv/${operacao}/${caminhoDoSegredo(escopo)}`, { versions: [versao] });
  };

  return {
    async gravar(escopo, dados) {
      const resposta = await chamar('POST', `kv/data/${caminhoDoSegredo(escopo)}`, {
        data: {
          pkcs12_base64: dados.pkcs12Base64,
          senha: dados.senha,
          impressao_digital: dados.impressaoDigital,
        },
        options: { cas: 0 },
      });
      const versao = (resposta['data'] as { version?: unknown } | undefined)?.version;
      return typeof versao === 'number' ? versao : 1;
    },
    inutilizar: (escopo, versao = 1) => mudarVersao('POST', 'delete', escopo, versao),
    restaurar: (escopo, versao = 1) => mudarVersao('POST', 'undelete', escopo, versao),
    destruir: (escopo, versao = 1) => mudarVersao('PUT', 'destroy', escopo, versao),
    async pronto() {
      try {
        const resposta = await fetchImpl(`${endereco}/v1/sys/health?standbyok=true`, {
          signal: AbortSignal.timeout(tempoLimiteMs),
        });
        // 200 = inicializado, desselado e ativo; 501 = sem init; 503 = selado.
        return resposta.status === 200;
      } catch {
        return false;
      }
    },
  };
};
