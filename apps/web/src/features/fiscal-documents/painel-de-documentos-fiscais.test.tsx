import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CienciaDaEmissaoUI, DocumentoFiscal } from './api';

const navegacao = vi.hoisted(() => ({ replace: vi.fn(), parametros: 'aba=captura-dfe&documentosPagina=2&documentosEstado=CONFLITO' }));
const api = vi.hoisted(() => ({
  listar: vi.fn(async (): Promise<{ pagina: number; temProximaPagina: boolean; itens: DocumentoFiscal[] }> => ({ pagina: 2, temProximaPagina: false, itens: [] })),
  obter: vi.fn(),
  listarCiencias: vi.fn(async (): Promise<{ itens: CienciaDaEmissaoUI[] }> => ({ itens: [] })),
  obterCiencia: vi.fn(),
  retomarCiencia: vi.fn(async () => ({ acknowledgementId: '423e4567-e89b-12d3-a456-426614174000', status: 'SCHEDULED' })),
  resolucoes: vi.fn(async (): Promise<{ itens: Record<string, unknown>[] }> => ({ itens: [] })),
  processarResolucao: vi.fn(),
  compararResolucao: vi.fn(),
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
  listarCienciasDaEmissao: api.listarCiencias,
  obterCienciaDaEmissao: api.obterCiencia,
  retomarCienciaDaEmissao: api.retomarCiencia,
  listarResolucaoTributaria: api.resolucoes,
  processarResolucaoTributaria: api.processarResolucao,
  compararResolucaoTributaria: api.compararResolucao,
}));

import { PainelDeDocumentosFiscais } from './painel-de-documentos-fiscais';

