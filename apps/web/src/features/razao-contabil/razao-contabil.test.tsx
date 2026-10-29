import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { obterBalanceteMock, listarMovimentosMock, searchParams } = vi.hoisted(() => ({
  obterBalanceteMock: vi.fn(), listarMovimentosMock: vi.fn(), searchParams: new URLSearchParams('de=2097-01&ate=2097-01&visao=balancete'),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/empresas/empresa-1/razao',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock('../usuarios/queries', () => ({ useSessao: () => ({ data: { permissoes: ['contabil.razao.consultar'] } }) }));
vi.mock('../lancamentos-contabeis/api', () => ({
  listarContasAnaliticas: vi.fn().mockResolvedValue({ items: [] }),
  listarCentrosAnaliticos: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('../empresa/api', () => ({ listarEmpresas: vi.fn() }));
vi.mock('./api', () => ({
  listarMovimentosRazao: listarMovimentosMock,
  obterBalancete: obterBalanceteMock,
  obterDetalheDoMovimento: vi.fn(), reconstruirRazao: vi.fn(), verificarIntegridadeRazao: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RazaoContabil } from './razao-contabil';

const envolver = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>,
);

describe('razão contábil', () => {
  beforeEach(() => { obterBalanceteMock.mockReset(); listarMovimentosMock.mockReset(); });

  it('declara marco inicial e natureza textual no balancete', async () => {
    obterBalanceteMock.mockResolvedValue({
      lines: [{ accountId: 'conta-1', code: '1.01', name: 'Caixa', type: 'ANALYTICAL', normalBalance: 'DEBIT', level: 0, parentAccountId: null, openingBalanceCents: 0, debitCents: 2400, creditCents: 0, closingBalanceCents: 2400, closingNature: 'DEBIT', movementCount: 1 }],
      totalDebitCents: 2400, totalCreditCents: 2400, firstCompetence: '2097-01', projectionVersion: 1, integrity: 'CONSISTENT',
    });
    envolver(<RazaoContabil empresaId="empresa-1" nomeEmpresa="Empresa teste"/>);
    expect(await screen.findByRole('heading', { name: 'Razão contábil' })).toBeInTheDocument();
    expect(await screen.findByText('1.01 · Caixa')).toBeInTheDocument();
    expect(screen.getByText('Saldo normal: devedor')).toBeInTheDocument();
    expect(screen.getByText('Devedor')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Marco inicial disponível: 2097-01');
  });
});
