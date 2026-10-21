import type { PoolClient } from 'pg';
import type { DocumentoFiscalParseado } from '@contaia/shared/fiscal-document-parser';
import { createHash, randomUUID as uuidV4 } from 'node:crypto';

export type NfceBatchInput = Readonly<{
  tenantId: string; companyId: string; actorId: string; correlationId: string; source: 'PORTAL_GO'|'ERP'|'EMISSOR';
  items: readonly Readonly<{ name: string; size: number; hash: string; key: string; bytes: Buffer }>[];
}>;

export const criarLoteNfce = async (client: PoolClient, input: NfceBatchInput) => {
  const hashes=input.items.map(item=>item.hash).sort();
  const identity=createHash('sha256').update([input.tenantId,input.companyId,input.source,...hashes].join('\0')).digest('hex');
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[identity]);
  const prior = await client.query<{ id: string }>(
    `select b.id from app.nfce_import_batch b where b.tenant_id=$1 and b.empresa_id=$2
      and b.total=$3 and b.origem=$4
      and (select array_agg(i.hash_sha256 order by i.hash_sha256) from app.nfce_import_item i where i.batch_id=b.id)=$5::text[]
      order by b.criado_em desc limit 1`,
    [input.tenantId,input.companyId,input.items.length,input.source,hashes],
  );
  if (prior.rows[0]) return { batchId: prior.rows[0].id, reused: true, itemIds: [] as string[] };
  const batchId = uuidV4();
  await client.query(`insert into app.nfce_import_batch(id,tenant_id,empresa_id,actor_id,correlation_id,origem,total)
    values($1,$2,$3,$4,$5,$6,$7)`,[batchId,input.tenantId,input.companyId,input.actorId,input.correlationId,input.source,input.items.length]);
  const itemIds: string[] = [];
  const seenHashes=new Set<string>();
  for (const item of input.items) {
    const itemId = uuidV4(); itemIds.push(itemId);
    if(seenHashes.has(item.hash)){
      await client.query(`insert into app.nfce_import_item(id,tenant_id,empresa_id,batch_id,nome_sanitizado,tamanho_bytes,hash_sha256,original_key,status,codigo,detalhe_sanitizado,parser_version,schema_version,correlation_id,processado_em)
        values($1,$2,$3,$4,$5,$6,$7,$8,'REJECTED','NFCE_DUPLICATE_IN_BATCH','Arquivo duplicado neste lote.','f30-1.0.0','pl8i2+pl010f',$9,now())`,
        [itemId,input.tenantId,input.companyId,batchId,item.name.slice(0,180),item.size,item.hash,item.key,input.correlationId]);
      continue;
    }
    seenHashes.add(item.hash);
    await client.query(`insert into app.nfce_import_item(id,tenant_id,empresa_id,batch_id,nome_sanitizado,tamanho_bytes,hash_sha256,original_key,parser_version,schema_version,correlation_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,'f30-1.0.0','pl8i2+pl010f',$9)`,
      [itemId,input.tenantId,input.companyId,batchId,item.name.slice(0,180),item.size,item.hash,item.key,input.correlationId]);
    await client.query(`insert into app.nfce_import_source(tenant_id,empresa_id,item_id,cnpj,origem,correlation_id) values($1,$2,$3,(select cnpj from app.empresa where id=$2),$4,$5)`,
      [input.tenantId,input.companyId,itemId,input.source,input.correlationId]);
  }
  return { batchId, reused: false, itemIds };
};

export const consultarLoteNfce = async (client: PoolClient, companyId: string, batchId: string) => {
  const batch = await client.query(`select id,status,total,origem,criado_em,atualizado_em from app.nfce_import_batch where empresa_id=$1 and id=$2`,[companyId,batchId]);
  if (!batch.rows[0]) return null;
  const { rows } = await client.query(`select id,nome_sanitizado,tamanho_bytes,hash_sha256,status,codigo,detalhe_sanitizado,document_id,modelo,versao_layout,ambiente,chave_acesso,criado_em,processado_em
    from app.nfce_import_item where empresa_id=$1 and batch_id=$2 order by criado_em,id`,[companyId,batchId]);
  return { ...batch.rows[0], totais: rows.reduce((total: Record<string,number>, item) => { const key=String(item['status']); total[key]=(total[key]??0)+1; return total; },{}), itens: rows };
};

