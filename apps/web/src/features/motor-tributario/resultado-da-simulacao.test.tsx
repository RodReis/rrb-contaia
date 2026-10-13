import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';

import { simulacao } from './motor-tributario.fixtures';
import { ResultadoDaSimulacao } from './resultado-da-simulacao';

describe('ResultadoDaSimulacao — memória de cálculo determinística (SPEC-016 §3.4–3.5)', () => {
  it('destaca o resultado em reais e diz o arredondamento aplicado', () => {
    render(<ResultadoDaSimulacao resultado={simulacao()} />);

    expect(screen.getByRole('heading', { name: 'Memória de cálculo determinística' })).toBeInTheDocument();
    expect(screen.getByText('R$ 12,00')).toBeInTheDocument();
    expect(screen.getByText(/arredondamento: meio para cima/iu)).toBeInTheDocument();
  });

  it('identifica a regra, a versão e a vigência que o cálculo usou', () => {
    render(<ResultadoDaSimulacao resultado={simulacao()} />);

    const regra = screen.getByText('Regra e versão', { selector: 'dt' }).nextElementSibling as HTMLElement;
    expect(regra).toHaveTextContent('ICMS · Lucro Presumido · Venda de mercadoria');
    expect(regra).toHaveTextContent('versão 1');
    expect(screen.getByText('Vigência da regra', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      'A partir de 01/01/2026, sem data final',
    );
  });

  it('expõe cada etapa: base, redução, base reduzida, alíquota, valor antes do arredondamento', () => {
    render(<ResultadoDaSimulacao resultado={simulacao()} />);

    const valor = (rotulo: string): HTMLElement => screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling as HTMLElement;

    expect(valor('Data do fato gerador')).toHaveTextContent('15/06/2026');
    expect(valor('Base de cálculo')).toHaveTextContent('R$ 100,00');
    expect(valor('Redução de base')).toHaveTextContent('33,33%');
    expect(valor('Base após a redução')).toHaveTextContent('6.667 centavos');
    expect(valor('Alíquota')).toHaveTextContent('18,00%');
    expect(valor('Valor antes do arredondamento')).toHaveTextContent('1.200,06 centavos');
    expect(valor('Valor antes do arredondamento')).toHaveTextContent('60003/50');
    expect(valor('Arredondamento')).toHaveTextContent('Meio para cima');
  });

  it('sem redução de base, diz que não houve em vez de omitir a etapa', () => {
    render(
      <ResultadoDaSimulacao
        resultado={simulacao({ baseReductionBasisPoints: 0, reducedBase: { numerator: '10000', denominator: '1' } })}
      />,
    );

    expect(screen.getByText('Redução de base', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Sem redução');
  });

  it('marca o dado como fixture não oficial, com a fonte, e não só por cor', () => {
    render(<ResultadoDaSimulacao resultado={simulacao()} />);

    const aviso = screen.getByRole('note');
    expect(within(aviso).getByText('Dado de teste não oficial')).toBeInTheDocument();
    expect(aviso).toHaveTextContent('Fixture de teste não oficial');
    expect(aviso).toHaveTextContent('não orienta');
  });

  it('valores monetários e identificadores usam mono e algarismos tabulares', () => {
    render(<ResultadoDaSimulacao resultado={simulacao()} />);

    expect(screen.getByText('R$ 12,00').className).toMatch(/font-mono/u);
    expect(screen.getByText('R$ 12,00').className).toMatch(/tabular-nums/u);
  });

  it('o resultado é exato no maior inteiro seguro', () => {
    render(
      <ResultadoDaSimulacao
        resultado={simulacao({
          baseCents: Number.MAX_SAFE_INTEGER,
          baseReductionBasisPoints: 0,
          rateBasisPoints: 3_333,
          reducedBase: { numerator: '9007199254740991', denominator: '1' },
          unrounded: { numerator: '30020995116051723003', denominator: '10000' },
          resultCents: 3_002_099_511_605_172,
        })}
      />,
    );

    expect(screen.getByText('R$ 30.020.995.116.051,72')).toBeInTheDocument();
    expect(screen.getByText('Valor antes do arredondamento', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '3.002.099.511.605.172,3003 centavos',
    );
  });

  it('não tem violação de axe', async () => {
    const { container } = render(<ResultadoDaSimulacao resultado={simulacao()} />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
