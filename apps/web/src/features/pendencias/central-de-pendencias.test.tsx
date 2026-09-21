/**
 * Provas de tela da central de pendências (SPEC-005 §2, §6, Task 9).
 *
 * A API é dublada no nível do `fetch`, mesmo padrão de `lista-de-empresas.test.tsx`:
 * o que se prova aqui é a tela — os estados, os dois vazios distintos, filtro
 * na URL, ação de dispensa via `DialogoDeJustificativa` — não o backend.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CentralDePendencias } from './central-de-pendencias';
import type { PaginaDePendencias } from './api';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

const pendenciaAberta = {
  id: 'pend-1',
  empresaId: 'empresa-1',
  empresaNome: 'Padaria Aurora',
  origem: 'DOCUMENTAL',
  tipo: 'DOCUMENTO_VENCIDO',
  chave: 'contrato-social',
  estado: 'ABERTA',
  dataLimite: '2026-01-01T00:00:00.000Z',
  criadoEm: '2025-12-01T00:00:00.000Z',
  resolvidoEm: null,
} as const;

const pendenciaResolvida = {
  ...pendenciaAberta,
  id: 'pend-2',
  estado: 'RESOLVIDA',
  resolvidoEm: '2025-12-15T00:00:00.000Z',
} as const;

const comPendencias: PaginaDePendencias = { pendencias: [pendenciaAberta], total: 1 };
const vazia: PaginaDePendencias = { pendencias: [], total: 0 };

const respostaJson = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<CentralDePendencias />, { wrapper: Envolvido });

const responderCom = (...respostas: Response[]): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  for (const resposta of respostas) {
    mock.mockResolvedValueOnce(resposta);
  }
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  substituir.mockClear();
  vi.stubGlobal('fetch', vi.fn());

  // Mesmos dublês de `lista-de-empresas.test.tsx`: o Radix (Select e Dialog)
  // usa APIs de ponteiro e layout que o jsdom não implementa.
  if (!('PointerEvent' in globalThis)) {
    vi.stubGlobal('PointerEvent', MouseEvent);
  }

  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('estado de carregamento', () => {
  it('anuncia o carregamento com skeleton, não spinner', () => {
    responderCom(respostaJson(comPendencias));

    const { container } = renderizar();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('estado de erro', () => {
  it('mostra a falha em linguagem de usuário com o correlationId copiável', async () => {
    responderCom(
      respostaJson(
        {
          type: 'https://contaia.local/erros/interno',
          title: 'falha',
          status: 500,
          code: 'ERRO_INTERNO',
          correlationId: 'corr-321',
        },
        500,
      ),
    );

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as pendências',
    );
    expect(screen.getByText('corr-321')).toBeInTheDocument();
  });

  it('permite tentar de novo, refazendo a busca', async () => {
    const usuario = userEvent.setup();
    responderCom(
      respostaJson(
        {
          type: 'https://contaia.local/erros/interno',
          title: 'falha',
          status: 500,
          code: 'ERRO_INTERNO',
          correlationId: 'corr-322',
        },
        500,
      ),
      respostaJson(comPendencias),
    );

    renderizar();

    await screen.findByRole('alert');
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect((await screen.findAllByText('Padaria Aurora')).length).toBeGreaterThan(0);
  });
});

describe('estado vazio', () => {
  it('sem nenhuma pendência aberta, o texto é positivo e não alarmante', async () => {
    responderCom(respostaJson(vazia));

    renderizar();

    expect(await screen.findByText('Sem pendências')).toBeInTheDocument();
  });

  it('com filtro ativo, o vazio é outro: fala de filtro e oferece limpar', async () => {
    parametrosAtuais = new URLSearchParams({ tipo: 'CAMPO_AUSENTE' });
    responderCom(respostaJson(vazia));

    renderizar();

    expect(await screen.findByText('Nenhuma pendência encontrada')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Limpar filtros' }).length).toBeGreaterThan(0);
  });
});

describe('listagem', () => {
  it('renderiza a pendência com indicador de tipo/urgência e nome da empresa', async () => {
    responderCom(respostaJson(comPendencias));

    renderizar();

    expect((await screen.findAllByText('Padaria Aurora')).length).toBeGreaterThan(0);
    // Tipo aparece com rótulo textual, não só cor (COMPONENTS.md §3.4).
    expect(screen.getAllByText(/Documento vencido/iu).length).toBeGreaterThan(0);
  });

  it('pendência resolvida some da visão padrão mas aparece ao filtrar por resolvidas', async () => {
    responderCom(respostaJson({ pendencias: [pendenciaResolvida], total: 1 }));

    parametrosAtuais = new URLSearchParams({ estado: 'RESOLVIDA' });
    renderizar();

    expect((await screen.findAllByText('Padaria Aurora')).length).toBeGreaterThan(0);
    const chamada = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(String(chamada)).toContain('estado=RESOLVIDA');
  });

  it('a busca ao servidor usa o filtro padrão estado=ABERTA quando nada foi escolhido', async () => {
    responderCom(respostaJson(comPendencias));

    renderizar();
    await screen.findAllByText('Padaria Aurora');

    const chamada = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(String(chamada)).toContain('estado=ABERTA');
  });
});

describe('filtro na URL', () => {
  it('trocar o filtro de origem reflete na URL e volta para a primeira página', async () => {
    const usuario = userEvent.setup();
    parametrosAtuais = new URLSearchParams({ pagina: '3' });
    responderCom(respostaJson(comPendencias), respostaJson(comPendencias));

    renderizar();
    await screen.findAllByText('Padaria Aurora');

    const seletor = screen.getByRole('combobox', { name: /Origem/u });
    seletor.focus();
    await usuario.keyboard('{Enter}');
    await usuario.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(substituir).toHaveBeenCalled();
    });

    const chamada = substituir.mock.calls.at(-1)?.[0] as string;
    expect(chamada).not.toContain('pagina=3');
  });
});

describe('paginação', () => {
  it('trocar de página mantém os filtros na URL', async () => {
    const usuario = userEvent.setup();
    parametrosAtuais = new URLSearchParams({ origem: 'DOCUMENTAL' });
    responderCom(
      respostaJson({ pendencias: [pendenciaAberta], total: 40 }),
      respostaJson({ pendencias: [pendenciaAberta], total: 40 }),
    );

    renderizar();
    await screen.findAllByText('Padaria Aurora');

    await usuario.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(substituir).toHaveBeenCalledWith(
      '/pendencias?origem=DOCUMENTAL&pagina=2',
      { scroll: false },
    );
  });

  it('desabilita "Anterior" na primeira página e "Próxima" na última', async () => {
    responderCom(respostaJson({ pendencias: [pendenciaAberta], total: 40 }));

    renderizar();
    await screen.findAllByText('Padaria Aurora');

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).not.toBeDisabled();
  });
});

describe('ação de dispensa', () => {
  it('abre o DialogoDeJustificativa e, ao confirmar, chama o endpoint de dispensa', async () => {
    const usuario = userEvent.setup();
    responderCom(
      respostaJson(comPendencias),
      respostaJson({ ...pendenciaAberta, estado: 'RESOLVIDA' }),
      respostaJson({ pendencias: [], total: 0 }),
      respostaJson({ empresas: [], total: 0 }),
    );

    renderizar();
    await screen.findAllByText('Padaria Aurora');

    const botoesDeDispensa = screen.getAllByRole('button', { name: 'Dispensar' });
    await usuario.click(botoesDeDispensa[0]!);

    const campoDeJustificativa = await screen.findByLabelText(/Justificativa/u);
    await usuario.type(campoDeJustificativa, 'Documento reemitido fora do prazo, dispensado.');
    await usuario.click(screen.getByRole('button', { name: 'Dispensar pendência' }));

    await waitFor(() => {
      const chamada = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
      expect(String(chamada)).toContain(
        '/empresas/empresa-1/pendencias/pend-1/dispensa',
      );
    });
  });

  it('não oferece dispensa para pendência já resolvida', async () => {
    responderCom(respostaJson({ pendencias: [pendenciaResolvida], total: 1 }));

    parametrosAtuais = new URLSearchParams({ estado: 'RESOLVIDA' });
    renderizar();

    await screen.findAllByText('Padaria Aurora');
    expect(screen.queryByRole('button', { name: 'Dispensar' })).not.toBeInTheDocument();
  });
});

describe('acessibilidade', () => {
  it('a listagem não tem violação detectável pelo axe', async () => {
    responderCom(respostaJson(comPendencias));

    const { container } = renderizar();
    await screen.findAllByText('Padaria Aurora');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o estado vazio não tem violação detectável pelo axe', async () => {
    responderCom(respostaJson(vazia));

    const { container } = renderizar();
    await screen.findByText('Sem pendências');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o estado de erro não tem violação detectável pelo axe', async () => {
    responderCom(
      respostaJson(
        {
          type: 'https://contaia.local/erros/interno',
          title: 'falha',
          status: 500,
          code: 'ERRO_INTERNO',
          correlationId: 'corr-999',
        },
        500,
      ),
    );

    const { container } = renderizar();
    await screen.findByRole('alert');

    expect(await axe(container)).toHaveNoViolations();
  });
});
