/**
 * Pendência de plano de contas incompleto na Central (SPEC-013 §3.10): aparece com rótulo
 * próprio e não se dispensa — resolve-se importando ou cadastrando a primeira conta válida.
 * A ação leva à aba "Plano de contas" da empresa, só para quem consulta o plano.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Envolvido, instalarFetch, json, type Roteador } from '../cofre/cofre.fixtures';
import { CentralDePendencias } from './central-de-pendencias';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

const planoIncompleto = {
  id: 'pend-plano',
  empresaId: 'empresa-1',
  empresaNome: 'Padaria Aurora',
  origem: 'PLANO_CONTAS',
  tipo: 'PLANO_CONTAS_INCOMPLETO',
  chave: 'plano-contas:incompleto',
  estado: 'ABERTA',
  dataLimite: null,
  criadoEm: '2026-10-01T00:00:00.000Z',
  resolvidoEm: null,
};

let pendencias: readonly (typeof planoIncompleto)[] = [];
let permissoes: readonly string[] = [];

const roteador: Roteador = (url) => {
  if (url.includes('/api/proxy/pendencias?')) {
    return json({ pendencias, total: pendencias.length });
  }

  return url.endsWith('/api/proxy/usuarios/eu')
    ? json({ papeis: ['contador'], permissoes, escopoDeEmpresas: 'CARTEIRA' })
    : undefined;
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  pendencias = [planoIncompleto];
  permissoes = ['empresas.plano_contas.consultar'];
  instalarFetch(roteador);
});

describe('Central de Pendências — origem Plano de contas', () => {
  it('mostra origem e tipo em português, sem oferecer dispensa', async () => {
    render(<CentralDePendencias />, { wrapper: Envolvido });

    // A mesma pendência aparece no cartão (telas estreitas) e na linha da tabela (tablet+).
    const tabela = await screen.findByRole('table', { name: /Pendências cadastrais e documentais/u });
    const linha = within(tabela).getAllByRole('row').find((r) => within(r).queryByText('Padaria Aurora') !== null);
    expect(linha).toBeDefined();
    if (linha === undefined) {
      return;
    }
    expect(within(linha).getByText('Plano de contas incompleto')).toBeInTheDocument();
    expect(within(linha).getByText('Plano de contas')).toBeInTheDocument();
    const cartao = screen.getAllByRole('listitem').find((item) => within(item).queryByText('Padaria Aurora') !== null);
    expect(cartao).toBeDefined();
    if (cartao !== undefined) {
      expect(within(cartao).getByText('Plano de contas incompleto')).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Dispensar' })).not.toBeInTheDocument();
  });

  it('leva à aba Plano de contas da empresa quem consulta o plano', async () => {
    render(<CentralDePendencias />, { wrapper: Envolvido });

    const acoes = await screen.findAllByRole('link', { name: 'Abrir aba Plano de contas de Padaria Aurora' });

    expect(acoes[0]).toHaveAttribute('href', '/empresas/empresa-1?aba=plano-contas');
    expect(acoes[0]).toHaveTextContent('Abrir aba Plano de contas');
  });

  it('não oferece o atalho a quem não consulta o plano de contas', async () => {
    permissoes = ['pendencias.central.consultar'];

    render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/usuarios/eu'))).toBe(true));

    expect(screen.queryByRole('link', { name: /Plano de contas de Padaria Aurora/u })).not.toBeInTheDocument();
  });

  it('o filtro de origem oferece "Plano de contas"', async () => {
    parametrosAtuais = new URLSearchParams('origem=PLANO_CONTAS');

    render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');

    expect(screen.getByRole('combobox', { name: /Origem/u })).toHaveTextContent('Plano de contas');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');

    expect(await axe(container)).toHaveNoViolations();
  });
});
