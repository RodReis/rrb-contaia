/**
 * Provas de tela da Central de Carteiras (SPEC-009 §5.1, §5.3): lista orientada a
 * colaboradores, filtros na URL, seleção para o lote e os estados obrigatórios.
 * A API é dublada no `fetch`, por rota.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CentralDeCarteiras } from './central-de-carteiras';
import {
  Envolvido,
  colaborador,
  empresa,
  instalarFetch,
  json,
  problema,
  type Roteador,
} from './carteira.fixtures';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/configuracoes/usuarios',
}));

const ANA = colaborador({ id: 'ana', nome: 'Ana Souza', empresas: 3, papeis: ['admin_escritorio'] });
const BRUNO = colaborador({ id: 'bruno', nome: 'Bruno Lima', empresas: 0 });
const ELISA = colaborador({ id: 'elisa', nome: 'Elisa Prado', estado: 'ARQUIVADO' });

let lista: () => Response | Promise<Response> = () =>
  json({ colaboradores: [ANA, BRUNO], total: 2 });
const chamadas: string[] = [];

const roteador: Roteador = (url) => {
  chamadas.push(url);

  if (url.includes('/carteiras/colaboradores/') && url.includes('/empresas?')) {
    return json({
      empresas: [empresa({ id: 'e1', nome: 'Alfa Ltda' })],
      total: 1,
    });
  }
  if (url.includes('/carteiras/colaboradores?')) return lista();

  return undefined;
};

const renderizar = () => render(<CentralDeCarteiras />, { wrapper: Envolvido });
const naTabela = () => within(screen.getByRole('table'));

beforeEach(() => {
  parametrosAtuais = new URLSearchParams('aba=carteiras');
  lista = () => json({ colaboradores: [ANA, BRUNO], total: 2 });
  chamadas.length = 0;
  substituir.mockClear();
  instalarFetch(roteador);
});

describe('CentralDeCarteiras', () => {
  it('mostra Skeleton enquanto carrega e depois a lista orientada a colaboradores', async () => {
    renderizar();

    expect(screen.getByText('Carregando os colaboradores do escritório')).toBeInTheDocument();
    expect(await naTabelaAguardada()).toBeTruthy();

    const tabela = naTabela();
    expect(tabela.getByText('Ana Souza')).toBeInTheDocument();
    expect(tabela.getByText('Bruno Lima')).toBeInTheDocument();
    // Quantidade de empresas dita por extenso; zero vira "Sem empresas".
    expect(tabela.getByText('3 empresas')).toBeInTheDocument();
    expect(tabela.getByText('Sem empresas')).toBeInTheDocument();
    expect(screen.getByText('2 colaboradores encontrados.')).toBeInTheDocument();
  });

  it('abre com colaboradores ativos: arquivados dependem de seleção explícita', async () => {
    renderizar();
    await naTabelaAguardada();

    expect(chamadas.some((url) => url.includes('estado=ATIVO'))).toBe(true);
  });

  it('cada linha oferece "Gerenciar carteira" apontando para a página dedicada do colaborador', async () => {
    renderizar();
    await naTabelaAguardada();

    const link = naTabela().getByRole('link', { name: 'Gerenciar carteira de Ana Souza' });

    expect(link).toHaveAttribute('href', '/configuracoes/usuarios/carteiras/ana');
  });

  it('lista vazia sem filtro explica o que fazer; com filtro, oferece limpar', async () => {
    lista = () => json({ colaboradores: [], total: 0 });
    const { unmount } = renderizar();

    expect(await screen.findByText('Nenhum colaborador ativo')).toBeInTheDocument();
    unmount();

    parametrosAtuais = new URLSearchParams('aba=carteiras&busca=zzz');
    renderizar();

    expect(await screen.findByText('Nenhum colaborador encontrado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('erro mostra o correlationId e permite tentar de novo', async () => {
    lista = () => problema(500, 'ERRO_DESCONHECIDO');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar as carteiras')).toBeInTheDocument();
    expect(screen.getByText('corr-123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('sem permissão de administração, a recusa da API vira o estado de permissão insuficiente', async () => {
    lista = () => problema(403, 'SEM_AUTORIZACAO');
    renderizar();

    expect(
      await screen.findByText('Você não tem permissão para ver esta área'),
    ).toBeInTheDocument();
  });

  it('seleção habilita as operações em lote e nomeia quantos foram escolhidos', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await naTabelaAguardada();

    expect(screen.queryByRole('region', { name: 'Operações em lote' })).not.toBeInTheDocument();

    await usuario.click(naTabela().getByRole('checkbox', { name: 'Selecionar Ana Souza' }));
    await usuario.click(naTabela().getByRole('checkbox', { name: 'Selecionar Bruno Lima' }));

    const lote = screen.getByRole('region', { name: 'Operações em lote' });
    expect(within(lote).getByText('2 colaboradores selecionados')).toBeInTheDocument();
    expect(within(lote).getByRole('button', { name: /Adicionar empresas/ })).toBeEnabled();
    expect(within(lote).getByRole('button', { name: /Remover empresas/ })).toBeEnabled();
  });

  it('selecionar a página inteira e limpar a seleção', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await naTabelaAguardada();

    await usuario.click(
      naTabela().getByRole('checkbox', { name: 'Selecionar todos os colaboradores desta página' }),
    );
    expect(screen.getByText('2 colaboradores selecionados')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    expect(screen.queryByRole('region', { name: 'Operações em lote' })).not.toBeInTheDocument();
  });

  it('usuário arquivado na seleção bloqueia o lote e explica por quê', async () => {
    lista = () => json({ colaboradores: [ANA, ELISA], total: 2 });
    parametrosAtuais = new URLSearchParams('aba=carteiras&estado=ARQUIVADO');
    const usuario = userEvent.setup();
    renderizar();
    await naTabelaAguardada();

    await usuario.click(naTabela().getByRole('checkbox', { name: 'Selecionar Elisa Prado' }));

    const lote = screen.getByRole('region', { name: 'Operações em lote' });
    expect(within(lote).getByRole('button', { name: /Adicionar empresas/ })).toBeDisabled();
    expect(within(lote).getByRole('button', { name: /Remover empresas/ })).toBeDisabled();
    expect(within(lote).getByRole('note')).toHaveTextContent(/usuário arquivado/i);
  });

  it('filtro de carteira publica na URL e volta à primeira página', async () => {
    parametrosAtuais = new URLSearchParams('aba=carteiras&pagina=3');
    renderizar();
    await naTabelaAguardada();

    // O Select do Radix abre por teclado no jsdom, como nas demais telas de lista.
    screen.getByRole('combobox', { name: /Carteira/u }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(substituir).toHaveBeenCalled());
    const destino = String(substituir.mock.calls.at(-1)?.[0]);
    expect(destino).toContain('carteira=SEM_EMPRESAS');
    expect(destino).toContain('aba=carteiras');
    expect(destino).not.toContain('pagina=');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderizar();
    await naTabelaAguardada();

    expect(await axe(container)).toHaveNoViolations();
  });
});

const naTabelaAguardada = async () => screen.findByRole('table');
