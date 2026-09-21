/**
 * Provas de tela do alerta de pendências (SPEC-005, Task 8).
 *
 * A API é dublada no nível do `fetch`, seguindo o mesmo padrão de
 * `manutencao-da-empresa.test.tsx`: o que se prova aqui é a tela, não o
 * backend.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertaDePendencias } from './alerta-de-pendencias';

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

const renderizar = () =>
  render(<AlertaDePendencias empresaId="empresa-1" />, { wrapper: Envolvido });

const responderCom = (...respostas: Response[]): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  for (const resposta of respostas) {
    mock.mockResolvedValueOnce(resposta);
  }
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('sem pendências abertas', () => {
  it('não renderiza nada enquanto carrega', () => {
    responderCom(respostaJson({ pendencias: [], total: 0 }));

    const { container } = renderizar();

    expect(container).toBeEmptyDOMElement();
  });

  it('não renderiza nada quando o total é zero', async () => {
    responderCom(respostaJson({ pendencias: [], total: 0 }));

    const { container } = renderizar();

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    expect(container).toBeEmptyDOMElement();
  });
});

describe('com pendências abertas', () => {
  it('renderiza role="status" com o total', async () => {
    responderCom(respostaJson({ pendencias: [], total: 3 }));

    renderizar();

    expect(await screen.findByRole('status')).toHaveTextContent('3');
  });

  it('contém um link para a central de pendências da empresa', async () => {
    responderCom(respostaJson({ pendencias: [], total: 1 }));

    renderizar();

    const link = await screen.findByRole('link', { name: /ver pendências/iu });
    expect(link).toHaveAttribute('href', '/pendencias?empresaId=empresa-1');
  });
});
