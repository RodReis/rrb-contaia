import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AbaCapturaDfe } from './aba-captura-dfe';
import { iniciarConsultaDfe, obterEstadoDaCapturaDfe, obterHistoricoDaCapturaDfe, reprocessarCapturaDfe } from './api';

vi.mock('./api', () => ({
  iniciarConsultaDfe: vi.fn(),
  obterEstadoDaCapturaDfe: vi.fn(),
  obterHistoricoDaCapturaDfe: vi.fn(),
  reprocessarCapturaDfe: vi.fn(),
}));

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const estado = {
  companyId: 'empresa-1', state: 'READY' as const, lastNsu: '0', maxNsu: '0', averageTimeMs: 60_000,
  nextAllowedAt: '2026-10-14T00:00:00.000Z', blockedUntil: null, consecutiveFailures: 0, lastSuccessAt: null, lastErrorCode: null,
};

describe('aba de captura DF-e', () => {
  beforeEach(() => {
    vi.mocked(obterEstadoDaCapturaDfe).mockResolvedValue(estado);
    vi.mocked(obterHistoricoDaCapturaDfe).mockResolvedValue({ pagina: 1, itens: [] });
    vi.mocked(iniciarConsultaDfe).mockResolvedValue({ runId: 'run-1', status: 'QUEUED' });
  });

  it('enfileira consulta manual ao ativar botão', async () => {
    const user = userEvent.setup();
    render(<AbaCapturaDfe empresaId="empresa-1" somenteLeitura={false} podeReprocessar={false} />, { wrapper: Envolvido });

    await user.click(await screen.findByRole('button', { name: 'Consultar agora' }));
    await waitFor(() => expect(iniciarConsultaDfe).toHaveBeenCalledWith('empresa-1'));
  });

  it('não oferece ação manual em modo somente leitura', async () => {
    render(<AbaCapturaDfe empresaId="empresa-1" somenteLeitura podeReprocessar={false} />, { wrapper: Envolvido });

    expect((await screen.findByRole('button', { name: 'Consultar agora' })).hasAttribute('disabled')).toBe(true);
  });

  it('explica bloqueio 656 sem depender apenas da cor', async () => {
    vi.mocked(obterEstadoDaCapturaDfe).mockResolvedValue({ ...estado, state: 'BLOCKED_656', blockedUntil: '2026-10-15T12:00:00.000Z' });
    render(<AbaCapturaDfe empresaId="empresa-1" somenteLeitura={false} podeReprocessar={false} />, { wrapper: Envolvido });

    expect((await screen.findByRole('status')).textContent).toMatch(/não há antecipação manual/u);
    expect(screen.getByRole('button', { name: 'Consultar agora' }).hasAttribute('disabled')).toBe(true);
  });

  it('mostra reprocessamento da DLQ somente para admin_escritorio', async () => {
    vi.mocked(obterHistoricoDaCapturaDfe).mockResolvedValue({ pagina: 1, itens: [{ id: 'run-1', estado: 'DEAD', origem: 'MANUAL', iniciado_em: null, quantidade_recebida: 0, codigo: 'DFE_PROVIDER_UNAVAILABLE' }] });
    vi.mocked(reprocessarCapturaDfe).mockResolvedValue({ runId: 'run-1', status: 'QUEUED' });
    const user = userEvent.setup();
    render(<AbaCapturaDfe empresaId="empresa-1" somenteLeitura={false} podeReprocessar />, { wrapper: Envolvido });
    await user.click(await screen.findByRole('button', { name: 'Reprocessar' }));
    await waitFor(() => expect(reprocessarCapturaDfe).toHaveBeenCalledWith('empresa-1', 'run-1'));
  });
});
