import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listarModelosMock, listarVersoesMock, obterVersaoMock, provenanceMock, toastError } = vi.hoisted(() => ({
  listarModelosMock: vi.fn(), listarVersoesMock: vi.fn(), obterVersaoMock: vi.fn(), provenanceMock: vi.fn(), toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/usuarios/queries', () => ({ useSessao: () => ({ data: { permissoes: ['contabil.dre_gerencial.consultar', 'contabil.dre_gerencial.editar', 'contabil.dre_gerencial.publicar'] } }) }));
vi.mock('@/features/empresa/api', () => ({ listarEmpresas: vi.fn().mockResolvedValue({ empresas: [] }) }));
vi.mock('../dre-gerencial/api', () => ({ listarVersoesDre: vi.fn().mockResolvedValue([]), obterVersaoDre: vi.fn() }));
vi.mock('./api', () => ({
  listarModelos: listarModelosMock, listarVersoesModelo: listarVersoesMock, obterVersaoModelo: obterVersaoMock,
  consultarProvenienciaModelo: provenanceMock, criarModelo: vi.fn(), criarModeloDaEmpresa: vi.fn(), renomearModelo: vi.fn(),
  arquivarModelo: vi.fn(), reativarModelo: vi.fn(), criarVersaoModelo: vi.fn(), descartarRascunhoModelo: vi.fn(),
  salvarLinhasModelo: vi.fn(), publicarModelo: vi.fn(), aplicarModelo: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { ModelosDre } from './modelos-dre';
import { ErroDaApi } from '@/lib/http';

describe('biblioteca de modelos DRE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarModelosMock.mockResolvedValue({ items: [{ id: 'modelo-1', name: 'DRE varejo', description: 'Estrutura padrão', status: 'ACTIVE', createdBy: 'user-1', updatedBy: 'user-1', updatedByName: 'Contadora F46', createdAt: '2097-01-01', updatedAt: '2097-01-01', activeVersion: 1, activeOrigin: 'MANUAL' }] });
    listarVersoesMock.mockResolvedValue({ items: [{ id: 'versao-1', version: 1, status: 'DRAFT', revision: 0, origin: 'MANUAL', structuralHash: null, createdBy: 'user-1', createdAt: '2097-01-01', publishedBy: null, publishedAt: null }] });
    obterVersaoMock.mockResolvedValue({ model: { id: 'modelo-1', name: 'DRE varejo' }, version: { id: 'versao-1', version: 1, status: 'DRAFT', revision: 0, origin: 'MANUAL', structuralHash: null }, lines: [{ code: 'RECEITA', title: 'Receita líquida', type: 'DETAIL', order: 1, level: 0, parentCode: null, presentationSign: 1, components: [], verticalBasis: true }] });
    provenanceMock.mockResolvedValue({ origin: { type: 'MANUAL' }, applications: [] });
  });

  it('abre um rascunho editável e expõe uma linha sem vínculos contábeis', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ModelosDre/></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /DRE varejo/ }));
    expect(await screen.findByRole('heading', { name: 'DRE varejo' })).toBeInTheDocument();
    expect(screen.getByText(/Atualizado em/)).toHaveTextContent('Contadora F46');
    expect(await screen.findByDisplayValue('RECEITA')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Receita líquida')).toBeInTheDocument();
    expect(screen.getByText('Contas contábeis nunca fazem parte do modelo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descartar rascunho/ })).toBeInTheDocument();
  });

  it('mantém erro da biblioteca com código de suporte copiável', async () => {
    listarModelosMock.mockRejectedValueOnce(new ErroDaApi({ type: 'x', title: 'Falha', status: 503, code: 'ERRO_INTERNO', correlationId: 'corr-f46-ui' }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ModelosDre/></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Biblioteca indisponível');
    expect(screen.getByText('corr-f46-ui')).toBeInTheDocument();
  });
});
