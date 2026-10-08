/**
 * Armazenamento de arquivos do produto: logo e documentos do escritório
 * (SPEC-001) e documentos cadastrais da empresa cliente (SPEC-004).
 *
 * Storage local compatível com S3 (MinIO, ADR-012). A chave carrega o
 * `tenantId` no prefixo: o isolamento não depende só do banco.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import type { TipoDeArquivo } from '@contaia/shared';

export type ArquivoRecebido = Readonly<{
  nomeOriginal: string;
  tipoConteudo: string;
  conteudo: Buffer;
}>;

export type ArquivoArmazenado = Readonly<{
  conteudo: Buffer;
  tipoConteudo: string | null;
}>;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env['S3_BUCKET'] ?? 'contaia-documentos';

  private readonly cliente = new S3Client({
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://127.0.0.1:19000',
    region: process.env['S3_REGION'] ?? 'us-east-1',
    // MinIO não resolve bucket por subdomínio no ambiente local.
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env['MINIO_ROOT_USER'] ?? 'contaia_local',
      secretAccessKey: process.env['MINIO_ROOT_PASSWORD'] ?? 'contaia_local_secret',
    },
  });

  async onModuleInit(): Promise<void> {
    try {
      await this.cliente.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.cliente.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`bucket ${this.bucket} criado no storage local`);
    }
  }

  /**
   * Sobe o arquivo e devolve a chave. O id é gerado aqui: nome original do
   * usuário nunca vira caminho, para não permitir travessia de diretório.
   */
  async enviar(
    tenantId: string,
    tipo: TipoDeArquivo,
    arquivo: ArquivoRecebido,
  ): Promise<string> {
    const extensao = extname(arquivo.nomeOriginal).toLowerCase().slice(0, 10);
    const chave = `${tenantId}/${tipo.toLowerCase()}/${randomUUID()}${extensao}`;

    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: arquivo.conteudo,
        ContentType: arquivo.tipoConteudo,
      }),
    );

    return chave;
  }

  /**
   * Sobe o arquivo numa chave decidida pelo caso de uso — nunca derivada do nome do usuário. Serve
   * ao armazenamento endereçado por conteúdo (SPEC-013: `…/<sha256>.csv`): reenviar os mesmos bytes
   * sobrescreve o objeto com conteúdo idêntico e não deixa original órfão.
   */
  async enviarComChave(chave: string, conteudo: Buffer, tipoConteudo: string): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: conteudo,
        ContentType: tipoConteudo,
      }),
    );
  }

  /**
   * Lê o arquivo pela chave. Não há URL assinada nem acesso direto do
   * navegador ao storage: o conteúdo passa pela aplicação, que já autorizou
   * tenant e empresa e registra o acesso (SPEC-004 §3.2). Bucket público ou
   * link assinado entregariam o documento sem trilha.
   *
   * Falha de leitura vira `ARQUIVO_INDISPONIVEL`, que a tela trata como erro
   * acionável — e o caso de uso não registra acesso concluído (§4).
   */
  async obter(chave: string): Promise<ArquivoArmazenado> {
    try {
      const resposta = await this.cliente.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
      );

      const corpo = resposta.Body;

      if (corpo === undefined) {
        throw new Error('resposta do storage sem corpo');
      }

      return {
        conteudo: Buffer.from(await corpo.transformToByteArray()),
        tipoConteudo: resposta.ContentType ?? null,
      };
    } catch (erro) {
      this.logger.error(`falha ao ler ${chave} do storage`, erro);

      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.ARQUIVO_INDISPONIVEL,
        'O arquivo não está disponível no momento. Tente novamente.',
      );
    }
  }
}
