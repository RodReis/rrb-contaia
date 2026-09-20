/**
 * Armazenamento de logo e documentos do escritório.
 *
 * Storage local compatível com S3 (MinIO, ADR-012). A chave carrega o
 * `tenantId` no prefixo: o isolamento não depende só do banco.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import type { TipoDeArquivo } from '@contaia/shared';

export type ArquivoRecebido = Readonly<{
  nomeOriginal: string;
  tipoConteudo: string;
  conteudo: Buffer;
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
}
