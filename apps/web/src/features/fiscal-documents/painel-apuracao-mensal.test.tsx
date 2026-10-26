import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PainelApuracaoMensal } from './painel-apuracao-mensal';
import { listarApuracoesMensais, listarPacotesMensais, prepararApuracaoMensal } from './monthly-assessments-api';

vi.mock('./monthly-assessments-api', () => ({
  baixarRelatorioApuracao: vi.fn(), declararApuracaoIcms: vi.fn(), declararApuracaoSimples: vi.fn(),
  importarPacoteMensal: vi.fn(), listarApuracoesMensais: vi.fn(), listarPacotesMensais: vi.fn(),
  prepararApuracaoMensal: vi.fn(), revisarApuracaoMensal: vi.fn(), decidirPacoteMensal: vi.fn(),
}));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return { Select: ({ rotulo, valor, onValorChange, opcoes }: {
    rotulo: string; valor: string; onValorChange: (value: string) => void; opcoes: readonly { valor: string; rotulo: string }[];
  }) => React.createElement('label', null, rotulo, React.createElement('select', {
    'aria-label': rotulo, value: valor, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValorChange(event.currentTarget.value),
  }, ...opcoes.map((opcao) => React.createElement('option', { key: opcao.valor, value: opcao.valor }, opcao.rotulo)))) };
});

const Wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('painel de apuração mensal F36', () => {
  beforeEach(() => {
    vi.mocked(listarApuracoesMensais).mockResolvedValue([]);
    vi.mocked(listarPacotesMensais).mockResolvedValue([]);
  });

  it('mostra estado vazio sem apresentar guia ou valor presumido', async () => {
    render(<PainelApuracaoMensal empresaId="company-1" somenteLeitura={false} podePreparar podeRevisar />, { wrapper: Wrapper });
    expect(await screen.findByRole('heading', { name: 'Apuração fiscal mensal' })).toBeTruthy();
    expect(await screen.findByText('Nenhuma revisão nesta competência')).toBeTruthy();
    expect(screen.getByText(/Não transmite nem emite guia oficial/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Preparar/u })).toBeDisabled();
  });

  it('exibe lacunas e bloqueia exportação quando total é indeterminado', async () => {
    vi.mocked(listarApuracoesMensais).mockResolvedValue([{
      assessmentId: '11111111-1111-4111-8111-111111111111', competence: '2026-09', kind: 'SIMPLES_NACIONAL_DAS', status: 'INDETERMINATE',
      components: [], totalCents: null, gapCodes: ['MONTHLY_ASSESSMENT_RBT12_INCOMPLETE'], canonicalJsonHash: 'a'.repeat(64),
    }]);
    render(<PainelApuracaoMensal empresaId="company-1" somenteLeitura={false} podePreparar podeRevisar />, { wrapper: Wrapper });
    expect(await screen.findByText('MONTHLY_ASSESSMENT_RBT12_INCOMPLETE')).toBeTruthy();
    expect(screen.getByRole('button', { name: /PDF/u })).toBeDisabled();
    expect(screen.getByText('Indeterminado')).toBeTruthy();
  });

  it('não prepara sem permissão de simulação', async () => {
    render(<PainelApuracaoMensal empresaId="company-1" somenteLeitura={false} podePreparar={false} podeRevisar={false} />, { wrapper: Wrapper });
    await screen.findByRole('heading', { name: 'Apuração fiscal mensal' });
    fireEvent.change(screen.getByLabelText('ID do pacote normativo aprovado'), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    expect(screen.getByRole('button', { name: /Preparar/u })).toBeDisabled();
    expect(prepararApuracaoMensal).not.toHaveBeenCalled();
  });

  it('mostra PIS e Cofins separados, sem rotular a revisão F37 como ICMS', async () => {
    vi.mocked(listarApuracoesMensais).mockResolvedValue([{
      assessmentId: '11111111-1111-4111-8111-111111111111', competence: '2026-03', kind: 'LUCRO_PRESUMIDO_PIS_COFINS', status: 'READY_FOR_REVIEW',
      components: [{ code: 'PIS_PASEP:NORMAL', baseCents: 10_000, rateScaled: '0.65',
        amountCents: 60, grossAmountCents: 65, transitionOffsetCents: 5, netAmountCents: 60, ruleId: 'v1', sourceIds: ['doc:hash:item:1'] }],
      totalCents: null, pisPayableCents: 60, cofinsPayableCents: 300, gapCodes: [], canonicalJsonHash: 'a'.repeat(64),
    }]);
    render(<PainelApuracaoMensal empresaId="company-1" somenteLeitura={false} podePreparar podeRevisar />, { wrapper: Wrapper });
    await screen.findByRole('heading', { name: 'Apuração fiscal mensal' });
    fireEvent.change(screen.getByLabelText('Trilha fiscal'), { target: { value: 'LUCRO_PRESUMIDO_PIS_COFINS' } });

    expect(await screen.findByText('Fiscal · F37')).toBeTruthy();
    expect(await screen.findByText('PIS/Pasep preliminar')).toBeTruthy();
    expect(await screen.findByText('Cofins preliminar')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Compensação' })).toBeTruthy();
    expect(screen.queryByText(/DARE · ICMS próprio/u)).toBeNull();
  });
});
