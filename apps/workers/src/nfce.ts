import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { XmlBufferInputProvider, XmlDocument, XmlElement, xmlRegisterInputProvider, XsdValidator, ParseOption } from 'libxml2-wasm';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { NAMESPACE_NFE, normalizarEventoCancelamentoNfce, normalizarNfceGoias } from '@contaia/shared';
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
let eventSchema:XsdValidator|undefined;
let cancellationDetailSchema:XsdValidator|undefined;

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

const cancellationSchema=()=>{
  if(eventSchema)return eventSchema;
  const dir=path.join(schemesRoot,'eventos');
  const filenames=['e110111_v1.00.xsd','leiauteEvento_v1.00.xsd','leiauteSRE_v1.00.xsd','procEventoNFe_v1.00.xsd','tiposBasico_v1.03.xsd','xmldsig-core-schema_v1.01.xsd'];
  const buffers:Record<string,Uint8Array>={};
  for(const file of filenames)buffers[file]=readFileSync(path.join(dir,file));
  xmlRegisterInputProvider(new XmlBufferInputProvider(buffers));
  const doc=XmlDocument.fromBuffer(buffers['procEventoNFe_v1.00.xsd']!,{url:'procEventoNFe_v1.00.xsd',option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
  eventSchema=XsdValidator.fromDoc(doc);doc.dispose();
  const detail=XmlDocument.fromBuffer(buffers['e110111_v1.00.xsd']!,{url:'e110111_v1.00.xsd',option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
  cancellationDetailSchema=XsdValidator.fromDoc(detail);detail.dispose();return eventSchema;
};

export const validarSchemaEventoCancelamentoNfce=(bytes:Uint8Array)=>{
  const eventDoc=XmlDocument.fromBuffer(bytes,{option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
  try{cancellationSchema().validate(eventDoc);}finally{eventDoc.dispose();}
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const dom=new DOMParser({errorHandler:()=>undefined}).parseFromString(xml,'application/xml');
  const details=dom.getElementsByTagNameNS(NAMESPACE_NFE,'detEvento');
  if(details.length!==1)throw new Error('NFCE_PROTOCOL_INVALID');
  const detailDoc=XmlDocument.fromBuffer(Buffer.from(new XMLSerializer().serializeToString(details[0]!)),{option:ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NONET});
  try{cancellationDetailSchema!.validate(detailDoc);}finally{detailDoc.dispose();}
};

const validateSignature=(xml:string, signatureNode:Node, trustedRoots:readonly X509Certificate[], signedLocalName:'infNFe'|'infEvento',verificationInstant?:string)=>{
  const signingCertPem=SignedXml.getCertFromKeyInfo(signatureNode);
  if(!signingCertPem||trustedRoots.length===0) throw new Error('NFCE_SIGNATURE_INVALID');
  const signer=new X509Certificate(signingCertPem);
  const verifiedAt=verificationInstant===undefined?Date.now():Date.parse(verificationInstant);
  const validAt=(certificate:X509Certificate)=>Number.isFinite(verifiedAt)&&Date.parse(certificate.validFrom)<=verifiedAt&&Date.parse(certificate.validTo)>=verifiedAt;
  if(!validAt(signer)||signer.ca)throw new Error('NFCE_SIGNATURE_INVALID');
  const embedded=Array.from(signatureNode.ownerDocument?.getElementsByTagNameNS(nsDs,'X509Certificate')??[]).flatMap(node=>{try{return[new X509Certificate(Buffer.from(node.textContent??'','base64'))];}catch{return[];}});
  const certificates=[signer,...embedded];let current=signer;const seen=new Set<string>();let trusted=trustedRoots.some(root=>root.fingerprint256===current.fingerprint256);
  for(let depth=0;depth<8&&!trusted;depth++){
    if(seen.has(current.fingerprint256))break;seen.add(current.fingerprint256);
    const issuer=[...certificates,...trustedRoots].find(cert=>cert.ca&&validAt(cert)&&current.checkIssued(cert)&&current.verify(cert.publicKey));
    if(!issuer)break;current=issuer;trusted=trustedRoots.some(root=>root.fingerprint256===current.fingerprint256);
  }
  if(!trusted)throw new Error('NFCE_SIGNATURE_INVALID');
  const verifier=new SignedXml({getCertFromKeyInfo:()=>signingCertPem});
  verifier.loadSignature(signatureNode);
  if(!verifier.checkSignature(xml)||verifier.getSignedReferences().length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
  const doc=signatureNode.ownerDocument;
  const signedNodes=doc?.getElementsByTagNameNS(NAMESPACE_NFE,signedLocalName);
  if(!signedNodes||signedNodes.length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
  const signedNode=signedNodes[0] as Element;
  const id=signedNode.getAttribute('Id');
  if(!id||Array.from(doc!.getElementsByTagName('*')).filter(node=>(node as Element).getAttribute('Id')===id).length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
  const references=doc?.getElementsByTagNameNS(nsDs,'Reference');
  if(!references||references.length!==1||(references[0] as Element).getAttribute('URI')!==`#${id}`)throw new Error('NFCE_SIGNATURE_INVALID');
  const authenticated=verifier.getSignedReferences();
  if(authenticated.length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
  return authenticated[0]!;
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
        const documentRoot=new DOMParser({errorHandler:()=>undefined}).parseFromString(xml,'application/xml').documentElement;
        if(documentRoot.localName==='procEventoNFe'){
          const parsedEvent=normalizarEventoCancelamentoNfce(bytes);
          if(parsedEvent.cnpjEmitente!==item.cnpj)throw new Error('NFCE_ISSUER_MISMATCH');
          await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${command.tenantId}:${command.companyId}:${parsedEvent.chaveAcesso}`]);
          validarSchemaEventoCancelamentoNfce(bytes);
          const dom=new DOMParser({errorHandler:()=>undefined}).parseFromString(xml,'application/xml');
          const signatures=dom.getElementsByTagNameNS(nsDs,'Signature');if(signatures.length!==1)throw new Error('NFCE_SIGNATURE_INVALID');
          const rawEventDate=dom.getElementsByTagNameNS(NAMESPACE_NFE,'infEvento')[0]?.getElementsByTagNameNS(NAMESPACE_NFE,'dhEvento')[0]?.textContent?.trim();
          if(!rawEventDate||!Number.isFinite(Date.parse(rawEventDate)))throw new Error('NFCE_SIGNATURE_INVALID');
          const signedEvent=validateSignature(xml,signatures[0]!,roots,'infEvento',rawEventDate);
          const signedDom=new DOMParser({errorHandler:()=>undefined}).parseFromString(signedEvent,'application/xml');
          const signedInfo=signedDom.getElementsByTagNameNS(NAMESPACE_NFE,'infEvento');
          const signedValue=(name:string)=>signedInfo[0]?.getElementsByTagNameNS(NAMESPACE_NFE,name)[0]?.textContent?.trim();
          if(signedInfo.length!==1||signedValue('chNFe')!==parsedEvent.chaveAcesso||signedValue('tpEvento')!=='110111'||signedValue('CNPJ')!==parsedEvent.cnpjEmitente||signedValue('nSeqEvento')!==parsedEvent.sequencia||signedValue('tpAmb')!==(parsedEvent.ambiente==='PRODUCAO'?'1':'2'))throw new Error('NFCE_SIGNATURE_INVALID');
          if(signedValue('dhEvento')!==rawEventDate)throw new Error('NFCE_SIGNATURE_INVALID');
          const priorEvent=await client.query<{hash_sha256:string;item_id:string;status:string;document_id:string|null}>(`select e.hash_sha256,e.item_id,i.status,i.document_id from app.nfce_import_event e join app.nfce_import_item i on i.id=e.item_id where e.tenant_id=$1 and e.empresa_id=$2 and e.chave_acesso=$3 and e.tipo='110111' and e.sequencia=$4 and e.protocolo=$5 for update of e,i`,[command.tenantId,command.companyId,parsedEvent.chaveAcesso,parsedEvent.sequencia,parsedEvent.protocolo]);
          if(priorEvent.rows[0]&&priorEvent.rows[0].hash_sha256!==digest){
            await client.query(`update app.nfce_import_item set status='CONFLICT',codigo='NFCE_DOCUMENT_CONFLICT',detalhe_sanitizado='Identidade de evento já vinculada a conteúdo divergente.',processado_em=now() where id=$1`,[item.id]);
            return {ok:false};
          }
          if(priorEvent.rows[0]){
            await client.query(`update app.nfce_import_item set status='REUSED',codigo='NFCE_EVENT_REUSED',detalhe_sanitizado='Evento idêntico já recebido neste contexto.',modelo='65',versao_layout='1.00',ambiente=$1,chave_acesso=$2,document_id=$3,processado_em=now() where id=$4`,[parsedEvent.ambiente,parsedEvent.chaveAcesso,priorEvent.rows[0].document_id,item.id]);
            return {ok:true};
          }
          await client.query(`insert into app.nfce_import_event(tenant_id,empresa_id,item_id,source_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,tamanho_bytes,correlation_id)
            values($1,$2,$3,$4,$5,$6,$7,'110111',$8,$9,$10,$11,$12,$13) on conflict(tenant_id,empresa_id,chave_acesso,tipo,sequencia,protocolo) do nothing`,[command.tenantId,command.companyId,item.id,item.source_id,parsedEvent.chaveAcesso,parsedEvent.cnpjEmitente,parsedEvent.ambiente,parsedEvent.sequencia,parsedEvent.protocolo,digest,item.original_key,bytes.byteLength,command.correlationId]);
          const matchingDocument=await client.query<{id:string;emitido_em:string|null}>(`select d.id,d.emitido_em from app.fiscal_document d join app.fiscal_document_origin o on o.document_id=d.id join app.nfce_import_source s on s.id=o.nfce_source_id join app.nfce_import_item i on i.id=s.item_id where d.tenant_id=$1 and d.empresa_id=$2 and d.especie='NFCE_65' and d.chave_acesso=$3 and s.cnpj=$4 and i.ambiente=$5 for update of d`,[command.tenantId,command.companyId,parsedEvent.chaveAcesso,parsedEvent.cnpjEmitente,parsedEvent.ambiente]);
          const linked=matchingDocument.rows[0];
          if(linked){
            await client.query(`update app.fiscal_document set estado='CANCELLED',cancelado_em=now(),protocolo_cancelamento=$2,atualizado_em=now() where id=$1 and estado<>'CANCELLED'`,[linked.id,parsedEvent.protocolo]);
            await client.query(`insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,nfce_source_id,tipo,codigo,detalhe_sanitizado,parser_version,hash_sha256,ator_id,correlation_id) values($1,$2,$3,$4,'CANCELAMENTO','110111','Evento de cancelamento autorizado e conciliado.','f30-1.0.0',$5,$6,$7)`,[command.tenantId,command.companyId,linked.id,item.source_id,digest,command.actorId,command.correlationId]);
            await client.query(`update app.nfce_import_item set status='IMPORTED',codigo=null,detalhe_sanitizado='Evento de cancelamento vinculado ao documento.',modelo='65',versao_layout='1.00',ambiente=$1,chave_acesso=$2,document_id=$3,processado_em=now() where id=$4`,[parsedEvent.ambiente,parsedEvent.chaveAcesso,linked.id,item.id]);
            if(linked.emitido_em)await client.query(`select app.tax_st_settlement_mark_stale($1,$2::date,$3,$4,$5)`,[command.companyId,`${linked.emitido_em.slice(0,7)}-01`,command.actorId,command.correlationId,linked.id]);
          }else await client.query(`update app.nfce_import_item set status='PENDING_LINK',codigo='NFCE_EVENT_ORPHAN',detalhe_sanitizado='Evento de cancelamento validado; aguardando documento correspondente.',modelo='65',versao_layout='1.00',ambiente=$1,chave_acesso=$2,processado_em=now() where id=$3 and tenant_id=$4 and empresa_id=$5`,[parsedEvent.ambiente,parsedEvent.chaveAcesso,item.id,command.tenantId,command.companyId]);
          return {ok:true};
        }
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
        validateSignature(xml,signatures[0]!,roots,'infNFe',parsed.protocoloRecebidoEm);
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
  await worker.waitUntilReady();return{fechar:async()=>{await worker.close();redis.disconnect();for(const value of loaded.values())value.dispose();loaded.clear();eventSchema?.dispose();cancellationDetailSchema?.dispose();eventSchema=undefined;cancellationDetailSchema=undefined;}};
};
