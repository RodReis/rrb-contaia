/**
 * Leitura ESTREITA do Vault KV v2 (SPEC-012 §3.4).
 *
 * O Signer usa o token `signer-leitura`: só `read` em `kv/data/certificados/*`. Este módulo só sabe
 * fazer GET do caminho exato de UMA versão — não existe list, metadata, escrita, rotação nem
 * administração, nem por conveniência de teste. O caminho é montado a partir de UUIDs vindos do
 * BANCO (metadados autorizados), nunca do chamador.
 *
 * O token é lido do arquivo a CADA uso e nunca fica em variável de módulo, log ou erro. PKCS#12 e
 * senha existem só na memória da operação; o chamador zera o buffer ao terminar.
 */
import { readFile } from 'node:fs/promises';

export type EscopoDoSegredo = Readonly<{ tenantId: string; empresaId: string; referencia: string }>;

export type SegredoLido = Readonly<{
  pkcs12: Buffer;
  senha: string;
  impressaoDigital: string;
}>;

export type FalhaDoVault = 'INDISPONIVEL' | 'NEGADO' | 'NAO_ENCONTRADO' | 'INESPERADA';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Só UUID entra no caminho do KV: nada de `..`, barra ou consulta embutida. */
export const caminhoDoSegredo = (escopo: EscopoDoSegredo): string => {
  for (const id of [escopo.tenantId, escopo.empresaId, escopo.referencia]) {
    if (!UUID.test(id)) {
      throw new ErroDoVault('INESPERADA', null);
    }
  }

  return `certificados/${escopo.tenantId}/${escopo.empresaId}/${escopo.referencia}`;
};

export type LeitorDoVault = Readonly<{
  ler(escopo: EscopoDoSegredo): Promise<SegredoLido>;
  /** `true` se o Vault responde inicializado, desselado e ativo. */
  pronto(): Promise<boolean>;
}>;

export type OpcoesDoLeitorDoVault = Readonly<{
  endereco: string;
  arquivoDoToken: string;
  fetchImpl?: typeof fetch;
  lerArquivo?: (caminho: string) => Promise<string>;
  tempoLimiteMs?: number;
}>;

const dadosDo = (corpo: unknown): Record<string, unknown> | null => {
  const externo = (corpo as { data?: { data?: unknown } } | null)?.data?.data;

  return typeof externo === 'object' && externo !== null ? (externo as Record<string, unknown>) : null;
};

export const criarLeitorDoVault = (opcoes: OpcoesDoLeitorDoVault): LeitorDoVault => {
  const {
    endereco,
    arquivoDoToken,
    fetchImpl = fetch,
    lerArquivo = (caminho: string) => readFile(caminho, 'utf8'),
    tempoLimiteMs = 5000,
  } = opcoes;

  return {
    async ler(escopo) {
      const caminho = caminhoDoSegredo(escopo);
      let token: string;

      try {
        token = (await lerArquivo(arquivoDoToken)).trim();
      } catch {
        throw new ErroDoVault('INDISPONIVEL', null);
      }

      let resposta: Response;

      try {
        resposta = await fetchImpl(`${endereco}/v1/kv/data/${caminho}`, {
          method: 'GET',
          headers: { 'x-vault-token': token },
          signal: AbortSignal.timeout(tempoLimiteMs),
        });
      } catch {
        throw new ErroDoVault('INDISPONIVEL', null);
      }

      if (resposta.status === 404) {
        // A F11 desativa por soft delete: a leitura da versão apagada devolve 404.
        throw new ErroDoVault('NAO_ENCONTRADO', 404);
      }
      if (resposta.status === 401 || resposta.status === 403) {
        throw new ErroDoVault('NEGADO', resposta.status);
      }
      if (!resposta.ok) {
        throw new ErroDoVault(resposta.status >= 500 || resposta.status === 429 ? 'INDISPONIVEL' : 'INESPERADA', resposta.status);
      }

      const dados = dadosDo(await resposta.json().catch(() => null));
      const base64 = dados?.['pkcs12_base64'];
      const senha = dados?.['senha'];
      const impressao = dados?.['impressao_digital'];

      if (typeof base64 !== 'string' || typeof senha !== 'string' || typeof impressao !== 'string' || base64 === '') {
        throw new ErroDoVault('INESPERADA', resposta.status);
      }

      return { pkcs12: Buffer.from(base64, 'base64'), senha, impressaoDigital: impressao };
    },

    async pronto() {
      try {
        const resposta = await fetchImpl(`${endereco}/v1/sys/health?standbyok=true`, {
          signal: AbortSignal.timeout(tempoLimiteMs),
        });

        return resposta.status === 200;
      } catch {
        return false;
      }
    },
  };
};
