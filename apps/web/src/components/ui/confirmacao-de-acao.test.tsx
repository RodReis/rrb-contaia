import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { ConfirmacaoDeAcao } from './confirmacao-de-acao';

const montar = (aoConfirmar: () => Promise<void>, explicarBloqueio?: (erro: unknown) => string | null) =>
  render(
    <ConfirmacaoDeAcao
      gatilho={<Button>Suspender</Button>}
      titulo="Suspender Ana Souza?"
      descricao="Ana perde o acesso na hora e todas as sessões dela são encerradas."
      rotuloDeConfirmacao="Suspender usuário"
      destrutivo
      aoConfirmar={aoConfirmar}
      {...(explicarBloqueio === undefined ? {} : { explicarBloqueio })}
    />,
  );

describe('ConfirmacaoDeAcao', () => {
  it('só abre ao acionar o gatilho e nomeia o registro e o efeito', async () => {
    montar(async () => undefined);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Suspender Ana Souza?');
    expect(dialogo).toHaveTextContent('sessões dela são encerradas');
  });

  it('não executa nada até a confirmação explícita; cancelar fecha sem chamar', async () => {
    const aoConfirmar = vi.fn(async () => undefined);

    montar(aoConfirmar);
    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(aoConfirmar).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('confirmar executa e fecha o diálogo quando conclui', async () => {
    const aoConfirmar = vi.fn(async () => undefined);

    montar(aoConfirmar);
    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender usuário' }));

    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('enquanto executa, os botões ficam desabilitados e o diálogo não fecha sozinho', async () => {
    let concluir: () => void = () => undefined;
    const aoConfirmar = vi.fn(
      () =>
        new Promise<void>((resolver) => {
          concluir = resolver;
        }),
    );

    montar(aoConfirmar);
    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender usuário' }));

    // O rótulo da ação continua; o estado ocupado vem do indicador e de `aria-busy`.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Suspender usuário' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Suspender usuário' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    concluir();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('falha comum mantém o diálogo aberto para tentar de novo', async () => {
    montar(async () => {
      throw new Error('falhou');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender usuário' }));

    expect(await screen.findByRole('button', { name: 'Suspender usuário' })).toBeEnabled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('bloqueio explicado troca o conteúdo por uma mensagem com um único "Entendi"', async () => {
    montar(
      async () => {
        throw new Error('ultimo-admin');
      },
      () => 'O escritório precisa manter ao menos um administrador ativo.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender usuário' }));

    expect(await screen.findByText('Não é possível continuar')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('ao menos um administrador ativo');
    expect(screen.queryByRole('button', { name: 'Suspender usuário' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('reabrir começa do zero, sem o bloqueio da tentativa anterior', async () => {
    montar(
      async () => {
        throw new Error('x');
      },
      () => 'Bloqueado.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender usuário' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Entendi' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));

    expect(await screen.findByText('Suspender Ana Souza?')).toBeInTheDocument();
    expect(screen.queryByText('Não é possível continuar')).not.toBeInTheDocument();
  });

  it('ESC fecha e devolve o foco ao gatilho', async () => {
    montar(async () => undefined);

    const gatilho = screen.getByRole('button', { name: 'Suspender' });

    await userEvent.click(gatilho);
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(gatilho).toHaveFocus();
  });

  it('o diálogo aberto não tem violação detectável pelo axe', async () => {
    montar(async () => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(await axe(dialogo)).toHaveNoViolations();
  });

  it('o botão de recusa aceita rótulo próprio e o padrão continua "Cancelar"', async () => {
    render(
      <ConfirmacaoDeAcao
        gatilho={<Button>Cancelar importação</Button>}
        titulo="Cancelar a importação?"
        descricao="Nada muda no plano."
        rotuloDeConfirmacao="Cancelar importação"
        rotuloDeRecusa="Manter prévia"
        destrutivo
        aoConfirmar={async () => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar importação' }));

    const dialogo = await screen.findByRole('alertdialog');
    expect(screen.getAllByRole('button', { name: 'Manter prévia' })).toHaveLength(1);
    expect(dialogo).not.toHaveTextContent(/^Cancelar$/u);
  });
});
