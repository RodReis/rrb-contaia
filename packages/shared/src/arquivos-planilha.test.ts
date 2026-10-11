/**
 * Regras de arquivo da importação com planilha (SPEC-015 §3.1–3.2): `.csv`, `.xlsx` e `.ods`, 10 MB,
 * `.xls` e `.xlsm` recusados pela extensão.
 */
import { describe, expect, it } from 'vitest';

import {
  LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES,
  LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES,
  REGRAS_DE_ARQUIVO,
  conteudoConfereComOTipo,
  formatoPelaExtensao,
  mensagemDaFalha,
  tipoDeConteudoDoFormato,
  validarArquivo,
  type TipoDeArquivo,
} from './arquivos.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ODS = 'application/vnd.oasis.opendocument.spreadsheet';
const IMPORTACOES: readonly TipoDeArquivo[] = ['IMPORTACAO_PLANO_CONTAS', 'IMPORTACAO_EMPREGADOS'];

const bytes = (...valores: number[]): Uint8Array => Uint8Array.from(valores);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const ZIP_VAZIO = bytes(0x50, 0x4b, 0x05, 0x06, 0x00, 0x00);
const CFB = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const TEXTO = new TextEncoder().encode('codigo;nome\r\n1;Ativo');

describe.each(IMPORTACOES)('%s — formatos e limites', (tipo) => {
  it('aceita .csv, .xlsx e .ods, e só eles', () => {
    expect(REGRAS_DE_ARQUIVO[tipo].extensoesAceitas).toEqual(['.csv', '.xlsx', '.ods']);
    for (const tipoConteudo of ['text/csv', 'text/plain', 'application/vnd.ms-excel', XLSX, ODS]) {
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 1024 }), tipoConteudo).toBeNull();
    }
    for (const tipoConteudo of ['application/pdf', 'application/zip', 'application/vnd.ms-excel.sheet.macroEnabled.12']) {
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 1024 }), tipoConteudo).toBe('TIPO_NAO_ACEITO');
    }
  });

  it('10 MB também para planilha: o byte seguinte é recusado', () => {
    expect(REGRAS_DE_ARQUIVO[tipo].limiteBytes).toBe(10 * 1024 * 1024);
    for (const tipoConteudo of [XLSX, ODS]) {
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 10 * 1024 * 1024 })).toBeNull();
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 10 * 1024 * 1024 + 1 })).toBe('TAMANHO_EXCEDIDO');
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 0 })).toBe('ARQUIVO_VAZIO');
    }
    expect(LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES).toBe(LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES);
  });

  it('.xls e .xlsm são recusados pela extensão, com código próprio, qualquer que seja o tipo declarado', () => {
    for (const tipoConteudo of ['application/vnd.ms-excel', XLSX, 'application/octet-stream']) {
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 1024, nome: 'empregados.xls' })).toBe('FORMATO_XLS_NAO_SUPORTADO');
      expect(validarArquivo(tipo, { tipoConteudo, tamanhoBytes: 1024, nome: 'EMPREGADOS.XLSM' })).toBe('FORMATO_XLSM_NAO_SUPORTADO');
    }
  });

  it('a recusa por extensão olha só o fim do nome; nome aceito ou ausente segue o fluxo normal', () => {
    expect(validarArquivo(tipo, { tipoConteudo: XLSX, tamanhoBytes: 10, nome: 'plano.xls.xlsx' })).toBeNull();
    expect(validarArquivo(tipo, { tipoConteudo: XLSX, tamanhoBytes: 10, nome: 'plano.xlsx' })).toBeNull();
    expect(validarArquivo(tipo, { tipoConteudo: 'text/csv', tamanhoBytes: 10, nome: 'plano.csv' })).toBeNull();
    expect(validarArquivo(tipo, { tipoConteudo: XLSX, tamanhoBytes: 10 })).toBeNull();
  });

  it('arquivo vazio vence a recusa por extensão', () => {
    expect(validarArquivo(tipo, { tipoConteudo: XLSX, tamanhoBytes: 0, nome: 'a.xls' })).toBe('ARQUIVO_VAZIO');
  });

  it('as mensagens citam os três formatos aceitos e orientam sobre .xls e .xlsm', () => {
    expect(mensagemDaFalha(tipo, 'TIPO_NAO_ACEITO')).toBe('Formato não aceito. Envie .csv, .xlsx, .ods.');
    expect(mensagemDaFalha(tipo, 'FORMATO_XLS_NAO_SUPORTADO')).toContain('.xlsx');
    expect(mensagemDaFalha(tipo, 'FORMATO_XLSM_NAO_SUPORTADO')).toContain('macro');
    expect(mensagemDaFalha(tipo, 'TAMANHO_EXCEDIDO')).toContain('10 MB');
  });
});

