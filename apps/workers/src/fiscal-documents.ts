import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { comContexto } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import { FISCAL_DOCUMENTS_DLQ, FISCAL_DOCUMENTS_QUEUE, FiscalDocumentCommandSchema, type FiscalDocumentCommand } from '@contaia/shared';
import { Queue, Worker, type Job } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import { criarConexaoRedis } from './redis.js';
import type { ConfigDoArmazenamento } from './config.js';
import { iniciarAgendadorDeDocumentosFiscais, iniciarAgendadorDeCiencias } from './dfe-scheduler.js';
import { iniciarConsumidorDeCiencias } from './fiscal-acknowledgement.js';
import type { ClienteDoSigner } from '@contaia/signer-client';
import { parsearDocumentoFiscal } from '@contaia/shared/fiscal-document-parser';
import { persistirDocumentoFiscal, persistirFalhaDocumentoFiscal, transicionarCienciaDaEmissao } from '@contaia/db';

const versaoParser = 'f18-1.0.0';
type Staging = Readonly<{ id: string; cnpj: string; nsu: string; chave_acesso: string | null; especie: 'NFE_55' | 'CTE'; conteudo_bruto: Buffer; capturado_em: Date }>;

const processar = async (pool: Pool, storage: ConfigDoArmazenamento, command: FiscalDocumentCommand): Promise<void> => {
  const ctx = contextoTecnico({ identidadeTecnica: 'worker', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: command.tenantId, empresaId: command.companyId, correlationId: command.correlationId });
  const row = await comContexto(pool, ctx, async (client) => {
    const result = await client.query<Staging>(`select id,cnpj,nsu,chave_acesso,especie,conteudo_bruto,capturado_em from app.dfe_capture_staging where id=$1 and empresa_id=$2`, [command.stagingId,command.companyId]);
    return result.rows[0] ?? null;
  });
  if (!row) return;
  if(row.chave_acesso){
    const expected=await comContexto(pool,ctx,async(client)=>client.query<{chave_acesso:string}>(`select chave_acesso from app.fiscal_acknowledgement where xml_staging_id=$1 and empresa_id=$2`,[row.id,command.companyId]));
    if(expected.rows[0]&&expected.rows[0].chave_acesso!==row.chave_acesso){
      const acknowledgement = await comContexto(pool,ctx,async(client)=>client.query<{id:string}>(`select id from app.fiscal_acknowledgement where xml_staging_id=$1 and empresa_id=$2`,[row.id,command.companyId]));
      if(acknowledgement.rows[0]) await comContexto(pool,ctx,(client)=>transicionarCienciaDaEmissao(client,{tenantId:command.tenantId,empresaId:command.companyId,
        acknowledgementId:acknowledgement.rows[0]!.id,estado:'IMPEDIDO',codigo:'FISCAL_FULL_XML_MISMATCH',correlationId:command.correlationId}));
      return;
    }
  }
  const hash = createHash('sha256').update(row.conteudo_bruto).digest('hex');
  const key = `${command.tenantId}/${command.companyId}/fiscal-original/${hash}.xml`;
  const s3 = new S3Client({ endpoint: storage.endpoint, region: storage.regiao, forcePathStyle: true, credentials: { accessKeyId: storage.usuario, secretAccessKey: storage.senha } });
  try {
    try {
      await s3.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: row.conteudo_bruto, ContentType: 'application/xml' }));
    } catch (cause) {
      await comContexto(pool, ctx, (client) => persistirFalhaDocumentoFiscal(client, {
        tenantId: command.tenantId, empresaId: command.companyId, stagingId: row.id, especie: row.especie,
        chaveAcesso: row.chave_acesso, hashSha256: hash, tamanho: row.conteudo_bruto.byteLength,
        originalKey: key, parserVersion: versaoParser, correlationId: command.correlationId,
        codigo: 'FISCAL_ORIGINAL_UNAVAILABLE', estado: 'FALHA',
      }));
      throw cause;
    }
    let parsed: ReturnType<typeof parsearDocumentoFiscal>;
    try {
      parsed = parsearDocumentoFiscal(row.conteudo_bruto, row.especie);
    } catch (cause) {
      const code = cause instanceof Error && cause.message.startsWith('FISCAL_') ? cause.message : 'FISCAL_XML_INVALID';
      await comContexto(pool, ctx, (client) => persistirFalhaDocumentoFiscal(client, {
        tenantId: command.tenantId, empresaId: command.companyId, stagingId: row.id, especie: row.especie,
        chaveAcesso: row.chave_acesso, hashSha256: hash, tamanho: row.conteudo_bruto.byteLength,
        originalKey: key, parserVersion: versaoParser, correlationId: command.correlationId, codigo: code,
        estado: code === 'FISCAL_LAYOUT_UNSUPPORTED' ? 'PENDENTE_LAYOUT' : 'XML_INVALIDO',
      }));
      return;
    }
    await comContexto(pool, ctx, (client) => persistirDocumentoFiscal(client, {
      tenantId: command.tenantId, empresaId: command.companyId, stagingId: row.id, cnpj: row.cnpj, nsu: row.nsu,
      correlationId: command.correlationId, originalKey: key, parserVersion: versaoParser,
      parsed: { ...parsed, id: randomUUID(), hashSha256: hash },
    }));
  } finally { s3.destroy(); }
};

