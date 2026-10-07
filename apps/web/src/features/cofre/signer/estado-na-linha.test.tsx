/**
 * Coluna `Signer mTLS` por empresa (SPEC-012 §5.2): DF-e e eSocial separados, cada um com estado,
 * último teste e latência; o resumo é o pior estado das duas e nunca depende só de cor.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import { EstadoNaLinha } from './estado-na-linha';
import {
  estadoComFalhaNoEsocial,
  estadoDaEmpresa,
  estadoNaoTestado,
  estadoSemCertificado,
} from './signer.fixtures';

const resumo = () => screen.getByRole('group', { name: 'Resumo do Signer mTLS' });

const EMPRESA = { empresaId: 'empresa-1', empresaNome: 'Padaria Aurora' } as const;

const renderizar = (propriedades: Partial<React.ComponentProps<typeof EstadoNaLinha>> = {}) => {
  const aoAbrir = vi.fn();

  render(
    <EstadoNaLinha
      {...EMPRESA}
      estado={estadoDaEmpresa('empresa-1')}
      situacao="pronto"
      aoAbrir={aoAbrir}
      {...propriedades}
    />,
  );

  return { aoAbrir };
};

describe('EstadoNaLinha', () => {
  it('mostra o resumo e as duas finalidades, cada uma com estado, último teste e latência', () => {
    renderizar();

    const lista = screen.getByRole('list', { name: 'Finalidades do Signer mTLS' });
    const [dfe, esocial] = within(lista).getAllByRole('listitem');

    expect(within(dfe!).getByText('DF-e')).toBeInTheDocument();
    expect(within(dfe!).getByText('Operacional')).toBeInTheDocument();
    expect(within(dfe!).getByText(/07\/10\/2026 11:30/u)).toBeInTheDocument();
    expect(within(dfe!).getByText(/12 ms/u)).toBeInTheDocument();
    expect(within(esocial!).getByText('eSocial')).toBeInTheDocument();
    expect(within(esocial!).getByText(/15 ms/u)).toBeInTheDocument();
    expect(resumo()).toHaveTextContent('Operacional');
  });

  it('o resumo é o pior estado: uma finalidade em falha derruba a empresa, em texto', () => {
    renderizar({ estado: estadoComFalhaNoEsocial('empresa-1') });

    expect(resumo()).toHaveTextContent('Falha');
    const [dfe, esocial] = within(screen.getByRole('list', { name: 'Finalidades do Signer mTLS' })).getAllByRole('listitem');

    expect(within(dfe!).getByText('Operacional')).toBeInTheDocument();
    expect(within(esocial!).getByText('Falha')).toBeInTheDocument();
    expect(within(esocial!).getByText('—')).toBeInTheDocument();
  });

  it('empresa sem certificado vigente: estado próprio, sem horário nem latência inventados', () => {
    renderizar({ estado: estadoSemCertificado('empresa-1') });

    expect(resumo()).toHaveTextContent('Sem certificado');
    expect(screen.getAllByText('Sem certificado').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/ms/u)).not.toBeInTheDocument();
  });

  it('empresa ainda não testada diz que nunca foi testada', () => {
    renderizar({ estado: estadoNaoTestado('empresa-1') });

    expect(resumo()).toHaveTextContent('Não testado');
    expect(screen.getAllByText('Nunca testado')).toHaveLength(2);
  });

  it('carregando: forma de esqueleto com aviso textual', () => {
    renderizar({ estado: undefined, situacao: 'carregando' });

    expect(screen.getByText('Carregando o estado do Signer da empresa')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('falha de comunicação: diz que não conseguiu ler, sem inventar estado', () => {
    renderizar({ estado: undefined, situacao: 'falha' });

    expect(screen.getByText('Estado indisponível agora')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Resumo do Signer mTLS' })).not.toBeInTheDocument();
  });

  it('falha com último estado conhecido: mantém o estado e marca como desatualizado', () => {
    renderizar({ situacao: 'falha' });

    expect(resumo()).toHaveTextContent('Operacional');
    expect(screen.getByText('Desatualizado')).toBeInTheDocument();
  });

  it('empresa fora da resposta (não listada pelo Signer) mostra travessão', () => {
    renderizar({ estado: undefined, situacao: 'pronto' });

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('o botão abre o painel da empresa e o nome acessível cita a empresa', async () => {
    const { aoAbrir } = renderizar();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir o painel do Signer de Padaria Aurora' }));

    expect(aoAbrir).toHaveBeenCalledWith('empresa-1');
  });

  it('acessível: sem violações do axe, em estado normal e em falha', async () => {
    const { container } = render(
      <>
        <EstadoNaLinha {...EMPRESA} estado={estadoComFalhaNoEsocial('empresa-1')} situacao="pronto" aoAbrir={vi.fn()} />
      </>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
