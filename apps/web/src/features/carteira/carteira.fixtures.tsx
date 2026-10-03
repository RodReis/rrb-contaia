/**
 * Dados e utilitários de prova para as telas de carteira (SPEC-009). Só os
 * testes importam este arquivo: ele não entra no bundle.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import type {
  ColaboradorDaEmpresa,
  ColaboradorNaCentral,
  EmpresaParaAtribuicao,
  EventoDeCarteira,
} from './api';

export const colaborador = (
  sobrescritas: Partial<ColaboradorNaCentral> & Pick<ColaboradorNaCentral, 'id' | 'nome'>,
): ColaboradorNaCentral => ({
  email: `${sobrescritas.id}@escritorio.com`,
  estado: 'ATIVO',
  papeis: ['contador'],
  papeisPersonalizados: [],
  empresas: 0,
  revisaoCarteira: 0,
  ...sobrescritas,
});

export const empresa = (
  sobrescritas: Partial<EmpresaParaAtribuicao> & Pick<EmpresaParaAtribuicao, 'id' | 'nome'>,
): EmpresaParaAtribuicao => ({
  cnpj: '11222333000181',
  status: 'ATIVA',
  situacao: 'ativo',
  atribuida: false,
  ...sobrescritas,
});

export const doColaborador = (
  sobrescritas: Partial<ColaboradorDaEmpresa> & Pick<ColaboradorDaEmpresa, 'id' | 'nome'>,
): ColaboradorDaEmpresa => ({
  email: `${sobrescritas.id}@escritorio.com`,
  estado: 'ATIVO',
  papeis: ['contador'],
  revisaoCarteira: 1,
  desde: '2026-10-01T12:00:00.000Z',
  ...sobrescritas,
});

export const evento = (
  sobrescritas: Partial<EventoDeCarteira> & Pick<EventoDeCarteira, 'id'>,
): EventoDeCarteira => ({
  ocorridoEm: '2026-10-02T15:30:00.000Z',
  origem: 'INDIVIDUAL',
  autorId: 'ana',
  autorNome: 'Ana Souza',
  afetados: [],
  ...sobrescritas,
});

export const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

export const problema = (
  status: number,
  code: string,
  extras: Record<string, unknown> = {},
  correlationId = 'corr-123',
): Response => json({ type: 'x', title: 'x', status, code, correlationId, ...extras }, status);

export const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

export type Roteador = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/** `fetch` dublado por rota; rota sem dublê falha o teste em vez de passar calada. */
export const instalarFetch = (roteador: Roteador): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const resposta = await roteador(String(url), init);

      if (resposta === undefined) {
        throw new Error(`rota sem dublê: ${init?.method ?? 'GET'} ${String(url)}`);
      }

      return resposta;
    }),
  );

  // O Radix usa APIs de ponteiro e de layout que o jsdom não implementa.
  if (!('PointerEvent' in globalThis)) {
    vi.stubGlobal('PointerEvent', MouseEvent);
  }

  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
};