export const finalizarLoteNfce=async(client:PoolClient,batchId:string)=>client.query(`
  WITH aggregate AS (
    SELECT count(*) FILTER (WHERE status IN ('QUEUED','PROCESSING')) AS pendentes,
           count(*) FILTER (WHERE status<>'REJECTED') AS nao_rejeitados,
           count(*) FILTER (WHERE status IN ('REJECTED','CONFLICT','FAILED')) AS recusados
      FROM app.nfce_import_item WHERE batch_id=$1
  )
  UPDATE app.nfce_import_batch b SET status=CASE
    WHEN a.pendentes>0 THEN 'PROCESSING'
    WHEN a.nao_rejeitados=0 THEN 'REJECTED'
    WHEN a.recusados>0 THEN 'COMPLETED_WITH_REJECTIONS'
    ELSE 'COMPLETED' END, atualizado_em=now()
  FROM aggregate a WHERE b.id=$1`,[batchId]);

export const obterOriginalNfce=async(client:PoolClient,companyId:string,documentId:string)=>{
  const {rows}=await client.query(`select d.original_key,d.hash_sha256,d.tamanho_bytes,s.id source_id from app.fiscal_document d join app.fiscal_document_origin o on o.document_id=d.id join app.nfce_import_source s on s.id=o.nfce_source_id where d.empresa_id=$1 and d.id=$2 and d.especie='NFCE_65' limit 1`,[companyId,documentId]);return rows[0]??null;
};

export const listarItensLoteNfceCsv=async(client:PoolClient,companyId:string,batchId:string)=>client.query(`select nome_sanitizado,status,codigo,detalhe_sanitizado,modelo,versao_layout,ambiente,chave_acesso,document_id,hash_sha256,tamanho_bytes,processado_em from app.nfce_import_item where empresa_id=$1 and batch_id=$2 order by criado_em,id`,[companyId,batchId]);

