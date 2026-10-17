import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './dashboard';

const nav = vi.hoisted(() => ({ values: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => '/painel',
  useSearchParams: () => nav.values,
}));

const empresaId = '22222222-2222-4222-8222-222222222222';
const motivoId = '33333333-3333-4333-8333-333333333333';
const empresas = [{ empresa_id: empresaId, cnpj: '11222333000181', nome: 'Padaria Aurora', regime: 'SIMPLES_NACIONAL', cor: 'AMARELO',
  contagens_fontes: { PENDENCIAS: 1 }, contagens_gravidade: { AMARELO: 1 }, atualizado_em: '2026-10-17T12:00:00Z', resumo: null,
  motivo_prioritario: { fonte: 'PENDENCIAS', codigo: 'DOCUMENTAL_DOCUMENTO_AUSENTE', gravidade: 'AMARELO', descricao: 'Documento ausente.' }, total_motivos: 1, proxima_data: null }];
const motivo = { fonte: 'PENDENCIAS', codigo: 'DOCUMENTAL_DOCUMENTO_AUSENTE', gravidade: 'AMARELO', origem_id: motivoId,
  descricao: 'Documento ausente.', data_referencia: null, atualizado_em: '2026-10-17T12:00:00Z', identidade: 'id-1', revisao_fonte: '1', processado_em: '2026-10-17T12:00:00Z' };
const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><main>{children}</main></QueryClientProvider>;

beforeEach(() => {
  nav.values = new URLSearchParams(); nav.push.mockReset(); nav.replace.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard?')) return resposta({ resumo: { total: 1, vermelho: 0, amarelo: 1, verde: 0, vencidas: 0, d3: 0, manifestacoes: 0, capturas: 0, certificados: 0 }, empresas, total: 1 });
    if (url.includes('/motivos')) return resposta([motivo]);
    if (url.includes('/usuarios/eu')) return resposta({ papeis: ['contador'], permissoes: ['empresas.cadastro.consultar', 'pendencias.pendencias.consultar'], escopoDeEmpresas: 'CARTEIRA' });
    return resposta({}, 404);
  }));
});

describe('Dashboard F23', () => {
  it('mostra lista acessível, CNPJ mascarado, filtra por URL e preserva o link de detalhe', async () => {
    nav.values = new URLSearchParams({ empresa: empresaId });
    render(<Dashboard />, { wrapper });
    expect(await screen.findByRole('dialog', { name: /Padaria Aurora/u })).toBeVisible();
    expect(screen.getAllByText('11.***.***/****-81')).toHaveLength(2);
    expect(screen.getByText('Em atenção')).toBeVisible();
    expect(await screen.findByText('Documento ausente.', { selector: 'h3' })).toBeVisible();
    const link = screen.getByRole('link', { name: 'Abrir pendências' });
    expect(link).toHaveAttribute('href', `/pendencias?empresaId=${empresaId}`);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('preserva filtros ao selecionar empresa na URL e apresenta vazio e erro', async () => {
    nav.values = new URLSearchParams({ cor: 'AMARELO', pagina: '1', empresa: empresaId });
    const { unmount } = render(<Dashboard />, { wrapper });
    expect(await screen.findByRole('dialog')).toBeVisible();
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => resposta({ type: 'x', title: 'x', status: 503, code: 'x', correlationId: 'corr' }, 503)));
    render(<Dashboard />, { wrapper });
    expect(await screen.findByText('Dashboard indisponível')).toBeVisible();
  });

  it('mantém ordenação e tamanho da página na URL e preserva seleção ao paginar', async () => {
    nav.values = new URLSearchParams({ pagina: '2' });
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper });
    await screen.findByRole('heading', { name: 'Visão da carteira' });
    await user.click(screen.getByRole('button', { name: 'Ver detalhes' }));
    expect(nav.push).toHaveBeenLastCalledWith(expect.stringContaining(`pagina=2&empresa=${empresaId}`), { scroll: false });
    const ordenar = screen.getByRole('combobox', { name: 'Ordenar por' });
    await user.click(ordenar);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('ordem=NOME'), { scroll: false });
    const tamanho = screen.getByRole('combobox', { name: 'Itens por página' });
    await user.click(tamanho);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(nav.push).toHaveBeenLastCalledWith(expect.stringContaining('limite=50'), { scroll: false });
    expect(nav.push).toHaveBeenLastCalledWith(expect.not.stringContaining('pagina=2'), { scroll: false });
  });
});