describe('a recusa por extensão não vale para os outros tipos de arquivo', () => {
  it('logo e documentos seguem como antes', () => {
    expect(validarArquivo('LOGO', { tipoConteudo: 'image/png', tamanhoBytes: 10, nome: 'logo.xls' })).toBeNull();
    expect(validarArquivo('DOCUMENTO', { tipoConteudo: 'application/pdf', tamanhoBytes: 10, nome: 'a.xlsm' })).toBeNull();
  });
});

describe('conteudoConfereComOTipo — texto × planilha', () => {
  it('texto (CSV) não pode ter assinatura ZIP nem CFB', () => {
    for (const tipo of ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']) {
      expect(conteudoConfereComOTipo(tipo, TEXTO), tipo).toBe(true);
      expect(conteudoConfereComOTipo(tipo, ZIP), `${tipo} zip`).toBe(false);
      expect(conteudoConfereComOTipo(tipo, ZIP_VAZIO), `${tipo} zip vazio`).toBe(false);
      expect(conteudoConfereComOTipo(tipo, CFB), `${tipo} cfb`).toBe(false);
    }
  });

  it('planilha precisa começar como ZIP; texto, PDF e imagem anunciados como planilha não conferem', () => {
    for (const tipo of [XLSX, ODS]) {
      expect(conteudoConfereComOTipo(tipo, ZIP), tipo).toBe(true);
      expect(conteudoConfereComOTipo(tipo, TEXTO), `${tipo} texto`).toBe(false);
      expect(conteudoConfereComOTipo(tipo, bytes(0x25, 0x50, 0x44, 0x46)), `${tipo} pdf`).toBe(false);
      expect(conteudoConfereComOTipo(tipo, bytes(0x89, 0x50, 0x4e, 0x47)), `${tipo} png`).toBe(false);
      expect(conteudoConfereComOTipo(tipo, bytes(0x50, 0x4b)), `${tipo} curto`).toBe(false);
    }
  });

  // O formato real é decidido pelo leitor. XLSX cifrado e .xls renomeado são CFB: deixá-los passar
  // aqui é o que permite devolver ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO / EXTENSAO_DIFERENTE_DO_CONTEUDO
  // em vez de uma recusa genérica de conteúdo.
  it('CFB anunciado como planilha passa para o leitor classificar (cifrado, .xls renomeado)', () => {
    for (const tipo of [XLSX, ODS]) {
      expect(conteudoConfereComOTipo(tipo, CFB), tipo).toBe(true);
    }
  });
});

describe('formato pela extensão e tipo de conteúdo canônico', () => {
  it('extensão decide o formato, sem diferenciar caixa', () => {
    expect(formatoPelaExtensao('plano.csv')).toBe('CSV');
    expect(formatoPelaExtensao('Plano Final.XLSX')).toBe('XLSX');
    expect(formatoPelaExtensao('a.b.ods')).toBe('ODS');
    expect(formatoPelaExtensao('plano.xls')).toBeNull();
    expect(formatoPelaExtensao('plano.xlsm')).toBeNull();
    expect(formatoPelaExtensao('plano')).toBeNull();
    expect(formatoPelaExtensao('xlsx')).toBeNull();
  });

  it('cada formato tem o tipo de conteúdo que o navegador e o servidor devem usar', () => {
    expect(tipoDeConteudoDoFormato('CSV')).toBe('text/csv');
    expect(tipoDeConteudoDoFormato('XLSX')).toBe(XLSX);
    expect(tipoDeConteudoDoFormato('ODS')).toBe(ODS);
  });
});
