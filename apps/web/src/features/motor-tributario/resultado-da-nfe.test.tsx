import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';

import { resultadoDaNfe } from './motor-tributario.fixtures';
import { ResultadoDaNfe } from './resultado-da-nfe';

const linha = (item: number, tributo: string): HTMLElement => {
  const linhas = screen.getAllByRole('row').filter((candidata) => within(candidata).queryByText(tributo, { selector: 'td,th' }) !== null);

  return linhas.find((candidata) => within(candidata).queryAllByText(String(item), { selector: 'th' }).length > 0) as HTMLElement;
};

describe('ResultadoDaNfe — cálculo por item e comparação com o declarado (SPEC-016 §3.6)', () => {
  it('lista cada tributo de cada item com base, calculado e declarado', () => {
    render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    expect(screen.getByRole('table', { name: 'Cálculo por item da NF-e' })).toBeInTheDocument();
    const cbsDoItem1 = linha(1, 'CBS');
    expect(within(cbsDoItem1).getByText('R$ 100,00')).toBeInTheDocument();
    expect(within(cbsDoItem1).getAllByText('R$ 0,90')).toHaveLength(2);
  });

  it('o valor que confere diz "Confere", em texto', () => {
    render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    expect(within(linha(1, 'CBS')).getByText('Confere')).toBeInTheDocument();
  });

  it('a divergência aparece em texto, com a diferença, sem declarar qual valor está correto', () => {
    render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    const divergente = linha(2, 'CBS');
    expect(within(divergente).getByText('Divergente')).toBeInTheDocument();
    expect(within(divergente).getByText('-R$ 0,05')).toBeInTheDocument();
    expect(screen.getByText(/não indica qual valor está correto/iu)).toBeInTheDocument();
  });

  it('o item sem valor declarado diz que não há o que comparar', () => {
    const resultado = resultadoDaNfe();
    const [item] = resultado.items;
    const semDeclarado = {
      ...resultado,
      items: [{ ...(item as NonNullable<typeof item>), taxes: (item?.taxes ?? []).map((t) => ({ ...t, comparison: null })) }],
    };
    render(<ResultadoDaNfe resultado={semDeclarado} />);

    expect(within(linha(1, 'CBS')).getByText('Sem valor declarado')).toBeInTheDocument();
  });

  it('totais: calculado e comparação com os totais declarados do documento', () => {
    render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    const totais = screen.getByRole('region', { name: 'Totais da NF-e' });
    expect(within(totais).getByText('IBS')).toBeInTheDocument();
    expect(within(totais).getByText('CBS')).toBeInTheDocument();
    expect(within(totais).getByText('Confere')).toBeInTheDocument();
    expect(within(totais).getByText('Divergente')).toBeInTheDocument();
    expect(within(totais).getByText('R$ 1,80')).toBeInTheDocument();
    expect(within(totais).getByText('R$ 1,85')).toBeInTheDocument();
  });

  it('abre e fecha a memória de cálculo da linha, com o estado no botão', async () => {
    render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    const botao = within(linha(2, 'CBS')).getByRole('button', { name: /Ver memória/u });
    expect(botao).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('heading', { name: 'Memória de cálculo determinística' })).toBeInTheDocument();

    await userEvent.click(botao);
    expect(screen.queryByRole('heading', { name: 'Memória de cálculo determinística' })).not.toBeInTheDocument();
  });

  it('a tabela rola na horizontal dentro do próprio contêiner, sem estourar a página', () => {
    render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    expect(screen.getByRole('table').parentElement?.className).toMatch(/overflow-x-auto/u);
  });

  it('não tem violação de axe', async () => {
    const { container } = render(<ResultadoDaNfe resultado={resultadoDaNfe()} />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
