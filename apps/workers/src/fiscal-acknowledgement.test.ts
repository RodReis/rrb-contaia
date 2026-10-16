import { describe, expect, it } from 'vitest';
import { validarXmlCompletoRecuperado } from './fiscal-acknowledgement.js';

const chave = '35240112345678000195550010000000011000000019';
const cnpj = '12345678000195';
const xml = (destinatario = cnpj, chaveXml = chave) => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chaveXml}" versao="4.00"><ide><mod>55</mod><dhEmi>2026-10-15T10:00:00-03:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ></emit><dest><CNPJ>${destinatario}</CNPJ><xNome>Empresa</xNome></dest><det nItem="1"><prod><cProd>1</cProd><xProd>Produto</xProd><qCom>1</qCom><uCom>UN</uCom><vProd>1.00</vProd></prod><imposto/></det><total><ICMSTot><vNF>1.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

describe('validação do XML completo recuperado', () => {
  it('exige chave e CNPJ de destinatário iguais à ciência original', () => {
    expect(validarXmlCompletoRecuperado(xml(), chave, cnpj)).toBe(true);
    expect(validarXmlCompletoRecuperado(xml('99999999000191'), chave, cnpj)).toBe(false);
    expect(validarXmlCompletoRecuperado(xml(cnpj, '35240112345678000195550010000000011000000010'), chave, cnpj)).toBe(false);
  });

  it('recusa XML inseguro ou layout inválido', () => {
    expect(validarXmlCompletoRecuperado('<!DOCTYPE x><nfeProc/>', chave, cnpj)).toBe(false);
    expect(validarXmlCompletoRecuperado('<resNFe/>', chave, cnpj)).toBe(false);
  });
});
