import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcuracoesRfb } from './procuracoes';

const estado = vi.hoisted(() => ({
  parametros: new URLSearchParams(),
  substituir: vi.fn(),
  itens: [] as unknown[],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: estado.substituir }),
  useSearchParams: () => estado.parametros,
}));
const chamadas: string[] = [];
vi.mock('@/lib/http', () => ({
  requisitar: async (url: string) => {
    chamadas.push(url);
    if (url.startsWith('/procurações-rfb?'))
      return { itens: estado.itens, total: estado.itens.length };
    if (url === '/procurações-rfb/resumo')
      return { DRAFT: 0, SCHEDULED: 0, ACTIVE: 0, EXPIRED: 0, REVOKED: 0 };
    if (url.startsWith('/empresas?'))
      return {
        empresas: [
          {
            id: 'empresa-1',
            cnpj: '11222333000181',
            razaoSocial: 'Padaria Aurora',
            nomeFantasia: null,
          },
        ],
      };
    throw new Error('rota não prevista: ' + url);
  },
}));

const renderizar = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProcuracoesRfb
        sessao={
          {
            permissoes: [
              'procuracoes.registro.consultar',
              'procuracoes.registro.administrar',
            ],
          } as never
        }
      />
    </QueryClientProvider>,
  );

describe('Procurações RFB/e-CAC', () => {
  beforeEach(() => {
    chamadas.length = 0;
    estado.parametros = new URLSearchParams();
    estado.substituir.mockReset();
    estado.itens = [];
  });

  it('mostra contagens, filtros, etapas e lista vazia sem sugerir validação oficial', async () => {
    renderizar();
    expect(
      await screen.findByText('Nenhuma procuração encontrada'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Registro declarado pelo escritório. Sem conexão automática com Receita Federal.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Declaração conferida pelo escritório; sem validação automática pela Receita Federal.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Empresa' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Poder RFB' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Vencimento' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Ordenar por' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Etapas do cadastro' }),
    ).toBeInTheDocument();
    expect(chamadas).toContain('/procurações-rfb/resumo');
  });

  it('expõe somente os poderes ativos quando a sessão pode operar', async () => {
    estado.itens = [
      {
        id: 'proc-1',
        empresaId: 'empresa-1',
        empresaNome: 'Padaria Aurora',
        empresaCnpj: '11222333000181',
        outorganteCnpj: '11222333000181',
        outorgadoCnpj: '11222333000181',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        status: 'ACTIVE',
        powers: ['RFB_CNPJ_STATUS_READ'],
        evidence: {
          nome: 'autorizacao.pdf',
          sha256: 'a'.repeat(64),
          tamanho: 2048,
        },
        revision: 2,
        localTestResult: 'SUCCESS',
        localTestCorrelationId: 'corr-1',
        declarationAt: '2026-01-01T12:00:00.000Z',
        catalogVersion: 1,
        archivedAt: null,
      },
    ];
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ProcuracoesRfb
          sessao={
            {
              permissoes: [
                'procuracoes.registro.consultar',
                'procuracoes.registro.operar',
              ],
            } as never
          }
        />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('button', {
        name: 'Consultar situação cadastral do CNPJ',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Consultar certidão de regularidade fiscal',
      }),
    ).not.toBeInTheDocument();
  });
});
