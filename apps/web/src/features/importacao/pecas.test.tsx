/**
 * Região rolável das tabelas largas: quando a tabela não cabe, a borda cortada ganha um esmaecido
 * que diz "tem mais para o lado", e ele some quando a rolagem chega ao fim. Sem transbordo, nada aparece.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RegiaoRolavel } from './pecas';

const medidas = (elemento: HTMLElement, { largura, conteudo }: { largura: number; conteudo: number }): void => {
  Object.defineProperty(elemento, 'clientWidth', { configurable: true, value: largura });
  Object.defineProperty(elemento, 'scrollWidth', { configurable: true, value: conteudo });
};

const esmaecido = (container: HTMLElement, lado: 'inicio' | 'fim'): Element | null =>
  container.querySelector(`[data-borda="${lado}"]`);

describe('RegiaoRolavel', () => {
  it('sem transbordo, nenhuma borda esmaecida', () => {
    const { container } = render(<RegiaoRolavel rotulo="Tabela de teste">conteúdo</RegiaoRolavel>);
    const regiao = screen.getByRole('region', { name: 'Tabela de teste' });
    medidas(regiao, { largura: 600, conteudo: 600 });
    fireEvent.scroll(regiao);

    expect(esmaecido(container, 'inicio')).toHaveClass('opacity-0');
    expect(esmaecido(container, 'fim')).toHaveClass('opacity-0');
  });

  it('com transbordo, esmaece o lado que ainda tem conteúdo e acompanha a rolagem', () => {
    const { container } = render(<RegiaoRolavel rotulo="Tabela de teste">conteúdo</RegiaoRolavel>);
    const regiao = screen.getByRole('region', { name: 'Tabela de teste' });
    medidas(regiao, { largura: 600, conteudo: 900 });

    fireEvent.scroll(regiao, { target: { scrollLeft: 0 } });
    expect(esmaecido(container, 'inicio')).toHaveClass('opacity-0');
    expect(esmaecido(container, 'fim')).toHaveClass('opacity-100');

    fireEvent.scroll(regiao, { target: { scrollLeft: 150 } });
    expect(esmaecido(container, 'inicio')).toHaveClass('opacity-100');
    expect(esmaecido(container, 'fim')).toHaveClass('opacity-100');

    fireEvent.scroll(regiao, { target: { scrollLeft: 300 } });
    expect(esmaecido(container, 'inicio')).toHaveClass('opacity-100');
    expect(esmaecido(container, 'fim')).toHaveClass('opacity-0');
  });

  it('o esmaecido é só visual e não entra na árvore de acessibilidade', () => {
    const { container } = render(<RegiaoRolavel rotulo="Tabela de teste">conteúdo</RegiaoRolavel>);

    expect(esmaecido(container, 'fim')).toHaveAttribute('aria-hidden', 'true');
  });
});
