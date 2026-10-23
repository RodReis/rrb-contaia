import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const state=vi.hoisted(()=>({query:vi.fn(),approved:true,prior:false,unit:'UN',quantity:'30000000000',kind:'RESTITUTION',restitution:'10',complement:null as string|null,normalizedHash:null as string|null}));
vi.mock('@contaia/db',()=>({
  comContextoHumano:(_pool:unknown,_context:unknown,operation:(client:{query:typeof state.query})=>unknown)=>operation({query:state.query}),
  getDfeCaptureCompany:vi.fn(),listarHistoricoRegimeTributario:vi.fn(),
}));

import { IcmsStSettlementsService } from './icms-st-settlements.service.js';
import { parsearDocumentoFiscal } from './fiscal-document.parser.js';

const createService=()=>{
  state.query.mockImplementation(async(sql:string)=>{
    if(sql.includes('select exists(select 1 from app.usuario u join app.usuario_papel'))return {rows:[{allowed:true}]};
    if(sql.includes('from app.tax_st_return_event e left join app.tax_st_return_reversal'))return {rows:state.prior?[{id:'existing',evidence_sha256:createHash('sha256').update('fixture').digest('hex'),competence:'2019-02-01',returned_quantity_scaled:'10000000000',
      remaining_quantity_scaled:'20000000000',reversed_restitution_cents:'3',reversed_complement_cents:'0',original_line_id:'line',normalized_unit:'UN',requested_quantity:'10000000000',
      origin:'MANUAL_DOCUMENT',return_document_identity:'devolucao-original',return_item_identity:'1',event_date:'2019-02-03',review_action:'APPROVED'}]:[]};
    if(sql.includes('select l.difference_kind kind'))return {rows:[{kind:state.kind,restitution:state.restitution,complement:state.complement,
      facts:{quantityScaled:state.quantity,unit:state.unit,factDate:'2017-01-01'},calculation:{formulaVersion:'RULE-1'},unit:state.unit,
      source_ids:[],snapshot_id:'snapshot',revision:1,approved:state.approved,stale:false,document_number:'123',access_key:'1'.repeat(44),fact_date:'2017-01-01'}]};
    if(sql.includes("especie='NFE_55' and chave_acesso=$3"))return {rows:state.normalizedHash?[{id:'normalized-return',original_key:'tenant/source.xml',hash_sha256:state.normalizedHash}]:[]};
    if(sql.includes('sum(returned_quantity_scaled)'))return {rows:[{quantity:'0'}]};
    if(sql.includes('insert into app.tax_st_return_event'))return {rows:[{id:'event'}]};
    if(sql.includes('from app.tax_st_return_event where id=$1'))return {rows:[{original_snapshot_id:'snapshot',original_line_id:'line',return_item_identity:'1',event_date:'2019-02-03',
      returned_quantity_scaled:'10000000000',normalized_unit:'UN',evidence_facts:{originalQuantityScaled:'30000000000',originalRestitutionCents:10,originalComplementCents:null,differenceKind:'RESTITUTION',formulaVersion:'RULE-1',sourceIds:['line'],
        returnDocumentNumber:'123',returnAccessKey:'2'.repeat(44),returnModel:'55',returnSeries:'1',returnCfop:'1202',ncm:'12345678',productCode:'SKU-1',productDescription:'Produto',returnedQuantity:'1',unitPrice:'10',total:'10',efdDate:null,
        originalDocumentNumber:'456',originalAccessKey:'1'.repeat(44),originalDate:'2017-01-01'}}]};
    if(sql.includes('select app.tax_st_return_finalize'))return {rows:[{id:'reversal'}]};
    if(sql.includes('from app.tax_st_return_reversal r join app.tax_st_return_event e'))return {rows:[{event_id:'event',event_date:'2019-02-03',event_competence:'2019-02-01',quantity:'10000000000',
      unit:'UN',item_identity:'1',restitution:'3',complement:'0',evidence_sha256:'a'.repeat(64),regime:'SIMPLES_NACIONAL',evidence_facts:{returnDocumentNumber:'123',returnAccessKey:'2'.repeat(44),
        returnModel:'55',returnSeries:'1',returnCfop:'1202',ncm:'12345678',productCode:'SKU-1',productDescription:'Produto',returnedQuantity:'1',unitPrice:'10',total:'10',efdDate:null,
        originalDocumentNumber:'456',originalAccessKey:'1'.repeat(44),originalDate:'2017-01-01'}}]};
    if(sql.includes('select max(revision)::int revision from app.tax_st_settlement_snapshot'))return {rows:[{revision:null}]};
    if(sql.includes('select app.tax_st_settlement_process'))return {rows:[{snapshot_id:'new-snapshot'}]};
    return {rows:[]};
  });
  const storage={enviarComChave:vi.fn().mockResolvedValue(undefined)};
  return {service:new IcmsStSettlementsService({instancia:{} as never} as never,storage as never),storage};
};

