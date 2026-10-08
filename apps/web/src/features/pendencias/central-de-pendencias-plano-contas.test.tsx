/**
 * Pendência de plano de contas incompleto na Central (SPEC-013 §3.10): aparece com rótulo
 * próprio e não se dispensa — resolve-se importando ou cadastrando a primeira conta válida.
 * O atalho para a aba "Plano de contas" chega com a interface da F13.
 */
import { render, screen } from '@testing-library/react';
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

const roteador: Roteador = (url) =>
  url.includes('/api/proxy/pendencias?') ? json({ pendencias, total: pendencias.length }) : undefined;

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  pendencias = [planoIncompleto];
  instalarFetch(roteador);
});

describe('Central de Pendências — origem Plano de contas', () => {
  it('mostra origem e tipo em português, sem oferecer dispensa', async () => {
    render(<CentralDePendencias />, { wrapper: Envolvido });

    expect((await screen.findAllByText('Plano de contas incompleto')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Plano de contas').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Dispensar' })).not.toBeInTheDocument();
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
