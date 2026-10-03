/**
 * Provas de tela das visões de carteira (SPEC-009 §5.2, §5.3, §3.6): aba
 * "Colaboradores" da empresa, "Minha carteira" e a aba "Carteiras" do Histórico.
 * A API é dublada no `fetch`, por rota.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaDeColaboradores } from './aba-de-colaboradores';
import {
  Envolvido,
  colaborador,
  doColaborador,
  empresa,
  evento,
  instalarFetch,
  json,
  problema,
  type Roteador,
} from './carteira.fixtures';
import { HistoricoDeCarteiras } from './historico-de-carteiras';
import { MinhaCarteira } from './minha-carteira';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/historico',
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));

const envios: Array<Record<string, unknown>> = [];
let doServidor: () => Response | Promise<Response>;
let minha: () => Response | Promise<Response>;
let eventos: () => Response | Promise<Response>;

const roteador: Roteador = (url, init) => {
  if (url.endsWith('/carteiras/alteracoes') && init?.method === 'POST') {
    envios.push(JSON.parse(String(init.body)) as Record<string, unknown>);

    return json({ aplicado: true, afetados: [] });
  }
  if (url.includes('/carteiras/empresas/') && url.endsWith('/colaboradores')) return doServidor();
  if (url.includes('/carteiras/colaboradores?')) {
    return json({
      colaboradores: [
        colaborador({ id: 'ana', nome: 'Ana Souza', revisaoCarteira: 2 }),
        colaborador({ id: 'bruno', nome: 'Bruno Lima', revisaoCarteira: 4 }),
      ],
      total: 2,
    });
  }
  if (url.endsWith('/carteiras/minha')) return minha();
  if (url.includes('/historico/carteiras?')) return eventos();
  if (url.includes('/usuarios?')) return json({ usuarios: [], total: 0 });

  return undefined;
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams('aba=CARTEIRAS');
  envios.length = 0;
  substituir.mockClear();
  doServidor = () => json({ colaboradores: [] });
  minha = () => json({ empresas: [] });
  eventos = () => json({ eventos: [], total: 0 });
  instalarFetch(roteador);
});

describe('AbaDeColaboradores (empresa)', () => {
  const renderizar = () =>
    render(<AbaDeColaboradores empresaId="e-alfa" empresaNome="Alfa Ltda" />, {
      wrapper: Envolvido,
    });

  it('empresa sem colaboradores explica que ninguém atende — nem o administrador', async () => {
    renderizar();

    expect(await screen.findByText('Empresa sem colaboradores')).toBeInTheDocument();
    expect(screen.getByText(/nem o administrador/i)).toBeInTheDocument();
  });

  it('lista quem tem a empresa na carteira, com papéis e situação', async () => {
    doServidor = () => json({ colaboradores: [doColaborador({ id: 'ana', nome: 'Ana Souza' })] });
    renderizar();

    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('1 colaborador atua nesta empresa.')).toBeInTheDocument();
    expect(screen.getByText('Contador')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
  });

  it('remover pede confirmação com o impacto e só então envia a remoção com a revisão atual', async () => {
    doServidor = () =>
      json({
        colaboradores: [doColaborador({ id: 'ana', nome: 'Ana Souza', revisaoCarteira: 7 })],
      });
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Remover Ana Souza desta empresa' }));

    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Ana Souza');
    expect(dialogo).toHaveTextContent('Alfa Ltda');
    expect(dialogo).toHaveTextContent(/nova atribuição/i);
    expect(envios).toHaveLength(0);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Remover acesso' }));

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toEqual({
      origem: 'INDIVIDUAL',
      usuarios: [{ id: 'ana', revisao: 7 }],
      adicionar: [],
      remover: ['e-alfa'],
    });
  });

  it('adicionar colaboradores escolhe da lista e envia a empresa para cada um', async () => {
    doServidor = () => json({ colaboradores: [doColaborador({ id: 'ana', nome: 'Ana Souza' })] });
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: /Adicionar colaboradores/ }));

    // Quem já tem a empresa aparece marcado e desabilitado: nada de vínculo duplicado.
    const ana = await screen.findByRole('checkbox', { name: 'Ana Souza' });
    expect(ana).toBeChecked();
    expect(ana).toBeDisabled();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Bruno Lima' }));
    await usuario.click(screen.getByRole('button', { name: 'Adicionar e salvar' }));

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toEqual({
      origem: 'INDIVIDUAL',
      usuarios: [{ id: 'bruno', revisao: 4 }],
      adicionar: ['e-alfa'],
      remover: [],
    });
  });

  it('erro de carregamento mostra o correlationId', async () => {
    doServidor = () => problema(500, 'ERRO_DESCONHECIDO');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar os colaboradores')).toBeInTheDocument();
    expect(screen.getByText('corr-123')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    doServidor = () => json({ colaboradores: [doColaborador({ id: 'ana', nome: 'Ana Souza' })] });
    const { container } = renderizar();
    await screen.findByText('Ana Souza');

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('MinhaCarteira', () => {
  const renderizar = () => render(<MinhaCarteira />, { wrapper: Envolvido });

  it('quem não tem carteira lê a orientação de ausência de alçada, não uma tela vazia', async () => {
    renderizar();

    expect(
      await screen.findByText('Você ainda não tem empresas na sua carteira'),
    ).toBeInTheDocument();
  });

  it('lista só as empresas da própria carteira, com situação por extenso e link para abrir', async () => {
    minha = () =>
      json({
        empresas: [
          empresa({ id: 'e-alfa', nome: 'Alfa Ltda', atribuida: true }),
          empresa({ id: 'e-beta', nome: 'Beta Comércio', status: 'CADASTRO_INCOMPLETO' }),
        ],
      });
    renderizar();

    expect(await screen.findByText('2 empresas na sua carteira.')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('Cadastro incompleto')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir Alfa Ltda' })).toHaveAttribute(
      'href',
      '/empresas/e-alfa',
    );
  });

  it('erro mostra o correlationId e permite tentar de novo', async () => {
    minha = () => problema(500, 'ERRO_DESCONHECIDO');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar a sua carteira')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    minha = () => json({ empresas: [empresa({ id: 'e-alfa', nome: 'Alfa Ltda', atribuida: true })] });
    const { container } = renderizar();
    await screen.findByText('Alfa Ltda');

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('HistoricoDeCarteiras', () => {
  const renderizar = () => render(<HistoricoDeCarteiras />, { wrapper: Envolvido });

  const EVENTO = evento({
    id: 'ev-1',
    origem: 'LOTE',
    afetados: [
      {
        usuarioId: 'bruno',
        usuarioNome: 'Bruno Lima',
        adicionadas: [{ id: 'e-alfa', nome: 'Alfa Ltda', cnpj: '11222333000181' }],
        removidas: [{ id: 'e-beta', nome: 'Beta Comércio', cnpj: '45242914000105' }],
        revisaoAnterior: 3,
        revisaoNova: 4,
      },
    ],
  });

  it('mostra autor, origem, afetados, empresas adicionadas e removidas, revisão e data em São Paulo', async () => {
    eventos = () => json({ eventos: [EVENTO], total: 1 });
    renderizar();

    expect(await screen.findByText('Operação em lote')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
    expect(screen.getByText('Revisão 3 → 4')).toBeInTheDocument();
    expect(screen.getByText(/Alfa Ltda \(11\.222\.333\/0001-81\)/)).toBeInTheDocument();
    expect(screen.getByText(/Beta Comércio \(45\.242\.914\/0001-05\)/)).toBeInTheDocument();
    expect(screen.getByText('Adicionadas (1)')).toBeInTheDocument();
    expect(screen.getByText('Removidas (1)')).toBeInTheDocument();
    // 15:30Z é 12:30 em America/Sao_Paulo (I-11).
    expect(screen.getByText('02/10/2026, 12:30')).toBeInTheDocument();
  });

  it('é somente leitura: nenhuma ação de escrita na tela', async () => {
    eventos = () => json({ eventos: [EVENTO], total: 1 });
    renderizar();
    await screen.findByText('Operação em lote');

    expect(screen.queryByRole('button', { name: /excluir|editar|remover/i })).not.toBeInTheDocument();
  });

  it('o vazio muda de texto conforme a causa: sem filtro e com filtro', async () => {
    const { unmount } = renderizar();

    expect(await screen.findByText('Nenhuma alteração de carteira registrada')).toBeInTheDocument();
    unmount();

    parametrosAtuais = new URLSearchParams('aba=CARTEIRAS&origem=LOTE');
    renderizar();

    expect(await screen.findByText('Nenhum evento no período ou filtro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('filtro de origem vai para a API e publica na URL', async () => {
    parametrosAtuais = new URLSearchParams('aba=CARTEIRAS&origem=ARQUIVAMENTO_EMPRESA');
    renderizar();
    await screen.findByText('Nenhum evento no período ou filtro');

    const chamadas = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(chamadas.some((url) => url.includes('origem=ARQUIVAMENTO_EMPRESA'))).toBe(true);
  });

  it('sem permissão, a recusa da API vira o estado de permissão insuficiente', async () => {
    eventos = () => problema(403, 'SEM_AUTORIZACAO');
    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver esta área')).toBeInTheDocument();
  });

  it('erro mostra o correlationId', async () => {
    eventos = () => problema(500, 'ERRO_DESCONHECIDO');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar o histórico')).toBeInTheDocument();
    expect(screen.getByText('corr-123')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    eventos = () => json({ eventos: [EVENTO], total: 1 });
    const { container } = renderizar();
    await screen.findByText('Operação em lote');

    expect(await axe(container)).toHaveNoViolations();
  });
});
