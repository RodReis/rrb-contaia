/**
 * Jornada da importação na tela (SPEC-013 §10): selecionar o CSV → mapear → validar → ver a
 * prévia → confirmar → ver o resultado. E as regras que a jornada precisa respeitar: mapeamento
 * incompleto ou com coluna repetida não envia nada, o diálogo de confirmação funciona por teclado,
 * e toda chamada leva o `x-correlation-id` da ação.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaPlanoDeContas } from './aba-plano-de-contas';
import {
  BASE,
  Envolvido,
  TENTATIVA,
  corpoEnviado,
  criarBackend,
  csvDoModelo,
  csvLegado,
  instalarFetch,
  json,
  navegacao,
  previa,
  previaParcial,
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

let backend = criarBackend();

const renderizar = () =>
  render(<AbaPlanoDeContas empresaId="empresa-1" somenteLeitura={false} />, { wrapper: Envolvido });

const enviosFeitos = () =>
  vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === `${BASE}/importacoes` && init?.method === 'POST');

/** O Select do Radix abre por teclado no jsdom, como nas demais telas do produto. */
const escolherColuna = async (campo: RegExp, coluna: string): Promise<void> => {
  screen.getByRole('combobox', { name: campo }).focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(await screen.findByRole('option', { name: coluna }));
};

beforeEach(() => {
  vi.clearAllMocks();
  navegacao.definir('aba=plano-contas');
  backend = criarBackend();
  instalarFetch(backend.roteador);
});

