import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PainelDossieDecisaoIcmsSt } from './painel-dossie-decisao-icms-st';
import { listarDossiesIcmsSt, listarFontesAcrescimosF34, listarRegrasDestinoIcmsSt, listarResultadosAcrescimosF34 } from './api';

vi.mock('./api', () => ({
  anexarEvidenciaDossieIcmsSt: vi.fn(), criarDossieIcmsSt: vi.fn(), decidirDossieIcmsSt: vi.fn(), decidirRegraDestinoIcmsSt: vi.fn(),
  exportarDossieIcmsSt: vi.fn(), importarRegraDestinoIcmsSt: vi.fn(), listarDossiesIcmsSt: vi.fn(), listarEvidenciasDossieIcmsSt: vi.fn(),
  listarFontesAcrescimosF34: vi.fn(), listarRegrasDestinoIcmsSt: vi.fn(), listarResultadosAcrescimosF34: vi.fn(),
}));

const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

describe('painel do dossiê interno ICMS-ST F35', () => {
  beforeEach(() => {
    vi.mocked(listarFontesAcrescimosF34).mockResolvedValue({ itens: [] });
    vi.mocked(listarResultadosAcrescimosF34).mockResolvedValue({ itens: [] });
    vi.mocked(listarRegrasDestinoIcmsSt).mockResolvedValue({ items: [] });
    vi.mocked(listarDossiesIcmsSt).mockResolvedValue({ items: [] });
  });

  it('exibe estado vazio e impede criar sem fontes elegíveis', async () => {
    render(<PainelDossieDecisaoIcmsSt empresaId="company-1" podePreparar podeDecidir={false} />, { wrapper: Wrapper });
    expect(await screen.findByRole('heading', { name: 'Dossiê de decisão do ICMS-ST histórico' })).toBeTruthy();
    expect(await screen.findByText('Nenhum fundamento importado. Destinos seguem sem elegibilidade.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar / reproduzir dossiê' })).toBeDisabled();
  });

  it('impede preparação quando a permissão de simulação está ausente', async () => {
    render(<PainelDossieDecisaoIcmsSt empresaId="company-1" podePreparar={false} podeDecidir={false} />, { wrapper: Wrapper });
    expect(await screen.findByRole('button', { name: 'Criar / reproduzir dossiê' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Importar fundamento' })).toBeDisabled();
  });
});
