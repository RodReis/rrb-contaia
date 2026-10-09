/**
 * Texto e destino do aviso de importação do plano de contas (SPEC-013 §3.10).
 */
import { describe, expect, it } from 'vitest';

import type { Notificacao } from './api';
import { resumoDaImportacao, rotaDaNotificacao } from './apresentacao';

const aviso = (sobrescritas: Partial<Notificacao> = {}): Notificacao => ({
  id: 'n-1',
  empresaId: 'e-plano',
  empresaNome: 'Padaria Aurora',
  adicionadas: null,
  removidas: null,
  tipo: 'IMPORTACAO_PLANO_CONTAS_CONCLUIDA',
  chave: 'importacao:t-9',
  lida: false,
  lidaEm: null,
  criadoEm: '2026-10-08T12:00:00.000Z',
  importacao: { tentativaId: 't-9', estado: 'CONCLUIDA', totais: { lidas: 3, novas: 2, atualizadas: 1, rejeitadas: 0 } },
  ...sobrescritas,
});

describe('resumoDaImportacao: frases terminam com ponto', () => {
  it('concluída lista os totais e fecha a frase', () => {
    expect(resumoDaImportacao(aviso())).toBe('2 incluídas, 1 atualizada, 0 rejeitadas.');
  });

  it('rejeitada diz que nada mudou, com a contagem e o ponto final', () => {
    expect(
      resumoDaImportacao(
        aviso({ importacao: { tentativaId: 't-9', estado: 'REJEITADA', totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 } } }),
      ),
    ).toBe('Nenhuma conta foi alterada: 2 linhas rejeitadas.');
  });
});

describe('rotaDaNotificacao do aviso de importação', () => {
  it('abre a tentativa na aba Plano de contas da empresa', () => {
    expect(rotaDaNotificacao(aviso())).toBe('/empresas/e-plano?aba=plano-contas&tentativa=t-9');
  });

  it('sem empresa no aviso, cai no histórico de notificações em vez de um link quebrado', () => {
    expect(rotaDaNotificacao(aviso({ empresaId: null }))).toBe('/notificacoes');
  });
});
