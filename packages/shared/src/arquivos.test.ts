import { describe, expect, it } from 'vitest';

import { LIMITE_DE_LOGO_BYTES, mensagemDaFalha, validarArquivo } from './arquivos.js';

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
