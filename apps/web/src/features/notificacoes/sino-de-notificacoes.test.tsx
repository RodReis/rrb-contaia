import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SinoDeNotificacoes } from './sino-de-notificacoes';

vi.mock('@/lib/http', () => ({ requisitar: vi.fn() }));

import { requisitar } from '@/lib/http';

const renderizar = () => {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <SinoDeNotificacoes />
    </QueryClientProvider>,
  );
};

const PAINEL_COM_NAO_LIDAS = {
  notificacoes: [
    {
      id: 'n1',
      empresaId: 'e1',
      empresaNome: 'Acme Ltda',
      tipo: 'DOCUMENTO_REJEITADO',
      chave: 'exigencia:x1',
      lida: false,
      lidaEm: null,
      criadoEm: new Date().toISOString(),
    },
  ],
  naoLidas: 1,
};

describe('SinoDeNotificacoes', () => {
  beforeEach(() => {
    vi.mocked(requisitar).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exibe badge com o número de não lidas', async () => {
    vi.mocked(requisitar).mockResolvedValue(PAINEL_COM_NAO_LIDAS);

    renderizar();

    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('badge não aparece quando não há não lidas (estado "Badge zero")', async () => {
    vi.mocked(requisitar).mockResolvedValue({ notificacoes: [], naoLidas: 0 });

    renderizar();

    await waitFor(() => expect(requisitar).toHaveBeenCalled());
    expect(screen.queryByTestId('badge-nao-lidas')).not.toBeInTheDocument();
  });

  it('abre o painel e mostra a lista ao clicar no sino', async () => {
    vi.mocked(requisitar).mockResolvedValue(PAINEL_COM_NAO_LIDAS);
    const usuario = userEvent.setup();

    renderizar();
    await screen.findByText('1');
    await usuario.click(screen.getByRole('button', { name: /notifica/iu }));

    expect(await screen.findByText('Acme Ltda')).toBeInTheDocument();
  });

  it('marca como lida e navega ao clicar no item', async () => {
    vi.mocked(requisitar)
      .mockResolvedValueOnce(PAINEL_COM_NAO_LIDAS) // carga inicial
      .mockResolvedValueOnce({ ...PAINEL_COM_NAO_LIDAS.notificacoes[0], lida: true }) // marcar lida
      .mockResolvedValue({ notificacoes: [], naoLidas: 0 }); // invalidação após sucesso
    const usuario = userEvent.setup();

    renderizar();
    await screen.findByText('1');
    await usuario.click(screen.getByRole('button', { name: /notifica/iu }));
    await usuario.click(await screen.findByText('Acme Ltda'));

    await waitFor(() =>
      expect(requisitar).toHaveBeenCalledWith(
        '/notificacoes/n1/leitura',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
  });

  it('checkbox Todas seleciona os itens visíveis e marca em lote', async () => {
    vi.mocked(requisitar).mockResolvedValue(PAINEL_COM_NAO_LIDAS);
    const usuario = userEvent.setup();

    renderizar();
    await screen.findByText('1');
    await usuario.click(screen.getByRole('button', { name: /notifica/iu }));

    const painel = await screen.findByRole('dialog');
    await usuario.click(within(painel).getByLabelText(/todas/iu));

    expect(within(painel).getByRole('checkbox', { name: /todas/iu })).toBeChecked();
  });
});
