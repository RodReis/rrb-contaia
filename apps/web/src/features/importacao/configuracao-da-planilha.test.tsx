/**
 * Acabamento da escolha da planilha (SPEC-015 §5.2, §5.3; FRONTEND.md §20.1): troca de aba depois do
 * mapeamento, leitura cancelada ao trocar o arquivo, código de suporte real numa resposta fora do
 * contrato, nome acessível da linha com a prévia do texto, espera do "Tentar de novo" anunciada,
 * foco depois de uma falha e da troca de arquivo, e o `accept` de cada download.
 *
 * Os componentes são os mesmos nos dois domínios; aqui roda pelo plano de contas.
 */
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaPlanoDeContas } from '../plano-contas/aba-plano-de-contas';
import { DOMINIO_DO_PLANO } from '../plano-contas/dominio';
import {
  BASE,
  Envolvido,
  criarBackend,
  csvDoModelo,
  desinstalarDownloads,
  instalarDownloads,
  instalarFetch,
  json,
  navegacao,
  problema,
  type Roteador,
} from '../plano-contas/plano-contas.fixtures';
import { ocupado, pedidoDeInspecao, planilha, responderInspecao, type AbaDublada } from './planilha.fixtures';
import { useInspecaoDaPlanilha } from './queries';

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

const CAMPOS = ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'] as const;
const ROTULO_DA_PLANILHA = 'Planilha XLSX ou ODS do plano de contas';
const DUAS_ABAS: readonly AbaDublada[] = [
  { nome: 'Resumo', posicao: 1, utilizavel: true },
  { nome: 'Plano', posicao: 2, utilizavel: true },
];

type Responder = (init: RequestInit | undefined) => Response | Promise<Response>;

let inspecionar: Responder;
let enviar: Responder | null;
let baixar: Roteador;

const renderizar = () => render(<AbaPlanoDeContas empresaId="empresa-1" somenteLeitura={false} />, { wrapper: Envolvido });

const chamadasA = (trecho: string): readonly (RequestInit | undefined)[] =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes(trecho))
    .map(([, init]) => init);

const escolherPlanilha = async (usuario: ReturnType<typeof userEvent.setup>, arquivo = planilha('legado.xlsx')) => {
  await usuario.upload(await screen.findByLabelText(ROTULO_DA_PLANILHA), arquivo);
};

const combobox = (rotulo: string): HTMLElement => screen.getByRole('combobox', { name: new RegExp(`^${rotulo}`, 'u') });

const escolherOpcao = async (usuario: ReturnType<typeof userEvent.setup>, rotulo: string, opcao: string) => {
  combobox(rotulo).focus();
  await usuario.keyboard('{Enter}');
  await usuario.click(await screen.findByRole('option', { name: opcao }));
};

/** Como o `fetch` de verdade: um pedido cancelado termina com `AbortError`. */
const pendenteAteCancelar: Responder = (init) =>
  new Promise<Response>((_, rejeitar) => {
    init?.signal?.addEventListener('abort', () => rejeitar(new DOMException('cancelado', 'AbortError')));
  });

beforeEach(() => {
  vi.clearAllMocks();
  navegacao.definir('aba=plano-contas');
  const backend = criarBackend();
  backend.estado.tentativa = null;
  inspecionar = responderInspecao(CAMPOS);
  enviar = null;
  baixar = backend.roteador;
  instalarFetch((url, init) => {
    if (url.startsWith(`${BASE}/planilhas/inspecao`)) {
      return inspecionar(init);
    }
    if (enviar !== null && url === `${BASE}/importacoes` && init?.method === 'POST') {
      return enviar(init);
    }
    if (url.startsWith(`${BASE}/modelo`) || url.endsWith('/relatorio') || url.endsWith('/arquivo')) {
      return baixar(url, init);
    }

    return backend.roteador(url, init);
  });
});

afterEach(() => {
  vi.useRealTimers();
  desinstalarDownloads();
});

