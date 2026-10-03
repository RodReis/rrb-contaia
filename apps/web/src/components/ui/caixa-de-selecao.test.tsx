import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import { CaixaDeSelecao } from './caixa-de-selecao';

describe('CaixaDeSelecao', () => {
  it('é um checkbox nomeado pelo rótulo, com a descrição ligada por aria-describedby', () => {
    render(
      <CaixaDeSelecao
        rotulo="Contador"
        descricao="Cria e mantém empresas."
        marcada={false}
        onMarcadaChange={() => undefined}
      />,
    );

    const caixa = screen.getByRole('checkbox', { name: 'Contador' });

    expect(caixa).not.toBeChecked();
    expect(caixa).toHaveAccessibleDescription('Cria e mantém empresas.');
  });

  it('clicar no rótulo ou na caixa alterna e avisa o novo valor', async () => {
    const aoMudar = vi.fn();

    render(<CaixaDeSelecao rotulo="Contador" marcada={false} onMarcadaChange={aoMudar} />);

    await userEvent.click(screen.getByText('Contador'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));

    expect(aoMudar).toHaveBeenNthCalledWith(1, true);
    expect(aoMudar).toHaveBeenNthCalledWith(2, true);
  });

  it('com a caixa marcada, alternar avisa false', async () => {
    const aoMudar = vi.fn();

    render(<CaixaDeSelecao rotulo="Contador" marcada onMarcadaChange={aoMudar} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));

    expect(aoMudar).toHaveBeenCalledWith(false);
  });

  it('Espaço alterna pelo teclado e o foco é visível', async () => {
    const aoMudar = vi.fn();

    render(<CaixaDeSelecao rotulo="Contador" marcada={false} onMarcadaChange={aoMudar} />);

    await userEvent.tab();

    const caixa = screen.getByRole('checkbox', { name: 'Contador' });

    expect(caixa).toHaveFocus();
    expect(caixa.className).toMatch(/focus-visible:ring/u);

    await userEvent.keyboard(' ');

    expect(aoMudar).toHaveBeenCalledWith(true);
  });

  it('desabilitada não alterna e fica explícita para quem usa leitor de tela', async () => {
    const aoMudar = vi.fn();

    render(<CaixaDeSelecao rotulo="Contador" marcada={false} onMarcadaChange={aoMudar} disabled />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));

    expect(screen.getByRole('checkbox', { name: 'Contador' })).toBeDisabled();
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('não tem violação detectável pelo axe', async () => {
    const { container } = render(
      <CaixaDeSelecao
        rotulo="Contador"
        descricao="Cria e mantém empresas."
        marcada
        onMarcadaChange={() => undefined}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
