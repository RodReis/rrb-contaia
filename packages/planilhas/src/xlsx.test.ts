import type { CelulaDaTabela, LeituraDaAba } from '@contaia/domain';
import { LeituraDaAbaSchema } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { ABA_VAZIA, NS, abaXml, xlsx } from './testes/construtores.ts';
import { esperarErro } from './testes/esperar.ts';
import { escreverZip } from './zip-escrita.ts';

const TEXTOS = ['codigo', 'cpf', 'data', 'formula', 'mesclado', '00123', '529.982.247-25', 'M', '00456'];
const RICO = `<si><r><t>Jo</t></r><r><rPr><b/></rPr><t>ão</t></r><rPh sb="0" eb="1"><t>ジョ</t></rPh><phoneticPr fontId="0"/></si>`;
const SST = `<?xml version="1.0"?><sst xmlns="${NS}">${TEXTOS.map((t) => `<si><t>${t}</t></si>`).join('')}${RICO}<si><t xml:space="preserve">linha1_x000D__x000A_linha2 </t></si></sst>`;

const DADOS = abaXml(
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2"><f>1+1</f><v>2</v></c><c r="E2" t="s"><v>7</v></c><c r="F2" s="1"/></row>' +
    '<row r="3" hidden="1"><c r="A3" t="s"><v>8</v></c><c r="B3" s="2"><v>52998224725</v></c><c r="C3" s="4"><v>45000</v></c><c r="D3" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="E3" t="inlineStr"><is><t>inline</t></is></c></row>' +
    '<row r="4"><c r="A4" s="3"><v>123</v></c><c r="B4" t="b"><v>1</v></c><c r="C4" s="1"><v>45000.75</v></c><c r="D4" s="1"><v>1</v></c><c r="E4" t="b"><v>0</v></c></row>' +
    '<row r="5"><c r="A5" s="5"><v>42</v></c><c r="B5" t="e"><v>#DIV/0!</v></c><c r="C5" s="6"><v>45000.5</v></c><c r="D5"><f t="shared" ref="D5:D6" si="0">A4+1</f><v>124</v></c><c r="E5" t="s"><v>9</v></c><c r="F5"><v>52998224725</v></c></row>' +
    '<row r="6"><c r="A6" t="s"><v>10</v></c><c r="D6"><f t="shared" si="0"/><v>8</v></c><c r="E6"><f>NA()</f></c></row>' +
    '<row r="8"><c r="B8" s="1"><v>60</v></c><c r="C8" s="1"><v>0</v></c><c r="D8" t="inlineStr"><is><r><t>ri</t></r><r><t>co</t></r></is></c><c r="E8" t="d"><v>2023-03-15T00:00:00</v></c></row>',
  '<sheetProtection sheet="1" password="CC1A"/><mergeCells count="1"><mergeCell ref="E2:F2"/></mergeCells>',
);

const pasta = (o: { date1904?: boolean } = {}): Uint8Array =>
  xlsx({ sstXml: SST, date1904: o.date1904 ?? false, protegerPasta: true, abas: [{ nome: 'Dados', xml: DADOS }, { nome: 'Vazia', xml: ABA_VAZIA }] });

const celula = (leitura: LeituraDaAba, ref: string): CelulaDaTabela | undefined => {
  const [, letra = '', numero = ''] = /^([A-Z]+)(\d+)$/u.exec(ref) ?? [];
  return leitura.linhas.find((l) => l.numero === Number(numero))?.celulas[letra];
};

const texto = (valorExibido: string, extra: Partial<CelulaDaTabela> = {}): CelulaDaTabela => ({
  valorExibido,
  tipoNativo: 'texto',
  formula: false,
  mesclada: false,
  ...extra,
});

describe('XLSX — inspeção', () => {
  it('lista as abas em ordem, com posição base 1 e utilizável só se houver conteúdo', () => {
    expect(inspecionarPlanilha(pasta())).toEqual({
      formato: 'XLSX',
      abas: [
        { nome: 'Dados', posicao: 1, utilizavel: true },
        { nome: 'Vazia', posicao: 2, utilizavel: false },
      ],
    });
  });

  it('aba só com espaços ou células vazias estilizadas não é utilizável', () => {
    const branca = abaXml('<row r="1"><c r="A1" t="inlineStr"><is><t>   </t></is></c><c r="B1" s="1"/></row>');
    expect(inspecionarPlanilha(xlsx({ abas: [{ nome: 'Branca', xml: branca }] })).abas[0]?.utilizavel).toBe(false);
  });

  it('nome de aba vazio ou longo vira identificação válida (1..255)', () => {
    const abas = inspecionarPlanilha(xlsx({ abas: [{ nome: '', xml: ABA_VAZIA }, { nome: 'n'.repeat(400), xml: ABA_VAZIA }] })).abas;
    expect(abas[0]?.nome).toBe('Aba 1');
    expect(abas[1]?.nome.length).toBe(255);
  });

  it('pasta sem nenhuma aba → lista vazia', () => {
    expect(inspecionarPlanilha(xlsx({ abas: [] })).abas).toEqual([]);
  });
});