describe('troca de aba depois do mapeamento', () => {
  it('descarta o mapeamento feito e a recusa do envio anterior', async () => {
    inspecionar = responderInspecao(CAMPOS, DUAS_ABAS);
    enviar = () => problema(422, 'CABECALHO_MESCLADO', {}, 'corr-recusa-aba');
    const usuario = userEvent.setup();
    renderizar();
    await escolherPlanilha(usuario);
    await escolherOpcao(usuario, 'Aba da planilha', 'Plano (posição 2)');
    await usuario.click(await screen.findByRole('radio', { name: /^Linha 2 como cabeçalho/u }));
    await screen.findByRole('combobox', { name: /^Código/u });
    await escolherOpcao(usuario, 'Código', 'Coluna F — Obs');
    await escolherOpcao(usuario, 'Nome', 'Coluna A — codigo');

    await usuario.click(screen.getByRole('button', { name: /Validar arquivo/u }));
    expect(await screen.findByText('O arquivo não foi aceito para validação')).toBeInTheDocument();

    await escolherOpcao(usuario, 'Aba da planilha', 'Resumo (posição 1)');
    await usuario.click(await screen.findByRole('radio', { name: /^Linha 2 como cabeçalho/u }));

    await waitFor(() => expect(combobox('Código')).toHaveTextContent('Coluna A — codigo'));
    expect(combobox('Nome')).toHaveTextContent('Coluna B — nome');
    expect(screen.queryByText('O arquivo não foi aceito para validação')).not.toBeInTheDocument();
    expect(pedidoDeInspecao(chamadasA('/planilhas/inspecao').at(-1))).toMatchObject({ aba: 1, linhaCabecalho: 2 });
  });
});

