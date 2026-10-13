import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorDeRegra } from './editor-de-regra';
import { BASE, Envolvido, REGRA_ID, instalarFetch, json, problema, rascunho, regra } from './motor-tributario.fixtures';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Chamada = Readonly<{ url: string; metodo: string; corpo: unknown }>;

const montar = (
  roteador: (url: string, metodo: string) => Response | Promise<Response> | undefined,
  props: { regraId?: string; podeAdministrar?: boolean } = {},
) => {
  const chamadas: Chamada[] = [];
  const aoFechar = vi.fn();
  instalarFetch((url, init) => {
    const metodo = init?.method ?? 'GET';
    chamadas.push({ url, metodo, corpo: init?.body === undefined ? null : JSON.parse(String(init.body)) });

    return roteador(url, metodo);
  });
  const resultado = render(<EditorDeRegra regraId={props.regraId ?? 'nova'} podeAdministrar={props.podeAdministrar ?? true} aoFechar={aoFechar} />, {
    wrapper: Envolvido,
  });

  return { ...resultado, chamadas, aoFechar };
};

/** Seletor aberto pelo teclado: caminho acessível e estável no jsdom. */
const escolher = async (rotulo: string, opcao: string): Promise<void> => {
  screen.getByRole('combobox', { name: new RegExp(rotulo, 'u') }).focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(await screen.findByRole('option', { name: opcao }));
};

const preencherNova = async (): Promise<void> => {
  await escolher('Tributo', 'ICMS');
  await escolher('Regime', 'Lucro Presumido');
  await escolher('Tipo de operação', 'Venda de mercadoria');
  await userEvent.type(screen.getByLabelText(/Início da vigência/u), '2026-01-01');
  await userEvent.type(screen.getByLabelText(/Alíquota/u), '18');
  await userEvent.type(screen.getByLabelText(/Fonte da regra/u), 'Fixture de teste não oficial');
};

const URL_DA_REGRA = `${BASE}/${REGRA_ID}`;
const doServidor = (versao = rascunho({ lockVersion: 4 })) => (url: string, metodo: string) =>
  metodo === 'GET' && url === URL_DA_REGRA ? json(versao) : undefined;

describe('EditorDeRegra — nova regra (SPEC-016 §3.2)', () => {
  it('abre como painel nomeado, com a identidade editável e o aviso de que só vale depois de publicada', () => {
    montar(() => undefined);

    const painel = screen.getByRole('dialog', { name: 'Nova regra' });
    expect(within(painel).getByRole('combobox', { name: /Tributo/u })).toBeEnabled();
    expect(within(painel).getByText(/só passa a valer depois de publicado/iu)).toBeInTheDocument();
  });

  it('envio vazio mostra os erros, leva o foco ao primeiro campo e não chama a API', async () => {
    const { chamadas } = montar(() => undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    expect(await screen.findByText('6 campos precisam de correção')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Tributo/u })).toHaveFocus());
    expect(chamadas).toHaveLength(0);
  });

  it('cria o rascunho com o corpo exato do contrato e fecha o painel', async () => {
    const { chamadas, aoFechar } = montar((url, metodo) => (metodo === 'POST' && url === BASE ? json(rascunho(), 201) : undefined));

    await preencherNova();
    await userEvent.type(screen.getByLabelText(/Redução de base/u), '33,33');
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toEqual({
      taxType: 'ICMS',
      regime: 'LUCRO_PRESUMIDO',
      operationType: 'VENDA_MERCADORIA',
      validFrom: '2026-01-01',
      validUntil: null,
      baseReductionBasisPoints: 3_333,
      rateBasisPoints: 1_800,
      source: 'Fixture de teste não oficial',
      fixtureNote: '',
    });
    expect(toast.success).toHaveBeenCalledWith('Rascunho criado.');
  });

  it('vigência final anterior à inicial é recusada no campo certo', async () => {
    const { chamadas } = montar(() => undefined);

    await preencherNova();
    await userEvent.type(screen.getByLabelText(/Fim da vigência/u), '2025-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    expect(await screen.findByText('A vigência final não pode ser anterior à inicial')).toBeInTheDocument();
    expect(chamadas).toHaveLength(0);
  });

  it('Esc fecha o painel', async () => {
    const { aoFechar } = montar(() => undefined);

    await userEvent.keyboard('{Escape}');

    expect(aoFechar).toHaveBeenCalled();
  });
});