describe('XLSX — células (valor exibido, tipo, fórmula, mescla, oculta)', () => {
  const leitura = lerAba(pasta(), 1);

  it('a saída passa no schema estrito do contrato (o mesmo que valida o IPC)', () => {
    expect(() => LeituraDaAbaSchema.parse(leitura)).not.toThrow();
    expect(leitura.formato).toBe('XLSX');
    expect(leitura.aba).toEqual({ nome: 'Dados', posicao: 1, utilizavel: true });
  });

  it('zeros à esquerda como texto e CPF com máscara em texto ficam como estão', () => {
    expect(celula(leitura, 'A2')).toEqual(texto('00123'));
    expect(celula(leitura, 'B2')).toEqual(texto('529.982.247-25'));
  });

  it('CPF numérico com máscara 000"."000"."000-00 exibe a máscara; 123 com 00000 exibe 00123; General exibe o número', () => {
    expect(celula(leitura, 'B3')).toEqual({ valorExibido: '529.982.247-25', tipoNativo: 'numero', formula: false, mesclada: false });
    expect(celula(leitura, 'A4')).toEqual({ valorExibido: '00123', tipoNativo: 'numero', formula: false, mesclada: false });
    expect(celula(leitura, 'F5')?.valorExibido).toBe('52998224725');
  });

  it('data nativa (sistema 1900): exibição dd/mm/aaaa e data civil, inclusive numFmt 14 e data com hora', () => {
    expect(celula(leitura, 'C2')).toEqual({ valorExibido: '15/03/2023', tipoNativo: 'data', formula: false, mesclada: false, dataCivil: '2023-03-15' });
    expect(celula(leitura, 'C3')).toMatchObject({ valorExibido: '15/03/2023', tipoNativo: 'data', dataCivil: '2023-03-15' });
    expect(celula(leitura, 'C4')).toMatchObject({ valorExibido: '15/03/2023', dataCivil: '2023-03-15' });
    expect(celula(leitura, 'C5')).toMatchObject({ valorExibido: '15/03/2023 12:00', tipoNativo: 'data', dataCivil: '2023-03-15' });
    expect(celula(leitura, 'D4')).toMatchObject({ valorExibido: '01/01/1900', dataCivil: '1900-01-01' });
  });

  it('célula t="d" (data ISO 8601) vira data civil e exibição dd/mm/aaaa', () => {
    expect(celula(leitura, 'E8')).toEqual({ valorExibido: '15/03/2023', tipoNativo: 'data', formula: false, mesclada: false, dataCivil: '2023-03-15' });
  });

  it('bug de 1900 do Lotus: serial 60 (29/02/1900) e serial 0 não têm data civil', () => {
    expect(celula(leitura, 'B8')).toEqual({ valorExibido: '29/02/1900', tipoNativo: 'data', formula: false, mesclada: false });
    expect(celula(leitura, 'C8')?.dataCivil).toBeUndefined();
  });

  it('fórmula é detectada (inclusive compartilhada e sem resultado salvo), nunca executada; o resultado salvo é o exibido', () => {
    expect(celula(leitura, 'D2')).toEqual({ valorExibido: '2', tipoNativo: 'numero', formula: true, mesclada: false });
    expect(celula(leitura, 'D3')).toEqual(texto('xy', { formula: true }));
    expect(celula(leitura, 'D5')).toMatchObject({ valorExibido: '124', formula: true });
    expect(celula(leitura, 'D6')).toMatchObject({ valorExibido: '8', formula: true });
    expect(celula(leitura, 'E6')).toEqual({ valorExibido: '', tipoNativo: 'vazio', formula: true, mesclada: false });
  });

  it('mescla: intervalo devolvido e células dentro marcadas; a célula coberta vazia não é materializada', () => {
    expect(leitura.mesclas).toEqual([{ de: 'E2', ate: 'F2' }]);
    expect(celula(leitura, 'E2')).toEqual(texto('M', { mesclada: true }));
    expect(celula(leitura, 'F2')).toBeUndefined();
    expect(celula(leitura, 'E3')?.mesclada).toBe(false);
  });

  it('linha oculta é lida e marcada; as demais não', () => {
    const porNumero = new Map(leitura.linhas.map((l) => [l.numero, l.oculta]));
    expect(porNumero.get(3)).toBe(true);
    expect(porNumero.get(2)).toBe(false);
    expect(leitura.totalDeLinhasOcultas).toBe(1);
  });

  it('inlineStr, rich text com fonética, escapes _xHHHH_, booleanos e erros', () => {
    expect(celula(leitura, 'E3')).toEqual(texto('inline'));
    expect(celula(leitura, 'E5')).toEqual(texto('João'));
    expect(celula(leitura, 'A6')).toEqual(texto('linha1\r\nlinha2 '));
    expect(celula(leitura, 'D8')).toEqual(texto('rico'));
    expect(celula(leitura, 'B4')).toEqual({ valorExibido: 'VERDADEIRO', tipoNativo: 'booleano', formula: false, mesclada: false });
    expect(celula(leitura, 'E4')?.valorExibido).toBe('FALSO');
    expect(celula(leitura, 'B5')).toEqual({ valorExibido: '#DIV/0!', tipoNativo: 'erro', formula: false, mesclada: false });
  });

  it('formato de número inválido/forjado cai para a renderização General (não rejeita)', () => {
    expect(celula(leitura, 'A5')).toEqual({ valorExibido: '42', tipoNativo: 'numero', formula: false, mesclada: false });
  });

  it('linhas sem conteúdo não são materializadas; as demais vêm em ordem', () => {
    expect(leitura.linhas.map((l) => l.numero)).toEqual([1, 2, 3, 4, 5, 6, 8]);
  });

  it('proteção de aba/pasta sem criptografia não rejeita (abre sem senha)', () => {
    expect(leitura.linhas.length).toBeGreaterThan(0);
  });

  it('segunda aba vazia é lida sem erro e sem linhas', () => {
    const vazia = lerAba(pasta(), 2);
    expect(vazia.aba).toEqual({ nome: 'Vazia', posicao: 2, utilizavel: false });
    expect(vazia.linhas).toEqual([]);
  });

  it('aba inexistente → ABA_INEXISTENTE', () => {
    esperarErro(() => lerAba(pasta(), 3), 'ABA_INEXISTENTE');
    esperarErro(() => lerAba(pasta(), 0), 'ABA_INEXISTENTE');
    esperarErro(() => lerAba(pasta(), 1.5), 'ABA_INEXISTENTE');
  });
});

