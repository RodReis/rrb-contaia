import type { ComandoCienciaDfe } from '@contaia/shared';
import type { ComandoManifestarConclusiva } from '@contaia/shared';
import { C14N_1_0, type Adaptador } from './xml/adaptadores.js';

export const ADAPTADOR_CIENCIA_DFE: Adaptador = {
  finalidade: 'DFE_TESTE', raiz: 'envEvento', alvo: /^infEvento$/u, canonicalizacao: C14N_1_0,
};

export const criarXmlDaCiencia = (comando: Pick<ComandoCienciaDfe, 'cnpj'|'chaveAcesso'|'tipoEvento'|'sequencia'|'ocorridoEm'>): string => {
  const ocorridoEm = new Date(comando.ocorridoEm);
  if (comando.tipoEvento !== '210210' || comando.sequencia !== 1 || !/^\d{14}$/u.test(comando.cnpj) || !/^\d{44}$/u.test(comando.chaveAcesso) ||
      Number.isNaN(ocorridoEm.getTime())) throw new Error('FISCAL_ACK_IDENTITY_INVALID');
  const chave = comando.chaveAcesso;
  const id = `ID${comando.tipoEvento}${chave}${comando.sequencia.toString().padStart(2,'0')}`;
  return `<?xml version="1.0" encoding="UTF-8"?><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><evento versao="1.00"><infEvento Id="${id}"><cOrgao>${chave.slice(0,2)}</cOrgao><tpAmb>2</tpAmb><CNPJ>${comando.cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${ocorridoEm.toISOString()}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento></envEvento>`;
};

const escaparXml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export const criarXmlDaManifestacaoConclusiva=(comando:ComandoManifestarConclusiva,ocorridoEm:Date):string=>{
 if(!/^\d{14}$/u.test(comando.cnpj)||!/^\d{44}$/u.test(comando.chaveAcesso)||!Number.isFinite(ocorridoEm.getTime()))throw new Error('FISCAL_MANIFESTATION_IDENTITY_INVALID');
 const descricao=comando.tipoEvento==='210200'?'Confirmacao da Operacao':comando.tipoEvento==='210220'?'Ciencia da Operacao':'Operacao nao Realizada';
 const detail=comando.tipoEvento==='210240'?`<xJust>${escaparXml(comando.xJust?.trim()??'')}</xJust>`:'';
 const id=`ID${comando.tipoEvento}${comando.chaveAcesso}${String(comando.sequencia).padStart(2,'0')}`;
 return `<?xml version="1.0" encoding="UTF-8"?><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><evento versao="1.00"><infEvento Id="${id}"><cOrgao>${comando.chaveAcesso.slice(0,2)}</cOrgao><tpAmb>2</tpAmb><CNPJ>${comando.cnpj}</CNPJ><chNFe>${comando.chaveAcesso}</chNFe><dhEvento>${ocorridoEm.toISOString()}</dhEvento><tpEvento>${comando.tipoEvento}</tpEvento><nSeqEvento>${comando.sequencia}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${descricao}</descEvento>${detail}</detEvento></infEvento></evento></envEvento>`;
};
