import { describe, expect, it } from 'vitest';
import { digitoVerificadorDaChaveNfeValido, normalizarNfceGoias } from './nfce.js';

const chaveBase = '5226101234567800019565001000000123100000001';
const dv = (base: string): string => {
  let soma = 0;
  let peso = 2;
  for (let indice = base.length - 1; indice >= 0; indice--) {
    soma += Number(base[indice]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return String(resto <= 1 ? 0 : 11 - resto);
};
const chave = chaveBase + dv(chaveBase);
const cnpj = '12345678000195';
const criarXml = (version: '3.10' | '4.00' = '4.00', overrides: Readonly<{
  model?: string; key?: string; issuer?: string; issuerUf?: string; status?: string;
}> = {}) => {
  const date = version === '3.10' ? '<dEmi>2026-10-01</dEmi>' : '<dhEmi>2026-10-01T12:00:00-03:00</dhEmi>';
  const key = overrides.key ?? chave;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="' + version + '">',
    '<NFe><infNFe versao="' + version + '" Id="NFe' + key + '"><ide><cUF>52</cUF><mod>' + (overrides.model ?? '65') + '</mod><serie>1</serie><nNF>123</nNF><tpAmb>1</tpAmb><tpEmis>1</tpEmis><cNF>00000001</cNF>' + date + '</ide>',
    '<emit><CNPJ>' + (overrides.issuer ?? cnpj) + '</CNPJ><UF>' + (overrides.issuerUf ?? 'GO') + '</UF></emit><det nItem="1"><prod><cProd>SKU-1</cProd><xProd>Produto de teste</xProd><NCM>87089990</NCM><CEST>0100100</CEST><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMS00><CST>00</CST><vBC>10.00</vBC><vICMS>1.80</vICMS></ICMS00></ICMS></imposto></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe>',
    '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/><SignatureValue>c2lnbmF0dXJl</SignatureValue></Signature></NFe>',
    '<protNFe><infProt><tpAmb>1</tpAmb><verAplic>fixture</verAplic><chNFe>' + key + '</chNFe><dhRecbto>2026-10-01T12:01:00-03:00</dhRecbto><nProt>152260000000001</nProt><cStat>' + (overrides.status ?? '100') + '</cStat></infProt></protNFe>',
    '</nfeProc>',
  ].join('');
};

describe('normalizarNfceGoias', () => {
  it.each(['3.10', '4.00'] as const)('normaliza layout %s sem inferir validação criptográfica', (version) => {
    const result = normalizarNfceGoias(new TextEncoder().encode(criarXml(version)), cnpj);
    expect(result).toMatchObject({
      modelo: '65', versaoLayout: version, chaveAcesso: chave, cnpjEmitente: cnpj,
      ufEmitente: 'GO', ambiente: 'PRODUCAO', serie: '1', numero: '123',
      statusProtocolo: 'AUTORIZADA', assinaturasEncontradas: 1,
    });
    expect(result.documento).toMatchObject({
      especie: 'NFCE_65', modelo: '65', versaoLayout: version,
      itens: [expect.objectContaining({ codigo: 'SKU-1', descricao: 'Produto de teste', ncm: '87089990', cest: '0100100' })],
    });
  });

  it('rejeita dígito verificador incorreto na chave', () => {
    expect(digitoVerificadorDaChaveNfeValido(chave)).toBe(true);
    expect(() => normalizarNfceGoias(new TextEncoder().encode(criarXml('4.00', { key: chave.slice(0, -1) + '0' })), cnpj))
      .toThrow('NFCE_ACCESS_KEY_INVALID');
  });

  it('rejeita modelo, emitente e protocolo que não correspondem à cobertura', () => {
    expect(() => normalizarNfceGoias(new TextEncoder().encode(criarXml('4.00', { model: '55' })), cnpj))
      .toThrow('NFCE_MODEL_MISMATCH');
    expect(() => normalizarNfceGoias(new TextEncoder().encode(criarXml('4.00', { issuerUf: 'SP' })), cnpj))
      .toThrow('NFCE_ISSUER_MISMATCH');
    expect(() => normalizarNfceGoias(new TextEncoder().encode(criarXml('4.00', { status: '101' })), cnpj))
      .toThrow('NFCE_PROTOCOL_INVALID');
  });

  it('rejeita DTD antes de abrir o XML', () => {
    expect(() => normalizarNfceGoias(new TextEncoder().encode('<!DOCTYPE x [<!ENTITY a "x">]>' + criarXml()), cnpj))
      .toThrow('NFCE_XML_UNSAFE');
  });
});
