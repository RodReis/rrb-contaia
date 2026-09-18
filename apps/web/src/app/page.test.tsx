import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('página inicial do ambiente local', () => {
  it('identifica o produto e o ambiente', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { level: 1, name: 'ContaIA' })).toBeVisible();
    expect(screen.getByText('Ambiente local')).toBeVisible();
  });

  it('não tem violação de acessibilidade', async () => {
    const { container } = render(<Home />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