export const iniciarConsumidorDeDocumentosFiscais = async (deps: Readonly<{ pool: Pool; schedulerPool: Pool; conexao: ConexaoDoRedis; storage: ConfigDoArmazenamento; signer?: ClienteDoSigner; prefixo?: string; }>) => {
  const redis = criarConexaoRedis(deps.conexao);
  const common = { connection: redis, ...(deps.prefixo === undefined ? {} : { prefix: deps.prefixo }) };
  const queue = new Queue(FISCAL_DOCUMENTS_QUEUE, common);
  const dead = new Queue(FISCAL_DOCUMENTS_DLQ, common);
  const worker = new Worker(FISCAL_DOCUMENTS_QUEUE, async (job: Job<unknown>) => {
    const command = FiscalDocumentCommandSchema.parse(job.data);
    await processar(deps.pool, deps.storage, command);
  }, { ...common, concurrency: 4 });
  const acknowledgementQueue = deps.signer ? new Queue('fiscal-acknowledgement',common) : null;
  const acknowledgement = deps.signer ? await iniciarConsumidorDeCiencias({ pool:deps.pool,schedulerPool:deps.schedulerPool,conexao:deps.conexao,signer:deps.signer,
    agora:()=>new Date(),...(deps.prefixo===undefined?{}:{prefixo:deps.prefixo}) }) : null;
  const scheduler = iniciarAgendadorDeDocumentosFiscais({ pool: deps.pool, schedulerPool: deps.schedulerPool, documentQueue: queue,
    ...(acknowledgementQueue ? { acknowledgementQueue } : {}) });
  const acknowledgementScheduler=acknowledgementQueue?iniciarAgendadorDeCiencias({pool:deps.pool,schedulerPool:deps.schedulerPool,acknowledgementQueue}):null;
  worker.on('failed', (job, error) => {
    if (!job || job.attemptsMade < Number(job.opts.attempts ?? 5)) return;
    const parsedCommand = FiscalDocumentCommandSchema.safeParse(job.data);
    if (!parsedCommand.success) return;
    const command = parsedCommand.data;
    const ctx = contextoTecnico({ identidadeTecnica: 'worker', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: command.tenantId, empresaId: command.companyId, correlationId: command.correlationId });
    const persistirFalha = comContexto(deps.pool, ctx, async (client) => {
      const result = await client.query<Staging>(`select id,cnpj,nsu,chave_acesso,especie,conteudo_bruto,capturado_em from app.dfe_capture_staging where id=$1 and empresa_id=$2`, [command.stagingId,command.companyId]);
      const row = result.rows[0];
      if (row) await persistirFalhaDocumentoFiscal(client, { tenantId: command.tenantId, empresaId: command.companyId,
        stagingId: row.id, especie: row.especie, chaveAcesso: row.chave_acesso,
        hashSha256: createHash('sha256').update(row.conteudo_bruto).digest('hex'), tamanho: row.conteudo_bruto.byteLength,
        originalKey: `${command.tenantId}/${command.companyId}/fiscal-original/${createHash('sha256').update(row.conteudo_bruto).digest('hex')}.xml`,
        parserVersion: versaoParser, correlationId: command.correlationId, codigo: 'FISCAL_PROCESSING_FAILED', estado: 'FALHA' });
    });
    const registrarNaDlq = dead.add('dead', { ...command, attempts: job.attemptsMade, code: 'FISCAL_PROCESSING_FAILED' }, {
      jobId: `fiscal-dead-${command.stagingId}`, removeOnFail: false,
    });
    void Promise.allSettled([persistirFalha,registrarNaDlq]).then((results) => {
      for (const result of results) if (result.status === 'rejected') {
        const failure = result.reason;
        console.error(JSON.stringify({ event: 'fiscal-documents-dlq-failed', name: failure instanceof Error ? failure.name : error.name }));
      }
    });
  });
  worker.on('error', (error) => console.error(JSON.stringify({ event: 'fiscal-documents-worker-error', name: error.name })));
  await worker.waitUntilReady();
  return { fechar: async () => { scheduler.close(); acknowledgementScheduler?.close(); await acknowledgement?.fechar(); await acknowledgementQueue?.close(); await worker.close(); await queue.close(); await dead.close(); redis.disconnect(); } };
};
