import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormularioManual } from './formulario-manual';
import { Envolvido, instalarFetch, json, problema, simulacao } from './motor-tributario.fixtures';

const URL_MANUAL = '/api/proxy/tax-simulations/manual';

afterEach(() => {
  vi.unstubAllGlobals();
});

const escolher = async (rotulo: string, opcao: string): Promise<void> => {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(rotulo, 'u') }));
  await userEvent.click(await screen.findByRole('option', { name: opcao }));
};

const preencher = async (): Promise<void> => {
  await userEvent.type(screen.getByLabelText(/Data do fato gerador/u), '2026-06-15');
  await escolher('Regime', 'Lucro Presumido');
  await escolher('Tributo', 'ICMS');
  await escolher('Tipo de operação', 'Venda de mercadoria');
  await userEvent.type(screen.getByLabelText(/Base de cálculo/u), '100');
};

const corpoEnviado = (chamadas: ReadonlyArray<readonly [string, RequestInit | undefined]>): unknown => {
  const chamada = chamadas.find(([url]) => url === URL_MANUAL);

  return JSON.parse(String(chamada?.[1]?.body));
};

const montar = (roteador: Parameters<typeof instalarFetch>[0]) => {
  const chamadas: Array<readonly [string, RequestInit | undefined]> = [];
  instalarFetch((url, init) => {
    chamadas.push([url, init]);

    return roteador(url, init);
  });
  render(<FormularioManual />, { wrapper: Envolvido });

  return chamadas;
};

describe('FormularioManual — simulador independente de empresa e competência (SPEC-016 §3.5)', () => {
  it('pede data do fato, regime, tributo, operação e base, e o botão nunca fica desabilitado por validação', () => {
    montar(() => undefined);

    for (const rotulo of [/Data do fato gerador/u, /Base de cálculo/u]) {
      expect(screen.getByLabelText(rotulo)).toBeInTheDocument();
    }
    for (const rotulo of ['Regime', 'Tributo', 'Tipo de operação']) {
      expect(screen.getByRole('combobox', { name: new RegExp(rotulo, 'u') })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Simular' })).toBeEnabled();
  });

  it('envio vazio mostra o erro em cada campo, leva o foco ao primeiro e não chama a API', async () => {
    const chamadas = montar(() => undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    // Mais de três erros: a mensagem aparece no campo e no resumo acessível acima do formulário.
    expect(await screen.findByText('5 campos precisam de correção')).toBeInTheDocument();
    expect(screen.getByLabelText(/Data do fato gerador/u)).toHaveAccessibleDescription('Informe a data do fato gerador');
    expect(screen.getByRole('combobox', { name: /Regime/u })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: /Tributo/u })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: /Tipo de operação/u })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Base de cálculo/u)).toHaveAccessibleDescription('Informe a base de cálculo');
    await waitFor(() => expect(screen.getByLabelText(/Data do fato gerador/u)).toHaveFocus());
    expect(chamadas).toHaveLength(0);
  });

  it('envia o corpo exato do contrato, com a base em centavos inteiros', async () => {
    const chamadas = montar((url) => (url === URL_MANUAL ? json(simulacao()) : undefined));

    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    expect(await screen.findByRole('heading', { name: 'Memória de cálculo determinística' })).toBeInTheDocument();
    expect(corpoEnviado(chamadas)).toEqual({
      factDate: '2026-06-15',
      regime: 'LUCRO_PRESUMIDO',
      taxType: 'ICMS',
      operationType: 'VENDA_MERCADORIA',
      baseCents: 10_000,
    });
    expect(screen.getByText('R$ 12,00')).toBeInTheDocument();
  });

  it('o clique duplo não envia duas simulações', async () => {
    let liberar: (resposta: Response) => void = () => undefined;
    const chamadas = montar(
      (url) =>
        url === URL_MANUAL
          ? new Promise<Response>((resolver) => {
              liberar = resolver;
            })
          : undefined,
    );

    await preencher();
    const botao = screen.getByRole('button', { name: 'Simular' });
    await userEvent.dblClick(botao);

    expect(chamadas.filter(([url]) => url === URL_MANUAL)).toHaveLength(1);
    expect(botao).toBeDisabled();
    liberar(json(simulacao()));
    await screen.findByText('R$ 12,00');
    expect(botao).toBeEnabled();
  });

  it('sem regra vigente, explica de forma persistente e não mostra resultado improvisado', async () => {
    montar(() => problema(422, 'TAX_RULE_NOT_APPLICABLE', {}, 'corr-sem-regra'));

    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    const painel = await screen.findByRole('status');
    expect(painel).toHaveTextContent('Nenhuma regra publicada vigora');
    expect(painel).toHaveTextContent('Nenhum cálculo foi improvisado');
    expect(painel).toHaveTextContent('corr-sem-regra');
    expect(screen.queryByRole('heading', { name: 'Memória de cálculo determinística' })).not.toBeInTheDocument();
  });

  it('duas regras vigentes viram erro de integridade com o código de suporte', async () => {
    montar(() => problema(500, 'TAX_RULE_AMBIGUOUS', {}, 'corr-ambigua'));

    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    const alerta = await screen.findByRole('alert', { name: '' });
    expect(alerta).toHaveTextContent('mais de uma regra publicada');
    expect(alerta).toHaveTextContent('corr-ambigua');
  });

  it('uma nova simulação bem-sucedida troca o erro anterior pelo resultado', async () => {
    let tentativa = 0;
    montar((url) => {
      if (url !== URL_MANUAL) {
        return undefined;
      }
      tentativa += 1;

      return tentativa === 1 ? problema(422, 'TAX_RULE_NOT_APPLICABLE') : json(simulacao());
    });

    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    expect(await screen.findByRole('heading', { name: 'Memória de cálculo determinística' })).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum cálculo foi improvisado/u)).not.toBeInTheDocument();
  });

  it('não tem violação de axe, vazio e com erros', async () => {
    montar(() => undefined);
    const { container } = { container: document.body };

    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));
    await screen.findByText('5 campos precisam de correção');
    expect(await axe(container)).toHaveNoViolations();
  });
});
