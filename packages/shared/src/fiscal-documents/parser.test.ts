import { describe, expect, it } from 'vitest';
import { parsearDocumentoFiscal } from './parser.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe versao="4.00" Id="NFe35261000000000000000550010000000011000000010">
<ide><cUF>35</cUF><mod>55</mod><dhEmi>2026-06-15T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00000000000000</CNPJ><xNome>Emitente</xNome><enderEmit><UF>SP</UF></enderEmit></emit>
<dest><CNPJ>11111111111111</CNPJ><xNome>Destinatário</xNome><enderDest><UF>GO</UF></enderDest></dest>
<det nItem="1"><prod><cProd>1</cProd><xProd>Peça</xProd><NCM>87089990</NCM><CEST>0100100</CEST><CFOP>6102</CFOP><vProd>100.00</vProd><vFrete>2.00</vFrete><vSeg>0.50</vSeg><vDesc>1.25</vDesc><vOutro>0.75</vOutro></prod><imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>100.00</vBC><vICMS>17.00</vICMS><vBCST>120.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>4.60</vICMSST></ICMS10></ICMS></imposto></det>
<total><ICMSTot><vBC>100.00</vBC><vICMS>17.00</vICMS><vBCST>120.00</vBCST><vST>4.60</vST><vNF>100.00</vNF></ICMSTot></total>
</infNFe></NFe><protNFe><infProt><nProt>135260000000001</nProt><dhRecbto>2026-06-15T10:01:00-03:00</dhRecbto></infProt></protNFe></nfeProc>`;

describe('parse de evidência F27 para NF-e 55', () => {
  it('preserva CEST e valores ICMS-ST declarados por item e documento', () => {
    const parsed = parsearDocumentoFiscal(new TextEncoder().encode(xml), 'NFE_55');
    expect(parsed.itens[0]).toMatchObject({ ncm: '87089990', cest: '0100100', cfop: '6102', cstCsosn: '10' });
    expect(parsed.itens[0]).toMatchObject({ valor: '100.00', freight: '2.00', insurance: '0.50', discount: '1.25', otherExpenses: '0.75' });
    expect(parsed.tributos).toEqual(expect.arrayContaining([
      expect.objectContaining({ escopo: 'ITEM', numeroItem: 1, codigo: 'ICMS_ST', baseCalculo: '120.00', aliquota: '18.00', valor: '4.60' }),
      expect.objectContaining({ escopo: 'DOCUMENTO', codigo: 'ICMS_ST', valor: '4.60' }),
    ]));
  });
});
