import type { FormatoDeArquivo } from '@contaia/shared';

import { ErroDePlanilha } from './erros.ts';
import { LIMITES, type Limites } from './limites.ts';
import { local, percorrerXml } from './xml.ts';
import { abrirZip, type ZipAberto } from './zip.ts';

const ASSINATURA_CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const utf16 = (s: string): Buffer => Buffer.from(s, 'utf16le');
const STREAMS_DE_CIFRA = [utf16('EncryptedPackage'), utf16('EncryptionInfo')];
const STREAMS_DO_XLS = [utf16('Workbook'), utf16('Book')];

const MIME_ODS = 'application/vnd.oasis.opendocument.spreadsheet';
const TIPO_PRINCIPAL_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

/** O que o arquivo é de verdade, decidido pelos bytes (nunca pela extensão). */
export type ConteudoReal =
  | { readonly tipo: 'XLSX' | 'ODS'; readonly zip: ZipAberto }
  | { readonly tipo: 'XLSM' | 'XLS' | 'VAZIO' | 'NAO_PLANILHA' }
  | { readonly tipo: 'CIFRADO'; readonly detalhe: 'CFB_CIFRADO' | 'ODS_CIFRADO' };

const temElemento = (dados: Buffer | undefined, nomeLocal: string): boolean => {
  let achou = false;
  if (dados !== undefined) {
    percorrerXml(dados, {
      abrir: (e) => {
        if (local(e.nome) === nomeLocal) achou = true;
      },
    });
  }
  return achou;
};

const tiposDeConteudo = (dados: Buffer): string[] => {
  const tipos: string[] = [];
  percorrerXml(dados, {
    abrir: (e) => {
      const tipo = e.atributos['ContentType'];
      if (tipo !== undefined) tipos.push(tipo);
    },
  });
  return tipos;
};

const classificarZip = (bytes: Uint8Array, limites: Limites): ConteudoReal => {
  const zip = abrirZip(bytes, limites);
  // Só partes pequenas são lidas para decidir o formato: teto próprio, bem abaixo do de uma parte.
  const teto = limites.bytesDeParteDeDeteccao;

  if (zip.tem('mimetype')) {
    if (zip.ler('mimetype', teto)?.toString('latin1').trim() !== MIME_ODS) return { tipo: 'NAO_PLANILHA' };
    if (temElemento(zip.ler('META-INF/manifest.xml', teto), 'encryption-data')) return { tipo: 'CIFRADO', detalhe: 'ODS_CIFRADO' };
    return { tipo: 'ODS', zip };
  }

  const tipos = zip.tem('[Content_Types].xml') ? tiposDeConteudo(zip.ler('[Content_Types].xml', teto) as Buffer) : null;
  if (tipos === null) return { tipo: 'NAO_PLANILHA' };
  if (tipos.some((t) => /macroEnabled/iu.test(t)) || zip.nomes.some((n) => /(^|\/)vbaProject\.bin$/iu.test(n))) return { tipo: 'XLSM' };
  return tipos.includes(TIPO_PRINCIPAL_XLSX) ? { tipo: 'XLSX', zip } : { tipo: 'NAO_PLANILHA' };
};

export const identificarConteudo = (bytes: Uint8Array, limites: Limites = LIMITES): ConteudoReal => {
  if (bytes.length === 0) return { tipo: 'VAZIO' };
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 8).equals(ASSINATURA_CFB)) {
    // Container CFB: o OOXML cifrado (senha para abrir) guarda EncryptionInfo/EncryptedPackage; o .xls, Workbook/Book.
    if (STREAMS_DE_CIFRA.some((s) => b.includes(s))) return { tipo: 'CIFRADO', detalhe: 'CFB_CIFRADO' };
    if (STREAMS_DO_XLS.some((s) => b.includes(s))) return { tipo: 'XLS' };
    return { tipo: 'NAO_PLANILHA' };
  }
  if (b.subarray(0, 4).equals(ASSINATURA_ZIP)) return classificarZip(bytes, limites);
  return { tipo: 'NAO_PLANILHA' };
};

/** Formatos que nunca são aceitos, qualquer que seja a extensão. */
const recusarPeloConteudo = (real: ConteudoReal): void => {
  if (real.tipo === 'VAZIO') throw new ErroDePlanilha('ARQUIVO_VAZIO', 'VAZIO');
  if (real.tipo === 'XLS') throw new ErroDePlanilha('FORMATO_XLS_NAO_SUPORTADO', 'XLS');
  if (real.tipo === 'XLSM') throw new ErroDePlanilha('FORMATO_XLSM_NAO_SUPORTADO', 'XLSM');
  if (real.tipo === 'CIFRADO') throw new ErroDePlanilha('ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', real.detalhe);
};

const CONTEUDO_ESPERADO: ReadonlyMap<string, { tipo: ConteudoReal['tipo']; formato: FormatoDeArquivo }> = new Map([
  ['.csv', { tipo: 'NAO_PLANILHA', formato: 'CSV' }],
  ['.xlsx', { tipo: 'XLSX', formato: 'XLSX' }],
  ['.ods', { tipo: 'ODS', formato: 'ODS' }],
]);

/**
 * Formato do arquivo enviado, decidido pelo conteúdo e conferido com a extensão. Lê só o diretório
 * central do ZIP e partes de detecção pequenas — pode rodar no processo principal.
 */
export const detectarFormato = (bytes: Uint8Array, extensao: string): { formato: FormatoDeArquivo } => {
  if (bytes.length > LIMITES.bytesDoArquivo) throw new ErroDePlanilha('ARQUIVO_ACIMA_DO_LIMITE', 'TAMANHO');
  const real = identificarConteudo(bytes);
  recusarPeloConteudo(real);

  const normalizada = extensao.trim().toLowerCase().replace(/^\.?/u, '.');
  if (normalizada === '.xls') throw new ErroDePlanilha('FORMATO_XLS_NAO_SUPORTADO', 'XLS');
  if (normalizada === '.xlsm') throw new ErroDePlanilha('FORMATO_XLSM_NAO_SUPORTADO', 'XLSM');
  const esperado = CONTEUDO_ESPERADO.get(normalizada);
  if (esperado === undefined) throw new ErroDePlanilha('EXTENSAO_DIFERENTE_DO_CONTEUDO', 'EXTENSAO_NAO_ACEITA');
  if (real.tipo !== esperado.tipo) {
    throw new ErroDePlanilha('EXTENSAO_DIFERENTE_DO_CONTEUDO', real.tipo === 'NAO_PLANILHA' ? 'NAO_E_PLANILHA' : undefined);
  }
  return { formato: esperado.formato };
};

/** Para o leitor (dentro do filho): só XLSX e ODS seguem; o resto vira o código do formato real. */
export const abrirPlanilha = (bytes: Uint8Array, limites: Limites): { formato: 'XLSX' | 'ODS'; zip: ZipAberto } => {
  if (bytes.length > limites.bytesDoArquivo) throw new ErroDePlanilha('ARQUIVO_ACIMA_DO_LIMITE', 'TAMANHO');
  const real = identificarConteudo(bytes, limites);
  recusarPeloConteudo(real);
  if (real.tipo === 'XLSX' || real.tipo === 'ODS') return { formato: real.tipo, zip: real.zip };
  throw new ErroDePlanilha('EXTENSAO_DIFERENTE_DO_CONTEUDO', 'NAO_E_PLANILHA');
};
