/**
 * Diagnóstico da prévia (SPEC-015 §7): a REJEITADA que o worker produz para uma planilha traz a
 * mensagem fixa do código de planilha; os textos das F13/F14 não mudam.
 */
import { CODIGOS_DE_ERRO_DE_PLANILHA, MENSAGEM_DO_ERRO_DE_PLANILHA } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import { mensagensDoDiagnostico, paraDiagnosticoCom } from './apresentacao';

const MENSAGENS = mensagensDoDiagnostico('nada mudou');

describe('mensagensDoDiagnostico', () => {
  it.each(CODIGOS_DE_ERRO_DE_PLANILHA)('%s (recusa da planilha no worker) → mensagem fixa do código', (codigo) => {
    expect(paraDiagnosticoCom(MENSAGENS, { acao: 'VALIDACAO_REJEITADA', codigo }, 'XLSX')).toEqual({ codigo, mensagem: MENSAGEM_DO_ERRO_DE_PLANILHA[codigo] });
  });

  it('CABECALHO_INVALIDO: o texto do CSV fica no CSV; na planilha fala da linha de cabeçalho escolhida', () => {
    const diagnostico = { acao: 'VALIDACAO_REJEITADA', codigo: 'CABECALHO_INVALIDO' } as const;
    expect(paraDiagnosticoCom(MENSAGENS, diagnostico, 'CSV')?.mensagem).toBe(MENSAGENS['CABECALHO_INVALIDO']);
    for (const formato of ['XLSX', 'ODS'] as const) {
      const mensagem = paraDiagnosticoCom(MENSAGENS, diagnostico, formato)?.mensagem;
      expect(mensagem).toContain('linha de cabeçalho escolhida');
      expect(mensagem).not.toBe(MENSAGENS['CABECALHO_INVALIDO']);
    }
  });

  it('os códigos das F13/F14 mantêm os próprios textos', () => {
    expect(MENSAGENS['CABECALHO_INVALIDO']).toBe('O cabeçalho do arquivo tem coluna sem nome ou repetida. Corrija o cabeçalho e envie de novo.');
    expect(MENSAGENS['FALHA_NA_APLICACAO']).toBe('nada mudou');
  });
});
