/**
 * Pendências do cofre de certificados na Central (SPEC-011 §3.4–3.6): certificado
 * ausente, vencido, desativado e sem responsável aparecem com rótulo próprio e
 * levam ao registro da empresa no cofre — não se dispensam, resolvem-se lá.
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

const doCofre = (tipo: string) => ({
  id: 'pend-cofre',
  empresaId: 'empresa-1',
  empresaNome: 'Padaria Aurora',
  origem: 'CERTIFICADO',
  tipo,
  chave: tipo === 'CERTIFICADO_SEM_RESPONSAVEL' ? 'certificado:responsavel' : 'certificado:ausente',
  estado: 'ABERTA',
  dataLimite: null,
  criadoEm: '2026-10-01T00:00:00.000Z',
  resolvidoEm: null,
});

let pendencias: readonly ReturnType<typeof doCofre>[] = [];

const roteador: Roteador = (url) =>
  url.includes('/api/proxy/pendencias?') ? json({ pendencias, total: pendencias.length }) : undefined;

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  pendencias = [];
  instalarFetch(roteador);
});

describe('Central de Pendências — origem Certificado', () => {
  it.each([
    ['CERTIFICADO_AUSENTE', 'Certificado ausente'],
    ['CERTIFICADO_VENCIDO', 'Certificado vencido'],
    ['CERTIFICADO_SEM_RESPONSAVEL', 'Certificado sem responsável'],
  ])('%s aparece com rótulo e leva ao cofre, sem oferecer dispensa', async (tipo, rotulo) => {
    pendencias = [doCofre(tipo)];

    render(<CentralDePendencias />, { wrapper: Envolvido });

    expect((await screen.findAllByText(rotulo)).length).toBeGreaterThan(0);
    const acoes = screen.getAllByRole('link', {
      name: 'Abrir Padaria Aurora no cofre de certificados',
    });

    expect(acoes[0]).toHaveAttribute('href', '/configuracoes/cofre?empresa=empresa-1');
    expect(screen.queryByRole('button', { name: 'Dispensar' })).not.toBeInTheDocument();
  });

  it('o filtro de origem oferece "Certificado"', async () => {
    pendencias = [doCofre('CERTIFICADO_AUSENTE')];
    parametrosAtuais = new URLSearchParams('origem=CERTIFICADO');

    render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');

    expect(screen.getByRole('combobox', { name: /Origem/u })).toHaveTextContent('Certificado');
  });

  it('não tem violações de acessibilidade', async () => {
    pendencias = [doCofre('CERTIFICADO_VENCIDO')];

    const { container } = render(<CentralDePendencias />, { wrapper: Envolvido });
    await screen.findAllByText('Padaria Aurora');

    expect(await axe(container)).toHaveNoViolations();
  });
});
