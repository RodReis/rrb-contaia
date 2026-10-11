/**
 * Texto e destino do aviso de importação de empregados (SPEC-014 §3.10): estado, totais e a
 * tentativa na aba "Empregados". O aviso do plano de contas não muda.
 */
import { describe, expect, it } from 'vitest';

import type { Notificacao } from './api';
import { ehAvisoDeImportacao, resumoDaImportacao, rotaDaNotificacao, tipoDaNotificacao } from './apresentacao';

const aviso = (sobrescritas: Partial<Notificacao> = {}): Notificacao => ({
  id: 'n-2',
  empresaId: 'e-emp',
  empresaNome: 'Padaria Aurora',
  adicionadas: null,
  removidas: null,
  tipo: 'IMPORTACAO_EMPREGADOS_CONCLUIDA',
  chave: 'importacao-empregados:t-7',
  lida: false,
  lidaEm: null,
  criadoEm: '2026-10-08T12:00:00.000Z',
  importacao: { tentativaId: 't-7', estado: 'CONCLUIDA', totais: { lidas: 3, novas: 2, atualizadas: 1, rejeitadas: 0 } },
  ...sobrescritas,
});

describe('aviso de importação de empregados', () => {
  it('é aviso de importação e nomeia o desfecho', () => {
    expect(ehAvisoDeImportacao(aviso())).toBe(true);
    expect(tipoDaNotificacao(aviso())).toBe('Importação de empregados concluída');
    expect(
      tipoDaNotificacao(aviso({ importacao: { tentativaId: 't-7', estado: 'CONCLUIDA_COM_REJEICOES', totais: null } })),
    ).toBe('Importação de empregados concluída com rejeições');
    expect(tipoDaNotificacao(aviso({ importacao: { tentativaId: 't-7', estado: 'FALHA', totais: null } }))).toBe(
      'Importação de empregados com falha',
    );
  });

  it('resume os totais em palavras de empregado', () => {
    expect(resumoDaImportacao(aviso())).toBe('2 incluídos, 1 atualizado, 0 rejeitados.');
    expect(
      resumoDaImportacao(
        aviso({ importacao: { tentativaId: 't-7', estado: 'REJEITADA', totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 } } }),
      ),
    ).toBe('Nenhum empregado foi alterado: 2 linhas rejeitadas.');
    expect(resumoDaImportacao(aviso({ importacao: { tentativaId: 't-7', estado: 'FALHA', totais: null } }))).toBe(
      'O processamento do arquivo falhou.',
    );
  });

  it('abre a tentativa na aba Empregados da empresa', () => {
    expect(rotaDaNotificacao(aviso())).toBe('/empresas/e-emp?aba=empregados&tentativa=t-7');
    expect(rotaDaNotificacao(aviso({ empresaId: null }))).toBe('/notificacoes');
  });
});
