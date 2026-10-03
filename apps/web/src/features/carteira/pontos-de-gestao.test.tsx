/**
 * Os três pontos de gestão e a recusa por empresa (SPEC-009 §5.2, §3.5): aba
 * "Central de Carteiras" da área de usuários, aba "Carteira" do usuário e a tela
 * de empresa fora da carteira. Só o administrador vê as abas; a recusa da API é
 * o que vale, e a tela só a explica.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaginaDaEmpresa } from '../empresa/pagina-da-empresa';
import { catalogoDeTeste, sessaoDe } from '../papeis/papeis.fixtures';
import { AreaDeUsuarios } from '../usuarios/area-de-usuarios';
import { EdicaoDeUsuario } from '../usuarios/edicao-de-usuario';
import type { Sessao, VisaoDeUsuario } from '../usuarios/api';
import { Envolvido, colaborador, instalarFetch, json, problema, type Roteador } from './carteira.fixtures';

let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/configuracoes/usuarios',
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));

const ADMIN: Sessao = sessaoDe(['admin_escritorio']);
const AUDITOR: Sessao = sessaoDe(['auditor_readonly']);

const BRUNO: VisaoDeUsuario = {
  id: 'bruno',
  nome: 'Bruno Lima',
  email: 'bruno@escritorio.com',
  telefone: null,
  crc: null,
  papeis: ['contador'],
  papeisPersonalizados: [],
  estado: 'ATIVO',
  situacao: 'ATIVO',
  conviteExpiraEm: null,
  envioFalhou: false,
  versao: 0,
};

let sessaoAtual: Sessao = ADMIN;
let empresaAtual: () => Response | Promise<Response> = () => json({});

const roteador: Roteador = (url) => {
  if (url.endsWith('/usuarios/eu')) return json(sessaoAtual);
  if (url.endsWith('/papeis/catalogo')) return json(catalogoDeTeste());
  if (url.includes('/papeis?')) return json({ papeis: [], total: 0 });
  if (url.includes('/usuarios?')) return json({ usuarios: [BRUNO], total: 1 });
  if (url.endsWith('/usuarios/bruno')) return json(BRUNO);
  if (url.includes('/carteiras/colaboradores?')) {
    return json({ colaboradores: [colaborador({ id: 'bruno', nome: 'Bruno Lima' })], total: 1 });
  }
  if (url.endsWith('/carteiras/colaboradores/bruno')) {
    return json(colaborador({ id: 'bruno', nome: 'Bruno Lima' }));
  }
  if (url.includes('/carteiras/colaboradores/bruno/empresas?')) {
    return json({ empresas: [], total: 0 });
  }
  if (url.includes('/empresas/e-alfa')) return empresaAtual();

  return undefined;
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  sessaoAtual = ADMIN;
  empresaAtual = () => json({});
  instalarFetch(roteador);
});

describe('Central de Carteiras na área de usuários', () => {
  it('o administrador vê a aba e a Central abre pela URL, sem ação primária de página', async () => {
    parametrosAtuais = new URLSearchParams('aba=carteiras');
    render(<AreaDeUsuarios />, { wrapper: Envolvido });

    expect(await screen.findByRole('tab', { name: 'Central de Carteiras' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Convidar usuário/ })).not.toBeInTheDocument();
  });

  it('quem só consulta não vê a aba, e o link direto cai em Usuários', async () => {
    sessaoAtual = AUDITOR;
    parametrosAtuais = new URLSearchParams('aba=carteiras');
    render(<AreaDeUsuarios />, { wrapper: Envolvido });

    expect(await screen.findByRole('tab', { name: 'Usuários' })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByRole('tab', { name: 'Central de Carteiras' })).not.toBeInTheDocument();
  });
});

describe('aba Carteira do usuário', () => {
  it('o administrador a vê e ela mostra a gestão da carteira do colaborador', async () => {
    render(<EdicaoDeUsuario usuarioId="bruno" />, { wrapper: Envolvido });

    expect(await screen.findByRole('tab', { name: 'Carteira' })).toBeInTheDocument();
  });

  it('quem só consulta não tem a aba', async () => {
    sessaoAtual = AUDITOR;
    render(<EdicaoDeUsuario usuarioId="bruno" />, { wrapper: Envolvido });

    await screen.findByRole('tab', { name: 'Dados' });
    expect(screen.queryByRole('tab', { name: 'Carteira' })).not.toBeInTheDocument();
  });
});

describe('empresa fora da carteira', () => {
  it('403 nomeia a empresa e o CNPJ, diz que falta alçada e não libera nada além', async () => {
    empresaAtual = () =>
      problema(403, 'EMPRESA_FORA_DA_CARTEIRA', {
        detalhes: { empresa: { nome: 'Alfa Ltda', cnpj: '11.222.333/0001-81' } },
      });
    const { container } = render(<PaginaDaEmpresa empresaId="e-alfa" />, { wrapper: Envolvido });

    expect(await screen.findByText('Esta empresa não está na sua carteira')).toBeInTheDocument();
    expect(screen.getByText(/Alfa Ltda \(CNPJ 11\.222\.333\/0001-81\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver minha carteira' })).toHaveAttribute(
      'href',
      '/carteira',
    );
    // Nenhuma aba, formulário ou ação da empresa.
    expect(within(container).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(container).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('empresa de outro escritório ou inexistente segue como erro comum, sem nome nem CNPJ', async () => {
    empresaAtual = () => problema(404, 'EMPRESA_NAO_ENCONTRADA');
    render(<PaginaDaEmpresa empresaId="e-alfa" />, { wrapper: Envolvido });

    expect(await screen.findByText('Não foi possível carregar a empresa')).toBeInTheDocument();
    expect(screen.queryByText(/carteira/i)).not.toBeInTheDocument();
  });
});
