import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ packages: vi.fn(), history: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: api.toastSuccess, error: api.toastError } }));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return {
    Select: (props: { rotulo: string; valor: string; onValorChange: (value: string) => void;
      opcoes: readonly { valor: string; rotulo: string }[] }) => {
      const options = props.opcoes.map((item) => React.createElement('option', { key: item.valor, value: item.valor }, item.rotulo));
      return React.createElement('label', null, props.rotulo, React.createElement('select', { 'aria-label': props.rotulo,
        value: props.valor, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onValorChange(event.currentTarget.value) }, ...options));
    },
  };
});
vi.mock('./corporate-tax-assessments-api', () => ({
  listarPacotesCorporativos: api.packages, historicoApuracaoCorporativa: api.history,
  baixarArtefatoCorporativo: vi.fn(), baixarArtefatoCorporativoPersistido: vi.fn(), declararApuracaoCorporativa: vi.fn(),
  decidirApuracaoCorporativa: vi.fn(), importarPacoteCorporativo: vi.fn(), obterApuracaoCorporativa: vi.fn(),
  prepararApuracaoCorporativa: vi.fn(), revisarPacoteCorporativo: vi.fn(),
}));

import { PainelApuracaoCorporativa } from './painel-apuracao-corporativa';

const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const renderPanel = (readOnly = false) => render(<PainelApuracaoCorporativa empresaId="423e4567-e89b-12d3-a456-426614174000"
  somenteLeitura={readOnly} podePreparar={!readOnly} podeRevisar={!readOnly}/>, { wrapper: Wrapper });

describe('PainelApuracaoCorporativa F38', () => {
  beforeEach(() => { api.packages.mockReset().mockResolvedValue([]); api.history.mockReset().mockResolvedValue([]); });

  it('explica o bloqueio sem pacote e mantém a revisão vazia acessível', async () => {
    const { container } = renderPanel();
    expect(await screen.findByRole('heading', { name: 'IRPJ e CSLL · Lucro Presumido' })).toBeTruthy();
    expect(screen.getByText('Nenhum pacote importado. Fonte oficial aprovada é necessária para calcular.')).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão para este trimestre.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preparar apuração' })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sincroniza o trimestre escolhido com o rascunho da declaração', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'IRPJ e CSLL · Lucro Presumido' });
    fireEvent.change(screen.getByLabelText('Trimestre'), { target: { value: '2026-Q3' } });
    expect((await screen.findByLabelText('Declaração estruturada (JSON)') as HTMLTextAreaElement).value).toContain('"quarter": "2026-Q3"');
  });

  it('bloqueia anexos e mutations em modo somente leitura', async () => {
    const { container } = renderPanel(true);
    expect(await screen.findByRole('heading', { name: 'IRPJ e CSLL · Lucro Presumido' })).toBeTruthy();
    expect(screen.getByLabelText('Fonte oficial em PDF')).toBeDisabled();
    expect(screen.getByLabelText('Anexos na mesma ordem de `evidence` no JSON')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar declaração imutável' })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });
});
