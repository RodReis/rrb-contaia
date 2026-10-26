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
});
