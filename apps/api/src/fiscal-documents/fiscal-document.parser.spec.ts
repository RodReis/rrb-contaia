import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ehDocumentoFiscalElegivel } from '@contaia/shared/fiscal-document-parser';
import { parsearDocumentoFiscal } from './fiscal-document.parser';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../nfe/fixtures/${name}`));

describe('parser fiscal SPEC-018', () => {
  it('normaliza NF-e modelo 55 e calcula hash sobre os bytes originais', async () => {
    const bytes = fixture('nfe-rtc-valida.xml');
    const result = parsearDocumentoFiscal(bytes, 'NFE_55');
    expect(result.especie).toBe('NFE_55');
    expect(result.modelo).toBe('55');
    expect(result.chaveAcesso).toBe('00000000000000000000550010000000010000000010');
    expect(result.itens).toHaveLength(3);
    expect(result.partes[0]).toMatchObject({ papel: 'EMITENTE', identificador: '00000000000000', nome: 'EMITENTE DE TESTE NAO OFICIAL' });
    expect(result).toMatchObject({ baseIbsCbs: '204.20', totalIbs: '0.20', totalCbs: '1.89' });
    expect(result.protocolo).toBeNull();
    expect(result.referencias).toEqual([]);
    expect(result.hashSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.ibsCbsPendente).toBe(false);
  });

  it('normaliza campos de endereço declarados sem inventar localização ausente', () => {
    const source = fixture('nfe-rtc-valida.xml').toString('utf8').replace(
      '</emit>', '<enderEmit><xLgr>Rua Teste</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>São Paulo</xMun><UF>SP</UF><CEP>01000000</CEP></enderEmit></emit>',
    );
    const result = parsearDocumentoFiscal(Buffer.from(source), 'NFE_55');
    expect(result.partes[0]).toMatchObject({ logradouro: 'Rua Teste', numero: '10', bairro: 'Centro', codigoMunicipio: '3550308', municipio: 'São Paulo', uf: 'SP', cep: '01000000' });
    expect(result.partes[1]).toBeUndefined();
  });

  it('normaliza CT-e 57 sem duplicar o valor total do frete por medida de carga', () => {
    const result = parsearDocumentoFiscal(fixture('cte-rtc-sintetico.xml'),'CTE');
    expect(result.especie).toBe('CTE');
    expect(result.modelo).toBe('57');
    expect(result.chaveAcesso).toBe('00000000000000000000570010000000010000000010');
    expect(result.total).toBe('128.95');
    expect(result).toMatchObject({ baseIbsCbs: '100.00', totalIbs: '0.10', totalCbs: '0.90' });
    expect(result.protocolo).toBe('135260000000001');
    expect(result.referencias).toContainEqual({ tipo: 'NFE_VINCULADA_CTE', chave: '00000000000000000000550010000000010000000010' });
    expect(result.itens).toHaveLength(2);
    expect(result.itens[0]).toMatchObject({ tipo: 'COMPONENTE', descricao: 'FRETE PESO', valor: '128.95' });
    expect(result.itens[1]).toMatchObject({ tipo: 'MEDIDA_CARGA', quantidade: '25.5000', unidade: '01', valor: null });
    expect(result.ibsCbsPendente).toBe(false);
  });

  it('rejeita DTD e XXE antes de construir o DOM', () => {
    const bytes = Buffer.from('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>');
    expect(() => parsearDocumentoFiscal(bytes, 'NFE_55')).toThrow('FISCAL_XML_UNSAFE');
  });

  it('separa XML malformado, layout desconhecido e espécie divergente', () => {
    expect(() => parsearDocumentoFiscal(Buffer.from('<a>'), 'NFE_55')).toThrow('FISCAL_XML_INVALID');
    expect(() => parsearDocumentoFiscal(Buffer.from('<x/>'), 'NFE_55')).toThrow('FISCAL_LAYOUT_UNSUPPORTED');
    expect(() => parsearDocumentoFiscal(Buffer.from('<cteProc/>'), 'NFE_55')).toThrow('FISCAL_DOCUMENT_TYPE_MISMATCH');
  });

  it('rejeita envelope fiscal com namespace não oficial', () => {
    const source = fixture('nfe-rtc-valida.xml').toString('utf8').replace(
      'http://www.portalfiscal.inf.br/nfe', 'urn:namespace-nao-oficial',
    );
    expect(() => parsearDocumentoFiscal(Buffer.from(source), 'NFE_55')).toThrow('FISCAL_LAYOUT_UNSUPPORTED');
  });

  it('deixa layout fora da versão suportada como não suportado e rejeita estrutura incompleta', () => {
    const valid = fixture('nfe-rtc-valida.xml').toString('utf8');
    expect(() => parsearDocumentoFiscal(Buffer.from(valid.replace(/versao="4\.00"/gu, 'versao="3.10"')), 'NFE_55')).toThrow('FISCAL_LAYOUT_UNSUPPORTED');
    expect(() => parsearDocumentoFiscal(Buffer.from(valid.replace('<ide>', '<ide-invalido>').replace('</ide>', '</ide-invalido>')), 'NFE_55')).toThrow('FISCAL_LAYOUT_UNSUPPORTED');
  });

  it('não lê campos fiscais injetados por namespace estrangeiro', () => {
    const source = fixture('nfe-rtc-valida.xml').toString('utf8').replace(
      '<cProd>1</cProd>', '<evil:cProd xmlns:evil="urn:namespace-nao-oficial">SPOOF</evil:cProd>',
    );
    const result = parsearDocumentoFiscal(Buffer.from(source), 'NFE_55');
    expect(result.itens[0]?.codigo).toBeNull();
  });

  it('mantém resumos e eventos fora da fila F18', () => {
    expect(ehDocumentoFiscalElegivel(Buffer.from('<resNFe/>'),'NFE_55')).toBe(false);
    expect(ehDocumentoFiscalElegivel(Buffer.from('<procEventoNFe/>'),'NFE_55')).toBe(false);
    expect(ehDocumentoFiscalElegivel(Buffer.from('<resCTe/>'),'CTE')).toBe(false);
    expect(ehDocumentoFiscalElegivel(Buffer.from('<nfeProc/>'),'NFE_55')).toBe(true);
    expect(ehDocumentoFiscalElegivel(Buffer.from('<cteProc/>'),'CTE')).toBe(true);
  });

  it('marca IBS/CBS incompleto só a partir da data de emissão de 03/08/2026', () => {
    const source = fixture('nfe-rtc-valida.xml').toString('utf8').replace(/<vIBS>[^<]*<\/vIBS>|<vCBS>[^<]*<\/vCBS>/gu,'');
    const anterior = parsearDocumentoFiscal(Buffer.from(source),'NFE_55');
    const vigente = parsearDocumentoFiscal(Buffer.from(source.replace('2026-06-15','2026-08-03')),'NFE_55');
    expect(anterior.ibsCbsPendente).toBe(false);
    expect(vigente.ibsCbsPendente).toBe(true);
  });

  it('rejeita o XML acima do limite antes de decodificá-lo', () => {
    expect(() => parsearDocumentoFiscal(Buffer.alloc(10 * 1024 * 1024 + 1),'NFE_55')).toThrow('FISCAL_XML_TOO_LARGE');
  });
});
