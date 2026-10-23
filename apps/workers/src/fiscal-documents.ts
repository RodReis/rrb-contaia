import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { comContexto } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import { FISCAL_DOCUMENTS_DLQ, FISCAL_DOCUMENTS_QUEUE, FiscalDocumentCommandSchema, type FiscalDocumentCommand } from '@contaia/shared';
import { Queue, Worker, type Job } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { NAMESPACE_NFE, normalizarEventoCancelamentoNfe } from '@contaia/shared';
import { XmlBufferInputProvider, XmlDocument, xmlRegisterInputProvider, XsdValidator, ParseOption } from 'libxml2-wasm';
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
const nsDs='http://www.w3.org/2000/09/xmldsig#';
const schemasRoot=path.resolve(globalThis.process.cwd(),'../../packages/shared/src/nfce/schemas/eventos');
const cancellationSchema=()=>{
  const files=['e110111_v1.00.xsd','leiauteEvento_v1.00.xsd','leiauteSRE_v1.00.xsd','procEventoNFe_v1.00.xsd','tiposBasico_v1.03.xsd','xmldsig-core-schema_v1.01.xsd'];
  const buffers:Record<string,Uint8Array>={};for(const file of files)buffers[file]=readFileSync(path.join(schemasRoot,file));
  xmlRegisterInputProvider(new XmlBufferInputProvider(buffers));
  const doc=XmlDocument.fromBuffer(buffers['procEventoNFe_v1.00.xsd']!,{url:'procEventoNFe_v1.00.xsd',option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
  try{return XsdValidator.fromDoc(doc);}finally{doc.dispose();}
};
const validarEventoNfe=(bytes:Uint8Array,roots:readonly X509Certificate[])=>{
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const dom=new DOMParser({errorHandler:()=>undefined}).parseFromString(xml,'application/xml');
  if(dom.documentElement.localName!=='procEventoNFe')return null;
  const normalized=normalizarEventoCancelamentoNfe(bytes);
  const xsd=cancellationSchema();const eventDoc=XmlDocument.fromBuffer(bytes,{option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});try{xsd.validate(eventDoc);}finally{eventDoc.dispose();}
  const signatures=dom.getElementsByTagNameNS(nsDs,'Signature');if(signatures.length!==1||roots.length===0)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  const certPem=SignedXml.getCertFromKeyInfo(signatures[0]!);if(!certPem)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  const signer=new X509Certificate(certPem);const eventInfo=dom.getElementsByTagNameNS(NAMESPACE_NFE,'infEvento')[0];const eventDate=eventInfo?.getElementsByTagNameNS(NAMESPACE_NFE,'dhEvento')[0]?.textContent?.trim();
  const instant=eventDate?Date.parse(eventDate):NaN;const validAt=(certificate:X509Certificate)=>Number.isFinite(instant)&&Date.parse(certificate.validFrom)<=instant&&Date.parse(certificate.validTo)>=instant;
  if(!validAt(signer)||signer.ca)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  const certificates=Array.from(dom.getElementsByTagNameNS(nsDs,'X509Certificate')).flatMap(node=>{try{return[new X509Certificate(Buffer.from(node.textContent??'','base64'))];}catch{return[];}});
  let current=signer;let trusted=roots.some(root=>root.fingerprint256===current.fingerprint256);const seen=new Set<string>();
  for(let depth=0;depth<8&&!trusted;depth++){
    if(seen.has(current.fingerprint256))break;seen.add(current.fingerprint256);
    const issuer=[...certificates,...roots].find(cert=>cert.ca&&validAt(cert)&&current.checkIssued(cert)&&current.verify(cert.publicKey));
    if(!issuer)break;current=issuer;trusted=roots.some(root=>root.fingerprint256===current.fingerprint256);
  }
  if(!trusted)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  const verifier=new SignedXml({getCertFromKeyInfo:()=>certPem});verifier.loadSignature(signatures[0]!);
  if(!verifier.checkSignature(xml)||verifier.getSignedReferences().length!==1)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  const eventId=eventInfo?.getAttribute('Id');const references=dom.getElementsByTagNameNS(nsDs,'Reference');
  if(!eventId||Array.from(dom.getElementsByTagName('*')).filter(node=>(node as Element).getAttribute('Id')===eventId).length!==1||references.length!==1||(references[0] as Element).getAttribute('URI')!==`#${eventId}`)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  const signed=verifier.getSignedReferences()[0]!;const signedDom=new DOMParser({errorHandler:()=>undefined}).parseFromString(signed,'application/xml');
  const signedInfo=signedDom.getElementsByTagNameNS(NAMESPACE_NFE,'infEvento');const signedValue=(name:string)=>signedInfo[0]?.getElementsByTagNameNS(NAMESPACE_NFE,name)[0]?.textContent?.trim();
  if(signedInfo.length!==1||signedValue('chNFe')!==normalized.chaveAcesso||signedValue('CNPJ')!==normalized.cnpjEmitente||signedValue('tpEvento')!=='110111'||signedValue('nSeqEvento')!==normalized.sequencia||signedValue('dhEvento')!==eventDate)throw new Error('FISCAL_EVENT_SIGNATURE_INVALID');
  return normalized;
};
type Staging = Readonly<{ id: string; cnpj: string; nsu: string; chave_acesso: string | null; especie: 'NFE_55' | 'CTE'; conteudo_bruto: Buffer; capturado_em: Date }>;

const processar = async (pool: Pool, storage: ConfigDoArmazenamento, roots: readonly X509Certificate[], command: FiscalDocumentCommand): Promise<void> => {
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
    const eventXml=new TextDecoder('utf-8',{fatal:true}).decode(row.conteudo_bruto);
    const eventRoot=new DOMParser({errorHandler:()=>undefined}).parseFromString(eventXml,'application/xml').documentElement;
    if(eventRoot.localName==='procEventoNFe'){
      const event=validarEventoNfe(row.conteudo_bruto,roots);
      if(!event)throw new Error('FISCAL_EVENT_INVALID');
      if(event.cnpjEmitente!==row.cnpj)throw new Error('FISCAL_EVENT_ISSUER_MISMATCH');
      await comContexto(pool,ctx,async(client)=>{
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${command.tenantId}:${command.companyId}:${event.chaveAcesso}`]);
        const prior=await client.query<{id:string;hash_sha256:string;protocolo:string}>(`select id,hash_sha256,protocolo from app.fiscal_document_verified_event where tenant_id=$1 and empresa_id=$2 and chave_acesso=$3 and tipo='110111' and sequencia=$4 for update`,[command.tenantId,command.companyId,event.chaveAcesso,event.sequencia]);
        if(prior.rows[0]&&(prior.rows[0].hash_sha256!==hash||prior.rows[0].protocolo!==event.protocolo))throw new Error('FISCAL_EVENT_CONFLICT');
        const inserted=await client.query<{id:string}>(`insert into app.fiscal_document_verified_event(tenant_id,empresa_id,staging_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,ocorrido_em,tamanho_bytes,correlation_id)
          values($1,$2,$3,$4,$5,$6,'110111',$7,$8,$9,$10,$11,$12,$13) on conflict(tenant_id,empresa_id,chave_acesso,tipo,sequencia) do nothing returning id`,[command.tenantId,command.companyId,row.id,event.chaveAcesso,event.cnpjEmitente,event.ambiente,event.sequencia,event.protocolo,hash,key,event.ocorridoEm,row.conteudo_bruto.byteLength,command.correlationId]);
        const sourceEventId=inserted.rows[0]?.id??prior.rows[0]?.id;
        if(!sourceEventId)return;
        const doc=await client.query<{id:string;emitido_em:Date;estado:string;protocolo_cancelamento:string|null}>(`select id,emitido_em,estado,protocolo_cancelamento from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie='NFE_55' and chave_acesso=$3 and estado in ('PROCESSADO','CANCELLED') for update`,[command.tenantId,command.companyId,event.chaveAcesso]);
        const target=doc.rows[0];if(!target)return;
        if(target.protocolo_cancelamento&&target.protocolo_cancelamento!==event.protocolo)throw new Error('FISCAL_EVENT_CONFLICT');
        if(target.estado!=='CANCELLED')await client.query(`update app.fiscal_document set estado='CANCELLED',cancelado_em=$3,protocolo_cancelamento=$2,atualizado_em=now() where id=$1 and estado<>'CANCELLED'`,[target.id,event.protocolo,event.ocorridoEm]);
        const fiscalEvent=await client.query<{id:string}>(`insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,verified_event_id,tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ator_id,correlation_id)
          values($1,$2,$3,$4,$5,'CANCELAMENTO','110111','Evento de cancelamento autorizado e conciliado.','f32-1.0.0',$6,$7,$8) on conflict(staging_id,tipo,codigo) where codigo='110111' do nothing returning id`,[command.tenantId,command.companyId,target.id,row.id,sourceEventId,hash,null,command.correlationId]);
        if(!fiscalEvent.rows[0])return;
        if(target.emitido_em)await client.query(`select app.tax_st_settlement_mark_stale($1,$2::date,$3,$4,$5)`,[command.companyId,`${target.emitido_em.toISOString().slice(0,7)}-01`,null,command.correlationId,target.id]);
        void fiscalEvent;
      });
      return;
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
    await comContexto(pool, ctx, async (client) => {
      const documentId=await persistirDocumentoFiscal(client, {
      tenantId: command.tenantId, empresaId: command.companyId, stagingId: row.id, cnpj: row.cnpj, nsu: row.nsu,
      correlationId: command.correlationId, originalKey: key, parserVersion: versaoParser,
      parsed: { ...parsed, id: randomUUID(), hashSha256: hash },
      });
      if(parsed.especie!=='NFE_55')return;
      const pending=await client.query<{id:string;staging_id:string;hash_sha256:string;protocolo:string;ambiente:string;sequencia:string;ocorrido_em:Date}>(`select id,staging_id,hash_sha256,protocolo,ambiente,sequencia,ocorrido_em from app.fiscal_document_verified_event where tenant_id=$1 and empresa_id=$2 and chave_acesso=$3`,[command.tenantId,command.companyId,parsed.chaveAcesso]);
      for(const event of pending.rows){
        const current=await client.query<{estado:string;protocolo_cancelamento:string|null}>(`select estado,protocolo_cancelamento from app.fiscal_document where id=$1 for update`,[documentId]);
        if(current.rows[0]?.protocolo_cancelamento&&current.rows[0].protocolo_cancelamento!==event.protocolo)throw new Error('FISCAL_EVENT_CONFLICT');
        const alreadyCancelled=current.rows[0]?.estado==='CANCELLED'?{rowCount:0}:await client.query(`update app.fiscal_document set estado='CANCELLED',cancelado_em=$3,protocolo_cancelamento=$2,atualizado_em=now() where id=$1 and estado<>'CANCELLED'`,[documentId,event.protocolo,event.ocorrido_em]);
        const fiscalEvent=await client.query<{id:string}>(`insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,verified_event_id,tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ator_id,correlation_id)
          values($1,$2,$3,$4,$5,'CANCELAMENTO','110111','Evento de cancelamento autorizado e conciliado.','f32-1.0.0',$6,null,$7) on conflict(staging_id,tipo,codigo) where codigo='110111' do nothing returning id`,[command.tenantId,command.companyId,documentId,event.staging_id,event.id,event.hash_sha256,command.correlationId]);
        if(!fiscalEvent.rows[0]&&alreadyCancelled.rowCount===0)continue;
      }
    });
  } finally { s3.destroy(); }
};

export const iniciarConsumidorDeDocumentosFiscais = async (deps: Readonly<{ pool: Pool; schedulerPool: Pool; conexao: ConexaoDoRedis; storage: ConfigDoArmazenamento; certificateRoots:readonly X509Certificate[]; signer?: ClienteDoSigner; prefixo?: string; }>) => {
  const redis = criarConexaoRedis(deps.conexao);
  const common = { connection: redis, ...(deps.prefixo === undefined ? {} : { prefix: deps.prefixo }) };
  const queue = new Queue(FISCAL_DOCUMENTS_QUEUE, common);
  const dead = new Queue(FISCAL_DOCUMENTS_DLQ, common);
  const worker = new Worker(FISCAL_DOCUMENTS_QUEUE, async (job: Job<unknown>) => {
    const command = FiscalDocumentCommandSchema.parse(job.data);
    await processar(deps.pool, deps.storage, deps.certificateRoots, command);
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
