/**
 * Pendência de empregados não importados na Central (SPEC-014 §3.10): rótulo próprio, sem
 * dispensa — resolve-se com o primeiro empregado confirmado. A ação leva à aba "Empregados" da
 * empresa, só para quem consulta empregados.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Envolvido, instalarFetch, json, type Roteador } from '../cofre/cofre.fixtures';
import { CentralDePendencias } from './central-de-pendencias';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

let parametrosAtuais = new URLSearchParams();

const semEmpregados = {
  id: 'pend-empregados',
  empresaId: 'empresa-1',
  empresaNome: 'Padaria Aurora',
  origem: 'EMPREGADOS',
  tipo: 'EMPREGADOS_NAO_IMPORTADOS',
  chave: 'empregados:nao-importados',
  estado: 'ABERTA',
  dataLimite: null,
  criadoEm: '2026-10-01T00:00:00.000Z',
  resolvidoEm: null,
};

let permissoes: readonly string[] = [];

const roteador: Roteador = (url) => {
  if (url.includes('/api/proxy/pendencias?')) {
    return json({ pendencias: [semEmpregados], total: 1 });
  }

  return url.endsWith('/api/proxy/usuarios/eu')
    ? json({ papeis: ['contador'], permissoes, escopoDeEmpresas: 'CARTEIRA' })
    : undefined;
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  permissoes = ['empresas.empregados.consultar'];
  instalarFetch(roteador);
});

describe('Central de Pendências — origem Empregados', () => {
  it('mostra origem e tipo em português, sem oferecer dispensa', async () => {
    render(<CentralDePendencias />, { wrapper: Envolvido });

    const tabela = await screen.findByRole('table', { name: /Pendências cadastrais e documentais/u });
    const linha = within(tabela).getAllByRole('row').find((r) => within(r).queryByText('Padaria Aurora') !== null);
    expect(linha).toBeDefined();
    if (linha === undefined) {
      return;
    }
    expect(within(linha).getByText('Empregados não importados')).toBeInTheDocument();
    expect(within(linha).getByText('Empregados')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispensar' })).not.toBeInTheDocument();
  });

  it('leva à aba Empregados da empresa quem consulta empregados', async () => {
    render(<CentralDePendencias />, { wrapper: Envolvido });

    const acoes = await screen.findAllByRole('link', { name: 'Abrir aba Empregados de Padaria Aurora' });

    expect(acoes[0]).toHaveAttribute('href', '/empresas/empresa-1?aba=empregados');
    expect(acoes[0]).toHaveTextContent('Abrir aba Empregados');
  });

  it('não oferece o atalho a quem não consulta empregados', async () => {
    permissoes = ['pendencias.central.consultar'];

    render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/usuarios/eu'))).toBe(true));

    expect(screen.queryByRole('link', { name: /Empregados de Padaria Aurora/u })).not.toBeInTheDocument();
  });

  it('o filtro de origem oferece "Empregados"', async () => {
    parametrosAtuais = new URLSearchParams('origem=EMPREGADOS');

    render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');

    expect(screen.getByRole('combobox', { name: /Origem/u })).toHaveTextContent('Empregados');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');

    expect(await axe(container)).toHaveNoViolations();
  });
});
