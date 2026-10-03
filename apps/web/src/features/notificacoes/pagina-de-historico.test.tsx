import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PaginaDeHistorico } from './pagina-de-historico';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/http')>();
  return { ...real, requisitar: vi.fn() };
});
import { ErroDaApi, requisitar } from '@/lib/http';

const renderizar = () => {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <PaginaDeHistorico />
    </QueryClientProvider>,
  );
};

describe('PaginaDeHistorico', () => {
  it('mostra estado vazio quando não há notificações', async () => {
    vi.mocked(requisitar).mockReset();
    vi.mocked(requisitar).mockResolvedValue({ notificacoes: [], total: 0 });

    renderizar();

    expect(await screen.findByText(/nenhuma notifica/iu)).toBeInTheDocument();
  });

  it('sem carteira, diz que falta alçada em vez de "Nenhuma notificação"', async () => {
    vi.mocked(requisitar).mockReset();
    vi.mocked(requisitar).mockResolvedValue({
      notificacoes: [],
      total: 0,
      escopoDeEmpresas: 'NENHUMA',
    });

    renderizar();

    expect(
      await screen.findByText('Você ainda não tem empresas na sua carteira'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma notifica/iu)).not.toBeInTheDocument();
  });

  it('lista notificações, incluindo lidas (histórico preservado)', async () => {
    vi.mocked(requisitar).mockReset();
    vi.mocked(requisitar).mockResolvedValue({
      notificacoes: [
        {
          id: 'n1',
          empresaId: 'e1',
          empresaNome: 'Acme Ltda',
          tipo: 'DOCUMENTO_VENCIDO',
          chave: 'exigencia:x1',
          lida: true,
          lidaEm: new Date().toISOString(),
          criadoEm: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    renderizar();

    expect(await screen.findByText(/Acme Ltda/u)).toBeInTheDocument();
  });

  it('mostra erro com correlationId quando a busca falha', async () => {
    vi.mocked(requisitar).mockReset();
    vi.mocked(requisitar).mockRejectedValue(
      new ErroDaApi({
        type: 'about:blank',
        title: 'Falha',
        status: 500,
        code: 'ERRO_DESCONHECIDO',
        correlationId: 'corr-123',
      }),
    );

    renderizar();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toBeInTheDocument();
    expect(await screen.findByText('corr-123')).toBeInTheDocument();
  });
});
