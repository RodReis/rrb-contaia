/**
 * Fixtures gerados em teste (nada de binário grande no repositório): XLSX/ODS mínimos montados à mão,
 * variações hostis e bombas de ZIP. Portado do gerador da avaliação de bibliotecas (lib-eval/gen.mjs).
 */
import { constants, crc32, deflateRawSync } from 'node:zlib';

import { escreverZip, montarZip, type EntradaCrua, type EntradaParaZip } from '../zip-escrita.ts';

export const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const MIME_ODS = 'application/vnd.oasis.opendocument.spreadsheet';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface OpcoesDoXlsx {
  readonly abas?: readonly { readonly nome: string; readonly xml: string }[];
  readonly textos?: readonly string[] | null;
  readonly sstXml?: string;
  readonly estilosXml?: string;
  readonly date1904?: boolean;
  readonly macro?: boolean;
  readonly protegerPasta?: boolean;
  readonly extras?: readonly EntradaParaZip[];
}

const tiposDeConteudo = (abas: number, macro: boolean): string => {
  const principal = macro
    ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  let s = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`;
  if (macro) s += '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>';
  s += `<Override PartName="/xl/workbook.xml" ContentType="${principal}"/>`;
  for (let i = 1; i <= abas; i++) {
    s += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }
  return `${s}</Types>`;
};

// xf: 0 geral; 1 dd/mm/yyyy; 2 máscara de CPF; 3 00000; 4 numFmt 14 embutido; 5 formato inválido; 6 data e hora
export const ESTILOS = `${XML}<styleSheet xmlns="${NS}"><numFmts count="5"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="000&quot;.&quot;000&quot;.&quot;000-00"/><numFmt numFmtId="166" formatCode="00000"/><numFmt numFmtId="167" formatCode="0;0;0;0;0"/><numFmt numFmtId="168" formatCode="dd/mm/yyyy hh:mm"/></numFmts><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="14"/><xf numFmtId="167"/><xf numFmtId="168"/></cellXfs></styleSheet>`;

export const sstXml = (textos: readonly string[]): string =>
  `${XML}<sst xmlns="${NS}" count="${textos.length}" uniqueCount="${textos.length}">${textos.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;

export const abaXml = (linhas: string, extra = ''): string =>
  `${XML}<worksheet xmlns="${NS}"><sheetData>${linhas}</sheetData>${extra}</worksheet>`;

export const ABA_VAZIA = abaXml('');

export const partesDoXlsx = (o: OpcoesDoXlsx = {}): EntradaParaZip[] => {
  const abas = o.abas ?? [{ nome: 'Dados', xml: abaXml('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>') }];
  const macro = o.macro ?? false;
  let rels = `${XML}<Relationships xmlns="${PR}">`;
  abas.forEach((_, i) => {
    rels += `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  });
  rels += `<Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>`;
  if (macro) rels += `<Relationship Id="rIdV" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>`;
  rels += '</Relationships>';

  const pasta = `${XML}<workbook xmlns="${NS}" xmlns:r="${R}"><workbookPr${o.date1904 === true ? ' date1904="1"' : ''}/>${o.protegerPasta === true ? '<workbookProtection lockStructure="1" workbookPassword="CC1A"/>' : ''}<sheets>${abas.map((a, i) => `<sheet name="${a.nome}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;

  const partes: EntradaParaZip[] = [
    { nome: '[Content_Types].xml', dados: tiposDeConteudo(abas.length, macro) },
    { nome: '_rels/.rels', dados: `${XML}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nome: 'xl/workbook.xml', dados: pasta },
    { nome: 'xl/_rels/workbook.xml.rels', dados: rels },
    { nome: 'xl/styles.xml', dados: o.estilosXml ?? ESTILOS },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: a.xml })),
  ];
  if (o.sstXml !== undefined) partes.push({ nome: 'xl/sharedStrings.xml', dados: o.sstXml });
  else if (o.textos !== null) partes.push({ nome: 'xl/sharedStrings.xml', dados: sstXml(o.textos ?? []) });
  if (macro) partes.push({ nome: 'xl/vbaProject.bin', dados: new Uint8Array(512) });
  return [...partes, ...(o.extras ?? [])];
};

export const xlsx = (o: OpcoesDoXlsx = {}): Uint8Array => escreverZip(partesDoXlsx(o));

// ---------- ODS ----------
const ODSNS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0" office:version="1.3"';

export const celulaOds = (texto: string, atributos = 'office:value-type="string"'): string =>
  `<table:table-cell ${atributos}><text:p>${texto}</text:p></table:table-cell>`;

export const tabelaOds = (nome: string, linhas: string, atributos = ''): string =>
  `<table:table table:name="${nome}"${atributos}><table:table-column/>${linhas}</table:table>`;

export const conteudoOds = (tabelas: string, antes = ''): string =>
  `<?xml version="1.0" encoding="UTF-8"?>${antes}<office:document-content ${ODSNS}><office:body><office:spreadsheet>${tabelas}</office:spreadsheet></office:body></office:document-content>`;

export const manifestoOds = (cifrado = false): string =>
  `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME_ODS}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"${
    cifrado
      ? ' manifest:size="1234"><manifest:encryption-data manifest:checksum-type="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#sha256-1k" manifest:checksum="AAAA"><manifest:algorithm manifest:algorithm-name="http://www.w3.org/2001/04/xmlenc#aes256-cbc" manifest:initialisation-vector="AAAA"/></manifest:encryption-data></manifest:file-entry>'
      : '/>'
  }</manifest:manifest>`;

export const ods = (conteudo: string, o: { cifrado?: boolean; mime?: string } = {}): Uint8Array =>
  escreverZip([
    { nome: 'mimetype', dados: o.mime ?? MIME_ODS, metodo: 0 },
    { nome: 'META-INF/manifest.xml', dados: manifestoOds(o.cifrado ?? false) },
    { nome: 'content.xml', dados: o.cifrado === true ? new Uint8Array(1234).fill(7) : conteudo, metodo: o.cifrado === true ? 0 : 8 },
  ]);

// ---------- bombas e ZIP forjado ----------
const MIB = 1024 * 1024;

/**
 * Entrada que expande de verdade para `mib` MiB sem materializar nada grande: o mesmo bloco deflate
 * (1 MiB de zeros, com flush total, sem referência ao anterior) repetido, mais um bloco final vazio.
 */
export const entradaBomba = (nome: string, mib: number, tamanhoDeclarado?: number): EntradaCrua => {
  const bloco = Buffer.alloc(MIB);
  const pedaco = deflateRawSync(bloco, { finishFlush: constants.Z_FULL_FLUSH });
  const pedacos: Buffer[] = [];
  let crc = 0;
  for (let i = 0; i < mib; i++) {
    pedacos.push(pedaco);
    crc = crc32(bloco, crc);
  }
  pedacos.push(deflateRawSync(Buffer.alloc(0)));
  return { nome, comprimido: Buffer.concat(pedacos), crc, tamanho: tamanhoDeclarado ?? mib * MIB, metodo: 8 };
};

export const entradaCrua = (nome: string, dados: string | Uint8Array, mudar: Partial<EntradaCrua> = {}): EntradaCrua => {
  const bytes = typeof dados === 'string' ? Buffer.from(dados, 'utf8') : Buffer.from(dados);
  return { nome, comprimido: deflateRawSync(bytes), crc: crc32(bytes), tamanho: bytes.length, metodo: 8, ...mudar };
};

/** XLSX válido com algumas entradas trocadas por versões cruas (forjadas). */
export const xlsxCru = (trocas: readonly EntradaCrua[], o: OpcoesDoXlsx = {}): Uint8Array => {
  const nomes = new Set(trocas.map((t) => t.nome));
  const base = partesDoXlsx(o)
    .filter((p) => !nomes.has(p.nome))
    .map((p) => entradaCrua(p.nome, p.dados));
  return montarZip([...base, ...trocas]);
};

/** Container CFB mínimo (assinatura + nomes de stream em UTF-16LE). Basta para o farejador. */
export const cfb = (...streams: readonly string[]): Uint8Array => {
  const cabecalho = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const corpo = Buffer.alloc(512);
  const nomes = streams.map((s) => Buffer.from(`Root Entry\0${s}\0`, 'utf16le'));
  return new Uint8Array(Buffer.concat([cabecalho, corpo, ...nomes, Buffer.alloc(512)]));
};

/** Procura a primeira ocorrência de `assinatura` seguida do nome de entrada `nome`. */
export const posicaoDoCabecalho = (zip: Uint8Array, assinatura: number, nome: string): number => {
  const b = Buffer.from(zip);
  const n = Buffer.from(nome);
  const salto = assinatura === 0x02014b50 ? 46 : 30;
  for (let i = 0; i < b.length - 4; i++) {
    if (b.readUInt32LE(i) === assinatura && b.subarray(i + salto, i + salto + n.length).equals(n)) return i;
  }
  throw new Error(`cabeçalho de ${nome} não encontrado`);
};

export const CENTRAL = 0x02014b50;
export const LOCAL = 0x04034b50;
