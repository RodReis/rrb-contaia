import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ler } = vi.hoisted(() => ({ ler: vi.fn() }));
vi.mock('../importacao/api', () => ({ ler }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../usuarios/queries', () => ({ useSessao: () => ({ data: { permissoes: ['contabil.estrutura_contabil.consultar','contabil.estrutura_contabil.manter_plano_contas','contabil.estrutura_contabil.arquivar','contabil.estrutura_contabil.reativar'] } }) }));

import { CatalogoOperacional } from './catalogo-operacional';

const envolver = (ui: React.ReactNode) => {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={cliente}>{ui}</QueryClientProvider>);
};

describe('catálogo contábil operacional', () => {
  beforeEach(() => { ler.mockReset(); Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}); });
  it('exibe conta incompleta, preserva saldo normal ao classificar e invalida consulta', async () => {
    ler.mockResolvedValue({ items: [{ code: '1.01', name: 'Caixa', type: 'ANALYTICAL', parentCode: null, status: 'INCOMPLETE', version: '1', accountClass: null, normalBalance: 'CREDIT', costCenterPolicy: null }], nextCursor: null, incompleteCount: 1 });
    envolver(<CatalogoOperacional empresaId="empresa-1" somenteLeitura={false} />);
    expect(await screen.findByText('Classe pendente')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Caixa'));
    expect(await screen.findByRole('heading', { name: 'Conta 1.01' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Classe contábil' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ativo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar conta' }));
    await waitFor(() => expect(ler).toHaveBeenCalledWith('/empresas/empresa-1/estrutura-contabil/contas/1.01', expect.objectContaining({ method: 'PUT' })));
    const envio = ler.mock.calls.find(([, opcoes]) => opcoes?.method === 'PUT');
    expect(JSON.parse(String(envio?.[1]?.body))).toMatchObject({ normalBalance: 'CREDIT', accountClass: 'ASSET' });
  });

  it('permite pesquisar e informa resultado vazio', async () => {
    ler.mockResolvedValue({ items: [], nextCursor: null, incompleteCount: 0 });
    envolver(<CatalogoOperacional empresaId="empresa-1" somenteLeitura />);
    expect(await screen.findByText('Nenhum item encontrado.')).toBeInTheDocument();
  });

  it('exibe cobertura indeterminada na nova aba sem sugerir pacote alternativo', async () => {
    ler.mockResolvedValueOnce({ items: [], nextCursor: null, incompleteCount: 0 }).mockResolvedValueOnce({
      company: { id: 'empresa-1', name: 'Empresa', cnpj: '12345678000190' }, calendarYear: 2025,
      taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, applicability: 'INDETERMINATE',
      selectedPackageId: null, packages: [], mappings: [], eligibleAccounts: [], referenceAccounts: [], draftDecisions: [],
    });
    envolver(<CatalogoOperacional empresaId="empresa-1" somenteLeitura />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Plano referencial' }));
    expect(await screen.findByText('Cobertura oficial indeterminada')).toBeInTheDocument();
    expect(screen.getByText(/não oferece pacote, rascunho ou publicação/u)).toBeInTheDocument();
    await waitFor(() => expect(ler).toHaveBeenCalledWith('/empresas/empresa-1/plano-referencial?calendarYear=2025&taxRegime=LUCRO_PRESUMIDO'));
  });

  it('cria rascunho somente quando a cobertura está disponível', async () => {
    const consulta = {
      company: { id: 'empresa-1', name: 'Empresa', cnpj: '12345678000190' }, calendarYear: 2025,
      taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, applicability: 'APPLICABLE', selectedPackageId: 'pkg-2025',
      packages: [{ id: 'pkg-2025', authority: 'RFB', sourceDocument: 'ECF leiaute 12', sourceUrl: 'https://example.test',
        layout: '12', revision: '2026-09-07', coveredCalendarYears: [2025], coveredSpecialSituations: [], downloadedAt: '2026-09-08T00:00:00Z',
        sourceSha256: 'a'.repeat(64), canonicalSha256: 'b'.repeat(64), status: 'AVAILABLE' }], mappings: [], eligibleAccounts: [], referenceAccounts: [], draftDecisions: [],
    };
    ler.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.includes('/plano-referencial?')) return consulta;
      if (options?.method === 'POST') return { mappingId: 'mapping-1', revision: 0, status: 'DRAFT' };
      return { items: [], nextCursor: null, incompleteCount: 0 };
    });
    envolver(<CatalogoOperacional empresaId="empresa-1" somenteLeitura={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Plano referencial' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Criar rascunho do exercício' }));
    await waitFor(() => expect(ler).toHaveBeenCalledWith('/empresas/empresa-1/plano-referencial/rascunhos', expect.objectContaining({ method: 'POST' })));
  });

  it('salva mapeamento-base do rascunho com revisão esperada', async () => {
    const consulta = {
      company: { id: 'empresa-1', name: 'Empresa', cnpj: '12345678000190' }, calendarYear: 2025,
      taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, applicability: 'APPLICABLE', selectedPackageId: 'pkg-2025',
      packages: [{ id: 'pkg-2025', authority: 'RFB', sourceDocument: 'ECF leiaute 12', sourceUrl: 'https://example.test',
        layout: '12', revision: '2026-09-07', coveredCalendarYears: [2025], coveredSpecialSituations: [], downloadedAt: '2026-09-08T00:00:00Z',
        sourceSha256: 'a'.repeat(64), canonicalSha256: 'b'.repeat(64), status: 'AVAILABLE' }],
      mappings: [{ id: 'mapping-1', calendarYear: 2025, taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, packageId: 'pkg-2025',
        applicability: 'APPLICABLE', status: 'DRAFT', version: null, revision: 2, canonicalSha256: null, createdAt: '2026-09-08T00:00:00Z', publishedAt: null }],
      eligibleAccounts: [{ id: 'account-1', code: '1.01', name: 'Caixa', nature: 'devedora', accountClass: 'ASSET', costCenterPolicy: 'FORBIDDEN', complete: true }],
      referenceAccounts: [{ code: '1.01', description: 'Caixa', sourceNature: 'DEBIT', parentCode: null, validFrom: null, validTo: null, status: 'ACTIVE' }],
      draftDecisions: [],
    };
    ler.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.includes('/plano-referencial?')) return consulta;
      if (options?.method === 'PUT') return { mappingId: 'mapping-1', revision: 3, status: 'DRAFT' };
      return { items: [], nextCursor: null, incompleteCount: 0 };
    });
    envolver(<CatalogoOperacional empresaId="empresa-1" somenteLeitura={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Plano referencial' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Decisão da conta 1.01' }), { target: { value: 'MAPPED' } });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Referência da conta 1.01' }), { target: { value: '1.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar decisões' }));
    await waitFor(() => expect(ler).toHaveBeenCalledWith('/empresas/empresa-1/plano-referencial/rascunhos/mapping-1/decisoes',
      expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"expectedRevision":2') })));
    const payload = ler.mock.calls.find(([path, options]) => String(path).includes('/decisoes') && options?.method === 'PUT');
    expect(JSON.parse(String(payload?.[1]?.body))).toMatchObject({ decisions: [{ accountCode: '1.01', referenceCode: '1.01', kind: 'MAPPED' }] });
  });
});