describe('jornada completa', () => {
  it('seleciona o CSV, mapeia, valida, revisa a prévia, confirma e vê o resultado', async () => {
    const usuario = userEvent.setup();
    backend.estado.lerTentativa = () =>
      json(backend.estado.tentativa?.estado === 'VALIDANDO' ? previaParcial() : backend.estado.tentativa);
    backend.estado.confirmar = () =>
      json(previaParcial({ estado: 'CONCLUIDA_COM_REJEICOES', finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvDoModelo());
    expect(await screen.findByRole('combobox', { name: /Natureza/u })).toHaveTextContent('natureza');
    await usuario.click(screen.getByRole('button', { name: 'Validar arquivo' }));

    await waitFor(() => expect(navegacao.ler().get('tentativa')).toBe(TENTATIVA));
    const envio = corpoEnviado(enviosFeitos()[0]?.[1]);
    expect(envio?.get('mapeamento')).toBe(
      JSON.stringify({ codigo: 'codigo', nome: 'nome', tipo: 'tipo', natureza: 'natureza', conta_pai: 'conta_pai' }),
    );
    const arquivo = envio?.get('arquivo');
    expect(arquivo instanceof File ? [arquivo.name, arquivo.type] : null).toEqual(['plano-legado.csv', 'text/csv']);

    expect(await screen.findByRole('table', { name: /Linhas rejeitadas/u })).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    const desfecho = await screen.findByRole('heading', { name: 'Importação concluída com rejeições' });
    await waitFor(() => expect(desfecho).toHaveFocus());
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Importação concluída com rejeições.');
  });

  it('leva o x-correlation-id da ação em todas as chamadas do plano de contas', async () => {
    const usuario = userEvent.setup();
    backend.estado.lerTentativa = () =>
      json(backend.estado.tentativa?.estado === 'VALIDANDO' ? previa() : backend.estado.tentativa);
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvDoModelo());
    await usuario.click(await screen.findByRole('button', { name: 'Validar arquivo' }));
    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));
    await screen.findByRole('heading', { name: 'Importação concluída' });

    const doPlano = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(BASE));
    const ids = doPlano.map(([, init]) => new Headers(init?.headers).get('x-correlation-id'));

    expect(doPlano.length).toBeGreaterThanOrEqual(5);
    expect(ids.every((id) => id !== null && /^[A-Za-z0-9-]{8,64}$/u.test(id))).toBe(true);
    // Um id por ação: o envio e a confirmação não compartilham correlação.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('regras do mapeamento', () => {
  it('mapeamento incompleto não envia: destaca os campos, diz o que falta e foca o primeiro', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvLegado());
    expect(await screen.findByRole('combobox', { name: /Tipo/u })).toHaveTextContent('Tipo');
    expect(screen.getByRole('combobox', { name: /Código/u })).toHaveTextContent('Escolha a coluna');

    await usuario.click(screen.getByRole('button', { name: 'Validar arquivo' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Revise: Código, Nome, Conta-pai.');
    expect(screen.getByRole('combobox', { name: /Código/u })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: /Conta-pai/u })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: /Natureza/u })).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('combobox', { name: /Código/u })).toHaveFocus();
    expect(enviosFeitos()).toHaveLength(0);
  });

  it('uma coluna de origem não alimenta dois campos', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvLegado());
    await screen.findByRole('combobox', { name: /Código/u });
    await escolherColuna(/Código/u, 'Cod');
    await escolherColuna(/Nome/u, 'Cod');
    await escolherColuna(/Conta-pai/u, 'Pai');

    expect(screen.getAllByText('A coluna “Cod” já alimenta outro campo; cada coluna serve a um campo só.')).toHaveLength(2);

    await usuario.click(screen.getByRole('button', { name: 'Validar arquivo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revise: Código, Nome.');
    expect(enviosFeitos()).toHaveLength(0);

    await escolherColuna(/Nome/u, 'Descricao');
    await usuario.click(screen.getByRole('button', { name: 'Validar arquivo' }));
    await waitFor(() => expect(enviosFeitos()).toHaveLength(1));
    expect(corpoEnviado(enviosFeitos()[0]?.[1])?.get('mapeamento')).toBe(
      JSON.stringify({ codigo: 'Cod', nome: 'Descricao', tipo: 'Tipo', natureza: 'Natureza', conta_pai: 'Pai' }),
    );
  });

  it('recusa do servidor no envio fica na tela com o código de suporte', async () => {
    const usuario = userEvent.setup();
    backend.estado.enviar = () =>
      json({ type: 'x', title: 'x', status: 413, code: 'ARQUIVO_ACIMA_DO_LIMITE', correlationId: 'corr-413' }, 413);
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvDoModelo());
    await usuario.click(await screen.findByRole('button', { name: 'Validar arquivo' }));

    const alerta = await screen.findByText('O arquivo não foi aceito para validação');
    expect(alerta.parentElement).toHaveTextContent('O arquivo passa do limite de 10 MB ou de 10.000 linhas.');
    expect(alerta.parentElement).toHaveTextContent('corr-413');
    expect(navegacao.ler().get('tentativa')).toBeNull();
  });
});

describe('teclado', () => {
  it('Tab chega a Confirmar, Enter abre o diálogo, Esc fecha e devolve o foco', async () => {
    const usuario = userEvent.setup();
    backend.estado.tentativa = previa();
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
    renderizar();

    const confirmar = await screen.findByRole('button', { name: 'Confirmar importação' });

    for (let passos = 0; passos < 40 && document.activeElement !== confirmar; passos += 1) {
      await usuario.tab();
    }
    expect(confirmar).toHaveFocus();

    await usuario.keyboard('{Enter}');
    const dialogo = await screen.findByRole('alertdialog');
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(confirmar).toHaveFocus();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/confirmar'))).toBe(false);
  });
});

describe('arrastar e soltar', () => {
  it('ignora um segundo arquivo solto enquanto o primeiro ainda está sendo lido', async () => {
    renderizar();

    const zona = (await screen.findByText('Arraste o CSV do plano de contas aqui')).parentElement;
    expect(zona).not.toBeNull();
    if (zona === null) {
      return;
    }

    fireEvent.drop(zona, { dataTransfer: { files: [csvDoModelo()] } });
    fireEvent.drop(zona, { dataTransfer: { files: [csvLegado()] } });

    expect(await screen.findByText('Associe as colunas do arquivo')).toBeInTheDocument();
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(screen.getByText('plano-legado.csv')).toBeInTheDocument();
    expect(screen.queryByText('legado.csv')).not.toBeInTheDocument();
  });
});