describe('leitura cancelada', () => {
  it('trocar o arquivo durante a leitura cancela o pedido, sem erro na tela nem toast', async () => {
    inspecionar = pendenteAteCancelar;
    const usuario = userEvent.setup();
    renderizar();
    await escolherPlanilha(usuario);
    await screen.findByText('Lendo a planilha');

    await usuario.click(screen.getByRole('button', { name: 'Trocar arquivo' }));

    const pedido = chamadasA('/planilhas/inspecao')[0];
    expect(pedido?.signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(pedido?.signal?.aborted).toBe(true));
    expect(await screen.findByRole('button', { name: 'Escolher planilha XLSX ou ODS' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('trocar a aba durante a leitura dela cancela a leitura anterior', async () => {
    inspecionar = (init) =>
      pedidoDeInspecao(init).aba === 1 ? pendenteAteCancelar(init) : responderInspecao(CAMPOS, DUAS_ABAS)(init);
    const usuario = userEvent.setup();
    renderizar();
    await escolherPlanilha(usuario);
    await escolherOpcao(usuario, 'Aba da planilha', 'Resumo (posição 1)');
    await screen.findByText('Lendo a aba escolhida');

    await escolherOpcao(usuario, 'Aba da planilha', 'Plano (posição 2)');

    const daPrimeira = chamadasA('/planilhas/inspecao').find((init) => pedidoDeInspecao(init).aba === 1);
    await waitFor(() => expect(daPrimeira?.signal?.aborted).toBe(true));
    expect(await screen.findByRole('radio', { name: /^Linha 1 como cabeçalho/u })).toBeInTheDocument();
  });
});

describe('resposta fora do contrato', () => {
  it('vira erro desconhecido com o código de suporte enviado no pedido', async () => {
    inspecionar = () => json({ formato: 'XLSX', abas: 'não é lista' });
    const usuario = userEvent.setup();
    renderizar();

    await escolherPlanilha(usuario);

    const titulo = await screen.findByText('Não foi possível ler a planilha agora');
    const enviado = new Headers(chamadasA('/planilhas/inspecao')[0]?.headers).get('x-correlation-id');
    expect(enviado).toMatch(/^[0-9a-f-]{36}$/u);
    expect(titulo.closest('[role="alert"]')).toHaveTextContent(enviado ?? 'id ausente');
    expect(titulo.closest('[role="alert"]')).not.toHaveTextContent('sem-correlacao');
  });
});

describe('acessibilidade da escolha do cabeçalho', () => {
  it('cada linha diz, no nome do rádio, o começo do texto dela', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await escolherPlanilha(usuario);

    expect(await screen.findByRole('radio', { name: 'Linha 1 como cabeçalho: Relatório exportado do sistema legado' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Linha 2 como cabeçalho: codigo, nome, tipo, …' })).toBeInTheDocument();
  });

  it('"Tentar de novo" diz quanto falta, conta os segundos e avisa uma vez quando libera', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let tentativas = 0;
    inspecionar = (init) => {
      tentativas += 1;

      return tentativas === 1 ? ocupado(5) : responderInspecao(CAMPOS)(init);
    };
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    renderizar();
    await escolherPlanilha(usuario);

    const tentar = await screen.findByRole('button', { name: /Tentar de novo/u });
    expect(tentar).toBeDisabled();
    expect(tentar).toHaveAccessibleDescription('Disponível em 5 segundos.');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByRole('button', { name: /Tentar de novo/u })).toHaveAccessibleDescription('Disponível em 3 segundos.');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    const liberado = screen.getByRole('button', { name: /Tentar de novo/u });
    expect(liberado).toBeEnabled();
    expect(liberado).not.toHaveAccessibleDescription(/Disponível em/u);
    const painel = liberado.closest('[role="alert"]');
    expect(within(painel as HTMLElement).getByRole('status')).toHaveTextContent('Já é possível tentar de novo.');
  });
});

describe('foco', () => {
  it('a falha da leitura recebe o foco, e "Escolher outro arquivo" devolve o foco ao botão da planilha', async () => {
    inspecionar = () => problema(422, 'ARQUIVO_CORROMPIDO', {}, 'corr-foco');
    const usuario = userEvent.setup();
    renderizar();
    await escolherPlanilha(usuario);

    const titulo = await screen.findByText('Esta planilha não pode ser usada');
    await waitFor(() => expect(titulo).toHaveFocus());

    await usuario.click(screen.getByRole('button', { name: 'Escolher outro arquivo' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Escolher planilha XLSX ou ODS' })).toHaveFocus());
  });

  it('"Trocar arquivo" no CSV devolve o foco ao botão do CSV', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvDoModelo());

    await usuario.click(await screen.findByRole('button', { name: 'Trocar arquivo' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Escolher arquivo CSV' })).toHaveFocus());
  });

  it('a página que abre sem arquivo não rouba o foco', async () => {
    renderizar();

    await screen.findByRole('button', { name: 'Escolher planilha XLSX ou ODS' });
    expect(document.body).toHaveFocus();
  });
});

describe('accept dos downloads', () => {
  const arquivoBaixado = (tipo: string, nome: string): Response =>
    new Response('x', { status: 200, headers: { 'content-type': tipo, 'content-disposition': `attachment; filename="${nome}"` } });

  it.each([
    ['CSV', `${BASE}/modelo`, 'text/csv, application/problem+json'],
    ['XLSX', `${BASE}/modelo?formato=xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/problem+json'],
    ['ODS', `${BASE}/modelo?formato=ods`, 'application/vnd.oasis.opendocument.spreadsheet, application/problem+json'],
  ])('modelo %s pede o tipo do próprio formato', async (formato, caminho, aceito) => {
    const downloads = instalarDownloads();
    baixar = () => arquivoBaixado('application/octet-stream', `modelo.${formato.toLowerCase()}`);
    const usuario = userEvent.setup();
    renderizar();

    const grupo = await screen.findByRole('group', { name: /Modelos oficiais/u });
    await usuario.click(within(grupo).getByRole('button', { name: `Baixar modelo ${formato}` }));

    await waitFor(() => expect(downloads.criar).toHaveBeenCalled());
    const pedido = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === caminho);
    expect(new Headers(pedido?.[1]?.headers).get('accept')).toBe(aceito);
  });
});

describe('consultas da inspeção', () => {
  it('a consulta desligada não espelha a ativa do mesmo arquivo', async () => {
    inspecionar = () => new Promise<Response>(() => undefined);
    const arquivo = planilha('legado.xlsx');
    const entrada = { arquivo, selecao: 'selecao-1', aba: null, linhaCabecalho: null };

    const { result } = renderHook(
      () => ({
        ativa: useInspecaoDaPlanilha(DOMINIO_DO_PLANO, 'empresa-1', entrada),
        desligada: useInspecaoDaPlanilha(DOMINIO_DO_PLANO, 'empresa-1', entrada, false),
      }),
      { wrapper: Envolvido },
    );

    await waitFor(() => expect(result.current.ativa.isFetching).toBe(true));
    expect(result.current.desligada.isFetching).toBe(false);
    expect(result.current.desligada.fetchStatus).toBe('idle');
  });
});
