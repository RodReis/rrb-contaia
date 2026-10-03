import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from './breadcrumb';

describe('Breadcrumb', () => {
  const itens = [
    { rotulo: 'Início', href: '/empresas' },
    { rotulo: 'Configurações' },
    { rotulo: 'Usuários e permissões' },
  ];

  it('é uma navegação rotulada com lista ordenada', () => {
    render(<Breadcrumb itens={itens} />);

    const navegacao = screen.getByRole('navigation', { name: 'Trilha de navegação' });

    expect(navegacao.querySelector('ol')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('só os itens com destino viram link; o último é a página atual e não é link', () => {
    render(<Breadcrumb itens={itens} />);

    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/empresas');
    expect(screen.queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuários e permissões' })).not.toBeInTheDocument();
    expect(screen.getByText('Usuários e permissões')).toHaveAttribute('aria-current', 'page');
  });

  it('não tem violação detectável pelo axe', async () => {
    const { container } = render(<Breadcrumb itens={itens} />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