describe('PainelDeDocumentosFiscais', () => {
  beforeEach(() => {
    navegacao.replace.mockReset();
    api.listar.mockClear();
    api.obter.mockReset();
    api.listarCiencias.mockReset().mockResolvedValue({ itens: [] });
    api.obterCiencia.mockReset();
    api.retomarCiencia.mockReset().mockResolvedValue({ acknowledgementId: '423e4567-e89b-12d3-a456-426614174000', status: 'SCHEDULED' });
    api.resolucoes.mockReset().mockResolvedValue({ itens: [] });
    api.processarResolucao.mockReset();
    api.compararResolucao.mockReset();
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
      id: '123e4567-e89b-12d3-a456-426614174000', especie: 'NFE_55', parser_version: 'f18-v1', chave_acesso: '0'.repeat(40) + '0010', hash_sha256: 'a'.repeat(64),
      tamanho_bytes: 1200, estado: 'PROCESSADO', emitido_em: '2026-06-15', emitente: 'Emitente de teste', destinatario: 'Destinatário de teste',
      total: '10.00', itens: [{ numero: 1, tipo: 'ITEM', codigo: 'A1', descricao: 'Item', valor: '10.00', ibs: '0.01', cbs: '0.09' }],
      base_ibs_cbs: '10.00', total_ibs: '0.01', total_cbs: '0.09',
      protocolo: '135260000000001', referencias: [{ tipo: 'NF-e', chave: 'chave referenciada' }],
      protocolo_recebido_em: '2026-08-03T13:31:00.000Z',
      partes: [{ papel: 'EMITENTE', identificador: '12345678000190', nome: 'Emitente de teste', inscricao_estadual: null, logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', codigo_municipio: '3550308', municipio: 'São Paulo', uf: 'SP', cep: '01000000', codigo_pais: '1058', pais: 'Brasil' }],
      tributos: [{ escopo: 'DOCUMENTO', numero_item: null, codigo: 'IBS', base_calculo: '10.00', aliquota: null, valor: '0.01', situacao: null, classificacao: '000001' }],
      origens: [{ nsu: '101', capturado_em: '2026-06-15T13:00:00.000Z' }], eventos: [],
    });
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PainelDeDocumentosFiscais empresaId="empresa-1" somenteLeitura={false} podeReprocessar={false} podeResolverTributos />
      </QueryClientProvider>,
    );

    await screen.findByText('Emitente de teste');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhes' }));

    expect(await screen.findByText('Itens e componentes')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Declarar item 1 para revenda' }));
    expect(screen.getByRole('button', { name: 'Declarar todos para revenda' })).toBeTruthy();
    api.processarResolucao.mockResolvedValueOnce({ revision: 1, reused: false, snapshots: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Processar itens' }));
    await waitFor(() => expect(api.processarResolucao).toHaveBeenCalledWith('empresa-1', '123e4567-e89b-12d3-a456-426614174000', expect.objectContaining({ resaleItemNumbers: [1] })));
    expect(screen.getByText('Destinatário de teste')).toBeTruthy();
    expect(screen.getByText('135260000000001')).toBeTruthy();
    expect(screen.getByText('NF-e: chave referenciada')).toBeTruthy();
    expect(screen.getByText('Partes e localização declarada')).toBeTruthy();
    expect(screen.getByText('Tributos normalizados')).toBeTruthy();
    expect(screen.getByText('Rua A, 10, Centro, São Paulo, SP, 01000000')).toBeTruthy();
    expect(screen.getAllByText('R$ 0,01', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Copiar chave de acesso' })).toBeTruthy();
    cliente.clear();
  });

  it('exibe decisões tributárias indeterminadas com o motivo e o hash da fonte', async () => {
    api.listar.mockResolvedValueOnce({
      pagina: 1, temProximaPagina: false, itens: [{
        id: '123e4567-e89b-12d3-a456-426614174000', especie: 'NFE_55', chave_acesso: '0000…0010', hash_sha256: 'a'.repeat(64),
        emitido_em: '2026-06-15', emitente: 'Emitente de teste', destinatario: 'Destinatário de teste', total: '10.00', estado: 'PROCESSADO',
        versao_layout: '4.00', criado_em: '2026-06-15T13:00:00.000Z', nsu: '101', capturado_em: '2026-06-15T13:00:00.000Z', atividade_em: '2026-06-15T13:00:00.000Z', origens: 1,
      }],
    });
    api.obter.mockResolvedValueOnce({
      id: '123e4567-e89b-12d3-a456-426614174000', especie: 'NFE_55', parser_version: 'f18-v1', chave_acesso: '0'.repeat(40) + '0010', hash_sha256: 'a'.repeat(64),
      tamanho_bytes: 1200, estado: 'PROCESSADO', emitido_em: '2026-06-15', emitente: 'Emitente de teste', destinatario: 'Destinatário de teste',
      total: '10.00', itens: [{ numero: 1, codigo: 'A1', descricao: 'Item', valor: '10.00' }], base_ibs_cbs: null, total_ibs: null, total_cbs: null,
      protocolo: '135260000000001', protocolo_recebido_em: null, referencias: [], partes: [], tributos: [], origens: [], eventos: [],
    });
    api.resolucoes.mockResolvedValueOnce({ itens: [{
      id: '223e4567-e89b-12d3-a456-426614174000', tenant_id: '323e4567-e89b-12d3-a456-426614174000', empresa_id: '423e4567-e89b-12d3-a456-426614174000',
      document_id: '123e4567-e89b-12d3-a456-426614174000', item_number: 1, parser_version: 'f18-v1', revision: 1, idempotency_key: 'idempotency-1',
      input_sha256: 'b'.repeat(64), package_id: null, package_sha256: null,
      facts: { itemNumber: 1, missingInputs: ['REGIME_HISTORICO', 'FINALIDADE_AQUISICAO'] },
      decisions: [{ tax: 'ICMS', status: 'INDETERMINATE', creditEligibility: 'INDETERMINATE', ruleId: null, reasons: ['REGIME_HISTORY_UNAVAILABLE', 'PACKAGE_UNAVAILABLE'], missingInputs: ['REGIME_HISTORICO'], sourceIds: [], rationale: 'Sem regime histórico; nenhuma regra aplicada.' }],
      reprocessing_reason: null, actor_id: '523e4567-e89b-12d3-a456-426614174000', correlation_id: 'corr-1', processed_at: '2026-10-18T13:00:00.000Z',
    }] });
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={cliente}><PainelDeDocumentosFiscais empresaId="empresa-1" somenteLeitura={false} podeReprocessar={false} /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir detalhes' }));
    expect(await screen.findByText('Tratamento tributário por item')).toBeTruthy();
    expect(await screen.findByText('Indeterminado')).toBeTruthy();
    expect(screen.getByText('Sem regime histórico; nenhuma regra aplicada.')).toBeTruthy();
    expect(screen.getByText('Regime tributário na data da NF-e')).toBeTruthy();
    expect(screen.getByText(/Origem esperada: Histórico fiscal cadastral da empresa/u)).toBeTruthy();
    expect(screen.getByText(/Confira o regime e a data de vigência/u)).toBeTruthy();
    expect(screen.getByText(/Aguarde a publicação de pacote compatível/u)).toBeTruthy();
    expect(screen.getByText('Sem pacote curado associado.')).toBeTruthy();
    cliente.clear();
  });

  it('mostra histórico e retomada autorizada, sem ação em somente leitura', async () => {
    api.listarCiencias.mockResolvedValue({ itens: [{
      id: '423e4567-e89b-12d3-a456-426614174000', staging_id: '523e4567-e89b-12d3-a456-426614174000', xml_staging_id: null,
      chave_acesso: '35240112345678000195550010000000011000000019', estado: 'DLQ', tentativas: 3, tentativas_ciencia: 3,
      tentativas_xml: 0, protocolo: null, ambiente: null, codigo: 'FISCAL_ACK_RETRY_EXHAUSTED', motivo_sanitizado: null,
      proxima_tentativa_em: null, solicitada_em: '2026-10-15T13:00:00.000Z', atualizado_em: '2026-10-15T13:01:00.000Z',
      nsu_resumo: '101', nsu_xml: null,
    }] });
    api.obterCiencia.mockResolvedValue({ ciencia: {}, historico: [{ estado: 'DLQ', ocorrido_em: '2026-10-15T13:01:00.000Z', tentativa: 3 }], tentativas: [] });
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PainelDeDocumentosFiscais empresaId="empresa-1" somenteLeitura={false} podeReprocessar />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Fila de falhas')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Histórico e detalhes' }));
    expect(await screen.findByText('Histórico')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar tecnicamente' }));
    await waitFor(() => expect(api.retomarCiencia).toHaveBeenCalledWith('empresa-1', '423e4567-e89b-12d3-a456-426614174000'));
    cliente.clear();
  });

  it('oculta a retomada técnica em modo somente leitura, mesmo com capacidade desatualizada', async () => {
    api.listarCiencias.mockResolvedValue({ itens: [{
      id: '423e4567-e89b-12d3-a456-426614174000', staging_id: '523e4567-e89b-12d3-a456-426614174000', xml_staging_id: null,
      chave_acesso: null, estado: 'DLQ', tentativas: 3, tentativas_ciencia: 3, tentativas_xml: 0, protocolo: null,
      ambiente: null, codigo: 'FISCAL_ACK_RETRY_EXHAUSTED', motivo_sanitizado: null, proxima_tentativa_em: null,
      solicitada_em: '2026-10-15T13:00:00.000Z', atualizado_em: '2026-10-15T13:01:00.000Z', nsu_resumo: '101', nsu_xml: null,
    }] });
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <PainelDeDocumentosFiscais empresaId="empresa-1" somenteLeitura podeReprocessar />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Fila de falhas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retomar tecnicamente' })).toBeNull();
    cliente.clear();
  });
});