describe('XLSX — sistema de datas 1904', () => {
  const leitura = lerAba(pasta({ date1904: true }), 1);

  it('o mesmo serial vira outra data civil, sem fuso', () => {
    expect(celula(leitura, 'C2')).toMatchObject({ valorExibido: '16/03/2027', dataCivil: '2027-03-16' });
    expect(celula(leitura, 'D4')).toMatchObject({ valorExibido: '02/01/1904', dataCivil: '1904-01-02' });
    expect(celula(leitura, 'C8')).toMatchObject({ valorExibido: '01/01/1904', dataCivil: '1904-01-01' });
  });
});

describe('XLSX — partes localizadas pelas relações, prefixos de namespace', () => {
  it('lê pasta gerada com prefixo x: (Open XML SDK) e caminhos absolutos nas relações', () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const aba = `<x:worksheet xmlns:x="${NS}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>ok</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
    const pastaXml = `<x:workbook xmlns:x="${NS}" xmlns:r="${R}"><x:sheets><x:sheet name="SDK" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>`;
    const comPastaPropria = xlsxComPasta(pastaXml, rels, aba);
    expect(lerAba(comPastaPropria, 1).linhas[0]?.celulas['A']?.valorExibido).toBe('ok');
    expect(inspecionarPlanilha(comPastaPropria).abas).toEqual([{ nome: 'SDK', posicao: 1, utilizavel: true }]);
  });
});

const xlsxComPasta = (pastaXml: string, rels: string, aba: string): Uint8Array =>
  escreverZip([
    {
      nome: '[Content_Types].xml',
      dados:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    },
    {
      nome: '_rels/.rels',
      dados:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>',
    },
    { nome: 'xl/workbook.xml', dados: pastaXml },
    { nome: 'xl/_rels/workbook.xml.rels', dados: rels },
    { nome: 'xl/worksheets/sheet1.xml', dados: aba },
  ]);
