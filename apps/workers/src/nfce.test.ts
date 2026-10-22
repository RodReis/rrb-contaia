import { describe,expect,it } from 'vitest';
import { validarSchemaEventoCancelamentoNfce } from './nfce.js';

const key='52261012345678000195650010000001231000000010';
const createEvent=(description='Cancelamento')=>Buffer.from(`<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento Id="ID110111${key}01"><cOrgao>52</cOrgao><tpAmb>1</tpAmb><CNPJ>12345678000195</CNPJ><chNFe>${key}</chNFe><dhEvento>2026-10-21T12:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${description}</descEvento><nProt>152260000000001</nProt><xJust>Documento emitido indevidamente</xJust></detEvento></infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#ID110111${key}01"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>YWJj</DigestValue></Reference></SignedInfo><SignatureValue>YWJj</SignatureValue><KeyInfo><X509Data><X509Certificate>YWJj</X509Certificate></X509Data></KeyInfo></Signature></evento><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><verAplic>fixture</verAplic><cOrgao>52</cOrgao><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-21T12:01:00-03:00</dhRegEvento><nProt>152260000000099</nProt></infEvento></retEvento></procEventoNFe>`);

describe('schema oficial de evento NFC-e',()=>{
  it('aceita envelope procEvento e detalhe de cancelamento 110111',()=>{
    expect(()=>validarSchemaEventoCancelamentoNfce(createEvent())).not.toThrow();
  });
  it('rejeita descrição de detalhe fora do XSD 110111',()=>{
    expect(()=>validarSchemaEventoCancelamentoNfce(createEvent('Carta de Correcao'))).toThrow();
  });
});
