/**
 * Provas da desativação (SPEC-011 §3.4) e da troca de responsável (§3.5):
 * `AlertDialog` que nomeia empresa e CNPJ, motivo obrigatório, falha que mantém o
 * diálogo aberto e escolha restrita aos elegíveis.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogoDeDesativacao } from './dialogo-de-desativacao';
import { DialogoDeResponsavel } from './dialogo-de-responsavel';
import {
  ITEM_SEM_RESPONSAVEL,
  PADARIA,
  detalhe,
  instalarFetch,
  json,
  problema,
  Envolvido,
  type Roteador,
} from './cofre.fixtures';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));

vi.mock('sonner', () => ({ toast }));

const chamadas: { url: string; metodo: string; corpo: string }[] = [];
let resposta: (url: string) => Response | Promise<Response> = () => json(detalhe(PADARIA));
const ELEGIVEIS = () =>
  json([
    { id: 'ana', nome: 'Ana Lima', email: 'ana@escritorio.com', papel: 'contador' },
    { id: 'carlos', nome: 'Carlos Dias', email: 'carlos@escritorio.com', papel: 'admin_escritorio' },
  ]);
let responsaveis: () => Response = ELEGIVEIS;

const roteador: Roteador = (url, init) => {
  chamadas.push({ url, metodo: init?.method ?? 'GET', corpo: String(init?.body ?? '') });

  if (url.includes('/certificados/responsaveis')) return responsaveis();
  if (url.includes('/vigente/')) return resposta(url);

  return undefined;
};

const mutacoes = () => chamadas.filter((chamada) => chamada.metodo !== 'GET');

beforeEach(() => {
  chamadas.length = 0;
  resposta = () => json(detalhe(PADARIA));
  responsaveis = ELEGIVEIS;
  Object.values(toast).forEach((funcao) => funcao.mockClear());
  instalarFetch(roteador);
});

describe('DialogoDeDesativacao', () => {
  const abrir = async () => {
    const usuario = userEvent.setup();

    render(
      <DialogoDeDesativacao
        gatilho={<button type="button">Desativar</button>}
        empresaId="e-valido"
        empresaNome="Padaria Aurora"
        cnpj="11222333000181"
      />,
      { wrapper: Envolvido },
    );
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }));

    return { usuario, caixa: await screen.findByRole('alertdialog') };
  };

  it('nomeia empresa e CNPJ e diz o que muda: sem certificado vigente, sem exclusão, pendência aberta', async () => {
    const { caixa } = await abrir();

    expect(caixa).toHaveAccessibleName(/Desativar o certificado de Padaria Aurora/u);
    expect(caixa).toHaveAccessibleName(/11\.222\.333\/0001-81/u);
    expect(within(caixa).getByText(/sem certificado vigente/u)).toBeInTheDocument();
    expect(within(caixa).getByText(/sem exclusão/u)).toBeInTheDocument();
    expect(within(caixa).getByText(/pendência de certificado ausente/u)).toBeInTheDocument();
    expect(within(caixa).getByText(/Não é possível reativar/u)).toBeInTheDocument();
  });

  it('o foco abre no motivo, que é o que precisa ser preenchido', async () => {
    const { caixa } = await abrir();

    await waitFor(() => expect(within(caixa).getByLabelText(/Motivo da desativação/u)).toHaveFocus());
  });

  it('sem motivo, a ação é bloqueada na interface e nada é enviado', async () => {
    const { usuario, caixa } = await abrir();

    await usuario.click(within(caixa).getByRole('button', { name: 'Desativar certificado' }));

    expect(await within(caixa).findByText('Informe o motivo da desativação.')).toBeInTheDocument();
    expect(within(caixa).getByLabelText(/Motivo da desativação/u)).toHaveAttribute('aria-invalid', 'true');
    expect(mutacoes()).toHaveLength(0);
    // O botão não fica desabilitado por validação: mostra o que falta.
    expect(within(caixa).getByRole('button', { name: 'Desativar certificado' })).toBeEnabled();
  });

  it('motivo só com espaços também é recusado', async () => {
    const { usuario, caixa } = await abrir();

    await usuario.type(within(caixa).getByLabelText(/Motivo da desativação/u), '    ');
    await usuario.click(within(caixa).getByRole('button', { name: 'Desativar certificado' }));

    expect(await within(caixa).findByText('Informe o motivo da desativação.')).toBeInTheDocument();
    expect(mutacoes()).toHaveLength(0);
  });

  it('com motivo, envia a desativação, fecha e avisa por Toast', async () => {
    const { usuario, caixa } = await abrir();

    await usuario.type(within(caixa).getByLabelText(/Motivo da desativação/u), '  Troca de certificadora  ');
    await usuario.click(within(caixa).getByRole('button', { name: 'Desativar certificado' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mutacoes()).toEqual([
      {
        url: '/api/proxy/empresas/e-valido/certificados/vigente/desativacao',
        metodo: 'POST',
        corpo: JSON.stringify({ motivo: 'Troca de certificadora' }),
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      'Certificado desativado. Padaria Aurora está sem certificado vigente.',
    );
  });

  it('se o servidor falhar, o diálogo continua aberto com o motivo e o erro vai por Toast com código', async () => {
    resposta = () => problema(503, 'COFRE_INDISPONIVEL', {}, 'corr-desativar-1');
    const { usuario, caixa } = await abrir();

    await usuario.type(within(caixa).getByLabelText(/Motivo da desativação/u), 'Troca de certificadora');
    await usuario.click(within(caixa).getByRole('button', { name: 'Desativar certificado' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('cofre está indisponível'),
        expect.objectContaining({
          duration: Infinity,
          description: 'Código de suporte: corr-desativar-1',
        }),
      ),
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(screen.getByRole('alertdialog')).getByLabelText(/Motivo da desativação/u)).toHaveValue(
      'Troca de certificadora',
    );
  });

  it('cancelar fecha sem enviar nada', async () => {
    const { usuario, caixa } = await abrir();

    await usuario.click(within(caixa).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mutacoes()).toHaveLength(0);
  });

  it('reabrir começa do zero: o motivo anterior não vaza para a próxima desativação', async () => {
    const { usuario, caixa } = await abrir();

    await usuario.type(within(caixa).getByLabelText(/Motivo da desativação/u), 'rascunho');
    await usuario.click(within(caixa).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }));

    expect(within(await screen.findByRole('alertdialog')).getByLabelText(/Motivo da desativação/u)).toHaveValue('');
  });

  it('não tem violações de acessibilidade', async () => {
    const { caixa } = await abrir();

    expect(await axe(caixa)).toHaveNoViolations();
  });
});

describe('DialogoDeResponsavel', () => {
  const abrir = async (item = ITEM_SEM_RESPONSAVEL) => {
    const usuario = userEvent.setup();

    render(<DialogoDeResponsavel item={item} gatilho={<button type="button">Trocar</button>} />, {
      wrapper: Envolvido,
    });
    await usuario.click(screen.getByRole('button', { name: 'Trocar' }));

    return { usuario, caixa: await screen.findByRole('dialog') };
  };

  it('diz quem é o responsável hoje e por que a troca é necessária', async () => {
    const { caixa } = await abrir();

    expect(caixa).toHaveAccessibleName('Trocar o responsável pelo certificado');
    expect(within(caixa).getByText(/Transportes Boa Viagem/u)).toBeInTheDocument();
    expect(within(caixa).getByText(/Hoje: Bruno Prado \(inativo\)/u)).toBeInTheDocument();
  });

  it('sem escolher ninguém, mostra o erro e não envia', async () => {
    const { usuario, caixa } = await abrir();

    await within(caixa).findByRole('combobox', { name: /Novo responsável/u });
    await usuario.click(within(caixa).getByRole('button', { name: 'Salvar responsável' }));

    expect(await within(caixa).findByText('Escolha o responsável pelo certificado.')).toBeInTheDocument();
    expect(mutacoes()).toHaveLength(0);
  });

  it('escolhe entre os elegíveis, salva por PUT e fecha com Toast', async () => {
    resposta = () => json(detalhe({ ...PADARIA, responsavel: { id: 'carlos', nome: 'Carlos Dias', email: 'c@e.com', situacao: 'ATIVO' } }));
    const { usuario, caixa } = await abrir();
    const seletor = await within(caixa).findByRole('combobox', { name: /Novo responsável/u });

    await waitFor(() => expect(seletor).toBeEnabled());
    // O Select do Radix abre por teclado no jsdom, como nas demais telas do produto.
    seletor.focus();
    await userEvent.keyboard('{Enter}{ArrowDown}{Enter}');
    await waitFor(() => expect(seletor).toHaveTextContent(/Ana Lima|Carlos Dias/u));
    await usuario.click(within(caixa).getByRole('button', { name: 'Salvar responsável' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [chamada] = mutacoes();

    expect(chamada?.url).toBe('/api/proxy/empresas/e-sem-resp/certificados/vigente/responsavel');
    expect(chamada?.metodo).toBe('PUT');
    expect(JSON.parse(chamada?.corpo ?? '{}')).toEqual({ responsavelId: expect.stringMatching(/ana|carlos/u) });
    expect(toast.success).toHaveBeenCalledWith('Responsável alterado para Carlos Dias.');
  });

  it('sem elegíveis explica o que fazer e não deixa escolher', async () => {
    responsaveis = () => json([]);
    const { caixa } = await abrir();

    expect(await within(caixa).findByText(/Nenhum administrador ou contador ativo/u)).toBeInTheDocument();
    expect(within(caixa).getByRole('combobox', { name: /Novo responsável/u })).toBeDisabled();
  });

  it('falha ao carregar os elegíveis oferece tentar de novo', async () => {
    responsaveis = () => problema(500, 'ERRO_DESCONHECIDO');
    const { caixa } = await abrir();

    expect(await within(caixa).findByText('Não foi possível carregar os responsáveis.')).toBeInTheDocument();
    expect(within(caixa).getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { caixa } = await abrir();

    await within(caixa).findByRole('combobox', { name: /Novo responsável/u });
    expect(await axe(caixa)).toHaveNoViolations();
  });
});
