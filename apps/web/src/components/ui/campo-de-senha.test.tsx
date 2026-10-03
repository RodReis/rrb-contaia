import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import { CampoDeSenha } from './campo-de-senha';

const montar = (extras: Partial<Parameters<typeof CampoDeSenha>[0]> = {}) =>
  render(
    <CampoDeSenha rotulo="Senha" value="" onValorChange={() => undefined} {...extras} />,
  );

describe('CampoDeSenha', () => {
  it('nasce oculto, com rótulo visível e autocomplete de senha nova', () => {
    montar();

    const campo = screen.getByLabelText('Senha');

    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'new-password');
  });

  it('o botão mostra e oculta a senha e anuncia o estado por aria-pressed', async () => {
    montar({ value: 'segredo-123' });

    const alternar = screen.getByRole('button', { name: 'Mostrar senha' });

    expect(alternar).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(alternar);

    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));

    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });

  it('o botão de mostrar nunca envia o formulário', async () => {
    const aoEnviar = vi.fn((evento: Event) => evento.preventDefault());

    render(
      <form onSubmit={aoEnviar as never}>
        <CampoDeSenha rotulo="Senha" value="" onValorChange={() => undefined} />
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));

    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it('digitar avisa o novo valor', async () => {
    const aoMudar = vi.fn();

    montar({ onValorChange: aoMudar });

    await userEvent.type(screen.getByLabelText('Senha'), 'a');

    expect(aoMudar).toHaveBeenCalledWith('a');
  });

  it('a ajuda aparece antes de digitar; o erro a substitui no mesmo lugar', () => {
    const { rerender } = montar({ ajuda: 'Use ao menos 10 caracteres.' });

    expect(screen.getByText('Use ao menos 10 caracteres.')).toBeInTheDocument();

    rerender(
      <CampoDeSenha
        rotulo="Senha"
        value=""
        onValorChange={() => undefined}
        ajuda="Use ao menos 10 caracteres."
        erro="A senha é curta demais."
      />,
    );

    expect(screen.queryByText('Use ao menos 10 caracteres.')).not.toBeInTheDocument();
    expect(screen.getByText('A senha é curta demais.')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Senha')).toHaveAccessibleDescription('A senha é curta demais.');
  });

  it('obrigatório é marcado e anunciado', () => {
    montar({ obrigatorio: true });

    expect(screen.getByLabelText(/Senha/u)).toBeRequired();
  });

  it('não tem violação detectável pelo axe', async () => {
    const { container } = montar({ ajuda: 'Use ao menos 10 caracteres.', obrigatorio: true });

    expect(await axe(container)).toHaveNoViolations();
  });
});
