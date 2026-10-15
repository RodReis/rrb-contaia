import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentoFiscal } from './api';

const navegacao = vi.hoisted(() => ({ replace: vi.fn(), parametros: 'aba=captura-dfe&documentosPagina=2&documentosEstado=CONFLITO' }));
const api = vi.hoisted(() => ({
  listar: vi.fn(async (): Promise<{ pagina: number; temProximaPagina: boolean; itens: DocumentoFiscal[] }> => ({ pagina: 2, temProximaPagina: false, itens: [] })),
  obter: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navegacao.replace }),
  useSearchParams: () => new URLSearchParams(navegacao.parametros),
}));
vi.mock('./api', () => ({
  baixarOriginalFiscal: vi.fn(),
  listarDocumentosFiscais: api.listar,
  obterDocumentoFiscal: api.obter,
  reprocessarDocumentoFiscal: vi.fn(),
  verificarIntegridadeFiscal: vi.fn(),
}));

import { PainelDeDocumentosFiscais } from './painel-de-documentos-fiscais';

describe('PainelDeDocumentosFiscais', () => {
  beforeEach(() => {
    navegacao.replace.mockReset();
    api.listar.mockClear();
    api.obter.mockReset();
  });

  it('mantém filtro e aba na URL ao voltar uma página', async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PainelDeDocumentosFiscais empresaId="empresa-1" somenteLeitura={false} podeReprocessar={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Nenhum documento neste filtro')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Estado do processamento' }).tagName).not.toBe('SELECT');
    expect(api.listar).toHaveBeenCalledWith('empresa-1', 2, 'CONFLITO');
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));

    expect(navegacao.replace).toHaveBeenCalledWith(
      '/empresas/empresa-1?aba=captura-dfe&documentosEstado=CONFLITO',
      { scroll: false },
    );
    cliente.clear();
  });

  it('abre os dados fiscais preservados para uma linha processada', async () => {
    api.listar.mockResolvedValueOnce({
      pagina: 1,
      temProximaPagina: false,
      itens: [{
        id: '123e4567-e89b-12d3-a456-426614174000', especie: 'NFE_55', chave_acesso: '0000…0010', hash_sha256: 'a'.repeat(64),
        emitido_em: '2026-06-15', emitente: 'Emitente de teste', destinatario: 'Destinatário de teste', total: '10.00', estado: 'PROCESSADO',
        versao_layout: '4.00', criado_em: '2026-06-15T13:00:00.000Z', nsu: '101', capturado_em: '2026-06-15T13:00:00.000Z',
        atividade_em: '2026-06-15T13:00:00.000Z', origens: 1,
      }],
    });
    api.obter.mockResolvedValueOnce({
      id: '123e4567-e89b-12d3-a456-426614174000', especie: 'NFE_55', chave_acesso: '0'.repeat(40) + '0010', hash_sha256: 'a'.repeat(64),
      tamanho_bytes: 1200, estado: 'PROCESSADO', emitido_em: '2026-06-15', emitente: 'Emitente de teste', destinatario: 'Destinatário de teste',
      total: '10.00', itens: [{ numero: 1, codigo: 'A1', descricao: 'Item', valor: '10.00', ibs: '0.01', cbs: '0.09' }],
      protocolo: '135260000000001', referencias: [{ tipo: 'NF-e', chave: 'chave referenciada' }],
      partes: [{ papel: 'EMITENTE', identificador: '12345678000190', nome: 'Emitente de teste', inscricao_estadual: null, logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', codigo_municipio: '3550308', municipio: 'São Paulo', uf: 'SP', cep: '01000000', codigo_pais: '1058', pais: 'Brasil' }],
      origens: [{ nsu: '101', capturado_em: '2026-06-15T13:00:00.000Z' }], eventos: [],
    });
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PainelDeDocumentosFiscais empresaId="empresa-1" somenteLeitura={false} podeReprocessar={false} />
      </QueryClientProvider>,
    );

    await screen.findByText('Emitente de teste');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhes' }));

    expect(await screen.findByText('Itens e tributos presentes')).toBeTruthy();
    expect(screen.getByText('Destinatário de teste')).toBeTruthy();
    expect(screen.getByText('135260000000001')).toBeTruthy();
    expect(screen.getByText('NF-e: chave referenciada')).toBeTruthy();
    expect(screen.getByText('Partes e localização declarada')).toBeTruthy();
    expect(screen.getByText('Rua A, 10, Centro, São Paulo, SP, 01000000')).toBeTruthy();
    expect(screen.getByText('R$ 0,01', { exact: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar chave de acesso' })).toBeTruthy();
    cliente.clear();
  });
});
