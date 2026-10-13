import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NfeSimulationDto } from '@contaia/shared';

import { FormularioNfe } from './formulario-nfe';
import { Envolvido, extracao, instalarFetch, json, problema, resultadoDaNfe } from './motor-tributario.fixtures';

const URL_NFE = '/api/proxy/tax-simulations/nfe';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Envio = Readonly<{ arquivo: File; complemento: unknown }>;

const montar = (responder: (envio: Envio) => Response | Promise<Response>) => {
  const envios: Envio[] = [];
  instalarFetch((url, init) => {
    if (url !== URL_NFE) {
      return undefined;
    }
    const formulario = init?.body as FormData;
    const complemento = formulario.get('complemento');
    const envio = { arquivo: formulario.get('arquivo') as File, complemento: complemento === null ? null : JSON.parse(String(complemento)) };
    envios.push(envio);

    return responder(envio);
  });
  // Na página o conteúdo fica dentro do `<main>` do shell; sem ele a regra `region` do axe reprovaria o teste.
  render(
    <main>
      <FormularioNfe />
    </main>,
    { wrapper: Envolvido },
  );

  return envios;
};

const xml = (nome = 'nfe-de-teste.xml'): File => new File(['<NFe/>'], nome, { type: 'text/xml' });

const enviarArquivo = async (arquivo = xml()): Promise<void> => {
  await userEvent.upload(screen.getByLabelText('Arquivo XML da NF-e'), arquivo);
};

const escolher = async (rotulo: string, opcao: string): Promise<void> => {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(rotulo, 'u') }));
  await userEvent.click(await screen.findByRole('option', { name: opcao }));
};

const analise = (sobrescritas: Partial<NfeSimulationDto> = {}): NfeSimulationDto => ({
  extraction: extracao(),
  complementsRequired: [{ field: 'operationType', reason: 'NOT_IN_XML' }],
  result: null,
  ...sobrescritas,
});

const completa = (): NfeSimulationDto => ({ extraction: extracao(), complementsRequired: [], result: resultadoDaNfe() });

