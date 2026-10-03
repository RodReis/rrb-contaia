import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavegacaoPrincipal } from './navegacao-principal';

vi.mock('next/navigation', () => ({ usePathname: () => '/empresas' }));

const sessao = (papeis: string[], permissoes: string[]) =>
  new Response(
    JSON.stringify({ papeis, permissoes, escopoDeEmpresas: 'CARTEIRA' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const links = (): string[] =>
  screen.getAllByRole('link').map((elemento) => elemento.textContent ?? '');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NavegacaoPrincipal', () => {
  it('administrador vê Empresas, Histórico e Usuários e permissões', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sessao(
        ['admin_escritorio'],
        [
          'empresas.cadastro.consultar',
          'historico.global.consultar',
          'empresas.historico.consultar',
          'usuarios.usuarios_e_papeis.consultar',
          'usuarios.usuarios_e_papeis.administrar',
        ],
      ),
    );

    render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    await waitFor(() => expect(links()).toContain('Usuários e permissões'));
    expect(links()).toEqual([
      'Empresas',
      'Histórico de Informações',
      'Minha carteira',
      'Usuários e permissões',
    ]);
  });

  it('auxiliar não vê Histórico nem Usuários e permissões', async () => {
    vi.mocked(fetch).mockResolvedValue(sessao(['auxiliar'], ['empresas.cadastro.consultar']));

    render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // "Minha carteira" é de qualquer usuário ativo: a API devolve só os vínculos da própria sessão.
    await waitFor(() => expect(links()).toEqual(['Empresas', 'Minha carteira']));
  });

  it('contador vê o Histórico, mas não Usuários e permissões', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sessao(['contador'], [
        'empresas.cadastro.consultar',
        'historico.global.consultar',
        'empresas.historico.consultar',
      ]),
    );

    render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    await waitFor(() => expect(links()).toContain('Histórico de Informações'));
    expect(links()).not.toContain('Usuários e permissões');
  });

  it('permissão vinda de papel personalizado abre o item, como a de qualquer papel padrão', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sessao(['auxiliar'], [
        'empresas.cadastro.consultar',
        'historico.global.consultar',
        'empresas.historico.consultar',
      ]),
    );

    render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    await waitFor(() => expect(links()).toContain('Histórico de Informações'));
    // Papel personalizado nunca concede a área exclusiva de usuários e papéis.
    expect(links()).not.toContain('Usuários e permissões');
  });

  it('o Histórico exige o global e o cadastral, como a API: só um deles não abre o item', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sessao(['auxiliar'], ['empresas.cadastro.consultar', 'historico.global.consultar']),
    );

    render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // "Minha carteira" é de qualquer usuário ativo: a API devolve só os vínculos da própria sessão.
    await waitFor(() => expect(links()).toEqual(['Empresas', 'Minha carteira']));
  });

  it('enquanto a sessão carrega ou se falhar, só os itens que toda sessão válida tem aparecem', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

    render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    expect(links()).toEqual(['Empresas', 'Minha carteira']);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(links()).toEqual(['Empresas', 'Minha carteira']);
  });

  it('marca a página atual com aria-current e passa no axe', async () => {
    vi.mocked(fetch).mockResolvedValue(sessao(['auxiliar'], ['empresas.cadastro.consultar']));

    const { container } = render(<NavegacaoPrincipal />, { wrapper: Envolvido });

    expect(screen.getByRole('link', { name: 'Empresas' })).toHaveAttribute('aria-current', 'page');
    expect(await axe(container)).toHaveNoViolations();
  });
});
