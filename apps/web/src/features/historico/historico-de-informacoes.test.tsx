/**
 * Provas de tela do Histórico de Informações (TESTING.md §3.5, SPEC-003 §9).
 *
 * O que se prova aqui: as quatro abas, os filtros aprovados, a ordem do mais
 * recente para o mais antigo, os complementos condicionais (vigência e
 * justificativa) e — o mais importante — que a tela não oferece **nenhuma**
 * ação de escrita sobre o histórico.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoricoDeInformacoes } from './historico-de-informacoes';
import type { PaginaDoHistorico } from '../empresa/manutencao-api';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

const alteracao = {
  id: 'evento-2',
  empresaId: 'empresa-1',
  empresaNome: 'Padaria Aurora',
  aba: 'DADOS_CADASTRAIS',
  acao: 'ALTERACAO',
  campo: 'razaoSocial',
  valorAnterior: 'Padaria Aurora LTDA',
  valorNovo: 'Padaria Aurora Alimentos LTDA',
  vigencia: null,
  justificativa: null,
  usuarioNome: 'Rodrigo Reis',
  ocorridoEm: '2026-09-20T14:30:00.000Z',
} as const;

const arquivamento = {
  id: 'evento-1',
  empresaId: 'empresa-1',
  empresaNome: 'Padaria Aurora',
  aba: 'DADOS_CADASTRAIS',
  acao: 'ARQUIVAMENTO',
  campo: 'situacao',
  valorAnterior: 'ativo',
  valorNovo: 'arquivado',
  vigencia: '2026-09-01',
  justificativa: 'Encerrou as atividades.',
  usuarioNome: 'Rodrigo Reis',
  ocorridoEm: '2026-09-19T10:00:00.000Z',
} as const;

const comEventos: PaginaDoHistorico = {
  eventos: [alteracao, arquivamento],
  total: 2,
};

const vazio: PaginaDoHistorico = { eventos: [], total: 0 };

const respostaJson = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<HistoricoDeInformacoes />, { wrapper: Envolvido });

/** A tela faz duas chamadas ao montar: os eventos e os campos do filtro. */
const responderCom = (pagina: PaginaDoHistorico, campos: readonly string[] = []): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  mock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/historico/campos')
        ? respostaJson(campos)
        : respostaJson(pagina),
    ),
  );
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  substituir.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('abas do histórico (§3.6)', () => {
  it('oferece exatamente as quatro abas aprovadas', async () => {
    responderCom(comEventos);
    renderizar();

    const abas = await screen.findByRole('tablist', { name: /abas do histórico/iu });

    expect(within(abas).getAllByRole('tab')).toHaveLength(4);
    for (const rotulo of [
      'Dados cadastrais',
      'Dados fiscais',
      'Endereços',
      'Status da empresa',
    ]) {
      expect(within(abas).getByRole('tab', { name: rotulo })).toBeInTheDocument();
    }
  });
});

describe('listagem (§3.6)', () => {
  it('abre do evento mais recente para o mais antigo', async () => {
    responderCom(comEventos);
    renderizar();

    const itens = await screen.findAllByRole('listitem');

    expect(itens[0]).toHaveTextContent('Razão social');
    expect(itens[1]).toHaveTextContent('Situação da empresa');
  });

  it('exibe autor, data, campo e os dois valores', async () => {
    responderCom(comEventos);
    renderizar();

    const primeiro = (await screen.findAllByRole('listitem'))[0];

    expect(primeiro).toHaveTextContent('Padaria Aurora');
    expect(primeiro).toHaveTextContent('Rodrigo Reis');
    expect(primeiro).toHaveTextContent('Padaria Aurora LTDA');
    expect(primeiro).toHaveTextContent('Padaria Aurora Alimentos LTDA');
    // Data e hora em America/Sao_Paulo (I-11): 14:30 UTC é 11:30 em SP.
    expect(primeiro).toHaveTextContent('20/09/2026');
    expect(primeiro).toHaveTextContent('11:30');
  });

  it('mostra vigência e justificativa quando o evento os tem', async () => {
    responderCom(comEventos);
    renderizar();

    const segundo = (await screen.findAllByRole('listitem'))[1];

    expect(segundo).toHaveTextContent('01/09/2026');
    expect(segundo).toHaveTextContent('Encerrou as atividades.');
  });

  it('diferencia o vazio por filtro do vazio por ausência de evento', async () => {
    responderCom(vazio);
    const { unmount } = renderizar();

    expect(await screen.findByText(/nenhum evento registrado/iu)).toBeInTheDocument();
    unmount();

    parametrosAtuais = new URLSearchParams({ campo: 'razaoSocial' });
    responderCom(vazio);
    renderizar();

    expect(await screen.findByText(/nenhum evento no período ou filtro/iu)).toBeInTheDocument();
  });
});

describe('somente leitura (§3.6 e I-6)', () => {
  it('não oferece nenhuma ação de escrita sobre os eventos', async () => {
    responderCom(comEventos);
    renderizar();

    await screen.findAllByRole('listitem');

    // Append-only não é só regra de servidor: a tela não tem por onde tentar.
    for (const proibido of [/editar/iu, /excluir/iu, /remover/iu, /corrigir/iu]) {
      expect(screen.queryByRole('button', { name: proibido })).not.toBeInTheDocument();
    }
  });
});

describe('filtros na URL (§5)', () => {
  it('publica o período na URL em vez de filtrar no cliente', async () => {
    responderCom(comEventos);
    renderizar();

    await screen.findAllByRole('listitem');

    const de = screen.getByLabelText('De');
    de.focus();

    // `fireEvent` via userEvent em input date é instável; o contrato provado
    // aqui é o da publicação na URL, feita pelo `onValorChange`.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(de, { target: { value: '2026-09-01' } });

    await waitFor(() => {
      expect(substituir).toHaveBeenCalledWith(
        expect.stringContaining('inicio=2026-09-01'),
        { scroll: false },
      );
    });
  });
});

describe('acessibilidade', () => {
  it('não acusa violação na listagem', async () => {
    responderCom(comEventos);
    const { container } = renderizar();

    await screen.findAllByRole('listitem');

    expect(await axe(container)).toHaveNoViolations();
  });
});
