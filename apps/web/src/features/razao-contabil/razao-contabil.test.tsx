import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { obterBalanceteMock, listarMovimentosMock, consultarFechamentosMock, fecharCompetenciaMock, reabrirCompetenciaMock, permissions, searchParams } = vi.hoisted(() => ({
  obterBalanceteMock: vi.fn(), listarMovimentosMock: vi.fn(), consultarFechamentosMock: vi.fn(), fecharCompetenciaMock: vi.fn(), reabrirCompetenciaMock: vi.fn(),
  permissions: ['contabil.razao.consultar'] as string[], searchParams: new URLSearchParams('de=2097-01&ate=2097-01&visao=balancete'),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/empresas/empresa-1/razao',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock('../usuarios/queries', () => ({ useSessao: () => ({ data: { permissoes: permissions } }) }));
vi.mock('../lancamentos-contabeis/api', () => ({
  listarContasAnaliticas: vi.fn().mockResolvedValue({ items: [] }),
  listarCentrosAnaliticos: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('../empresa/api', () => ({ listarEmpresas: vi.fn() }));
vi.mock('./api', () => ({
  listarMovimentosRazao: listarMovimentosMock,
  obterBalancete: obterBalanceteMock,
  consultarFechamentos: consultarFechamentosMock, fecharCompetencia: fecharCompetenciaMock,
  reabrirCompetencia: reabrirCompetenciaMock,
  obterDetalheDoMovimento: vi.fn(), reconstruirRazao: vi.fn(), verificarIntegridadeRazao: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RazaoContabil } from './razao-contabil';

const envolver = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>,
);

describe('razão contábil', () => {
  beforeEach(() => { obterBalanceteMock.mockReset(); listarMovimentosMock.mockReset(); consultarFechamentosMock.mockReset(); fecharCompetenciaMock.mockReset(); reabrirCompetenciaMock.mockReset(); permissions.splice(0, permissions.length, 'contabil.razao.consultar'); searchParams.set('de', '2097-01'); searchParams.set('ate', '2097-01'); searchParams.set('visao', 'balancete'); });

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

  it('mostra o ciclo e exige confirmação identificada antes de fechar', async () => {
    permissions.push('contabil.fechamento.consultar', 'contabil.fechamento.fechar_competencia');
    consultarFechamentosMock.mockResolvedValue({ cycles: [{ competence: '2097-01', status: 'OPEN', activeCloseId: null, latestVersion: 0 }], closes: [], events: [], correlationId: 'corr-f43' });
    obterBalanceteMock.mockResolvedValue({ lines: [], totalDebitCents: 0, totalCreditCents: 0, firstCompetence: '2097-01', projectionVersion: 1, integrity: 'CONSISTENT' });
    envolver(<RazaoContabil empresaId="empresa-1" nomeEmpresa="Empresa teste"/>);
    expect(await screen.findByRole('heading', { name: 'Fechamentos contábeis' })).toBeInTheDocument();
    await screen.findByText('Sem snapshot ativo');
    await screen.findByRole('button', { name: 'Fechar competência' }).then((button) => button.click());
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getAllByText(/Empresa teste/).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/2097-01/).length).toBeGreaterThan(1);
    expect(fecharCompetenciaMock).not.toHaveBeenCalled();
  });

  it('exige motivo e confirmação identificada antes de reabrir snapshot', async () => {
    permissions.push('contabil.fechamento.consultar', 'contabil.fechamento.reabrir');
    consultarFechamentosMock.mockResolvedValue({
      cycles: [{ competence: '2097-01', status: 'CLOSED', activeCloseId: 'close-1', latestVersion: 1 }],
      closes: [{ closeId: 'close-1', competence: '2097-01', version: 1, projectionVersion: 1, kind: 'REGULAR', debitCents: 100, creditCents: 100, movementCount: 2, entryCount: 1, firstCompetence: '2097-01', contentHash: 'a'.repeat(64), closedBy: 'user-1', closedAt: '2097-02-01T00:00:00.000Z', correlationId: 'corr-f43', content: { lines: [] }, closedByName: 'Contador', cycleStatus: 'CLOSED', snapshotValid: true }],
      events: [], correlationId: 'corr-f43',
    });
    obterBalanceteMock.mockResolvedValue({ lines: [], totalDebitCents: 100, totalCreditCents: 100, firstCompetence: '2097-01', projectionVersion: 1, integrity: 'CONSISTENT' });
    envolver(<RazaoContabil empresaId="empresa-1" nomeEmpresa="Empresa teste"/>);
    await screen.findByRole('heading', { name: 'Fechamentos contábeis' });
    await screen.findByText('Fechada');
    fireEvent.click(screen.getByRole('button', { name: 'Ver snapshot' }));
    await screen.findByRole('heading', { name: 'Fechamento 2097-01' });
    expect(await screen.findByText(/Somente administrador/)).toBeInTheDocument();
    fireEvent.change(await screen.findByRole('textbox', { name: /Motivo da reabertura/ }), { target: { value: 'Correção autorizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir competência' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getAllByText('Correção autorizada').length).toBeGreaterThan(1);
    expect(reabrirCompetenciaMock).not.toHaveBeenCalled();
  });
});
