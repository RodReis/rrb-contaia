import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import { AvisoBloqueante } from './aviso-bloqueante';

describe('AvisoBloqueante', () => {
  it('fechado não renderiza nada', () => {
    render(<AvisoBloqueante aberto={false} titulo="Não é possível" descricao="Motivo." aoFechar={() => undefined} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('aberto explica o motivo e oferece só "Entendi"', () => {
    render(
      <AvisoBloqueante
        aberto
        titulo="Não é possível continuar"
        descricao="O escritório precisa manter ao menos um administrador ativo."
        aoFechar={() => undefined}
      />,
    );

    const dialogo = screen.getByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Não é possível continuar');
    expect(dialogo).toHaveTextContent('ao menos um administrador ativo');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('"Entendi" e ESC pedem para fechar', async () => {
    const aoFechar = vi.fn();

    render(<AvisoBloqueante aberto titulo="T" descricao="D" aoFechar={aoFechar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(2));
  });

  it('não tem violação detectável pelo axe', async () => {
    render(<AvisoBloqueante aberto titulo="T" descricao="D" aoFechar={() => undefined} />);

    expect(await axe(screen.getByRole('alertdialog'))).toHaveNoViolations();
  });
});
