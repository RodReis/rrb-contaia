/**
 * Leitura do original da importação no object storage local (MinIO, ADR-012), pela chave
 * endereçada por conteúdo que a API gravou na tentativa (`arquivoChave`). Mesmo cliente S3 da API
 * (endpoint, bucket, credenciais, path-style). O conteúdo nunca vai para log; a chave também não
 * (carrega tenant e empresa): o erro sai só com um código estável.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { ConfigDoArmazenamento } from '../config.js';

/** Prazos do S3: um MinIO travado vira falha transitória (retry), não um job preso para sempre. */
const PRAZO_DE_CONEXAO_MS = 5_000;
const PRAZO_DA_REQUISICAO_MS = 30_000;

export type CodigoDoArmazenamento = 'ARMAZENAMENTO_INDISPONIVEL' | 'ORIGINAL_NAO_ENCONTRADO';

/**
 * Falha de leitura do original. `ORIGINAL_NAO_ENCONTRADO` é definitiva (repetir não faz o objeto
 * aparecer); `ARMAZENAMENTO_INDISPONIVEL` é transitória (rede, MinIO fora, prazo).
 */
export class ErroDoArmazenamento extends Error {
  readonly codigo: CodigoDoArmazenamento;

  constructor(codigo: CodigoDoArmazenamento) {
    super(codigo);
    this.name = 'ErroDoArmazenamento';
    this.codigo = codigo;
  }
}

export type LeitorDoArmazenamento = Readonly<{
  ler: (chave: string) => Promise<Buffer>;
  fechar: () => void;
}>;

const objetoAusente = (erro: unknown): boolean => {
  const nome = (erro as { name?: unknown } | null)?.name;

  return nome === 'NoSuchKey' || nome === 'NotFound';
};

export const criarLeitorDoArmazenamento = (config: ConfigDoArmazenamento): LeitorDoArmazenamento => {
  const cliente = new S3Client({
    endpoint: config.endpoint,
    region: config.regiao,
    // MinIO não resolve bucket por subdomínio no ambiente local.
    forcePathStyle: true,
    credentials: { accessKeyId: config.usuario, secretAccessKey: config.senha },
    requestHandler: { connectionTimeout: PRAZO_DE_CONEXAO_MS, requestTimeout: PRAZO_DA_REQUISICAO_MS },
  });

  return {
    ler: async (chave) => {
      try {
        const resposta = await cliente.send(new GetObjectCommand({ Bucket: config.bucket, Key: chave }));

        if (resposta.Body === undefined) {
          throw new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL');
        }

        return Buffer.from(await resposta.Body.transformToByteArray());
      } catch (erro) {
        if (erro instanceof ErroDoArmazenamento) {
          throw erro;
        }

        throw new ErroDoArmazenamento(objetoAusente(erro) ? 'ORIGINAL_NAO_ENCONTRADO' : 'ARMAZENAMENTO_INDISPONIVEL');
      }
    },
    fechar: () => cliente.destroy(),
  };
};
