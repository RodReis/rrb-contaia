import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApuracaoIcmsStSchema } from './api';
import { PainelApuracaoIcmsSt } from './painel-apuracao-icms-st';

const api = vi.hoisted(() => ({ listar: vi.fn(), obter: vi.fn() }));
vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, listarApuracoesIcmsSt: api.listar, obterApuracaoIcmsSt: api.obter };
});

const empresaId = '00000000-0000-4000-8000-000000000033';
const snapshotId = '00000000-0000-4000-8000-000000000034';
const snapshot = (page: number) => ApuracaoIcmsStSchema.parse({
  id: snapshotId, revision: 1, status: 'BLOCKED', competence: '2018-02-01',
  gross_restitution_cents: null, gross_complement_cents: null, net_amount_cents: null,
  blocked_line_count: 51, line_count: 51, line_page: page, line_page_size: 50, line_total_pages: 2,
  facts: { blockingReasonCodes: ['OFFICIAL_LAYOUT_UNAVAILABLE'] }, processed_at: '2026-10-21T12:00:00.000Z',
  lines: [{ output_document_id: '00000000-0000-4000-8000-000000000035', output_item_id: 'doc:1', difference_kind: 'INDETERMINATE',
    facts: { itemNumber: 1, productId: '7891234567895', quantityScaled: '25000000000', quantityScale: 10, unit: 'UN' },
    calculation: { recoveryOrigin: null, inputIcmsCents: null, inputIcmsStCents: null, presumedBaseCents: null,
      effectiveIcmsCents: null, effectiveBaseCents: null, restitutionCents: null, complementCents: null },
    recovery_memory: { documents: [] }, source_ids: [], blocking_reason_codes: ['OFFICIAL_LAYOUT_UNAVAILABLE'] }],
  events: [],
});

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('Painel de apuração F29', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    vi.stubGlobal('PointerEvent', MouseEvent);
    api.listar.mockResolvedValue({ itens: [{ id: snapshotId, competence: '2018-02-01', revision: 1, status: 'BLOCKED',
      processed_at: '2026-10-21T12:00:00.000Z', gross_restitution_cents: null, gross_complement_cents: null,
      net_amount_cents: null, line_count: 51, blocked_line_count: 51, review_action: null }] });
    api.obter.mockImplementation(async (_empresaId: string, _snapshotId: string, page: number) => snapshot(page));
  });

  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('mostra memória e indeterminação por linha sem inventar valores', async () => {
    render(<PainelApuracaoIcmsSt empresaId={empresaId} podeProcessar={false} podeDecidir={false} />, { wrapper: Envolvido });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
    const table = await screen.findByRole('table', { name: /Comparação por item/u });
    expect(within(table).getByText('Item 1')).toBeInTheDocument();
    expect(within(table).getByText('7891234567895')).toBeInTheDocument();
    expect(within(table).getAllByText('Indeterminado')).toHaveLength(3);
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('busca a próxima página no servidor para conjuntos acima de 50 linhas', async () => {
    render(<PainelApuracaoIcmsSt empresaId={empresaId} podeProcessar={false} podeDecidir={false} />, { wrapper: Envolvido });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
    await screen.findByRole('table', { name: /Comparação por item/u });
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(api.obter).toHaveBeenLastCalledWith(empresaId, snapshotId, 2, undefined));
    expect(await screen.findByText((_content, element) => element?.textContent === '51 item(ns) · página 2 de 2')).toBeInTheDocument();
  });

  it('não permite submeter, aprovar ou rejeitar sem cobertura oficial', async () => {
    const pending = snapshot(1);
    api.obter.mockResolvedValue({ ...pending, status: 'PENDING_REVIEW',
      facts: { blockingReasonCodes: [] }, blocked_line_count: 0,
      lines: pending.lines.map((line) => ({ ...line, difference_kind: 'NONE', blocking_reason_codes: [] })) });
    render(<PainelApuracaoIcmsSt empresaId={empresaId} podeProcessar podeDecidir />, { wrapper: Envolvido });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
    expect(await screen.findByRole('button', { name: /Submissão indisponível/u })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rejeitar' })).not.toBeInTheDocument();
  });

  it('não mostra decisão quando há evento de submissão sem layout mapeado', async () => {
    api.obter.mockResolvedValue({ ...snapshot(1), status: 'PENDING_REVIEW',
      facts: { blockingReasonCodes: [] }, blocked_line_count: 0,
      lines: snapshot(1).lines.map((line) => ({ ...line, difference_kind: 'NONE', blocking_reason_codes: [] })),
      events: [{ action: 'SUBMITTED', occurred_at: '2026-10-21T12:01:00.000Z', details: {} }] });
    render(<PainelApuracaoIcmsSt empresaId={empresaId} podeProcessar podeDecidir />, { wrapper: Envolvido });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Decisão suspensa/u);
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });

  it('filtra NFC-e 65 e identifica chave e consumidor sem documento', async () => {
    api.obter.mockImplementation(async (_empresaId: string, _snapshotId: string, page: number) => {
      const result = snapshot(page);
      const line = result.lines[0]!;
      return { ...result, line_count: 1, line_total_pages: 1,
        lines: [{ ...line, facts: { ...(line['facts'] as Record<string, unknown>), documentModel: '65', accessKey: '3'.repeat(44), destinationIdentifier: null } }],
      };
    });
    render(<PainelApuracaoIcmsSt empresaId={empresaId} podeProcessar={false} podeDecidir={false} />, { wrapper: Envolvido });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Modelo' }));
    await userEvent.click(screen.getByRole('option', { name: 'NFC-e 65' }));
    await waitFor(() => expect(api.obter).toHaveBeenLastCalledWith(empresaId, snapshotId, 1, '65'));
    expect(screen.getAllByText('NFC-e 65').length).toBeGreaterThan(0);
    expect(screen.getByText('Consumidor não identificado')).toBeInTheDocument();
    expect(screen.getByText('3'.repeat(44))).toBeInTheDocument();
  });

  it('marca revisão desatualizada e exige motivo antes de reprocessar', async () => {
    api.listar.mockResolvedValue({ itens: [{ id: snapshotId, competence: '2018-02-01', revision: 1, status: 'STALE',
      processed_at: '2026-10-21T12:00:00.000Z', gross_restitution_cents: null, gross_complement_cents: null,
      net_amount_cents: null, line_count: 51, blocked_line_count: 51, review_action: null }] });
    api.obter.mockResolvedValue({ ...snapshot(1), status: 'STALE', events: [{ action: 'DOCUMENT_SET_CHANGED', occurred_at: '2026-10-21T12:01:00.000Z', details: {} }] });
    render(<PainelApuracaoIcmsSt empresaId={empresaId} podeProcessar podeDecidir={false} />, { wrapper: Envolvido });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
    expect(await screen.findByText(/O conjunto de NFC-e mudou/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprocessar competência' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /Motivo do reprocessamento/u })).toBeInTheDocument();
  });
});
