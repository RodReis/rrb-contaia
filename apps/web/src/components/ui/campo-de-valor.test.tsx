import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CampoDeValor } from './campo-de-valor';

const Controlado = ({
  tipo,
  inicial = null,
  aoMudar,
  erro,
}: {
  tipo: 'moeda' | 'percentual';
  inicial?: number | null;
  aoMudar?: (valor: number | null) => void;
  erro?: string;
}) => {
  const [valor, definirValor] = useState<number | null>(inicial);

  return (
    <CampoDeValor
      rotulo={tipo === 'moeda' ? 'Base de cálculo' : 'Alíquota'}
      tipo={tipo}
      valor={valor}
      onValorChange={(proximo) => {
        definirValor(proximo);
        aoMudar?.(proximo);
      }}
      {...(erro === undefined ? {} : { erro })}
    />
  );
};

describe('CampoDeValor — moeda (estado em centavos, máscara só na exibição)', () => {
  it('digita em reais e entrega centavos inteiros ao estado', async () => {
    const aoMudar = vi.fn();
    render(<Controlado tipo="moeda" aoMudar={aoMudar} />);

    await userEvent.type(screen.getByLabelText('Base de cálculo'), '1234,5');

    expect(aoMudar).toHaveBeenLastCalledWith(123_450);
  });

  it('ao sair do campo formata o valor com milhar e duas casas', async () => {
    render(<Controlado tipo="moeda" />);
    const campo = screen.getByLabelText('Base de cálculo');

    await userEvent.type(campo, '1234,5');
    await userEvent.tab();

    expect(campo).toHaveValue('1.234,50');
  });

  it('colar valor mascarado funciona', async () => {
    const aoMudar = vi.fn();
    render(<Controlado tipo="moeda" aoMudar={aoMudar} />);

    await userEvent.click(screen.getByLabelText('Base de cálculo'));
    await userEvent.paste('R$ 12.345,67');

    expect(aoMudar).toHaveBeenLastCalledWith(1_234_567);
  });

  it('mostra o prefixo R$ fora do valor e o rótulo acessível completo', () => {
    render(<Controlado tipo="moeda" inicial={10_000} />);

    expect(screen.getByLabelText('Base de cálculo')).toHaveValue('100,00');
    expect(screen.getByText('R$')).toBeInTheDocument();
  });

  it('texto que não é valor gera o erro padrão ao sair e entrega nulo', async () => {
    const aoMudar = vi.fn();
    render(<Controlado tipo="moeda" aoMudar={aoMudar} />);
    const campo = screen.getByLabelText('Base de cálculo');

    await userEvent.type(campo, 'abc');
    await userEvent.tab();

    expect(aoMudar).toHaveBeenLastCalledWith(null);
    expect(await screen.findByText('Informe um valor válido')).toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
  });

  it('apagar o campo entrega nulo sem acusar erro (obrigatoriedade é do formulário)', async () => {
    const aoMudar = vi.fn();
    render(<Controlado tipo="moeda" inicial={500} aoMudar={aoMudar} />);

    await userEvent.clear(screen.getByLabelText('Base de cálculo'));
    await userEvent.tab();

    expect(aoMudar).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('Informe um valor válido')).not.toBeInTheDocument();
  });

  it('o erro do formulário aparece e aponta para o campo', () => {
    render(<Controlado tipo="moeda" erro="Informe a base" />);

    const campo = screen.getByLabelText('Base de cálculo');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Informe a base');
  });

  it('reflete valor trocado por fora (reinício do formulário)', async () => {
    const { rerender } = render(
      <CampoDeValor rotulo="Base" tipo="moeda" valor={100} onValorChange={() => undefined} />,
    );
    expect(screen.getByLabelText('Base')).toHaveValue('1,00');

    rerender(<CampoDeValor rotulo="Base" tipo="moeda" valor={250_000} onValorChange={() => undefined} />);

    expect(screen.getByLabelText('Base')).toHaveValue('2.500,00');
  });
});

describe('CampoDeValor — percentual (centésimos de ponto: 1550 = 15,50%)', () => {
  it('digita em percentual e entrega centésimos', async () => {
    const aoMudar = vi.fn();
    render(<Controlado tipo="percentual" aoMudar={aoMudar} />);

    await userEvent.type(screen.getByLabelText('Alíquota'), '18,5');

    expect(aoMudar).toHaveBeenLastCalledWith(1_850);
  });

  it('formata com duas casas e mostra o sufixo %', async () => {
    render(<Controlado tipo="percentual" />);
    const campo = screen.getByLabelText('Alíquota');

    await userEvent.type(campo, '0,9');
    await userEvent.tab();

    expect(campo).toHaveValue('0,90');
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it.each(['101', '100,01', 'x'])('recusa %s com o erro de alíquota', async (digitado) => {
    render(<Controlado tipo="percentual" />);

    await userEvent.type(screen.getByLabelText('Alíquota'), digitado);
    await userEvent.tab();

    expect(await screen.findByText('Informe uma alíquota entre 0 e 100%')).toBeInTheDocument();
  });
});

describe('CampoDeValor — acessibilidade', () => {
  it('não tem violação de axe, com e sem erro', async () => {
    const { container, rerender } = render(<Controlado tipo="moeda" inicial={100} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<Controlado tipo="moeda" inicial={100} erro="Informe a base" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('readOnly exibe o valor sem permitir edição e explica o motivo', () => {
    render(
      <CampoDeValor
        rotulo="Alíquota"
        tipo="percentual"
        valor={1_800}
        onValorChange={() => undefined}
        somenteLeitura
        ajuda="Versão publicada não é editada."
      />,
    );

    const campo = screen.getByLabelText('Alíquota');
    expect(campo).toHaveAttribute('readonly');
    expect(campo).toHaveValue('18,00');
    expect(campo).toHaveAccessibleDescription('Versão publicada não é editada.');
  });
});
