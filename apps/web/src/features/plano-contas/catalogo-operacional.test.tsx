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
});
