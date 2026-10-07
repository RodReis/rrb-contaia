import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SinoDeNotificacoes } from './sino-de-notificacoes';

vi.mock('@/lib/http', () => ({ requisitar: vi.fn() }));

import { requisitar } from '@/lib/http';

const renderizar = () => {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <SinoDeNotificacoes />
    </QueryClientProvider>,
  );
};

const PAINEL_COM_NAO_LIDAS = {
  notificacoes: [
    {
      id: 'n1',
      empresaId: 'e1',
      empresaNome: 'Acme Ltda',
      adicionadas: null,
      removidas: null,
      tipo: 'DOCUMENTO_REJEITADO',
      chave: 'exigencia:x1',
      lida: false,
      lidaEm: null,
      criadoEm: new Date().toISOString(),
    },
  ],
  naoLidas: 1,
};

/** Aviso consolidado (SPEC-009 §3.6): uma notificação por operação, sem empresa própria. */
const AVISO_DE_CARTEIRA = {
  id: 'c1',
  empresaId: null,
  empresaNome: null,
  tipo: 'CARTEIRA_ALTERADA',
  chave: 'evento-1',
  adicionadas: [
    { id: 'e1', nome: 'Alfa Ltda', cnpj: '11222333000181' },
    { id: 'e2', nome: 'Beta Comércio', cnpj: '45242914000105' },
  ],
  removidas: [{ id: 'e3', nome: 'Gama Serviços', cnpj: '33000167000101' }],
  lida: false,
  lidaEm: null,
  criadoEm: new Date().toISOString(),
};

