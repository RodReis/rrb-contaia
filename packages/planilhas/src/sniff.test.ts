import { describe, expect, it } from 'vitest';

import { detectarFormato } from './sniff.ts';
import { cfb, ods, conteudoOds, tabelaOds, celulaOds, xlsx } from './testes/construtores.ts';
import { esperarErro } from './testes/esperar.ts';
import { escreverZip } from './zip-escrita.ts';

const XLSX = xlsx();
const ODS = ods(conteudoOds(tabelaOds('Dados', `<table:table-row>${celulaOds('a')}</table:table-row>`)));
const CSV = new TextEncoder().encode('codigo;cpf\n00123;529.982.247-25\n');

describe('detectarFormato — formato pelo conteúdo, nunca pela extensão', () => {
  it('aceita XLSX, ODS e CSV quando a extensão confere (com ou sem ponto, qualquer caixa)', () => {
    expect(detectarFormato(XLSX, '.xlsx')).toEqual({ formato: 'XLSX' });
    expect(detectarFormato(XLSX, 'XLSX')).toEqual({ formato: 'XLSX' });
    expect(detectarFormato(ODS, '.ods')).toEqual({ formato: 'ODS' });
    expect(detectarFormato(CSV, '.csv')).toEqual({ formato: 'CSV' });
  });

  it('arquivo vazio → ARQUIVO_VAZIO, qualquer extensão', () => {
    esperarErro(() => detectarFormato(new Uint8Array(0), '.xlsx'), 'ARQUIVO_VAZIO');
    esperarErro(() => detectarFormato(new Uint8Array(0), '.csv'), 'ARQUIVO_VAZIO');
  });

  it('CSV, ODS e bytes aleatórios renomeados → EXTENSAO_DIFERENTE_DO_CONTEUDO', () => {
    esperarErro(() => detectarFormato(CSV, '.xlsx'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
    esperarErro(() => detectarFormato(ODS, '.xlsx'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
    esperarErro(() => detectarFormato(XLSX, '.ods'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
    esperarErro(() => detectarFormato(XLSX, '.csv'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
    esperarErro(() => detectarFormato(ODS, '.csv'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
    const aleatorio = new Uint8Array(4096).map((_, i) => (i * 7919 + 13) % 251);
    esperarErro(() => detectarFormato(aleatorio, '.xlsx'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
  });

  it('ZIP que não é planilha (sem marcadores, outro OOXML, outro ODF) → EXTENSAO_DIFERENTE_DO_CONTEUDO', () => {
    const zipQualquer = escreverZip([{ nome: 'a.txt', dados: 'oi' }]);
    esperarErro(() => detectarFormato(zipQualquer, '.xlsx'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO', 'NAO_E_PLANILHA');
    const docx = escreverZip([
      {
        nome: '[Content_Types].xml',
        dados:
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
    ]);
    esperarErro(() => detectarFormato(docx, '.xlsx'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO', 'NAO_E_PLANILHA');
    const odt = ods('', { mime: 'application/vnd.oasis.opendocument.text' });
    esperarErro(() => detectarFormato(odt, '.ods'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO', 'NAO_E_PLANILHA');
  });

  it('.xls (CFB com Workbook) → FORMATO_XLS_NAO_SUPORTADO, inclusive renomeado e pela extensão', () => {
    const xls = cfb('Workbook');
    esperarErro(() => detectarFormato(xls, '.xls'), 'FORMATO_XLS_NAO_SUPORTADO');
    esperarErro(() => detectarFormato(xls, '.xlsx'), 'FORMATO_XLS_NAO_SUPORTADO');
    esperarErro(() => detectarFormato(cfb('Book'), '.xlsx'), 'FORMATO_XLS_NAO_SUPORTADO');
    esperarErro(() => detectarFormato(CSV, '.xls'), 'FORMATO_XLS_NAO_SUPORTADO');
  });

  it('.xlsm (content-type macroEnabled ou vbaProject.bin) → FORMATO_XLSM_NAO_SUPORTADO, inclusive renomeado', () => {
    const xlsm = xlsx({ macro: true });
    esperarErro(() => detectarFormato(xlsm, '.xlsm'), 'FORMATO_XLSM_NAO_SUPORTADO');
    esperarErro(() => detectarFormato(xlsm, '.xlsx'), 'FORMATO_XLSM_NAO_SUPORTADO');
    const soVba = xlsx({ extras: [{ nome: 'xl/vbaProject.bin', dados: new Uint8Array(16) }] });
    esperarErro(() => detectarFormato(soVba, '.xlsx'), 'FORMATO_XLSM_NAO_SUPORTADO');
    esperarErro(() => detectarFormato(XLSX, '.xlsm'), 'FORMATO_XLSM_NAO_SUPORTADO');
  });

  it('OOXML cifrado (CFB com EncryptedPackage/EncryptionInfo) → ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', () => {
    esperarErro(() => detectarFormato(cfb('EncryptionInfo', 'EncryptedPackage'), '.xlsx'), 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', 'CFB_CIFRADO');
    esperarErro(() => detectarFormato(cfb('EncryptedPackage'), '.ods'), 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO');
  });

  it('ODS cifrado (manifest com encryption-data) → ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', () => {
    esperarErro(() => detectarFormato(ods('', { cifrado: true }), '.ods'), 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', 'ODS_CIFRADO');
  });

  it('CFB que não é planilha (ex.: .doc) → EXTENSAO_DIFERENTE_DO_CONTEUDO', () => {
    esperarErro(() => detectarFormato(cfb('WordDocument'), '.xlsx'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO');
  });

  it('extensão fora de .csv/.xlsx/.ods/.xls/.xlsm → EXTENSAO_DIFERENTE_DO_CONTEUDO', () => {
    esperarErro(() => detectarFormato(XLSX, '.pdf'), 'EXTENSAO_DIFERENTE_DO_CONTEUDO', 'EXTENSAO_NAO_ACEITA');
  });

  it('ZIP truncado → ARQUIVO_CORROMPIDO', () => {
    esperarErro(() => detectarFormato(XLSX.subarray(0, Math.floor(XLSX.length * 0.6)), '.xlsx'), 'ARQUIVO_CORROMPIDO');
  });
});
