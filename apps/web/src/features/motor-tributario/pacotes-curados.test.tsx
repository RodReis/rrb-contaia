import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listar: vi.fn(), importar: vi.fn(), validar: vi.fn(), revisar: vi.fn(), publicar: vi.fn(), arquivar: vi.fn(),
}));

vi.mock('../fiscal-documents/api', () => ({
  listarPacotesTributarios: api.listar,
  importarPacoteTributario: api.importar,
  validarPacoteTributario: api.validar,
  revisarPacoteTributario: api.revisar,
  publicarPacoteTributario: api.publicar,
  arquivarPacoteTributario: api.arquivar,
}));

import { PainelDePacotesCurados } from './pacotes-curados';

const ator = '123e4567-e89b-12d3-a456-426614174000';
const pacote = (status: 'IMPORTED' | 'VALIDATED' | 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED', importedBy = ator) => ({
  id: '223e4567-e89b-12d3-a456-426614174000', packageId: 'go-entry', semanticVersion: '1.0.0', status,
  jurisdiction: 'GO', regimes: ['SIMPLES_NACIONAL'], validFrom: '2026-01-01', validUntil: null,
  coverage: ['entrada para revenda'], exclusions: ['ST'], sha256: 'a'.repeat(64), importedBy,
  importedAt: '2026-10-18T13:00:00.000Z', reviewedBy: status === 'REVIEWED' ? ator : null,
  reviewedAt: status === 'REVIEWED' ? '2026-10-18T13:00:00.000Z' : null,
  publishedBy: status === 'PUBLISHED' || status === 'ARCHIVED' ? ator : null,
  publishedAt: status === 'PUBLISHED' || status === 'ARCHIVED' ? '2026-10-18T13:00:00.000Z' : null,
  archivedAt: status === 'ARCHIVED' ? '2026-10-18T13:00:00.000Z' : null,
});
const montar = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PainelDePacotesCurados /></QueryClientProvider>);

describe('PainelDePacotesCurados', () => {
  beforeEach(() => {
    api.listar.mockReset().mockResolvedValue({ canAdminister: true, actorId: ator, items: [] });
    api.importar.mockReset().mockResolvedValue({});
    api.validar.mockReset().mockResolvedValue({});
    api.revisar.mockReset().mockResolvedValue({});
    api.publicar.mockReset().mockResolvedValue({});
    api.arquivar.mockReset().mockResolvedValue({});
  });

  it('importa apenas JSON válido como novo rascunho', async () => {
    montar();
    const campo = await screen.findByLabelText(/Conteúdo JSON do pacote/u);
    fireEvent.change(campo, { target: { value: '{invalido' } });
    await userEvent.click(screen.getByRole('button', { name: 'Importar rascunho' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O conteúdo precisa ser um JSON válido.');
    fireEvent.change(campo, { target: { value: '{"packageId":"go-entry"}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Importar rascunho' }));
    expect(api.importar.mock.calls[0]?.[0]).toEqual({ packageId: 'go-entry' });
  });

  it('impede auto-revisão do pacote importado pelo mesmo super-admin', async () => {
    api.listar.mockResolvedValue({ canAdminister: true, actorId: ator, items: [pacote('VALIDATED')] });
    montar();
    expect(await screen.findByText('Outra conta super-admin precisa revisar este pacote.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar revisão' })).not.toBeInTheDocument();
  });

  it('mantém falhas de validação visíveis junto ao pacote', async () => {
    api.listar.mockResolvedValue({ canAdminister: true, actorId: ator, items: [pacote('IMPORTED')] });
    api.validar.mockResolvedValue({ id: '223e4567-e89b-12d3-a456-426614174000', packageId: 'go-entry', semanticVersion: '1.0.0', status: 'IMPORTED', sha256: 'a'.repeat(64), validation: { valid: false, errors: ['SOURCE_REFERENCE_INCOMPLETE:src'] } });
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Validar pacote' }));
    expect(await screen.findByRole('alert', { name: 'Falhas de validação de go-entry' })).toHaveTextContent('SOURCE_REFERENCE_INCOMPLETE:src');
  });

  it('confirma publicação pelo nome da versão antes de chamar a API', async () => {
    api.listar.mockResolvedValue({ canAdminister: true, actorId: ator, items: [pacote('REVIEWED', '323e4567-e89b-12d3-a456-426614174000')] });
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar versão' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Publicar go-entry v1.0.0?');
    expect(api.publicar).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar versão' }));
    expect(api.publicar.mock.calls[0]?.[0]).toBe('223e4567-e89b-12d3-a456-426614174000');
  });
});
