/**
 * Aviso de importação de empregados no sino (SPEC-014 §3.10): nomeia a empresa, o desfecho e os
 * totais, e abre a tentativa na aba "Empregados".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SinoDeNotificacoes } from './sino-de-notificacoes';

vi.mock('@/lib/http', () => ({ requisitar: vi.fn() }));

import { requisitar } from '@/lib/http';

const AVISO = {
  id: 'i2',
  empresaId: 'e-emp',
  empresaNome: 'Padaria Aurora',
  adicionadas: null,
  removidas: null,
  tipo: 'IMPORTACAO_EMPREGADOS_CONCLUIDA',
  chave: 'importacao-empregados:t-7',
  lida: false,
  lidaEm: null,
  criadoEm: new Date().toISOString(),
  duracaoMs: null,
  importacao: { tentativaId: 't-7', estado: 'CONCLUIDA_COM_REJEICOES', totais: { lidas: 64, novas: 60, atualizadas: 1, rejeitadas: 3 } },
};

beforeEach(() => {
  vi.mocked(requisitar).mockReset();
  vi.mocked(requisitar).mockResolvedValue({ notificacoes: [AVISO], naoLidas: 1 });
});

describe('sino — importação de empregados', () => {
  it('mostra o desfecho, os totais e abre a tentativa na aba Empregados', async () => {
    const usuario = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SinoDeNotificacoes />
      </QueryClientProvider>,
    );

    await usuario.click(await screen.findByRole('button', { name: /notifica/iu }));
    const painel = await screen.findByRole('dialog');
    const link = within(painel).getByRole('link', { name: /Padaria Aurora/u });

    expect(link).toHaveTextContent('Importação de empregados concluída com rejeições');
    expect(within(painel).getByText('60 incluídos, 1 atualizado, 3 rejeitados.')).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/empresas/e-emp?aba=empregados&tentativa=t-7');
    expect(await axe(painel)).toHaveNoViolations();
  });
});
