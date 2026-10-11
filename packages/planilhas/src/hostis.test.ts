import { describe, expect, it } from 'vitest';

import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { LIMITES } from './limites.ts';
import {
  CENTRAL,
  LOCAL,
  NS,
  abaXml,
  celulaOds,
  conteudoOds,
  entradaBomba,
  entradaCrua,
  ods,
  posicaoDoCabecalho,
  sstXml,
  tabelaOds,
  xlsx,
  xlsxCru,
} from './testes/construtores.ts';
import { esperarErro } from './testes/esperar.ts';
import { escreverZip } from './zip-escrita.ts';

const BASE = xlsx();
const SST = 'xl/sharedStrings.xml';

const LOL =
  '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>';

const mutar = (zip: Uint8Array, alterar: (b: Buffer) => void): Uint8Array => {
  const b = Buffer.from(zip);
  alterar(b);
  return new Uint8Array(b);
};

describe('ZIP hostil — rejeitado com código estável, sem alocar a expansão', () => {
  it('bomba com tamanho declarado honesto acima do teto por parte → LIMITE (sem inflar)', () => {
    const bomba = xlsxCru([entradaBomba(SST, 200)]);
    const inicio = performance.now();
    esperarErro(() => inspecionarPlanilha(bomba), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ZIP_BOMBA');
    expect(performance.now() - inicio).toBeLessThan(1_000);
  });

  it('bomba com tamanho declarado mentiroso (4 KB, expande 200 MiB) → LIMITE no inflate', () => {
    const bomba = xlsxCru([entradaBomba(SST, 200, 4096)]);
    esperarErro(() => lerAba(bomba, 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ZIP_BOMBA');
  });

  it('soma das partes acima do teto total → LIMITE', () => {
    const tres = [1, 2, 3].map((i) => entradaBomba(`xl/media/m${i}.bin`, 100));
    esperarErro(() => inspecionarPlanilha(xlsxCru(tres)), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ZIP_BOMBA');
  });

  it('mais de 2.000 entradas → LIMITE', () => {
    const extras = Array.from({ length: LIMITES.entradasDoZip }, (_, i) => ({ nome: `x/${i}.txt`, dados: '' }));
    esperarErro(() => inspecionarPlanilha(xlsx({ extras })), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ENTRADAS');
  });

  it('deflate corrompido → ARQUIVO_CORROMPIDO (rápido, sem laço)', () => {
    const corrompido = mutar(BASE, (b) => {
      const local = posicaoDoCabecalho(b, LOCAL, 'xl/worksheets/sheet1.xml');
      const inicio = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      for (let k = 0; k < 8; k++) b[inicio + k] = 0xff;
    });
    esperarErro(() => lerAba(corrompido, 1), 'ARQUIVO_CORROMPIDO');
  });

  it('ZIP truncado → ARQUIVO_CORROMPIDO', () => {
    esperarErro(() => inspecionarPlanilha(BASE.subarray(0, BASE.length - 30)), 'ARQUIVO_CORROMPIDO', 'ZIP_TRUNCADO');
  });

  it('CRC divergente → ARQUIVO_CORROMPIDO', () => {
    const errado = xlsxCru([{ ...entradaCrua(SST, sstXml(['a'])), crc: 1234 }]);
    esperarErro(() => lerAba(errado, 1), 'ARQUIVO_CORROMPIDO', 'CRC_OU_TAMANHO');
  });

  it('tamanho declarado maior que o real → ARQUIVO_CORROMPIDO', () => {
    const errado = xlsxCru([{ ...entradaCrua(SST, sstXml(['a'])), tamanho: 10_000 }]);
    esperarErro(() => lerAba(errado, 1), 'ARQUIVO_CORROMPIDO', 'CRC_OU_TAMANHO');
  });

  it('zip64 (tamanhos 0xFFFFFFFF ou EOCD com 0xFFFF entradas) → ARQUIVO_CORROMPIDO', () => {
    const zip64 = mutar(BASE, (b) => b.writeUInt32LE(0xffffffff, posicaoDoCabecalho(b, CENTRAL, SST) + 24));
    esperarErro(() => inspecionarPlanilha(zip64), 'ARQUIVO_CORROMPIDO', 'ZIP64');
    const eocd = mutar(BASE, (b) => b.writeUInt16LE(0xffff, b.length - 22 + 10));
    esperarErro(() => inspecionarPlanilha(eocd), 'ARQUIVO_CORROMPIDO', 'ZIP64');
  });

  it('entrada cifrada (bit 0) → ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', () => {
    const cifrada = xlsxCru([entradaCrua(SST, sstXml(['a']), { flags: 0x0801 })]);
    esperarErro(() => inspecionarPlanilha(cifrada), 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', 'ENTRADA_CIFRADA');
  });

  it('método de compressão diferente de 0/8 → ARQUIVO_CORROMPIDO', () => {
    const bzip = xlsxCru([entradaCrua(SST, sstXml(['a']), { metodo: 12 })]);
    esperarErro(() => inspecionarPlanilha(bzip), 'ARQUIVO_CORROMPIDO', 'METODO_DE_COMPRESSAO');
  });

  it('deslocamento fora do arquivo e nomes duplicados → ARQUIVO_CORROMPIDO', () => {
    const fora = mutar(BASE, (b) => b.writeUInt32LE(b.length + 100, posicaoDoCabecalho(b, CENTRAL, SST) + 42));
    esperarErro(() => lerAba(fora, 1), 'ARQUIVO_CORROMPIDO', 'ZIP_INVALIDO');
    const duplicado = escreverZip([
      { nome: 'mimetype', dados: 'application/vnd.oasis.opendocument.spreadsheet', metodo: 0 },
      { nome: 'content.xml', dados: conteudoOds('') },
      { nome: 'content.xml', dados: conteudoOds('') },
    ]);
    esperarErro(() => inspecionarPlanilha(duplicado), 'ARQUIVO_CORROMPIDO', 'ZIP_INVALIDO');
  });

  it('parte obrigatória ausente → ARQUIVO_CORROMPIDO', () => {
    const semConteudo = escreverZip([{ nome: 'mimetype', dados: 'application/vnd.oasis.opendocument.spreadsheet', metodo: 0 }]);
    esperarErro(() => inspecionarPlanilha(semConteudo), 'ARQUIVO_CORROMPIDO', 'PARTE_AUSENTE');
  });
});

describe('XML hostil — DOCTYPE proibido em qualquer parte', () => {
  it('billion laughs no sharedStrings (XLSX) → ARQUIVO_CORROMPIDO', () => {
    const sst = `<?xml version="1.0"?>${LOL}<sst xmlns="${NS}"><si><t>&lol3;</t></si></sst>`;
    esperarErro(() => lerAba(xlsx({ sstXml: sst }), 1), 'ARQUIVO_CORROMPIDO', 'DTD_PROIBIDO');
  });

  it('XXE (entidade SYSTEM) → ARQUIVO_CORROMPIDO, nada é lido do disco', () => {
    const sst = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]><sst xmlns="${NS}"><si><t>&xxe;</t></si></sst>`;
    esperarErro(() => lerAba(xlsx({ sstXml: sst }), 1), 'ARQUIVO_CORROMPIDO', 'DTD_PROIBIDO');
  });

  it('billion laughs no content.xml (ODS) → ARQUIVO_CORROMPIDO', () => {
    const conteudo = conteudoOds(tabelaOds('Dados', `<table:table-row>${celulaOds('&lol3;')}</table:table-row>`), LOL);
    esperarErro(() => inspecionarPlanilha(ods(conteudo)), 'ARQUIVO_CORROMPIDO', 'DTD_PROIBIDO');
  });

  it('entidade não declarada e XML malformado → ARQUIVO_CORROMPIDO', () => {
    esperarErro(() => lerAba(xlsx({ sstXml: `<sst xmlns="${NS}"><si><t>&x;</t></si></sst>` }), 1), 'ARQUIVO_CORROMPIDO', 'XML_INVALIDO');
    esperarErro(() => lerAba(xlsx({ abas: [{ nome: 'Dados', xml: '<worksheet><sheetData><row>' }] }), 1), 'ARQUIVO_CORROMPIDO', 'XML_INVALIDO');
  });
});

describe('Estrutura hostil — esparsa, com tetos', () => {
  it('dimensão A1:XFD1048576 declarada não aloca nada', () => {
    const aba = `<?xml version="1.0"?><worksheet xmlns="${NS}"><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`;
    const leitura = lerAba(xlsx({ abas: [{ nome: 'Dados', xml: aba }] }), 1);
    expect(leitura.linhas).toHaveLength(1);
  });

  it('células em A1 e XFD1048576 → duas linhas, esparsas', () => {
    const aba = abaXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>z</t></is></c></row>',
    );
    const leitura = lerAba(xlsx({ abas: [{ nome: 'Dados', xml: aba }] }), 1);
    expect(leitura.linhas.map((l) => l.numero)).toEqual([1, 1_048_576]);
    expect(leitura.linhas[1]?.celulas['XFD']?.valorExibido).toBe('z');
  });

  it('coluna além de XFD → LIMITE', () => {
    const aba = abaXml('<row r="1"><c r="XFE1" t="inlineStr"><is><t>a</t></is></c></row>');
    esperarErro(() => lerAba(xlsx({ abas: [{ nome: 'Dados', xml: aba }] }), 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'COLUNAS');
  });

  it('sharedStrings com mais de 2 M itens → LIMITE', () => {
    const sst = `<sst xmlns="${NS}">${'<si><t>a</t></si>'.repeat(LIMITES.textosCompartilhados + 1)}</sst>`;
    esperarErro(() => lerAba(xlsx({ sstXml: sst }), 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'TEXTOS_COMPARTILHADOS');
  }, 30_000);

  it('texto de célula acima de 32.767 caracteres → LIMITE', () => {
    esperarErro(() => lerAba(xlsx({ textos: ['a'.repeat(LIMITES.caracteresPorCelula + 1)] }), 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'TEXTO_DA_CELULA');
  });

  it('mais linhas com conteúdo do que o teto → ARQUIVO_ACIMA_DO_LIMITE', () => {
    const linhas = Array.from({ length: LIMITES.linhasComConteudo + 1 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
    esperarErro(() => lerAba(xlsx({ abas: [{ nome: 'Dados', xml: abaXml(linhas) }] }), 1), 'ARQUIVO_ACIMA_DO_LIMITE', 'LINHAS');
  });

  it('linhas vazias não contam no teto de linhas', () => {
    const linhas = Array.from({ length: LIMITES.linhasComConteudo + 500 }, (_, i) =>
      i % 2 === 0 ? `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>` : `<row r="${i + 1}"><c r="A${i + 1}" s="1"/></row>`,
    ).join('');
    const leitura = lerAba(xlsx({ abas: [{ nome: 'Dados', xml: abaXml(linhas) }] }), 1);
    expect(leitura.linhas.length).toBe(Math.ceil((LIMITES.linhasComConteudo + 500) / 2));
  });

  it('teto de células materializadas (limites reduzidos) → LIMITE', () => {
    const linhas = '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row>';
    esperarErro(
      () => lerAba(xlsx({ abas: [{ nome: 'Dados', xml: abaXml(linhas) }] }), 1, { ...LIMITES, celulas: 2 }),
      'LIMITE_DE_PROCESSAMENTO_EXCEDIDO',
      'CELULAS',
    );
  });

  it('formato de número com mais de 255 caracteres é ignorado (renderização General), não rejeita', () => {
    const estilos = `<styleSheet xmlns="${NS}"><numFmts><numFmt numFmtId="164" formatCode="${'0'.repeat(300)}"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
    const aba = abaXml('<row r="1"><c r="A1" s="1"><v>42</v></c></row>');
    const leitura = lerAba(xlsx({ estilosXml: estilos, abas: [{ nome: 'Dados', xml: aba }] }), 1);
    expect(leitura.linhas[0]?.celulas['A']?.valorExibido).toBe('42');
  });

  it('mescla gigante A1:XFD1048576 não é expandida célula a célula', () => {
    const aba = abaXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="5"><c r="C5"><v>1</v></c></row>',
      '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>',
    );
    const inicio = performance.now();
    const leitura = lerAba(xlsx({ abas: [{ nome: 'Dados', xml: aba }] }), 1);
    expect(performance.now() - inicio).toBeLessThan(1_000);
    expect(leitura.mesclas).toEqual([{ de: 'A1', ate: 'XFD1048576' }]);
    expect(leitura.linhas.every((l) => Object.values(l.celulas).every((c) => c.mesclada))).toBe(true);
  });
});

describe('ODS hostil — repetição', () => {
  it('number-rows-repeated gigante com células preenchidas → LIMITE (saída/células) sem materializar 10⁹', () => {
    const linhas = `<table:table-row table:number-rows-repeated="1000000"><table:table-cell office:value-type="string" table:number-columns-repeated="1000"><text:p>x</text:p></table:table-cell></table:table-row>`;
    const inicio = performance.now();
    esperarErro(() => lerAba(ods(conteudoOds(tabelaOds('Dados', linhas))), 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO');
    expect(performance.now() - inicio).toBeLessThan(5_000);
  });

  it('number-rows-repeated grande com uma célula → ARQUIVO_ACIMA_DO_LIMITE (linhas)', () => {
    const linhas = `<table:table-row table:number-rows-repeated="1000000">${celulaOds('x')}</table:table-row>`;
    esperarErro(() => lerAba(ods(conteudoOds(tabelaOds('Dados', linhas))), 1), 'ARQUIVO_ACIMA_DO_LIMITE', 'LINHAS');
  });

  it('colunas repetidas preenchidas além de XFD → LIMITE', () => {
    const linhas = `<table:table-row><table:table-cell office:value-type="string" table:number-columns-repeated="20000"><text:p>x</text:p></table:table-cell></table:table-row>`;
    esperarErro(() => lerAba(ods(conteudoOds(tabelaOds('Dados', linhas))), 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO');
  });

  it('text:s com c acima de 1.000 → LIMITE', () => {
    const linhas = `<table:table-row><table:table-cell office:value-type="string"><text:p>a<text:s text:c="5000000"/>b</text:p></table:table-cell></table:table-row>`;
    esperarErro(() => lerAba(ods(conteudoOds(tabelaOds('Dados', linhas))), 1), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'TEXTO_DA_CELULA');
  });
});
