import { describe, expect, it } from 'vitest';

import {
  LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES,
  LIMITE_DE_LOGO_BYTES,
  mensagemDaFalha,
  validarArquivo,
} from './arquivos.js';

describe('validarArquivo', () => {
  it('aceita logo PNG dentro do limite', () => {
    expect(validarArquivo('LOGO', { tipoConteudo: 'image/png', tamanhoBytes: 1024 })).toBeNull();
  });

  it('recusa PDF como logo', () => {
    expect(validarArquivo('LOGO', { tipoConteudo: 'application/pdf', tamanhoBytes: 1024 })).toBe(
      'TIPO_NAO_ACEITO',
    );
  });

  it('aceita PDF como documento', () => {
    expect(
      validarArquivo('DOCUMENTO', { tipoConteudo: 'application/pdf', tamanhoBytes: 1024 }),
    ).toBeNull();
  });

  it('recusa arquivo acima do limite', () => {
    expect(
      validarArquivo('LOGO', {
        tipoConteudo: 'image/png',
        tamanhoBytes: LIMITE_DE_LOGO_BYTES + 1,
      }),
    ).toBe('TAMANHO_EXCEDIDO');
  });

  it('aceita exatamente no limite', () => {
    expect(
      validarArquivo('LOGO', { tipoConteudo: 'image/png', tamanhoBytes: LIMITE_DE_LOGO_BYTES }),
    ).toBeNull();
  });

  it('recusa arquivo vazio', () => {
    expect(validarArquivo('LOGO', { tipoConteudo: 'image/png', tamanhoBytes: 0 })).toBe(
      'ARQUIVO_VAZIO',
    );
  });

  it('descreve a falha em linguagem de usuário, com o limite real', () => {
    expect(mensagemDaFalha('LOGO', 'TAMANHO_EXCEDIDO')).toContain('2 MB');
    expect(mensagemDaFalha('DOCUMENTO', 'TIPO_NAO_ACEITO')).toContain('.pdf');
  });
});

describe('documento da empresa cliente (SPEC-004)', () => {
  it('aceita PDF, JPG e PNG', () => {
    for (const tipoConteudo of ['application/pdf', 'image/jpeg', 'image/png']) {
      expect(
        validarArquivo('DOCUMENTO_DA_EMPRESA', { tipoConteudo, tamanhoBytes: 1024 }),
      ).toBeNull();
    }
  });

  it('recusa formato que o escritorio aceita mas o navegador nao exibe', () => {
    expect(
      validarArquivo('DOCUMENTO_DA_EMPRESA', {
        tipoConteudo:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        tamanhoBytes: 1024,
      }),
    ).toBe('TIPO_NAO_ACEITO');
  });

  it('aceita ate 20 MB e recusa o byte seguinte', () => {
    expect(
      validarArquivo('DOCUMENTO_DA_EMPRESA', {
        tipoConteudo: 'application/pdf',
        tamanhoBytes: LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES,
      }),
    ).toBeNull();

    expect(
      validarArquivo('DOCUMENTO_DA_EMPRESA', {
        tipoConteudo: 'application/pdf',
        tamanhoBytes: LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES + 1,
      }),
    ).toBe('TAMANHO_EXCEDIDO');
  });

  it('nomeia o limite de 20 MB na mensagem ao usuario', () => {
    expect(mensagemDaFalha('DOCUMENTO_DA_EMPRESA', 'TAMANHO_EXCEDIDO')).toContain('20 MB');
  });
});
