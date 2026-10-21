import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { XmlBufferInputProvider, XmlDocument, XmlElement, xmlRegisterInputProvider, XsdValidator, ParseOption } from 'libxml2-wasm';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { NAMESPACE_NFE, normalizarNfceGoias } from '@contaia/shared';
import { comContexto, finalizarLoteNfce, gravarResultadoItemNfce } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import { NFCE_IMPORT_QUEUE, NfceImportCommandSchema } from '@contaia/shared';
import { Worker, type Job } from 'bullmq';
import type { Pool } from 'pg';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import { criarConexaoRedis } from './redis.js';
import type { ConfigDoArmazenamento } from './config.js';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const nsDs='http://www.w3.org/2000/09/xmldsig#';
const schemesRoot=path.resolve(globalThis.process.cwd(),'../../packages/shared/src/nfce/schemas');
const loaded = new Map<string,XsdValidator>();

const schemaFor=(version:'3.10'|'4.00')=>{
  const cached=loaded.get(version);if(cached)return cached;
  const dir=path.join(schemesRoot,version);
  const buffers:Record<string,Uint8Array>={};
  const filenames=version==='3.10'
    ? ['consReciNFe_v3.10.xsd','consSitNFe_v3.10.xsd','consStatServ_v3.10.xsd','enviNFe_v3.10.xsd','inutNFe_v3.10.xsd','leiauteConsSitNFe_v3.10.xsd','leiauteConsStatServ_v3.10.xsd','leiauteInutNFe_v3.10.xsd','leiauteNFe_v3.10.xsd','nfe_v3.10.xsd','procInutNFe_v3.10.xsd','procNFe_v3.10.xsd','retConsReciNFe_v3.10.xsd','retConsSitNFe_v3.10.xsd','retConsStatServ_v3.10.xsd','retEnviNFe_v3.10.xsd','retInutNFe_v3.10.xsd','tiposBasico_v3.10.xsd','xmldsig-core-schema_v1.01.xsd']
    : ['DFeTiposBasicos_v1.00.xsd','leiauteNFe_v4.00.xsd','nfe_v4.00.xsd','tiposBasico_v4.00.xsd','xmldsig-core-schema_v1.01.xsd'];
  for(const file of filenames) buffers[file]=readFileSync(path.join(dir,file));
  xmlRegisterInputProvider(new XmlBufferInputProvider(buffers));
  const root=version==='3.10'?'procNFe_v3.10.xsd':'nfe_v4.00.xsd';
  const doc=XmlDocument.fromBuffer(buffers[root]!,{url:root,option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
  const validator=XsdValidator.fromDoc(doc);doc.dispose();loaded.set(version,validator);return validator;
};

const validateSignature=(xml:string, signatureNode:Node, trustedRoots:readonly X509Certificate[])=>{
  const signingCertPem=SignedXml.getCertFromKeyInfo(signatureNode);
  if(!signingCertPem||trustedRoots.length===0) throw new Error('NFCE_SIGNATURE_INVALID');
  const signer=new X509Certificate(signingCertPem);
  const now=Date.now();if(Date.parse(signer.validFrom)>now||Date.parse(signer.validTo)<now)throw new Error('NFCE_SIGNATURE_INVALID');
  const embedded=Array.from(signatureNode.ownerDocument?.getElementsByTagNameNS(nsDs,'X509Certificate')??[]).flatMap(node=>{try{return[new X509Certificate(Buffer.from(node.textContent??'','base64'))];}catch{return[];}});
  const certificates=[signer,...embedded];let current=signer;const seen=new Set<string>();let trusted=trustedRoots.some(root=>root.fingerprint256===current.fingerprint256);
  for(let depth=0;depth<8&&!trusted;depth++){
    if(seen.has(current.fingerprint256))break;seen.add(current.fingerprint256);
    const issuer=[...certificates,...trustedRoots].find(cert=>current.checkIssued(cert)&&current.verify(cert.publicKey));
    if(!issuer)break;current=issuer;trusted=trustedRoots.some(root=>root.fingerprint256===current.fingerprint256);
  }
  if(!trusted)throw new Error('NFCE_SIGNATURE_INVALID');
  const verifier=new SignedXml({getCertFromKeyInfo:()=>signingCertPem});
  verifier.loadSignature(signatureNode);
  if(!verifier.checkSignature(xml)||verifier.getSignedReferences().length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
  const references=verifier.getReferences();
  if(references.length!==1||references[0]?.uri!==`#${(signatureNode.ownerDocument?.getElementsByTagNameNS(NAMESPACE_NFE,'infNFe')[0] as Element|null)?.getAttribute('Id')}`)throw new Error('NFCE_SIGNATURE_INVALID');
  return verifier.getSignedReferences()[0]!;
};

type Input=Readonly<{tenantId:string;companyId:string;batchId:string;itemId:string;actorId:string;correlationId:string;attemptsMade?:number}>;
type Item=Readonly<{id:string;nome_sanitizado:string;original_key:string;hash_sha256:string;tamanho_bytes:string;source_id:string;cnpj:string;bytes:Buffer;batch_id:string}>;

const processNfce=(pool:Pool,storage:ConfigDoArmazenamento,roots:readonly X509Certificate[])=>async(command:Input)=>{
  const context=contextoTecnico({identidadeTecnica:'worker-nfce',finalidade:'IMPORTACAO_NFCE',tenantId:command.tenantId,empresaId:command.companyId,correlationId:command.correlationId});
  const item=await comContexto(pool,context,async client=>{
    await client.query(`update app.nfce_import_item set status='PROCESSING' where id=$1 and batch_id=$2 and status in ('QUEUED','FAILED')`,[command.itemId,command.batchId]);
    await client.query(`update app.nfce_import_batch set status='PROCESSING',atualizado_em=now() where id=$1`,[command.batchId]);
    const result=await client.query<Item>(`select i.id,i.nome_sanitizado,i.original_key,i.hash_sha256,i.tamanho_bytes,i.batch_id,s.id source_id,s.cnpj from app.nfce_import_item i join app.nfce_import_source s on s.item_id=i.id where i.id=$1 and i.batch_id=$2 and i.tenant_id=$3 and i.empresa_id=$4`,[command.itemId,command.batchId,command.tenantId,command.companyId]);return result.rows[0]??null;
  });
  if(!item)return;
  const s3=new S3Client({endpoint:storage.endpoint,region:storage.regiao,forcePathStyle:true,credentials:{accessKeyId:storage.usuario,secretAccessKey:storage.senha}});
  try{
    const object=await s3.send(new GetObjectCommand({Bucket:storage.bucket,Key:item.original_key}));
    const bytes=Buffer.from(await object.Body!.transformToByteArray());
    const actual=createHash('sha256').update(bytes).digest('hex');if(actual!==item.hash_sha256)throw new Error('NFCE_ORIGINAL_INTEGRITY_INVALID');
    const digest=createHash('sha256').update(bytes).digest('hex');
    const result=await comContexto(pool,context,async client=>{
      try{
        const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        const parsed=normalizarNfceGoias(bytes,item.cnpj);
        const version=parsed.versaoLayout;
        const rootDoc=XmlDocument.fromBuffer(bytes,{option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
        if(version==='3.10')schemaFor(version).validate(rootDoc);
        else {
          const nfe=rootDoc.get('//n:NFe',{n:NAMESPACE_NFE});
          if(!(nfe instanceof XmlElement))throw new Error('NFCE_XML_INVALID');
          schemaFor(version).validate(nfe);
        }
        const dom=new DOMParser({errorHandler:()=>undefined}).parseFromString(xml,'application/xml');
        const signatures=dom.getElementsByTagNameNS(nsDs,'Signature');if(signatures.length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
        validateSignature(xml,signatures[0]!,roots);
        const outcome=await gravarResultadoItemNfce(client,{tenantId:command.tenantId,companyId:command.companyId,itemId:item.id,status:'IMPORTED',code:null,detail:null,parsed:parsed.documento,hash:digest,size:bytes.byteLength,originalKey:item.original_key,sourceId:item.source_id,actorId:command.actorId,correlationId:command.correlationId,ambiente:parsed.ambiente});
        void outcome;return {ok:true};
      }catch(cause){const code=cause instanceof Error&&cause.message.startsWith('NFCE_')?cause.message:'NFCE_XML_INVALID';await gravarResultadoItemNfce(client,{tenantId:command.tenantId,companyId:command.companyId,itemId:item.id,status:code==='NFCE_DOCUMENT_CONFLICT'?'CONFLICT':'REJECTED',code,detail:`Arquivo rejeitado: ${code}.`,hash:digest,size:bytes.byteLength,originalKey:item.original_key,sourceId:item.source_id,actorId:command.actorId,correlationId:command.correlationId});return{ok:false};}
    });
    void result;
    await comContexto(pool,context,client=>finalizarLoteNfce(client,command.batchId));
  }catch(cause){
    const message=cause instanceof Error?cause.message:'NFCE_STORAGE_FAILURE';
    const attempts=command.attemptsMade??0;
    if(attempts>=3){
      await comContexto(pool,context,async client=>{
        await client.query(`update app.nfce_import_item set status='FAILED',codigo='NFCE_PROCESSING_FAILURE',detalhe_sanitizado='Falha técnica no processamento do arquivo.',processado_em=now() where id=$1 and tenant_id=$2 and empresa_id=$3`,[command.itemId,command.tenantId,command.companyId]);
      });
    }
    if(attempts>=3)await comContexto(pool,context,client=>finalizarLoteNfce(client,command.batchId));
    console.error(JSON.stringify({event:'nfce-import-item-failure',code:message.startsWith('NFCE_')?message:'NFCE_STORAGE_FAILURE'}));
    throw cause;
  }finally{s3.destroy();}
};

export const iniciarConsumidorNfce=async(deps:Readonly<{pool:Pool;conexao:ConexaoDoRedis;storage:ConfigDoArmazenamento;certificateRoots:readonly X509Certificate[];prefixo?:string}>)=>{
  const redis=criarConexaoRedis(deps.conexao);const common={connection:redis,...(deps.prefixo===undefined?{}:{prefix:deps.prefixo})};
  const worker=new Worker(NFCE_IMPORT_QUEUE,async(job:Job<unknown>)=>processNfce(deps.pool,deps.storage,deps.certificateRoots)(Object.assign({},NfceImportCommandSchema.parse(job.data),{attemptsMade:job.attemptsMade})),{...common,concurrency:8});
  worker.on('error',e=>console.error(JSON.stringify({event:'nfce-import-worker-error',name:e.name})));
  await worker.waitUntilReady();return{fechar:async()=>{await worker.close();redis.disconnect();for(const value of loaded.values())value.dispose();loaded.clear();}};
};