afterEach(()=>{vi.clearAllMocks();state.approved=true;state.prior=false;state.unit='UN';state.quantity='30000000000';state.kind='RESTITUTION';state.restitution='10';state.complement=null;state.normalizedHash=null;});

const returnInput={originalSnapshotId:'snapshot',originalLineId:'line',returnDocumentIdentity:'2'.repeat(44),returnItemIdentity:'1',
  eventDate:'2019-02-03',unit:'UN',returnedQuantityScaled:'10000000000',returnedQuantity:'1',returnDocumentNumber:'123',returnAccessKey:'2'.repeat(44),
  returnModel:'55' as const,returnSeries:'1',returnCfop:'1202',ncm:null,productCode:'',productDescription:'',unitPrice:'',total:'',
  efdDate:null,evidenceOrigin:'MANUAL_DOCUMENT' as const,idempotencyKey:'00000000-0000-4000-8000-000000000001'};

describe('registro de devolução F32',()=>{
  it('submete evidência de linha aprovada e não efetiva estorno antes da decisão humana',async()=>{
    const {service,storage}=createService();
    const result=await service.registerManualReturn('tenant','user','company',returnInput,
      {nomeOriginal:'comprovante.pdf',tipoConteudo:'application/pdf',conteudo:Buffer.from('fixture')},'correlation');
    expect(result).toMatchObject({status:'SUBMITTED',competence:'2019-02-01',returnedQuantityScaled:'10000000000',reversedRestitutionCents:null,reversedComplementCents:null});
    expect(storage.enviarComChave).toHaveBeenCalledOnce();
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'),expect.any(Array));
    expect(state.query).not.toHaveBeenCalledWith(expect.stringContaining('insert into app.tax_st_return_reversal'),expect.any(Array));
  });

  it('valida C100/C113/C170 da EFD e grava origem e fatos com preço unitário derivado',async()=>{
    const {service}=createService();
    const originalKey='1'.repeat(44),returnKey='2'.repeat(44);
    const efd=Buffer.from([
      '|0190|UN|Unidade|',
      '|0200|SKU-1|Produto||SKU-OLD|UN|00|12345678|||||1234567|',
      '|C100|0|0|PART|55|00|1|123|'+returnKey+'|03022019||10,00|',
      '|C113|0|1|PART|55|1||456|01012017|'+originalKey+'|00|',
      '|C170|1|SKU-1|Produto|1,00000|UN|10,00|0|0|00|1202|NAT|0|0|0|0|0|0|0|',
      '|C990|5|',
    ].join('\r\n'));
    await service.registerManualReturn('tenant','user','company',{...returnInput,evidenceOrigin:'EFD',ncm:null,unitPrice:'',total:'',returnSeries:'1'},
      {nomeOriginal:'efd.txt',tipoConteudo:'text/plain',conteudo:efd},'correlation');
    const insert=state.query.mock.calls.find(([sql])=>String(sql).includes('insert into app.tax_st_return_event'));
    expect(insert?.[1]?.[4]).toBe('EFD');
    const facts=JSON.parse(String(insert?.[1]?.[13])) as Record<string,unknown>;
    expect(facts).toMatchObject({evidenceOrigin:'EFD',unitPrice:'10.000',total:'10.00',efdFacts:{sourceRecords:['C100','C113','C170','0190','0200'],originalAccessKey:originalKey}});
  });

  it('aceita só NF-e de devolução já normalizada no F18 e grava vínculo ao documento persistido',async()=>{
    const {service}=createService();
    const originalKey='1'.repeat(44),returnKey='2'.repeat(44);
    const xml='<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe'+returnKey+'" versao="4.00"><ide><cUF>52</cUF><mod>55</mod><finNFe>4</finNFe><nNF>123</nNF><serie>1</serie><tpAmb>1</tpAmb><tpEmis>1</tpEmis><cNF>00000001</cNF><dhEmi>2019-02-03T10:00:00-03:00</dhEmi><NFref><refNFe>'+originalKey+'</refNFe></NFref></ide><emit><CNPJ>11222333000181</CNPJ></emit><det nItem="1"><prod><cProd>SKU-1</cProd><xProd>Produto</xProd><NCM>12345678</NCM><CFOP>1202</CFOP><qCom>1.00000</qCom><uCom>UN</uCom><vProd>10.00</vProd></prod><imposto/></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/><SignatureValue>c2lnbmF0dXJl</SignatureValue></Signature></NFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>'+returnKey+'</chNFe><cStat>100</cStat><nProt>135190000000001</nProt><dhRecbto>2019-02-03T10:01:00-03:00</dhRecbto></infProt></protNFe></nfeProc>';
    const bytes=Buffer.from(xml);
    expect(()=>parsearDocumentoFiscal(bytes,'NFE_55')).not.toThrow();
    state.normalizedHash=createHash('sha256').update(bytes).digest('hex');
    await service.registerManualReturn('tenant','user','company',{...returnInput,evidenceOrigin:'NORMALIZED_NFE',ncm:null,unitPrice:'',total:'',returnSeries:'1'},
      {nomeOriginal:'devolucao.xml',tipoConteudo:'application/xml',conteudo:bytes},'correlation');
    const insert=state.query.mock.calls.find(([sql])=>String(sql).includes('insert into app.tax_st_return_event'));
    expect(insert?.[1]?.[4]).toBe('NORMALIZED_NFE');
    expect(insert?.[1]?.[5]).toBe('normalized-return');
    expect(insert?.[1]?.[13]).toContain('tenant/source.xml');
  });

  it('recusa linha sem aprovação sem enviar o anexo',async()=>{
    state.approved=false;
    const {service,storage}=createService();
    await expect(service.registerManualReturn('tenant','user','company',returnInput,
      {nomeOriginal:'comprovante.pdf',tipoConteudo:'application/pdf',conteudo:Buffer.from('fixture')},'correlation'))
      .rejects.toMatchObject({codigo:'ICMS_ST_REVISION_STALE'});
    expect(storage.enviarComChave).not.toHaveBeenCalled();
  });

  it('rejeita reutilização da idempotência com outra identidade fiscal antes do upload',async()=>{
    state.prior=true;
    const {service,storage}=createService();
    await expect(service.registerManualReturn('tenant','user','company',{...returnInput,returnDocumentIdentity:'3'.repeat(44),returnAccessKey:'3'.repeat(44)},
      {nomeOriginal:'comprovante.pdf',tipoConteudo:'application/pdf',conteudo:Buffer.from('fixture')},'correlation'))
      .rejects.toMatchObject({codigo:'CONFLITO_DE_VERSAO'});
    expect(storage.enviarComChave).not.toHaveBeenCalled();
  });

  it('só cria estorno após aprovação e preserva os componentes separados',async()=>{
    const {service}=createService();
    const result=await service.reviewManualReturn('tenant','user','company','event','APPROVED',null,'correlation');
    expect(result).toMatchObject({action:'APPROVED',competence:'2019-02-01',remainingQuantityScaled:'20000000000',reversedRestitutionCents:3,reversedComplementCents:0,snapshotId:'new-snapshot',revision:1,c002:expect.stringContaining('|C002|')});
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('select app.tax_st_return_finalize'),expect.any(Array));
  });
});
