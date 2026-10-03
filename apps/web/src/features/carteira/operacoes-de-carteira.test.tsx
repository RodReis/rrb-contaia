/**
 * Provas de tela das operações de carteira (SPEC-009 §3.2, §5.2, §5.3): gestão
 * individual e lote. O que se prova é a tela — resumo antes de salvar, confirmação
 * de remoção com impacto explícito, lote inválido sem aplicação parcial, conflito
 * concorrente e estados —, com a API dublada no `fetch`.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogoDeLote } from './dialogo-de-lote';
import { GestaoDaCarteira } from './gestao-da-carteira';
import { Button } from '@/components/ui/button';
import {
  Envolvido,
  colaborador,
  empresa,
  instalarFetch,
  json,
  problema,
  type Roteador,
} from './carteira.fixtures';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));

const ALFA = empresa({ id: 'e-alfa', nome: 'Alfa Ltda', atribuida: true });
const BETA = empresa({ id: 'e-beta', nome: 'Beta Comércio', cnpj: '45242914000105' });
const GAMA = empresa({ id: 'e-gama', nome: 'Gama Serviços', cnpj: '33000167000101' });

let pessoa = colaborador({ id: 'bruno', nome: 'Bruno Lima', empresas: 1, revisaoCarteira: 4 });
let empresasDoServidor = [ALFA, BETA, GAMA];
let aoAlterar: (corpo: Record<string, unknown>) => Response | Promise<Response> = () =>
  json({ aplicado: true, afetados: [{ usuarioId: 'bruno', revisaoNova: 5 }] });
const envios: Array<Record<string, unknown>> = [];

const roteador: Roteador = (url, init) => {
  if (url.endsWith('/carteiras/alteracoes') && init?.method === 'POST') {
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    envios.push(corpo);

    return aoAlterar(corpo);
  }
  if (/\/carteiras\/colaboradores\/[^/?]+\/empresas\?/u.test(url)) {
    return json({ empresas: empresasDoServidor, total: empresasDoServidor.length });
  }
  if (/\/carteiras\/colaboradores\/[^/?]+$/u.test(url)) return json(pessoa);

  return undefined;
};

beforeEach(() => {
  pessoa = colaborador({ id: 'bruno', nome: 'Bruno Lima', empresas: 1, revisaoCarteira: 4 });
  empresasDoServidor = [ALFA, BETA, GAMA];
  aoAlterar = () => json({ aplicado: true, afetados: [{ usuarioId: 'bruno', revisaoNova: 5 }] });
  envios.length = 0;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.warning).mockClear();
  instalarFetch(roteador);
});

const renderizarGestao = () => render(<GestaoDaCarteira usuarioId="bruno" />, { wrapper: Envolvido });
const resumo = () => screen.getByRole('region', { name: 'Resumo antes de salvar' });

describe('GestaoDaCarteira', () => {
  it('mostra o colaborador, suas empresas e a marca de quem já está na carteira', async () => {
    renderizarGestao();

    expect(screen.getByText('Carregando a carteira do colaborador')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Bruno Lima' })).toBeInTheDocument();
    expect(screen.getByText('1 empresa na carteira')).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Alfa Ltda' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beta Comércio' })).not.toBeChecked();
    expect(screen.getByText('Na carteira')).toBeInTheDocument();
  });

  it('colaborador sem carteira recebe a orientação de ausência de alçada', async () => {
    pessoa = colaborador({ id: 'bruno', nome: 'Bruno Lima', empresas: 0 });
    renderizarGestao();

    expect(await screen.findByText('Sem empresas')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/ausência de alçada/i);
  });

  it('marcar empresa monta o resumo e salvar envia só a adição, com a revisão que a tela viu', async () => {
    const usuario = userEvent.setup();
    renderizarGestao();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Beta Comércio' }));

    expect(within(resumo()).getByText(/Beta Comércio \(45\.242\.914\/0001-05\)/)).toBeInTheDocument();
    expect(within(resumo()).getByText('Nenhuma empresa a remover.')).toBeInTheDocument();

    await usuario.click(within(resumo()).getByRole('button', { name: 'Salvar carteira' }));

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toEqual({
      origem: 'INDIVIDUAL',
      usuarios: [{ id: 'bruno', revisao: 4 }],
      adicionar: ['e-beta'],
      remover: [],
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Carteira atualizada.'));
    // Depois de salvar o resumo recomeça vazio.
    await waitFor(() =>
      expect(within(resumo()).getByText('Nenhuma empresa a adicionar.')).toBeInTheDocument(),
    );
  });

  it('marcar e desmarcar de novo desfaz a alteração', async () => {
    const usuario = userEvent.setup();
    renderizarGestao();
    const beta = await screen.findByRole('checkbox', { name: 'Beta Comércio' });

    await usuario.click(beta);
    await usuario.click(beta);

    expect(within(resumo()).getByText('Nenhuma empresa a adicionar.')).toBeInTheDocument();
    expect(within(resumo()).getByRole('button', { name: 'Salvar carteira' })).toBeDisabled();
  });

  it('remover exige confirmação que nomeia o colaborador e a empresa; só depois grava', async () => {
    const usuario = userEvent.setup();
    renderizarGestao();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Alfa Ltda' }));
    await usuario.click(within(resumo()).getByRole('button', { name: 'Salvar carteira' }));

    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Bruno Lima');
    expect(dialogo).toHaveTextContent('Alfa Ltda');
    expect(dialogo).toHaveTextContent(/nova atribuição/i);
    expect(envios).toHaveLength(0);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Remover e salvar' }));

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toMatchObject({ adicionar: [], remover: ['e-alfa'] });
  });

  it('cancelar a confirmação de remoção não grava nada', async () => {
    const usuario = userEvent.setup();
    renderizarGestao();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Alfa Ltda' }));
    await usuario.click(within(resumo()).getByRole('button', { name: 'Salvar carteira' }));
    await usuario.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }),
    );

    expect(envios).toHaveLength(0);
  });

  it('adição e remoção juntas saem numa só operação', async () => {
    const usuario = userEvent.setup();
    renderizarGestao();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Alfa Ltda' }));
    await usuario.click(screen.getByRole('checkbox', { name: 'Gama Serviços' }));
    await usuario.click(within(resumo()).getByRole('button', { name: 'Salvar carteira' }));
    await usuario.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remover e salvar' }),
    );

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toMatchObject({ adicionar: ['e-gama'], remover: ['e-alfa'] });
  });

  it('lote recusado lista os itens inválidos, não aplica nada e preserva a seleção', async () => {
    aoAlterar = () =>
      problema(422, 'CAMPO_OBRIGATORIO', {
        campos: [{ campo: 'empresas.e-beta', codigo: 'EMPRESA_ARQUIVADA' }],
      });
    const usuario = userEvent.setup();
    renderizarGestao();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Beta Comércio' }));
    await usuario.click(within(resumo()).getByRole('button', { name: 'Salvar carteira' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Nada foi salvo');
    expect(alerta).toHaveTextContent('Beta Comércio');
    expect(alerta).toHaveTextContent('Empresa arquivada não aceita esta operação.');
    // A seleção continua lá para corrigir e tentar de novo.
    expect(screen.getByRole('checkbox', { name: 'Beta Comércio' })).toBeChecked();
  });

  it('carteira desatualizada (409) avisa para recarregar, sem tratar como erro genérico', async () => {
    aoAlterar = () => problema(409, 'CARTEIRA_DESATUALIZADA');
    const usuario = userEvent.setup();
    renderizarGestao();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Beta Comércio' }));
    await usuario.click(within(resumo()).getByRole('button', { name: 'Salvar carteira' }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('A carteira mudou')),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('usuário arquivado não recebe carteira: explica e não oferece o seletor', async () => {
    pessoa = colaborador({ id: 'bruno', nome: 'Bruno Lima', estado: 'ARQUIVADO' });
    renderizarGestao();

    expect(await screen.findByText('Usuário arquivado')).toBeInTheDocument();
    expect(screen.getByText(/convide o usuário de novo/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Alfa Ltda' })).not.toBeInTheDocument();
  });

  it('sem permissão de administração a recusa da API vira estado de permissão insuficiente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => problema(403, 'SEM_AUTORIZACAO')),
    );
    renderizarGestao();

    expect(await screen.findByText('Você não tem permissão para ver esta área')).toBeInTheDocument();
  });

  it('empresa sem resultado na busca explica o vazio e não oferece seleção', async () => {
    empresasDoServidor = [];
    const usuario = userEvent.setup();
    renderizarGestao();
    await screen.findByRole('heading', { name: 'Bruno Lima' });

    await usuario.type(screen.getByRole('searchbox', { name: /Buscar empresa/ }), 'zzz');

    expect(await screen.findByText('Nenhuma empresa encontrada')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderizarGestao();
    await screen.findByRole('checkbox', { name: 'Alfa Ltda' });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DialogoDeLote', () => {
  const ANA = colaborador({ id: 'ana', nome: 'Ana Souza', revisaoCarteira: 2 });
  const BRUNO = colaborador({ id: 'bruno', nome: 'Bruno Lima', revisaoCarteira: 4 });
  const aoConcluir = vi.fn();

  const renderizarLote = (operacao: 'ADICIONAR' | 'REMOVER' = 'ADICIONAR') =>
    render(
      <DialogoDeLote
        operacao={operacao}
        colaboradores={[ANA, BRUNO]}
        aoConcluir={aoConcluir}
        gatilho={<Button>Abrir lote</Button>}
      />,
      { wrapper: Envolvido },
    );

  beforeEach(() => aoConcluir.mockClear());

  it('escolhe empresas, revisa colaboradores e efeito, e só então grava o lote inteiro', async () => {
    const usuario = userEvent.setup();
    renderizarLote();

    await usuario.click(screen.getByRole('button', { name: 'Abrir lote' }));
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();

    await usuario.click(await screen.findByRole('checkbox', { name: 'Beta Comércio' }));
    await usuario.click(screen.getByRole('checkbox', { name: 'Gama Serviços' }));
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByText('Revise antes de salvar')).toBeInTheDocument();
    expect(dialogo).toHaveTextContent('2 colaboradores passam a acessar 2 empresas');
    expect(dialogo).toHaveTextContent('Ana Souza');
    expect(dialogo).toHaveTextContent('Bruno Lima');
    expect(envios).toHaveLength(0);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Adicionar e salvar' }));

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toEqual({
      origem: 'LOTE',
      usuarios: [
        { id: 'ana', revisao: 2 },
        { id: 'bruno', revisao: 4 },
      ],
      adicionar: ['e-beta', 'e-gama'],
      remover: [],
    });
    await waitFor(() => expect(aoConcluir).toHaveBeenCalled());
  });

  it('remoção em lote diz o impacto por extenso e envia só a remoção', async () => {
    const usuario = userEvent.setup();
    renderizarLote('REMOVER');

    await usuario.click(screen.getByRole('button', { name: 'Abrir lote' }));
    await usuario.click(await screen.findByRole('checkbox', { name: 'Alfa Ltda' }));
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent('deixam de acessar');
    expect(dialogo).toHaveTextContent(/nova atribuição/i);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Remover e salvar' }));

    await waitFor(() => expect(envios).toHaveLength(1));
    expect(envios[0]).toMatchObject({ adicionar: [], remover: ['e-alfa'] });
  });

  it('lote inválido volta para a escolha com a lista de problemas e nada aplicado', async () => {
    aoAlterar = () =>
      problema(422, 'CAMPO_OBRIGATORIO', {
        campos: [{ campo: 'usuarios.bruno', codigo: 'USUARIO_ARQUIVADO_USE_NOVO_CONVITE' }],
      });
    const usuario = userEvent.setup();
    renderizarLote();

    await usuario.click(screen.getByRole('button', { name: 'Abrir lote' }));
    await usuario.click(await screen.findByRole('checkbox', { name: 'Beta Comércio' }));
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    await usuario.click(screen.getByRole('button', { name: 'Adicionar e salvar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Nada foi salvo');
    expect(alerta).toHaveTextContent('Bruno Lima');
    expect(aoConcluir).not.toHaveBeenCalled();
    // A seleção de empresas segue preservada na etapa de escolha.
    expect(screen.getByRole('checkbox', { name: 'Beta Comércio' })).toBeChecked();
  });

  it('reabrir começa do zero: a seleção anterior não vaza', async () => {
    const usuario = userEvent.setup();
    renderizarLote();

    await usuario.click(screen.getByRole('button', { name: 'Abrir lote' }));
    await usuario.click(await screen.findByRole('checkbox', { name: 'Beta Comércio' }));
    await usuario.click(screen.getByRole('button', { name: 'Fechar' }));
    await usuario.click(screen.getByRole('button', { name: 'Abrir lote' }));

    expect(await screen.findByRole('checkbox', { name: 'Beta Comércio' })).not.toBeChecked();
  });
});
