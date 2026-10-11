import { colunaParaLetra } from '@contaia/domain';

import { escreverZip } from './zip-escrita.ts';

/**
 * Modelos oficiais XLSX/ODS (SPEC-015 §3.1): uma aba "Modelo" com a linha de cabeçalho (negrito) e uma
 * linha de exemplo, ambas como texto. As colunas usam formato de texto (`@`), para o que o usuário
 * digitar depois — CPF, matrícula com zeros à esquerda — continuar texto. O pacote não conhece os
 * domínios: cabeçalhos e exemplo vêm do chamador.
 */
const NOME_DA_ABA = 'Modelo';
const LARGURA_MINIMA = 10;
const LARGURA_MAXIMA = 60;
// Caracteres permitidos em XML 1.0 (sem controles além de tab, LF e CR).
const INVALIDO_EM_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;

const escapar = (texto: string): string =>
  texto.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');

const validar = (cabecalhos: readonly string[], exemplo: readonly string[]): void => {
  if (cabecalhos.length === 0) throw new RangeError('O modelo precisa de ao menos um cabeçalho.');
  if (exemplo.length > cabecalhos.length) throw new RangeError('A linha de exemplo tem mais colunas que o cabeçalho.');
  if ([...cabecalhos, ...exemplo].some((t) => INVALIDO_EM_XML.test(t))) throw new RangeError('Texto com caractere inválido em XML.');
};

const larguras = (cabecalhos: readonly string[], exemplo: readonly string[]): number[] =>
  cabecalhos.map((c, i) => Math.min(LARGURA_MAXIMA, Math.max(LARGURA_MINIMA, c.length + 2, (exemplo[i] ?? '').length + 2)));

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';

const ESTILOS_XLSX = `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const linhaXlsx = (numero: number, textos: readonly string[], estilo: number): string =>
  `<row r="${numero}">${textos
    .map((t, i) => `<c r="${colunaParaLetra(i + 1)}${numero}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(t)}</t></is></c>`)
    .join('')}</row>`;

const modeloXlsx = (cabecalhos: readonly string[], exemplo: readonly string[]): Uint8Array => {
  const colunas = larguras(cabecalhos, exemplo)
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" style="1" customWidth="1"/>`)
    .join('');
  const aba = `${XML}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${colunas}</cols><sheetData>${linhaXlsx(1, cabecalhos, 2)}${linhaXlsx(2, exemplo, 1)}</sheetData></worksheet>`;
  return escreverZip([
    {
      nome: '[Content_Types].xml',
      dados: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    { nome: '_rels/.rels', dados: `${XML}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      nome: 'xl/workbook.xml',
      dados: `${XML}<workbook xmlns="${NS}" xmlns:r="${R}"><bookViews><workbookView/></bookViews><sheets><sheet name="${NOME_DA_ABA}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dados: `${XML}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    },
    { nome: 'xl/worksheets/sheet1.xml', dados: aba },
    { nome: 'xl/styles.xml', dados: ESTILOS_XLSX },
  ]);
};

const ODS_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"';
const MIME_ODS = 'application/vnd.oasis.opendocument.spreadsheet';

const linhaOds = (textos: readonly string[], estilo: string): string =>
  `<table:table-row>${textos
    .map((t) => `<table:table-cell table:style-name="${estilo}" office:value-type="string"><text:p>${escapar(t)}</text:p></table:table-cell>`)
    .join('')}</table:table-row>`;

const modeloOds = (cabecalhos: readonly string[], exemplo: readonly string[]): Uint8Array => {
  const ws = larguras(cabecalhos, exemplo);
  const estilosDeColuna = ws
    .map((w, i) => `<style:style style:name="co${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${(w * 0.19).toFixed(2)}cm"/></style:style>`)
    .join('');
  const colunas = ws.map((_, i) => `<table:table-column table:style-name="co${i + 1}" table:default-cell-style-name="texto"/>`).join('');
  const conteudo = `${XML}<office:document-content ${ODS_NS}><office:automatic-styles><number:text-style style:name="N100"><number:text-content/></number:text-style>${estilosDeColuna}<style:style style:name="texto" style:family="table-cell" style:data-style-name="N100"/><style:style style:name="cabecalho" style:family="table-cell" style:data-style-name="N100"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:spreadsheet><table:table table:name="${NOME_DA_ABA}">${colunas}${linhaOds(cabecalhos, 'cabecalho')}${linhaOds(exemplo, 'texto')}</table:table></office:spreadsheet></office:body></office:document-content>`;
  const manifesto = `${XML}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME_ODS}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return escreverZip([
    { nome: 'mimetype', dados: MIME_ODS, metodo: 0 },
    { nome: 'content.xml', dados: conteudo },
    { nome: 'META-INF/manifest.xml', dados: manifesto },
  ]);
};

export const gerarModelo = (formato: 'XLSX' | 'ODS', cabecalhos: readonly string[], exemplo: readonly string[]): Uint8Array => {
  validar(cabecalhos, exemplo);
  return formato === 'XLSX' ? modeloXlsx(cabecalhos, exemplo) : modeloOds(cabecalhos, exemplo);
};
