import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import { LIMITE_DA_NFE_BYTES } from '@contaia/shared';

import { ERRO_DE_ARQUIVO_GRANDE, ERRO_DE_EXTENSAO, ERRO_DE_VARIOS_ARQUIVOS, ZonaDeXml } from './zona-de-xml';

const xml = (nome = 'nfe.xml', tamanho = 1024): File => new File([new Uint8Array(tamanho)], nome, { type: 'text/xml' });

const montar = (sobrescritas: Partial<Parameters<typeof ZonaDeXml>[0]> = {}) => {
  const aoEscolher = vi.fn();
  const aoRemover = vi.fn();
  const aoRejeitar = vi.fn();
  const resultado = render(
    <ZonaDeXml arquivo={null} erro={undefined} aoEscolher={aoEscolher} aoRemover={aoRemover} aoRejeitar={aoRejeitar} {...sobrescritas} />,
  );

  return { ...resultado, aoEscolher, aoRemover, aoRejeitar };
};

describe('ZonaDeXml — NF-e de teste, entrada descartável (SPEC-016 §3.6)', () => {
  it('tem input de arquivo real, acessível, restrito a .xml, e diz o limite e que nada é guardado', () => {
    montar();

    const entrada = screen.getByLabelText('Arquivo XML da NF-e');
    expect(entrada).toHaveAttribute('type', 'file');
    expect(entrada).toHaveAttribute('accept', '.xml,text/xml,application/xml');
    expect(screen.getByText('Máx. 2 MB')).toBeInTheDocument();
    expect(screen.getByText(/não é gravado nem enviado a serviço externo/iu)).toBeInTheDocument();
  });

  it('entrega o arquivo escolhido', async () => {
    const { aoEscolher } = montar();
    const arquivo = xml();

    await userEvent.upload(screen.getByLabelText('Arquivo XML da NF-e'), arquivo);

    expect(aoEscolher).toHaveBeenCalledWith(arquivo);
  });

  it('entrega o arquivo solto na área', () => {
    const { aoEscolher, container } = montar();
    const arquivo = xml();

    fireEvent.drop(container.querySelector('[data-zona-de-arquivo]') as HTMLElement, { dataTransfer: { files: [arquivo] } });

    expect(aoEscolher).toHaveBeenCalledWith(arquivo);
  });

  it('recusa extensão que não é .xml antes de gastar a rede', async () => {
    const { aoEscolher, aoRejeitar } = montar();

    await userEvent.upload(screen.getByLabelText('Arquivo XML da NF-e'), new File(['x'], 'nota.pdf', { type: 'application/pdf' }), {
      applyAccept: false,
    });

    expect(aoEscolher).not.toHaveBeenCalled();
    expect(aoRejeitar).toHaveBeenCalledWith(ERRO_DE_EXTENSAO);
  });

  it('recusa arquivo acima do limite explícito', async () => {
    const { aoEscolher, aoRejeitar } = montar();

    await userEvent.upload(screen.getByLabelText('Arquivo XML da NF-e'), xml('grande.xml', LIMITE_DA_NFE_BYTES + 1));

    expect(aoEscolher).not.toHaveBeenCalled();
    expect(aoRejeitar).toHaveBeenCalledWith(ERRO_DE_ARQUIVO_GRANDE);
  });

  it('aceita o arquivo exatamente no limite', async () => {
    const { aoEscolher } = montar();

    await userEvent.upload(screen.getByLabelText('Arquivo XML da NF-e'), xml('limite.xml', LIMITE_DA_NFE_BYTES));

    expect(aoEscolher).toHaveBeenCalled();
  });

  it('recusa mais de um arquivo solto de uma vez', () => {
    const { aoEscolher, aoRejeitar, container } = montar();

    fireEvent.drop(container.querySelector('[data-zona-de-arquivo]') as HTMLElement, {
      dataTransfer: { files: [xml('a.xml'), xml('b.xml')] },
    });

    expect(aoEscolher).not.toHaveBeenCalled();
    expect(aoRejeitar).toHaveBeenCalledWith(ERRO_DE_VARIOS_ARQUIVOS);
  });

  it('mostra o arquivo escolhido e permite trocar ou remover', async () => {
    const { aoRemover } = montar({ arquivo: xml('nota-de-teste.xml', 2048) });

    expect(screen.getByText('nota-de-teste.xml')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trocar arquivo' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(aoRemover).toHaveBeenCalledTimes(1);
  });

  it('o erro liga ao campo e aparece em texto', () => {
    montar({ erro: 'O arquivo precisa ser .xml.' });

    expect(screen.getByLabelText('Arquivo XML da NF-e')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('O arquivo precisa ser .xml.')).toBeInTheDocument();
  });

  it('desabilitada não aceita arquivo', async () => {
    const { aoEscolher } = montar({ desabilitada: true });

    expect(screen.getByLabelText('Arquivo XML da NF-e')).toBeDisabled();
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it('não tem violação de axe, vazia, com arquivo e com erro', async () => {
    const { container, rerender, aoEscolher, aoRemover, aoRejeitar } = montar();
    expect(await axe(container)).toHaveNoViolations();

    rerender(<ZonaDeXml arquivo={xml()} erro="Falha" aoEscolher={aoEscolher} aoRemover={aoRemover} aoRejeitar={aoRejeitar} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