describe('SinoDeNotificacoes', () => {
  beforeEach(() => {
    vi.mocked(requisitar).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sem carteira, o painel diz que falta alçada em vez de "Sem notificações"', async () => {
    vi.mocked(requisitar).mockResolvedValue({
      notificacoes: [],
      naoLidas: 0,
      escopoDeEmpresas: 'NENHUMA',
    });
    const usuario = userEvent.setup();

    renderizar();
    await waitFor(() => expect(requisitar).toHaveBeenCalled());
    await usuario.click(await screen.findByRole('button', { name: /notifica/iu }));

    const painel = await screen.findByRole('dialog');

    expect(
      within(painel).getByText('Você ainda não tem empresas na sua carteira'),
    ).toBeInTheDocument();
    expect(within(painel).queryByText('Sem notificações')).not.toBeInTheDocument();
  });

  it('aviso de carteira resume o que entrou e o que saiu e leva à própria carteira', async () => {
    vi.mocked(requisitar).mockResolvedValue({ notificacoes: [AVISO_DE_CARTEIRA], naoLidas: 1 });
    const usuario = userEvent.setup();

    renderizar();
    await usuario.click(await screen.findByRole('button', { name: /notifica/iu }));

    const painel = await screen.findByRole('dialog');
    expect(within(painel).getByText('Sua carteira foi atualizada')).toBeInTheDocument();
    expect(within(painel).getByText(/2 empresas adicionadas: Alfa Ltda, Beta Comércio/)).toBeInTheDocument();
    expect(within(painel).getByText(/1 empresa removida: Gama Serviços/)).toBeInTheDocument();
    // Uma notificação só por operação — nunca uma por vínculo.
    expect(within(painel).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(painel).getByRole('link', { name: /Sua carteira foi atualizada/ }),
    ).toHaveAttribute('href', '/carteira');
  });

  it.each([
    ['CERTIFICADO_D30', 'Certificado vence em 30 dias'],
    ['CERTIFICADO_D15', 'Certificado vence em 15 dias'],
    ['CERTIFICADO_D7', 'Certificado vence em 7 dias'],
    ['CERTIFICADO_VENCIDO', 'Certificado vencido'],
    ['CERTIFICADO_RESPONSAVEL_INCONSISTENTE', 'Certificado sem responsável ativo'],
    ['CERTIFICADO_MARCO_FUTURO', 'Certificado digital'],
  ] as const)('aviso do cofre %s nomeia a empresa e abre o registro dela no cofre', async (tipo, rotulo) => {
    vi.mocked(requisitar).mockResolvedValue({
      notificacoes: [
        {
          id: 'k1',
          empresaId: 'e-valido',
          empresaNome: 'Padaria Aurora',
          adicionadas: null,
          removidas: null,
          tipo,
          chave: 'certificado:1',
          lida: false,
          lidaEm: null,
          criadoEm: new Date().toISOString(),
        },
      ],
      naoLidas: 1,
    });
    const usuario = userEvent.setup();

    renderizar();
    await usuario.click(await screen.findByRole('button', { name: /notifica/iu }));

    const painel = await screen.findByRole('dialog');
    const link = within(painel).getByRole('link', { name: /Padaria Aurora/ });

    expect(link).toHaveTextContent(rotulo);
    expect(link).toHaveAttribute('href', '/configuracoes/cofre?empresa=e-valido');
  });

  it('colaborador que perdeu a última empresa ainda vê o aviso, não a orientação de ausência de alçada', async () => {
    vi.mocked(requisitar).mockResolvedValue({ notificacoes: [AVISO_DE_CARTEIRA], naoLidas: 1 });
    const usuario = userEvent.setup();

    renderizar();
    await usuario.click(await screen.findByRole('button', { name: /notifica/iu }));

    const painel = await screen.findByRole('dialog');
    expect(
      within(painel).queryByText('Você ainda não tem empresas na sua carteira'),
    ).not.toBeInTheDocument();
  });

  it('exibe badge com o número de não lidas', async () => {
    vi.mocked(requisitar).mockResolvedValue(PAINEL_COM_NAO_LIDAS);

    renderizar();

    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('badge não aparece quando não há não lidas (estado "Badge zero")', async () => {
    vi.mocked(requisitar).mockResolvedValue({ notificacoes: [], naoLidas: 0 });

    renderizar();

    await waitFor(() => expect(requisitar).toHaveBeenCalled());
    expect(screen.queryByTestId('badge-nao-lidas')).not.toBeInTheDocument();
  });

  it('abre o painel e mostra a lista ao clicar no sino', async () => {
    vi.mocked(requisitar).mockResolvedValue(PAINEL_COM_NAO_LIDAS);
    const usuario = userEvent.setup();

    renderizar();
    await screen.findByText('1');
    await usuario.click(screen.getByRole('button', { name: /notifica/iu }));

    expect(await screen.findByText('Acme Ltda')).toBeInTheDocument();
  });

  it('marca como lida e navega ao clicar no item', async () => {
    vi.mocked(requisitar)
      .mockResolvedValueOnce(PAINEL_COM_NAO_LIDAS) // carga inicial
      .mockResolvedValueOnce({ ...PAINEL_COM_NAO_LIDAS.notificacoes[0], lida: true }) // marcar lida
      .mockResolvedValue({ notificacoes: [], naoLidas: 0 }); // invalidação após sucesso
    const usuario = userEvent.setup();

    renderizar();
    await screen.findByText('1');
    await usuario.click(screen.getByRole('button', { name: /notifica/iu }));
    await usuario.click(await screen.findByText('Acme Ltda'));

    await waitFor(() =>
      expect(requisitar).toHaveBeenCalledWith(
        '/notificacoes/n1/leitura',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
  });

  it('checkbox Todas seleciona os itens visíveis e marca em lote', async () => {
    vi.mocked(requisitar).mockResolvedValue(PAINEL_COM_NAO_LIDAS);
    const usuario = userEvent.setup();

    renderizar();
    await screen.findByText('1');
    await usuario.click(screen.getByRole('button', { name: /notifica/iu }));

    const painel = await screen.findByRole('dialog');
    await usuario.click(within(painel).getByLabelText(/todas/iu));

    expect(within(painel).getByRole('checkbox', { name: /todas/iu })).toBeChecked();
  });

  /** Incidente do Signer (SPEC-012 §3.10): serviço global, sem empresa, aviso a cada administrador. */
  const AVISO_DO_SIGNER = (tipo: string, duracaoMs: number | null) => ({
    id: 's1',
    empresaId: null,
    empresaNome: null,
    adicionadas: null,
    removidas: null,
    tipo,
    chave: 'signer:incidente-1:x',
    lida: false,
    lidaEm: null,
    criadoEm: new Date().toISOString(),
    duracaoMs,
  });

  it.each([
    ['SIGNER_INDISPONIVEL', null, 'Signer indisponível', /três verificações seguidas sem resposta/iu],
    ['SIGNER_RECUPERADO', 125_000, 'Signer recuperado', /ficou indisponível por 2 min/iu],
    ['SIGNER_RECUPERADO', 30_000, 'Signer recuperado', /ficou indisponível por menos de 1 min/iu],
    ['SIGNER_RECUPERADO', 3_900_000, 'Signer recuperado', /ficou indisponível por 1 h 5 min/iu],
    ['SIGNER_RECUPERADO', null, 'Signer recuperado', /voltou a responder\./iu],
  ] as const)(
    'incidente %s (%s ms): título do serviço, tipo, resumo e destino no cofre, sem empresa',
    async (tipo, duracaoMs, rotulo, resumo) => {
      vi.mocked(requisitar).mockResolvedValue({
        notificacoes: [AVISO_DO_SIGNER(tipo, duracaoMs)],
        naoLidas: 1,
      });
      const usuario = userEvent.setup();

      renderizar();
      await usuario.click(await screen.findByRole('button', { name: /notifica/iu }));

      const painel = await screen.findByRole('dialog');

      expect(within(painel).getByText('Microserviço Signer')).toBeInTheDocument();
      expect(within(painel).getByText(new RegExp(rotulo, 'u'))).toBeInTheDocument();
      expect(within(painel).getByText(resumo)).toBeInTheDocument();
      expect(within(painel).getByRole('link', { name: /Microserviço Signer/u })).toHaveAttribute(
        'href',
        '/configuracoes/cofre',
      );
    },
  );
});
