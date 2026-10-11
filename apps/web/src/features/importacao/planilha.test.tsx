/**
 * Estados da importação por planilha (SPEC-015 §5.3) nos dois domínios: formatos e modelos junto ao
 * envio, leitura, aba única ou várias, aba sem dados, cabeçalho sugerido/alterado/inválido/mesclado,
 * linhas ocultas, recusas do arquivo, serviço ocupado, mapeamento por letra, envio com a
 * configuração, e prévia/histórico/resultado com os diagnósticos. O CSV continua como era.
 *
 * A API é dublada no `fetch` (problem+json nas recusas); a URL é dublada com estado.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaEmpregados } from '../empregados/aba-empregados';
import * as fixturesDeEmpregados from '../empregados/empregados.fixtures';
import { AbaPlanoDeContas } from '../plano-contas/aba-plano-de-contas';
import * as fixturesDoPlano from '../plano-contas/plano-contas.fixtures';
import {
  Envolvido,
  desinstalarDownloads,
  instalarDownloads,
  instalarFetch,
  json,
  navegacao,
  problema,
  type Roteador,
} from '../plano-contas/plano-contas.fixtures';
import {
  inspecaoDublada,
  ocupado,
  pedidoDeInspecao,
  planilha,
  responderInspecao,
  type AbaDublada,
} from './planilha.fixtures';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('../plano-contas/plano-contas.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

type Backend = Readonly<{ estado: { tentativa: unknown; historico: unknown[] }; roteador: Roteador }>;

type CasoDeDominio = Readonly<{
  nome: string;
  aba: string;
  base: string;
  tentativa: string;
  campos: readonly string[];
  rotulos: readonly string[];
  rotuloDoCsv: string;
  rotuloDaPlanilha: string;
  criarBackend: () => Backend;
  previa: (sobrescritas: Record<string, unknown>) => unknown;
  rejeicao: (sobrescritas: Record<string, unknown>) => unknown;
  tentativaDoHistorico: (sobrescritas: Record<string, unknown>) => unknown;
  csv: () => File;
  renderizar: () => ReturnType<typeof render>;
}>;

const embrulhar = (no: ReactNode) => render(no, { wrapper: Envolvido });

const DOMINIOS: readonly CasoDeDominio[] = [
  {
    nome: 'plano de contas',
    aba: 'plano-contas',
    base: fixturesDoPlano.BASE,
    tentativa: fixturesDoPlano.TENTATIVA,
    campos: ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'],
    rotulos: ['Código', 'Nome', 'Tipo', 'Natureza', 'Conta-pai'],
    rotuloDoCsv: 'Arquivo CSV do plano de contas',
    rotuloDaPlanilha: 'Planilha XLSX ou ODS do plano de contas',
    criarBackend: fixturesDoPlano.criarBackend as () => Backend,
    previa: (sobrescritas) => fixturesDoPlano.previa(sobrescritas),
    rejeicao: (sobrescritas) => fixturesDoPlano.rejeicao(sobrescritas),
    tentativaDoHistorico: (sobrescritas) => fixturesDoPlano.tentativaDoHistorico(sobrescritas),
    csv: () => fixturesDoPlano.csvDoModelo(),
    renderizar: () => embrulhar(<AbaPlanoDeContas empresaId="empresa-1" somenteLeitura={false} />),
  },
  {
    nome: 'empregados',
    aba: 'empregados',
    base: fixturesDeEmpregados.BASE,
    tentativa: fixturesDeEmpregados.TENTATIVA,
    campos: ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'],
    rotulos: ['CPF', 'Nome completo', 'Matrícula', 'Data de nascimento', 'Data de admissão'],
    rotuloDoCsv: 'Arquivo CSV dos empregados',
    rotuloDaPlanilha: 'Planilha XLSX ou ODS dos empregados',
    criarBackend: fixturesDeEmpregados.criarBackend as () => Backend,
    previa: (sobrescritas) => fixturesDeEmpregados.previa(sobrescritas),
    rejeicao: (sobrescritas) => fixturesDeEmpregados.rejeicao(sobrescritas),
    tentativaDoHistorico: (sobrescritas) => fixturesDeEmpregados.tentativaDoHistorico(sobrescritas),
    csv: () => fixturesDeEmpregados.csvDoModelo(),
    renderizar: () =>
      embrulhar(<AbaEmpregados empresaId="empresa-1" nomeDaEmpresa="Padaria Aurora" somenteLeitura={false} />),
  },
];

type Responder = (init: RequestInit | undefined) => Response | Promise<Response>;

describe.each(DOMINIOS)('planilha — $nome', (dominio) => {
  let backend: Backend;
  let inspecionar: Responder;
  let baixarModelo: (url: string) => Response;

  const chamadas = (trecho: string): readonly (RequestInit | undefined)[] =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes(trecho))
      .map(([, init]) => init);

  const inspecoes = () => chamadas('/planilhas/inspecao').map(pedidoDeInspecao);
  const envios = () => chamadas('/importacoes').filter((init) => init?.method === 'POST' && init.body instanceof FormData);

  const escolherPlanilha = async (usuario: ReturnType<typeof userEvent.setup>, arquivo = planilha('legado.xlsx')) => {
    await usuario.upload(await screen.findByLabelText(dominio.rotuloDaPlanilha), arquivo);
  };

  const combobox = (rotulo: string): HTMLElement => screen.getByRole('combobox', { name: new RegExp(`^${rotulo}`, 'u') });

  const radioDaLinha = (numero: number): HTMLElement => screen.getByRole('radio', { name: `Linha ${numero} como cabeçalho` });

  beforeEach(() => {
    vi.clearAllMocks();
    navegacao.definir(`aba=${dominio.aba}`);
    backend = dominio.criarBackend();
    inspecionar = responderInspecao(dominio.campos);
    baixarModelo = () =>
      new Response('PK', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="modelo.xlsx"' },
      });
    instalarFetch((url, init) => {
      if (url.startsWith(`${dominio.base}/planilhas/inspecao`)) {
        return inspecionar(init);
      }
      if (url.startsWith(`${dominio.base}/modelo?formato=`)) {
        return baixarModelo(url);
      }

      return backend.roteador(url, init);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    desinstalarDownloads();
  });

  describe('formatos e modelos junto ao envio', () => {
    it('diz os formatos aceitos e oferece os modelos CSV, XLSX e ODS do domínio', async () => {
      const { container } = dominio.renderizar();

      const modelos = await screen.findByRole('group', { name: /Modelos oficiais/u });
      expect(within(modelos).getByRole('button', { name: 'Baixar modelo CSV' })).toBeInTheDocument();
      expect(within(modelos).getByRole('button', { name: 'Baixar modelo XLSX' })).toBeInTheDocument();
      expect(within(modelos).getByRole('button', { name: 'Baixar modelo ODS' })).toBeInTheDocument();
      expect(screen.getByText(/Formatos aceitos/u).closest('p')).toHaveTextContent(/\.csv.*\.xlsx.*\.ods/u);
      expect(screen.getByRole('button', { name: 'Escolher planilha XLSX ou ODS' })).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/\.xls\b(?!x)|\.xlsm|macro/u);
      expect(await axe(container)).toHaveNoViolations();
    });

    it.each([
      ['XLSX', 'xlsx'],
      ['ODS', 'ods'],
    ])('baixa o modelo %s do domínio atual pela API', async (rotulo, formato) => {
      const downloads = instalarDownloads();
      const usuario = userEvent.setup();
      dominio.renderizar();

      await usuario.click(await screen.findByRole('button', { name: `Baixar modelo ${rotulo}` }));

      await waitFor(() => expect(downloads.criar).toHaveBeenCalled());
      expect(chamadas('/modelo?formato=').map((init) => init?.method ?? 'GET')).toEqual(['GET']);
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === `${dominio.base}/modelo?formato=${formato}`)).toBe(true);
    });
  });

  describe('arquivo recusado antes do envio', () => {
    it.each([
      ['.xls', 'legado.xls', 'O formato .xls (Excel 97-2003) não é aceito'],
      ['.xlsm', 'legado.xlsm', 'Planilhas com macro (.xlsm) não são aceitas'],
      ['.pdf', 'legado.pdf', 'Formato não aceito. Envie .csv, .xlsx, .ods.'],
      ['acima de 10 MB', 'grande.xlsx', 'Arquivo acima do limite de 10 MB.'],
    ])('%s: diz o motivo e não lê nem envia nada', async (_caso, nome, motivo) => {
      const usuario = userEvent.setup({ applyAccept: false });
      dominio.renderizar();

      const arquivo = nome === 'grande.xlsx' ? planilha(nome, 10 * 1024 * 1024 + 1) : planilha(nome);
      await usuario.upload(await screen.findByLabelText(dominio.rotuloDaPlanilha), arquivo);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(`Arquivo recusado antes do envio: ${nome}`);
      expect(alerta).toHaveTextContent(motivo);
      expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });
  });

  describe('leitura da planilha', () => {
    it('XLSX selecionado: lendo a planilha, anunciado uma vez, sem mapeamento ainda', async () => {
      inspecionar = () => new Promise<Response>(() => undefined);
      const usuario = userEvent.setup();
      const { container } = dominio.renderizar();

      await escolherPlanilha(usuario);

      const status = await screen.findByRole('status', { name: '' });
      await waitFor(() => expect(screen.getByText('Lendo a planilha')).toBeInTheDocument());
      expect(status).toHaveTextContent(/Lendo a planilha/u);
      expect(screen.getByText('legado.xlsx')).toBeInTheDocument();
      expect(screen.getByText('XLSX')).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(inspecoes()).toHaveLength(1);
      expect(inspecoes()[0]).toMatchObject({ aba: undefined, linhaCabecalho: undefined });
      expect(inspecoes()[0]?.arquivo?.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(await axe(container)).toHaveNoViolations();
    });

    it('ODS segue o mesmo caminho, com o tipo do formato', async () => {
      const usuario = userEvent.setup();
      dominio.renderizar();

      await escolherPlanilha(usuario, planilha('legado.ods'));

      expect(await screen.findByText(/Aba única/u)).toBeInTheDocument();
      expect(inspecoes()[0]?.arquivo?.type).toBe('application/vnd.oasis.opendocument.spreadsheet');
    });

    it('uma aba utilizável: escolhida sozinha, com nome e posição; cabeçalho sugerido; ocultas sinalizadas', async () => {
      const usuario = userEvent.setup();
      const { container } = dominio.renderizar();

      await escolherPlanilha(usuario);

      expect(await screen.findByText('Aba única: Plano (posição 1)')).toBeInTheDocument();
      expect(screen.getByText(/Cabeçalho sugerido: linha 1/u)).toBeInTheDocument();
      expect(radioDaLinha(1)).toBeChecked();
      expect(screen.getByText('0 linhas anteriores ignoradas · 1 linha oculta processada')).toBeInTheDocument();
      const tabela = screen.getByRole('table', { name: /Primeiras linhas da aba Plano/u });
      expect(within(tabela).getByRole('rowheader', { name: /^4/u })).toHaveTextContent(/oculta/u);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('várias abas: nenhuma escolhida em silêncio; a escolha libera o cabeçalho', async () => {
      const abas: AbaDublada[] = [
        { nome: 'Resumo', posicao: 1, utilizavel: true },
        { nome: 'Plano', posicao: 2, utilizavel: true },
        { nome: 'Vazia', posicao: 3, utilizavel: false },
      ];
      inspecionar = responderInspecao(dominio.campos, abas);
      const usuario = userEvent.setup();
      const { container } = dominio.renderizar();

      await escolherPlanilha(usuario);

      const seletor = await screen.findByRole('combobox', { name: /Aba da planilha/u });
      expect(seletor).toHaveTextContent('Escolha a aba');
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Validar arquivo/u })).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      seletor.focus();
      await usuario.keyboard('{Enter}');
      expect(await screen.findByRole('option', { name: 'Vazia (posição 3) — sem dados' })).toBeInTheDocument();
      await usuario.click(screen.getByRole('option', { name: 'Plano (posição 2)' }));

      expect(await screen.findByRole('radio', { name: 'Linha 1 como cabeçalho' })).toBeChecked();
      expect(inspecoes().at(-1)).toMatchObject({ aba: 2, linhaCabecalho: undefined });
    });

    it('aba sem dados: não avança e deixa escolher outra', async () => {
      const abas: AbaDublada[] = [
        { nome: 'Resumo', posicao: 1, utilizavel: true },
        { nome: 'Plano', posicao: 2, utilizavel: true },
      ];
      inspecionar = (init) =>
        pedidoDeInspecao(init).aba === 1 ? problema(422, 'ABA_SEM_DADOS') : responderInspecao(dominio.campos, abas)(init);
      const usuario = userEvent.setup();
      dominio.renderizar();

      await escolherPlanilha(usuario);
      const seletor = await screen.findByRole('combobox', { name: /Aba da planilha/u });
      seletor.focus();
      await usuario.keyboard('{Enter}');
      await usuario.click(await screen.findByRole('option', { name: 'Resumo (posição 1)' }));

      expect(await screen.findByText('A aba escolhida está vazia. Escolha outra aba.')).toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();

      combobox('Aba da planilha').focus();
      await usuario.keyboard('{Enter}');
      await usuario.click(await screen.findByRole('option', { name: 'Plano (posição 2)' }));

      expect(await screen.findByRole('radio', { name: 'Linha 1 como cabeçalho' })).toBeInTheDocument();
      expect(screen.queryByText('A aba escolhida está vazia. Escolha outra aba.')).not.toBeInTheDocument();
    });
  });

  describe('linha de cabeçalho', () => {
    it('alterada pelo teclado: relê, mostra a alteração e rotula as colunas por letra', async () => {
      const usuario = userEvent.setup();
      dominio.renderizar();
      await escolherPlanilha(usuario);
      await screen.findByText('Aba única: Plano (posição 1)');

      radioDaLinha(1).focus();
      await usuario.keyboard('{ArrowDown}');

      expect(radioDaLinha(2)).toBeChecked();
      expect(await screen.findByText(/Cabeçalho alterado: linha 2 \(sugerida: linha 1\)/u)).toBeInTheDocument();
      expect(await screen.findByText('1 linha anterior ignorada · 1 linha oculta processada')).toBeInTheDocument();
      expect(inspecoes().at(-1)).toMatchObject({ aba: 1, linhaCabecalho: 2 });

      const primeiro = combobox(dominio.rotulos[0] ?? '');
      expect(primeiro).toHaveTextContent(`Coluna A — ${dominio.campos[0] ?? ''}`);
      primeiro.focus();
      await usuario.keyboard('{Enter}');
      expect(await screen.findByRole('option', { name: 'Coluna G (sem nome)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Coluna F — Obs' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Coluna H — Obs' })).toBeInTheDocument();
      await usuario.keyboard('{Escape}');

      await usuario.click(screen.getByRole('button', { name: 'Voltar à linha sugerida' }));
      expect(radioDaLinha(1)).toBeChecked();
      expect(await screen.findByText(/Cabeçalho sugerido: linha 1/u)).toBeInTheDocument();
    });

    it('cabeçalho mesclado bloqueia o mapeamento com orientação, até escolher outra linha', async () => {
      inspecionar = (init) => {
        const pedido = pedidoDeInspecao(init);

        return json(
          inspecaoDublada(dominio.campos, {
            aba: pedido.aba,
            linhaCabecalho: pedido.linhaCabecalho,
            sobrescritas: pedido.linhaCabecalho === 2 ? {} : { cabecalhoMesclado: true },
          }),
        );
      };
      const usuario = userEvent.setup();
      const { container } = dominio.renderizar();
      await escolherPlanilha(usuario);

      const alerta = await screen.findByText(/A linha de cabeçalho tem células mescladas/u);
      expect(alerta.closest('[role="alert"]')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Validar arquivo/u })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      await usuario.click(radioDaLinha(2));

      expect(await screen.findByRole('button', { name: /Validar arquivo/u })).toBeInTheDocument();
      expect(screen.queryByText(/A linha de cabeçalho tem células mescladas/u)).not.toBeInTheDocument();
    });

    it('cabeçalho inválido: diz o que fazer e não abre o mapeamento', async () => {
      inspecionar = (init) =>
        pedidoDeInspecao(init).linhaCabecalho === 3
          ? problema(422, 'CABECALHO_INVALIDO')
          : responderInspecao(dominio.campos)(init);
      const usuario = userEvent.setup();
      dominio.renderizar();
      await escolherPlanilha(usuario);
      await screen.findByText('Aba única: Plano (posição 1)');

      await usuario.click(radioDaLinha(3));

      expect(await screen.findByText(/A linha 3 não tem nomes de coluna utilizáveis/u)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Validar arquivo/u })).not.toBeInTheDocument();
    });

    it('trocar o cabeçalho descarta o mapeamento feito e a recusa do envio anterior', async () => {
      backend.estado.tentativa = null;
      const usuario = userEvent.setup();
      dominio.renderizar();
      await escolherPlanilha(usuario);
      await screen.findByText('Aba única: Plano (posição 1)');
      await usuario.click(radioDaLinha(2));
      const primeiro = await screen.findByRole('combobox', { name: new RegExp(`^${dominio.rotulos[0] ?? ''}`, 'u') });

      primeiro.focus();
      await usuario.keyboard('{Enter}');
      await usuario.click(await screen.findByRole('option', { name: 'Coluna F — Obs' }));
      expect(combobox(dominio.rotulos[0] ?? '')).toHaveTextContent('Coluna F — Obs');

      await usuario.click(radioDaLinha(1));
      await usuario.click(radioDaLinha(2));

      await waitFor(() => expect(combobox(dominio.rotulos[0] ?? '')).toHaveTextContent(`Coluna A — ${dominio.campos[0] ?? ''}`));
    });
  });

  describe('envio', () => {
    it('envia o arquivo de novo com a aba, a linha do cabeçalho e o mapeamento por letra', async () => {
      const usuario = userEvent.setup();
      dominio.renderizar();
      await escolherPlanilha(usuario);
      await screen.findByText('Aba única: Plano (posição 1)');
      await usuario.click(radioDaLinha(2));

      await usuario.click(await screen.findByRole('button', { name: /Validar arquivo/u }));

      await waitFor(() => expect(envios()).toHaveLength(1));
      const corpo = envios()[0]?.body;
      expect(corpo).toBeInstanceOf(FormData);
      if (!(corpo instanceof FormData)) {
        return;
      }
      expect(corpo.get('aba')).toBe('1');
      expect(corpo.get('linhaCabecalho')).toBe('2');
      expect(JSON.parse(String(corpo.get('mapeamento')))).toEqual(
        Object.fromEntries(dominio.campos.map((campo, indice) => [campo, String.fromCharCode(65 + indice)])),
      );
      const arquivo = corpo.get('arquivo');
      expect(arquivo instanceof File ? arquivo.name : null).toBe('legado.xlsx');
      await waitFor(() => expect(navegacao.ler().get('tentativa')).not.toBeNull());
    });

    it('a recusa do envio diz o motivo e o código de suporte', async () => {
      const usuario = userEvent.setup();
      dominio.renderizar();
      await escolherPlanilha(usuario);
      await screen.findByText('Aba única: Plano (posição 1)');
      await usuario.click(radioDaLinha(2));
      instalarFetch((url, init) => {
        if (url.startsWith(`${dominio.base}/planilhas/inspecao`)) {
          return inspecionar(init);
        }
        if (url === `${dominio.base}/importacoes` && init?.method === 'POST') {
          return problema(422, 'CABECALHO_MESCLADO', {}, 'corr-envio-1');
        }

        return backend.roteador(url, init);
      });

      await usuario.click(await screen.findByRole('button', { name: /Validar arquivo/u }));

      const alerta = await screen.findByText('O arquivo não foi aceito para validação');
      expect(alerta.closest('[role="alert"]')).toHaveTextContent(/células mescladas/u);
      expect(alerta.closest('[role="alert"]')).toHaveTextContent('corr-envio-1');
    });
  });

  describe('planilha que não pode ser usada', () => {
    it.each([
      ['ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', 422, /protegido por senha ou criptografado/u],
      ['ARQUIVO_CORROMPIDO', 422, /parece corrompido/u],
      ['EXTENSAO_DIFERENTE_DO_CONTEUDO', 422, /não corresponde à extensão/u],
      ['FORMATO_XLS_NAO_SUPORTADO', 422, /\.xls \(Excel 97-2003\)/u],
      ['PLANILHA_SEM_ABA_UTILIZAVEL', 422, /nenhuma aba com dados utilizáveis/u],
      ['LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 422, /limite seguro de processamento/u],
      ['ARQUIVO_ACIMA_DO_LIMITE', 413, /10 MB ou de 10\.000 linhas/u],
    ])('%s: motivo acionável, código de suporte e troca de arquivo', async (codigo, status, motivo) => {
      inspecionar = () => problema(status, codigo, {}, 'corr-planilha-9');
      const usuario = userEvent.setup();
      const { container } = dominio.renderizar();

      await escolherPlanilha(usuario);

      const titulo = await screen.findByText('Esta planilha não pode ser usada');
      const painel = titulo.closest('[role="alert"]');
      expect(painel).toHaveTextContent(motivo);
      expect(painel).toHaveTextContent('corr-planilha-9');
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      await usuario.click(screen.getByRole('button', { name: 'Escolher outro arquivo' }));
      expect(await screen.findByRole('button', { name: 'Escolher planilha XLSX ou ODS' })).toBeInTheDocument();
    });

    it('serviço ocupado: espera o Retry-After e tenta de novo', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let tentativas = 0;
      inspecionar = (init) => {
        tentativas += 1;

        return tentativas === 1 ? ocupado(5) : responderInspecao(dominio.campos)(init);
      };
      const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      dominio.renderizar();

      await escolherPlanilha(usuario);

      expect(await screen.findByText(/serviço de leitura de planilhas está ocupado/u)).toBeInTheDocument();
      const tentar = screen.getByRole('button', { name: /Tentar de novo/u });
      expect(tentar).toBeDisabled();
      expect(screen.getByText(/em 5 segundos/u)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByRole('button', { name: /Tentar de novo/u })).toBeEnabled();
      await usuario.click(screen.getByRole('button', { name: /Tentar de novo/u }));

      expect(await screen.findByText('Aba única: Plano (posição 1)')).toBeInTheDocument();
      expect(tentativas).toBe(2);
    });
  });

  describe('nomes longos', () => {
    it('arquivo, aba e coluna longos ficam numa linha, com o nome inteiro no título', async () => {
      const longo = `${'Exportação mensal do sistema legado '.repeat(6)}.xlsx`;
      const abaLonga = 'Plano de contas consolidado da matriz e das filiais — revisão final 2026';
      inspecionar = (init) => {
        const pedido = pedidoDeInspecao(init);

        return json(
          inspecaoDublada(dominio.campos, {
            abas: [{ nome: abaLonga, posicao: 1, utilizavel: true }],
            aba: pedido.aba,
            linhaCabecalho: pedido.linhaCabecalho,
          }),
        );
      };
      const usuario = userEvent.setup();
      dominio.renderizar();

      await escolherPlanilha(usuario, planilha(longo));

      const nome = await screen.findByTitle(longo);
      expect(nome).toHaveClass('truncate');
      const aba = await screen.findByTitle(`Aba única: ${abaLonga} (posição 1)`);
      expect(aba).toHaveClass('truncate');
      const celula = screen.getByTitle('Relatório exportado do sistema legado');
      expect(celula).toHaveClass('truncate');
    });
  });

  describe('CSV sem mudança', () => {
    it('o CSV não passa pela inspeção nem leva aba e cabeçalho', async () => {
      const usuario = userEvent.setup();
      dominio.renderizar();

      await usuario.upload(await screen.findByLabelText(dominio.rotuloDoCsv), dominio.csv());
      await usuario.click(await screen.findByRole('button', { name: /Validar arquivo/u }));

      await waitFor(() => expect(envios()).toHaveLength(1));
      const corpo = envios()[0]?.body;
      expect(corpo instanceof FormData ? corpo.get('aba') : 'sem corpo').toBeNull();
      expect(corpo instanceof FormData ? corpo.get('linhaCabecalho') : 'sem corpo').toBeNull();
      expect(inspecoes()).toHaveLength(0);
      expect(screen.queryByText(/Aba única/u)).not.toBeInTheDocument();
    });

    it('arrastar uma planilha para a zona também abre a leitura', async () => {
      dominio.renderizar();

      const titulo = await screen.findByRole('button', { name: 'Escolher planilha XLSX ou ODS' });
      const zona = titulo.closest('[data-zona-de-envio]');
      expect(zona).not.toBeNull();
      if (zona === null) {
        return;
      }
      fireEvent.drop(zona, { dataTransfer: { files: [planilha('solta.ods')] } });

      expect(await screen.findByText('Aba única: Plano (posição 1)')).toBeInTheDocument();
    });
  });

  describe('prévia, resultado e histórico da planilha', () => {
    const DETALHES = {
      formato: 'XLSX',
      aba: { nome: 'Plano', posicao: 2 },
      linhaCabecalho: 3,
      linhasIgnoradasAntesDoCabecalho: 2,
      linhasOcultas: 1,
      diagnosticosDaPlanilha: [
        { codigo: 'LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', mensagem: 'x', quantidade: 2 },
        { codigo: 'LINHAS_OCULTAS_PROCESSADAS', mensagem: 'x', quantidade: 1 },
        { codigo: 'LINHAS_COM_FORMULA_REJEITADAS', mensagem: 'x', quantidade: 1 },
        { codigo: 'LINHAS_COM_CELULA_MESCLADA_REJEITADAS', mensagem: 'x', quantidade: 1 },
      ],
    } as const;

    const abrir = (sobrescritas: Record<string, unknown>): void => {
      backend.estado.tentativa = dominio.previa(sobrescritas);
      navegacao.definir(`aba=${dominio.aba}&tentativa=${dominio.tentativa}`);
    };

    it('prévia mostra formato, aba, cabeçalho, ignoradas, ocultas e rejeições por fórmula e mescla', async () => {
      const mapeamento = Object.fromEntries(dominio.campos.map((campo, indice) => [campo, String.fromCharCode(65 + indice)]));
      abrir({
        ...DETALHES,
        arquivo: { nome: 'legado.xlsx', tamanho: 4096, hash: 'c'.repeat(64) },
        mapeamento,
        totais: { lidas: 6, novas: 3, atualizadas: 1, rejeitadas: 2 },
        amostraRejeicoes: [
          dominio.rejeicao({
            numeroDaLinha: 7,
            campo: dominio.campos[1],
            codigoDeErro: 'CELULA_COM_FORMULA',
            mensagem: 'A célula desta coluna contém uma fórmula, e fórmulas não são executadas. Substitua a fórmula pelo valor e reenvie a planilha.',
          }),
          dominio.rejeicao({
            numeroDaLinha: 9,
            campo: dominio.campos[1],
            codigoDeErro: 'CELULA_MESCLADA',
            mensagem: null,
          }),
        ],
      });
      const { container } = dominio.renderizar();

      const planilhaDaPrevia = await screen.findByRole('group', { name: 'Planilha lida' });
      expect(planilhaDaPrevia).toHaveTextContent('XLSX');
      expect(planilhaDaPrevia).toHaveTextContent('Plano (posição 2)');
      expect(planilhaDaPrevia).toHaveTextContent('Linha 3');
      expect(planilhaDaPrevia).toHaveTextContent('2 linhas anteriores ignoradas · 1 linha oculta processada');
      expect(planilhaDaPrevia).toHaveTextContent('1 linha rejeitada por fórmula');
      expect(planilhaDaPrevia).toHaveTextContent('1 linha rejeitada por célula mesclada');
      expect(screen.getByText(`Coluna ${'A'}`, { selector: 'span' })).toBeInTheDocument();

      const tabela = screen.getByRole('table', { name: /Linhas rejeitadas de legado.xlsx/u });
      expect(within(tabela).getByText('Fórmula na célula')).toBeInTheDocument();
      expect(within(tabela).getByText('Célula mesclada')).toBeInTheDocument();
      expect(within(tabela).getByText(/Substitua a fórmula pelo valor/u)).toBeInTheDocument();
      expect(within(tabela).getByText(/Desfaça a mescla da célula/u)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('resultado REJEITADA por defeito da planilha: mensagem acionável e código de suporte', async () => {
      abrir({
        ...DETALHES,
        estado: 'REJEITADA',
        totais: null,
        versaoDaPrevia: null,
        podeConfirmar: false,
        podeCancelar: false,
        relatorioDisponivel: false,
        finalizadoEm: '2026-10-08T12:35:00.000Z',
        correlationId: 'corr-rejeitada-77',
        diagnostico: { codigo: 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', mensagem: 'texto do servidor' },
      });
      dominio.renderizar();

      const titulo = await screen.findByRole('heading', { name: 'Nenhuma linha foi aplicada' });
      const desfecho = titulo.closest('div.rounded-md') ?? titulo.parentElement;
      expect(desfecho).toHaveTextContent(/protegido por senha ou criptografado/u);
      expect(desfecho).toHaveTextContent('corr-rejeitada-77');
    });

    it('histórico mostra formato, aba, cabeçalho, ignoradas, ocultas e rejeições estruturais', async () => {
      backend.estado.historico = [
        dominio.tentativaDoHistorico({ ...DETALHES, formato: 'ODS', arquivo: { nome: 'legado.ods', tamanho: 4096, hash: 'c'.repeat(64) } }),
      ];
      dominio.renderizar();

      const tabela = await screen.findByRole('table', { name: /Importações/u });
      const linha = within(tabela).getByRole('rowheader', { name: /legado\.ods/u });
      expect(linha).toHaveTextContent('ODS · aba Plano (posição 2) · cabeçalho na linha 3');
      expect(linha).toHaveTextContent('2 ignoradas · 1 oculta · 1 com fórmula · 1 com mescla');
    });
  });
});