export const gravarResultadoItemNfce = async (client: PoolClient, input: Readonly<{
  tenantId:string; companyId:string; itemId:string; status:'IMPORTED'|'REUSED'|'REJECTED'|'CONFLICT'|'FAILED'; code:string|null; detail:string|null;
  parsed?:DocumentoFiscalParseado; hash:string; size:number; originalKey:string; sourceId:string; actorId:string; correlationId:string; ambiente?:string;
}>) => {
  let resolved={...input};
  const candidate=resolved.parsed;
  if(candidate){
    const existing=await client.query<{id:string;hash_sha256:string}>(`select id,hash_sha256 from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie='NFCE_65' and chave_acesso=$3 for update`,[resolved.tenantId,resolved.companyId,candidate.chaveAcesso]);
    if(existing.rows[0]&&existing.rows[0].hash_sha256!==resolved.hash){const {parsed:discarded,...withoutParsed}=resolved;void discarded;resolved={...withoutParsed,status:'CONFLICT',code:'NFCE_DOCUMENT_CONFLICT',detail:'Chave já vinculada a conteúdo divergente.'};}
    else if(existing.rows[0])resolved={...resolved,status:'REUSED'};
  }
  await client.query(`update app.nfce_import_item set status=$1,codigo=$2,detalhe_sanitizado=$3,modelo=$4,versao_layout=$5,ambiente=$6,chave_acesso=$7,processado_em=now()
    where id=$8 and tenant_id=$9 and empresa_id=$10`,[resolved.status,resolved.code,resolved.detail,resolved.parsed?.modelo??null,resolved.parsed?.versaoLayout??null,resolved.ambiente??null,resolved.parsed?.chaveAcesso??null,resolved.itemId,resolved.tenantId,resolved.companyId]);
  if (!resolved.parsed || !['IMPORTED','REUSED'].includes(resolved.status)) return;
  const parsed=resolved.parsed;
  const found=await client.query<{id:string;hash_sha256:string}>(`select id,hash_sha256 from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie='NFCE_65' and chave_acesso=$3 for update`,[resolved.tenantId,resolved.companyId,parsed.chaveAcesso]);
  let documentId=found.rows[0]?.id;
  if (!documentId) {
    documentId=uuidV4();
    await client.query(`insert into app.fiscal_document(id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,protocolo,protocolo_recebido_em,emitido_em,numero_documento,serie_documento,emitente,destinatario,consumidor_final,total,base_ibs_cbs,total_ibs,total_cbs,estado,parser_version)
      values($1,$2,$3,null,'NFCE_65',$4,$5,$6,$7,'65',$8,$9,$10::timestamptz,$11::date,$12,$13,$14,$15,$16,$17::numeric,$18::numeric,$19::numeric,$20::numeric,'PROCESSADO','f30-1.0.0')`,
      [documentId,input.tenantId,input.companyId,parsed.chaveAcesso,input.hash,input.originalKey,input.size,parsed.versaoLayout,parsed.protocolo,parsed.protocoloRecebidoEm,parsed.emitidoEm?.slice(0,10)??null,parsed.numeroDocumento,parsed.serieDocumento,parsed.emitente,parsed.destinatario,parsed.finalConsumer,parsed.total,parsed.baseIbsCbs,parsed.totalIbs,parsed.totalCbs]);
    for(const [index,item] of parsed.itens.entries()) await client.query(`insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,gtin,descricao,quantidade,unidade,valor,ibs,cbs,ncm,cest,cfop,cst_csosn,codigo_beneficio,frete,seguro,desconto,outras_despesas) values($1,$2,$3,'f30-1.0.0',$4,$5,$6,$7,$8,$9::numeric,$10,$11::numeric,$12::numeric,$13::numeric,$14,$15,$16,$17,$18,$19::numeric,$20::numeric,$21::numeric,$22::numeric)`,[input.tenantId,input.companyId,documentId,index+1,item.tipo,item.codigo,item.gtin,item.descricao,item.quantidade,item.unidade,item.valor,item.ibs,item.cbs,item.ncm,item.cest,item.cfop,item.cstCsosn,item.codigoBeneficio,item.freight,item.insurance,item.discount,item.otherExpenses]);
    for(const tax of parsed.tributos) await client.query(`insert into app.fiscal_document_tax(tenant_id,empresa_id,document_id,parser_version,escopo,numero_item,codigo,base_calculo,aliquota,valor,situacao,classificacao) values($1,$2,$3,'f30-1.0.0',$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11) on conflict do nothing`,[input.tenantId,input.companyId,documentId,tax.escopo,tax.numeroItem,tax.codigo,tax.baseCalculo,tax.aliquota,tax.valor,tax.situacao,tax.classificacao]);
    for(const [index,payment] of parsed.pagamentos.entries()) await client.query(`insert into app.fiscal_document_payment(tenant_id,empresa_id,document_id,parser_version,numero,indicador,meio,valor,integracao,bandeira,autorizacao) values($1,$2,$3,'f30-1.0.0',$4,$5,$6,$7::numeric,$8,$9,$10) on conflict do nothing`,[input.tenantId,input.companyId,documentId,index+1,payment.indicador,payment.meio,payment.valor,payment.integracao,payment.bandeira,payment.autorizacao]);
    for(const party of parsed.partes) await client.query(`insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome,inscricao_estadual,logradouro,numero,complemento,bairro,codigo_municipio,municipio,uf,cep,codigo_pais,pais) values($1,$2,$3,'f30-1.0.0',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict do nothing`,[input.tenantId,input.companyId,documentId,party.papel,party.identificador,party.nome,party.inscricaoEstadual,party.logradouro,party.numero,party.complemento,party.bairro,party.codigoMunicipio,party.municipio,party.uf,party.cep,party.codigoPais,party.pais]);
  }
  await client.query(`insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,nfce_source_id,correlation_id,capturado_em) values($1,$2,$3,(select id from app.nfce_import_source where item_id=$4),$5,now()) on conflict do nothing`,[input.tenantId,input.companyId,documentId,input.itemId,input.correlationId]);
  await client.query(`insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,nfce_source_id,tipo,codigo,parser_version,hash_sha256,ator_id,correlation_id) values($1,$2,$3,(select id from app.nfce_import_source where item_id=$4),$5,$6,'f30-1.0.0',$7,$8,$9)`,[input.tenantId,input.companyId,documentId,input.itemId,found.rows[0]?'REUTILIZADO':'PROCESSADO',found.rows[0]?'REUTILIZADO':'PROCESSADO',input.hash,input.actorId,input.correlationId]);
  if(!found.rows[0]&&parsed.emitidoEm){
    const competence=`${parsed.emitidoEm.slice(0,7)}-01`;
    await client.query(`select app.tax_st_settlement_mark_stale($1,$2::date,$3,$4,$5)`,[input.companyId,competence,input.actorId,input.correlationId,documentId]);
  }
  await client.query(`update app.nfce_import_item set status=$1,document_id=$2 where id=$3`,[found.rows[0]?'REUSED':'IMPORTED',documentId,input.itemId]);
  await client.query(`update app.nfce_import_batch set status=case when exists(select 1 from app.nfce_import_item where batch_id=app.nfce_import_batch.id and status in ('REJECTED','CONFLICT','FAILED')) then 'COMPLETED_WITH_REJECTIONS' else 'COMPLETED' end,atualizado_em=now() where id=(select batch_id from app.nfce_import_item where id=$1) and not exists(select 1 from app.nfce_import_item where batch_id=app.nfce_import_batch.id and status in ('QUEUED','PROCESSING'))`,[input.itemId]);
};