describe('FormularioNfe — análise, complemento e simulação (SPEC-016 §3.6)', () => {
  it('começa só com a zona de envio, sem pedir nada ao servidor', () => {
    const envios = montar(() => json(analise()));

    expect(screen.getByLabelText('Arquivo XML da NF-e')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simular NF-e' })).not.toBeInTheDocument();
    expect(envios).toHaveLength(0);
  });

  it('ao escolher o arquivo, analisa sem complemento e mostra o que foi extraído', async () => {
    const envios = montar(() => json(analise()));

    await enviarArquivo();

    const resumo = await screen.findByRole('region', { name: 'O que a NF-e informa' });
    expect(envios).toHaveLength(1);
    expect(envios[0]?.complemento).toBeNull();
    expect(within(resumo).getByText('15/06/2026')).toBeInTheDocument();
    expect(within(resumo).getByText('Simples Nacional')).toBeInTheDocument();
    expect(within(resumo).getByText(/2 itens/u)).toBeInTheDocument();
    expect(within(resumo).getByText(/NT 2025\.002 v1\.50/u)).toBeInTheDocument();
  });

  it('com a análise em andamento, mostra o estado de carregamento e não deixa simular', async () => {
    let liberar: (resposta: Response) => void = () => undefined;
    montar(() => new Promise<Response>((resolver) => void (liberar = resolver)));

    await enviarArquivo();

    expect(await screen.findByText('Analisando a NF-e…')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toBeInTheDocument();
    liberar(json(analise()));
    expect(await screen.findByRole('region', { name: 'O que a NF-e informa' })).toBeInTheDocument();
  });

  it('pede só o tipo de operação quando o XML já traz regime e bases', async () => {
    montar(() => json(analise()));

    await enviarArquivo();
    await screen.findByRole('region', { name: 'O que a NF-e informa' });

    expect(screen.getByRole('combobox', { name: /Tipo de operação/u })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Regime/u })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Base de cálculo do item/u)).not.toBeInTheDocument();
  });

  it('simula com o complemento e mostra o cálculo por item, reenviando o mesmo arquivo', async () => {
    const envios = montar(({ complemento }) => json(complemento === null ? analise() : completa()));
    const arquivo = xml();

    await enviarArquivo(arquivo);
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    await escolher('Tipo de operação', 'Venda de mercadoria');
    await userEvent.click(screen.getByRole('button', { name: 'Simular NF-e' }));

    expect(await screen.findByRole('table', { name: 'Cálculo por item da NF-e' })).toBeInTheDocument();
    expect(envios).toHaveLength(2);
    expect(envios[1]?.complemento).toEqual({ operationType: 'VENDA_MERCADORIA' });
    expect(envios[1]?.arquivo).toBe(arquivo);
    // Divergência do item 2 (CBS) e do total de CBS.
    expect(screen.getAllByText('Divergente')).toHaveLength(2);
  });

  it('pede regime e bases dos itens quando o XML não os traz, e envia só o que foi pedido', async () => {
    const pendente = analise({
      extraction: extracao({
        regime: null,
        declaredTotals: null,
        items: [
          { number: 1, productCents: 25_000, ibsCbs: null },
          { number: 2, productCents: 1_000, ibsCbs: null },
        ],
      }),
      complementsRequired: [
        { field: 'operationType', reason: 'NOT_IN_XML' },
        { field: 'regime', reason: 'AMBIGUOUS_IN_XML' },
        { field: 'itemBases.1', reason: 'NOT_IN_XML' },
        { field: 'itemBases.2', reason: 'NOT_IN_XML' },
      ],
    });
    const envios = montar(({ complemento }) => json(complemento === null ? pendente : completa()));

    await enviarArquivo();
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    expect(screen.getByText(/regime não mapeável/iu)).toBeInTheDocument();
    await escolher('Tipo de operação', 'Venda de mercadoria');
    await escolher('Regime', 'Lucro Presumido');
    await userEvent.type(screen.getByLabelText(/Base de cálculo do item 1/u), '250');
    await userEvent.type(screen.getByLabelText(/Base de cálculo do item 2/u), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Simular NF-e' }));

    await screen.findByRole('table', { name: 'Cálculo por item da NF-e' });
    expect(envios[1]?.complemento).toEqual({
      operationType: 'VENDA_MERCADORIA',
      regime: 'LUCRO_PRESUMIDO',
      itemBases: { '1': 25_000, '2': 1_000 },
    });
  });

  it('envio sem o complemento mostra o erro nos campos, leva o foco ao primeiro e não chama a API', async () => {
    const envios = montar(() => json(analise()));

    await enviarArquivo();
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    await userEvent.click(screen.getByRole('button', { name: 'Simular NF-e' }));

    expect(await screen.findByText('Selecione o tipo de operação')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Tipo de operação/u })).toHaveFocus());
    expect(envios).toHaveLength(1);
  });

  it.each([
    ['NFE_XML_INVALID', 'Não foi possível ler este arquivo como XML de NF-e'],
    ['NFE_LAYOUT_UNSUPPORTED', 'não é uma NF-e do leiaute aceito'],
    ['NFE_REQUIRED_DATA_MISSING', 'não traz um dado mínimo'],
  ])('%s na análise vira estado persistente com o código de suporte', async (codigo, trecho) => {
    montar(() => problema(422, codigo, {}, 'corr-nfe-0001'));

    await enviarArquivo();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(trecho);
    expect(alerta).toHaveTextContent('corr-nfe-0001');
    expect(screen.queryByRole('button', { name: 'Simular NF-e' })).not.toBeInTheDocument();
    // O arquivo continua trocável para tentar de novo.
    expect(screen.getByRole('button', { name: 'Trocar arquivo' })).toBeInTheDocument();
  });

  it('sem regra para um tributo, diz o item e o tributo, sem resultado parcial', async () => {
    montar(({ complemento }) =>
      complemento === null ? json(analise()) : problema(422, 'TAX_RULE_NOT_APPLICABLE', { detalhes: { item: 1, taxType: 'CBS' } }, 'corr-sem-regra'),
    );

    await enviarArquivo();
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    await escolher('Tipo de operação', 'Venda de mercadoria');
    await userEvent.click(screen.getByRole('button', { name: 'Simular NF-e' }));

    const painel = await screen.findByRole('status', { name: '' });
    expect(painel).toHaveTextContent('Item 1 da NF-e, tributo CBS');
    expect(screen.queryByRole('table', { name: 'Cálculo por item da NF-e' })).not.toBeInTheDocument();
  });

  it('arquivo que não é .xml é recusado no campo, sem chamar a API', async () => {
    const envios = montar(() => json(analise()));

    await userEvent.upload(screen.getByLabelText('Arquivo XML da NF-e'), new File(['x'], 'nota.pdf'), { applyAccept: false });

    expect(await screen.findByText('O arquivo precisa ser um XML de NF-e (.xml).')).toBeInTheDocument();
    expect(envios).toHaveLength(0);
  });

  it('remover o arquivo descarta a análise e o resultado', async () => {
    montar(({ complemento }) => json(complemento === null ? analise() : completa()));

    await enviarArquivo();
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));

    expect(screen.queryByRole('region', { name: 'O que a NF-e informa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simular NF-e' })).not.toBeInTheDocument();
  });

  it('trocar o arquivo reinicia a análise com o novo documento', async () => {
    const envios = montar(() => json(analise()));

    await enviarArquivo(xml('primeira.xml'));
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    await enviarArquivo(xml('segunda.xml'));

    await waitFor(() => expect(envios).toHaveLength(2));
    expect(envios[1]?.arquivo.name).toBe('segunda.xml');
  });

  it('não tem violação de axe, na análise e no resultado', async () => {
    montar(({ complemento }) => json(complemento === null ? analise() : completa()));
    const { container } = { container: document.body };

    expect(await axe(container)).toHaveNoViolations();
    await enviarArquivo();
    await screen.findByRole('region', { name: 'O que a NF-e informa' });
    expect(await axe(container)).toHaveNoViolations();

    await escolher('Tipo de operação', 'Venda de mercadoria');
    await userEvent.click(screen.getByRole('button', { name: 'Simular NF-e' }));
    await screen.findByRole('table', { name: 'Cálculo por item da NF-e' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
