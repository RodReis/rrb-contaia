/**
 * Acompanhamento por consulta (SPEC-013 §5.3 "validação em andamento"): a tela relê a tentativa
 * enquanto o worker trabalha, para quando a prévia fica pronta e não congela quando uma leitura
 * falha — avisa na tela, com código de suporte, e continua tentando com espera crescente.
 * Relógio falso: o intervalo de 2 s é avançado, não esperado.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaPlanoDeContas } from './aba-plano-de-contas';
import {
  Envolvido,
  TENTATIVA,
  criarBackend,
  instalarFetch,
  json,
  navegacao,
  previa,
  problema,
} from './plano-contas.fixtures';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('./plano-contas.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

const VALIDANDO = previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null });

let backend = criarBackend();
let respostas: (() => Response)[] = [];
let leituras = 0;

const avancar = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const renderizar = () =>
  render(<AbaPlanoDeContas empresaId="empresa-1" somenteLeitura={false} />, { wrapper: Envolvido });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  backend = criarBackend();
  leituras = 0;
  respostas = [];
  // Cada leitura consome a próxima resposta da fila; a última se repete.
  backend.estado.lerTentativa = () => {
    leituras += 1;
    const proxima = respostas.length > 1 ? respostas.shift() : respostas[0];

    return proxima === undefined ? json(VALIDANDO) : proxima();
  };
  instalarFetch(backend.roteador);
  navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('acompanhamento por consulta', () => {
  it('volta a consultar enquanto valida e para quando a prévia fica pronta', async () => {
    respostas = [() => json(VALIDANDO), () => json(previa())];
    renderizar();

    expect(await screen.findByText('Validando o arquivo inteiro')).toBeInTheDocument();
    await avancar(2_100);

    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Validação concluída: 0 linhas rejeitadas.');

    const lidasAoTerminar = leituras;
    await avancar(60_000);
    expect(leituras).toBe(lidasAoTerminar);
  });

  it('falha numa leitura: avisa com código, segue tentando com espera maior e chega à prévia', async () => {
    respostas = [
      () => json(VALIDANDO),
      () => problema(500, 'FALHA_TECNICA', {}, 'corr-poll-500'),
      () => json(previa()),
    ];
    renderizar();

    expect(await screen.findByText('Validando o arquivo inteiro')).toBeInTheDocument();
    await avancar(2_100);

    const aviso = await screen.findByText(/Não foi possível atualizar o andamento desta importação/u);
    expect(aviso.closest('[role="alert"]')).toHaveTextContent('corr-poll-500');
    // O último estado lido continua na tela, identificado como tal — não um "validando" mudo.
    expect(screen.getByText('Validando o arquivo inteiro')).toBeInTheDocument();
    const lidasNaFalha = leituras;

    // Com uma falha, a espera dobra: 2 s não bastam, 4 s sim.
    await avancar(2_100);
    expect(leituras).toBe(lidasNaFalha);
    await avancar(2_100);

    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível atualizar o andamento/u)).not.toBeInTheDocument();
  });

  it('"Tentar de novo" relê na hora e retoma o acompanhamento', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    respostas = [
      () => json(VALIDANDO),
      () => problema(503, 'FALHA_DE_REDE', {}, 'corr-poll-503'),
      () => json(VALIDANDO),
      () => json(previa()),
    ];
    renderizar();

    await screen.findByText('Validando o arquivo inteiro');
    await avancar(2_100);
    await screen.findByText(/Não foi possível atualizar o andamento desta importação/u);

    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByText('Validando o arquivo inteiro')).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível atualizar o andamento/u)).not.toBeInTheDocument();
    await avancar(2_100);
    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
  });
});