describe('EditorDeRegra — rascunho existente', () => {
  it('carrega o valor do servidor e mostra a identidade como fixa, com o motivo', async () => {
    montar(doServidor(), { regraId: REGRA_ID });

    expect(await screen.findByLabelText(/Alíquota/u)).toHaveValue('18,00');
    const painel = screen.getByRole('dialog');
    // No cabeçalho do painel e no bloco da identidade fixa.
    expect(within(painel).getAllByText('ICMS · Lucro Presumido · Venda de mercadoria')).toHaveLength(2);
    expect(within(painel).getByText(/identidade não muda depois de criada/iu)).toBeInTheDocument();
    expect(within(painel).queryByRole('combobox', { name: /Tributo/u })).not.toBeInTheDocument();
    expect(within(painel).getByText('Rascunho')).toBeInTheDocument();
  });

  it('carregando: skeleton anunciado, sem formulário', () => {
    montar(() => new Promise<Response>(() => undefined), { regraId: REGRA_ID });

    expect(screen.getByText('Carregando a regra')).toBeInTheDocument();
    expect(screen.getByText('Carregando a regra').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
  });

  it('salva com a versão esperada e sem enviar a identidade', async () => {
    const { chamadas, aoFechar } = montar(
      (url, metodo) => (metodo === 'PUT' && url === URL_DA_REGRA ? json(rascunho({ lockVersion: 5 })) : doServidor()(url, metodo)),
      { regraId: REGRA_ID },
    );

    const aliquota = await screen.findByLabelText(/Alíquota/u);
    await userEvent.clear(aliquota);
    await userEvent.type(aliquota, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(chamadas.find((c) => c.metodo === 'PUT')?.corpo).toEqual({
      expectedVersion: 4,
      validFrom: '2026-01-01',
      validUntil: null,
      baseReductionBasisPoints: null,
      rateBasisPoints: 2_000,
      source: 'Fixture de teste não oficial',
      fixtureNote: 'Dado de teste não oficial',
    });
    expect(toast.success).toHaveBeenCalledWith('Rascunho salvo.');
  });

  it('conflito de versão: explica de forma persistente, mantém o digitado e recarrega a versão atual', async () => {
    let servidor = rascunho({ lockVersion: 4 });
    const { chamadas } = montar(
      (url, metodo) => {
        if (metodo === 'PUT') {
          return problema(409, 'TAX_RULE_VERSION_CONFLICT', {}, 'corr-conflito');
        }

        return metodo === 'GET' && url === URL_DA_REGRA ? json(servidor) : undefined;
      },
      { regraId: REGRA_ID },
    );

    const aliquota = await screen.findByLabelText(/Alíquota/u);
    await userEvent.clear(aliquota);
    await userEvent.type(aliquota, '22');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Outra pessoa alterou');
    expect(alerta).toHaveTextContent('corr-conflito');
    expect(toast.error).not.toHaveBeenCalled();

    // Outra pessoa subiu a versão no servidor; recarregar traz o lock novo sem descartar o digitado.
    servidor = rascunho({ lockVersion: 5, rateBasisPoints: 1_900 });
    await userEvent.click(within(alerta).getByRole('button', { name: 'Recarregar versão atual' }));

    expect(await screen.findByText(/versão atual foi carregada/iu)).toBeInTheDocument();
    // O que foi digitado continua (formatado ao sair do campo), não o 19,00 que o servidor tem agora.
    expect(screen.getByLabelText(/Alíquota/u)).toHaveValue('22,00');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(2));
    expect((chamadas.filter((c) => c.metodo === 'PUT')[1]?.corpo as { expectedVersion: number }).expectedVersion).toBe(5);
  });

  it('só permite publicar o que está salvo: com alteração pendente explica o motivo', async () => {
    montar(doServidor(), { regraId: REGRA_ID });

    expect(await screen.findByRole('button', { name: /Publicar/u })).toBeEnabled();
    await userEvent.type(screen.getByLabelText(/Alíquota/u), '1');

    expect(screen.getByRole('button', { name: /Publicar/u })).toBeDisabled();
    expect(screen.getByText(/Salve as alterações antes de publicar/u)).toBeInTheDocument();
  });

  it('regra que não existe mais: estado persistente, sem formulário', async () => {
    montar((url, metodo) => (metodo === 'GET' && url === URL_DA_REGRA ? problema(404, 'TAX_RULE_NOT_FOUND', {}, 'corr-404') : undefined), {
      regraId: REGRA_ID,
    });

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('não existe mais');
    expect(alerta).toHaveTextContent('corr-404');
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
  });
});

describe('EditorDeRegra — somente leitura (SPEC-016 §3.2: publicada é imutável)', () => {
  it('versão publicada: campos readOnly, explicação visível e nenhum botão de salvar', async () => {
    montar(doServidor(regra({ lockVersion: 2 })), { regraId: REGRA_ID });

    const aliquota = await screen.findByLabelText(/Alíquota/u);
    expect(aliquota).toHaveAttribute('readonly');
    expect(screen.getByText(/Versão publicada é imutável/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Arquivar/u })).toBeInTheDocument();
    expect(screen.getByText('Publicada')).toBeInTheDocument();
  });

  it('versão arquivada: somente leitura e sem ação alguma além de fechar', async () => {
    montar(doServidor(regra({ status: 'ARCHIVED', archivedAt: '2026-10-01T00:00:00.000Z', lockVersion: 3 })), { regraId: REGRA_ID });

    expect(await screen.findByLabelText(/Alíquota/u)).toHaveAttribute('readonly');
    expect(screen.getByText(/Versão arquivada/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Arquivar|Publicar|Salvar/u })).not.toBeInTheDocument();
  });

  it('o escritório vê a versão publicada sem nenhuma ação de alteração', async () => {
    montar(doServidor(regra()), { regraId: REGRA_ID, podeAdministrar: false });

    expect(await screen.findByLabelText(/Alíquota/u)).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /Arquivar|Publicar|Salvar/u })).not.toBeInTheDocument();
    expect(screen.getByText(/Somente o administrador da plataforma/u)).toBeInTheDocument();
  });

  it('mostra a auditoria da versão em horário de Brasília', async () => {
    montar(doServidor(regra({ createdAt: '2026-09-20T12:00:00.000Z', publishedAt: '2026-09-21T02:30:00.000Z' })), { regraId: REGRA_ID });

    await screen.findByLabelText(/Alíquota/u);
    expect(screen.getByText('20/09/2026 09:00')).toBeInTheDocument();
    expect(screen.getByText('20/09/2026 23:30')).toBeInTheDocument();
  });
});

describe('EditorDeRegra — acessibilidade', () => {
  it('o painel não tem violação de axe, vazio, em edição e somente leitura', async () => {
    const { unmount } = montar(() => undefined);
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
    unmount();

    const edicao = montar(doServidor(), { regraId: REGRA_ID });
    await screen.findByLabelText(/Alíquota/u);
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
    edicao.unmount();

    montar(doServidor(regra()), { regraId: REGRA_ID });
    await screen.findByLabelText(/Alíquota/u);
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });
});
