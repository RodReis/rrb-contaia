/**
 * Provas do editor de matriz (SPEC-008 §3.3 e §5.2): dependência de Consultar,
 * ocultação de módulo com confirmação, área exclusiva bloqueada, somente leitura,
 * teclado e acessibilidade. As regras são do domínio; aqui se prova que a tela as aplica.
 */
import { moldeDoPapelPadrao } from '@contaia/domain';
import type { ChaveDoCatalogo } from '@contaia/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrizDePermissoes } from './matriz-de-permissoes';
import { catalogoDeTeste } from './papeis.fixtures';

const avisar = vi.fn();

vi.mock('sonner', () => ({ toast: { info: (mensagem: string) => avisar(mensagem), success: vi.fn(), error: vi.fn() } }));

const CATALOGO = catalogoDeTeste();

/** Estado real por baixo: a tela devolve a matriz nova e o teste enxerga o resultado. */
const Editor = ({
  inicial,
  somenteLeitura = false,
  aoMudar,
  erro,
}: {
  inicial: readonly ChaveDoCatalogo[];
  somenteLeitura?: boolean;
  aoMudar?: (matriz: readonly ChaveDoCatalogo[]) => void;
  erro?: string;
}) => {
  const [matriz, definirMatriz] = useState(inicial);

  return (
    <MatrizDePermissoes
      catalogo={CATALOGO}
      valor={matriz}
      somenteLeitura={somenteLeitura}
      erro={erro}
      aoMudar={(proxima) => {
        definirMatriz(proxima);
        aoMudar?.(proxima);
      }}
    />
  );
};

const caixa = (nome: string | RegExp): HTMLElement => screen.getByRole('checkbox', { name: nome });

const modulo = (rotulo: string, escondido = false): HTMLElement =>
  screen.getByRole('region', { name: rotulo, hidden: escondido });

beforeEach(() => {
  avisar.mockClear();

  // O Radix usa APIs de ponteiro e de layout que o jsdom não implementa.
  if (!('PointerEvent' in globalThis)) {
    vi.stubGlobal('PointerEvent', MouseEvent);
  }

  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('estrutura', () => {
  it('mostra um módulo por seção do catálogo, com a contagem e o estado dito por texto', () => {
    render(<Editor inicial={['historico.global.consultar']} />);

    for (const rotulo of [
      'Cadastro do escritório',
      'Empresas',
      'Documentos da empresa',
      'Central de Pendências',
      'Notificações de pendências',
      'Histórico de Informações',
    ]) {
      expect(modulo(rotulo)).toBeInTheDocument();
    }

    expect(within(modulo('Histórico de Informações')).getByText('1 de 1 permissão')).toBeInTheDocument();
    expect(within(modulo('Histórico de Informações')).getByText('Módulo visível')).toBeInTheDocument();
    expect(within(modulo('Empresas')).getByText('Módulo oculto')).toBeInTheDocument();
    expect(within(modulo('Empresas')).getByText('0 de 6 permissões')).toBeInTheDocument();
  });

  it('só os módulos que já têm permissão começam abertos; os outros recolhidos', () => {
    render(<Editor inicial={['historico.global.consultar']} />);

    expect(
      within(modulo('Histórico de Informações')).getByRole('button', { name: /^Histórico de Informações/u }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(within(modulo('Empresas')).getByRole('button', { name: /^Empresas/u })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('abrir e fechar o módulo funciona por teclado', async () => {
    render(<Editor inicial={['historico.global.consultar']} />);

    const alternar = within(modulo('Empresas')).getByRole('button', { name: /^Empresas/u });

    alternar.focus();
    await userEvent.keyboard('{Enter}');

    expect(alternar).toHaveAttribute('aria-expanded', 'true');
    expect(within(modulo('Empresas')).getByRole('checkbox', { name: 'Criar' })).toBeVisible();

    await userEvent.keyboard(' ');

    expect(alternar).toHaveAttribute('aria-expanded', 'false');
  });

  it('as ações vêm agrupadas por funcionalidade, com os nomes do catálogo', () => {
    render(<Editor inicial={moldeDoPapelPadrao('contador')} />);

    const documentos = modulo('Documentos da empresa');

    for (const funcionalidade of ['Exigências', 'Arquivos e versões', 'Análise documental', 'Histórico documental']) {
      expect(within(documentos).getByRole('group', { name: funcionalidade })).toBeInTheDocument();
    }

    const arquivos = within(documentos).getByRole('group', { name: 'Arquivos e versões' });

    for (const acao of ['Consultar', 'Enviar', 'Substituir', 'Visualizar', 'Baixar']) {
      expect(within(arquivos).getByRole('checkbox', { name: acao })).toBeInTheDocument();
    }
  });
});

describe('dependência de Consultar (§3.3)', () => {
  it('marcar uma ação marca Consultar da mesma funcionalidade', async () => {
    const aoMudar = vi.fn();

    render(<Editor inicial={['historico.global.consultar']} aoMudar={aoMudar} />);

    await userEvent.click(within(modulo('Empresas')).getByRole('button', { name: /^Empresas/u }));

    const cadastro = within(modulo('Empresas')).getByRole('group', { name: 'Cadastro e ciclo de vida' });

    expect(within(cadastro).getByRole('checkbox', { name: 'Consultar' })).not.toBeChecked();

    await userEvent.click(within(cadastro).getByRole('checkbox', { name: 'Reativar' }));

    expect(within(cadastro).getByRole('checkbox', { name: 'Reativar' })).toBeChecked();
    expect(within(cadastro).getByRole('checkbox', { name: 'Consultar' })).toBeChecked();
    expect(aoMudar).toHaveBeenLastCalledWith(['empresas.cadastro.consultar', 'empresas.cadastro.reativar', 'historico.global.consultar']);
  });

  it('retirar Consultar revoga as ações dependentes e avisa quantas saíram', async () => {
    render(
      <Editor
        inicial={['documentos.arquivos.consultar', 'documentos.arquivos.enviar', 'documentos.arquivos.baixar']}
      />,
    );

    const arquivos = within(modulo('Documentos da empresa')).getByRole('group', { name: 'Arquivos e versões' });

    await userEvent.click(within(arquivos).getByRole('checkbox', { name: 'Consultar' }));

    for (const acao of ['Consultar', 'Enviar', 'Baixar']) {
      expect(within(arquivos).getByRole('checkbox', { name: acao })).not.toBeChecked();
    }

    expect(avisar).toHaveBeenCalledWith('Retirar “Consultar” também retirou 2 ações dependentes.');
  });

  it('retirar só uma ação dependente mantém Consultar e não avisa nada', async () => {
    render(<Editor inicial={['documentos.arquivos.consultar', 'documentos.arquivos.enviar']} />);

    const arquivos = within(modulo('Documentos da empresa')).getByRole('group', { name: 'Arquivos e versões' });

    await userEvent.click(within(arquivos).getByRole('checkbox', { name: 'Enviar' }));

    expect(within(arquivos).getByRole('checkbox', { name: 'Consultar' })).toBeChecked();
    expect(avisar).not.toHaveBeenCalled();
  });

  it('Consultar de uma funcionalidade não arrasta outra do mesmo módulo', async () => {
    render(
      <Editor
        inicial={[
          'documentos.arquivos.consultar',
          'documentos.arquivos.enviar',
          'documentos.analise.consultar',
          'documentos.analise.aprovar',
        ]}
      />,
    );

    const documentos = modulo('Documentos da empresa');

    await userEvent.click(
      within(within(documentos).getByRole('group', { name: 'Arquivos e versões' })).getByRole('checkbox', {
        name: 'Consultar',
      }),
    );

    const analise = within(documentos).getByRole('group', { name: 'Análise documental' });

    expect(within(analise).getByRole('checkbox', { name: 'Aprovar' })).toBeChecked();
  });
});

describe('ocultar módulo (§3.3)', () => {
  const MATRIZ: readonly ChaveDoCatalogo[] = [
    'documentos.arquivos.consultar',
    'documentos.arquivos.enviar',
    'documentos.analise.consultar',
    'historico.global.consultar',
  ];

  it('pede confirmação que diz quantas permissões saem, e nada muda antes de confirmar', async () => {
    const aoMudar = vi.fn();

    render(<Editor inicial={MATRIZ} aoMudar={aoMudar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Documentos da empresa' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Ocultar “Documentos da empresa”?');
    expect(dialogo).toHaveTextContent('3 permissões marcadas');
    expect(aoMudar).not.toHaveBeenCalled();
    // Com o diálogo aberto o fundo fica inerte (aria-hidden): a seção só se alcança como oculta.
    expect(within(modulo('Documentos da empresa', true)).getByText('Módulo visível')).toBeInTheDocument();
  });

  it('confirmar revoga toda a subárvore e o módulo passa a oculto', async () => {
    const aoMudar = vi.fn();

    render(<Editor inicial={MATRIZ} aoMudar={aoMudar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Documentos da empresa' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar e remover 3' }));

    expect(aoMudar).toHaveBeenCalledWith(['historico.global.consultar']);
    expect(within(modulo('Documentos da empresa')).getByText('Módulo oculto')).toBeInTheDocument();
    expect(within(modulo('Documentos da empresa')).getByText('0 de 12 permissões')).toBeInTheDocument();
  });

  it('cancelar não altera a matriz', async () => {
    const aoMudar = vi.fn();

    render(<Editor inicial={MATRIZ} aoMudar={aoMudar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Documentos da empresa' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('módulo oculto oferece Liberar consulta, que marca só Consultar de cada funcionalidade', async () => {
    const aoMudar = vi.fn();

    render(<Editor inicial={['historico.global.consultar']} aoMudar={aoMudar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Liberar consulta em Documentos da empresa' }));

    expect(aoMudar).toHaveBeenCalledWith([
      'documentos.exigencias.consultar',
      'documentos.arquivos.consultar',
      'documentos.analise.consultar',
      'documentos.historico.consultar',
      'historico.global.consultar',
    ]);
    expect(within(modulo('Documentos da empresa')).getByText('Módulo visível')).toBeInTheDocument();
  });
});

describe('área exclusiva do administrador (§3.3)', () => {
  it('aparece sempre, com cadeado e explicação, e os controles ficam desabilitados', () => {
    render(<Editor inicial={['historico.global.consultar']} />);

    const area = screen.getByRole('region', { name: 'Usuários e permissões, bloqueada' });

    expect(within(area).getByText('Bloqueado')).toBeInTheDocument();
    expect(area).toHaveTextContent('exclusivo do papel padrão Administrador do escritório');

    for (const caixaBloqueada of within(area).getAllByRole('checkbox')) {
      expect(caixaBloqueada).toBeDisabled();
      expect(caixaBloqueada).not.toBeChecked();
    }
  });

  it('não há botão de ocultar nem de liberar a área exclusiva', () => {
    render(<Editor inicial={['historico.global.consultar']} />);

    const area = screen.getByRole('region', { name: 'Usuários e permissões, bloqueada' });

    expect(within(area).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('somente leitura', () => {
  it('desabilita todas as caixas e não oferece ocultar nem liberar módulo', () => {
    render(<Editor inicial={moldeDoPapelPadrao('contador')} somenteLeitura />);

    for (const marcada of screen.getAllByRole('checkbox')) {
      expect(marcada).toBeDisabled();
    }

    expect(screen.queryByRole('button', { name: /Ocultar módulo|Liberar consulta/u })).not.toBeInTheDocument();
  });

  it('o molde do contador aparece como o papel padrão concede', () => {
    render(<Editor inicial={moldeDoPapelPadrao('contador')} somenteLeitura />);

    const cadastro = within(modulo('Empresas')).getByRole('group', { name: 'Cadastro e ciclo de vida' });

    for (const acao of ['Consultar', 'Criar', 'Editar', 'Arquivar', 'Reativar']) {
      expect(within(cadastro).getByRole('checkbox', { name: acao })).toBeChecked();
    }

    expect(
      within(
        within(modulo('Cadastro do escritório')).getByRole('group', {
          name: 'Dados do escritório',
          hidden: true,
        }),
      ).getByRole('checkbox', { name: 'Editar', hidden: true }),
    ).not.toBeChecked();
  });
});

describe('erro e acessibilidade', () => {
  it('a mensagem de erro da matriz é anunciada como alerta', () => {
    render(<Editor inicial={[]} erro="Marque ao menos uma permissão." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Marque ao menos uma permissão.');
  });

  it('as caixas se operam por teclado, com a barra de espaço', async () => {
    render(<Editor inicial={['historico.global.consultar']} />);

    const consultar = caixa('Consultar');

    consultar.focus();
    await userEvent.keyboard(' ');

    expect(consultar).not.toBeChecked();
  });

  it('não tem violação detectável pelo axe (editável e somente leitura)', async () => {
    const editavel = render(<Editor inicial={moldeDoPapelPadrao('auxiliar')} />);

    expect(await axe(editavel.container)).toHaveNoViolations();
    editavel.unmount();

    const leitura = render(<Editor inicial={moldeDoPapelPadrao('auxiliar')} somenteLeitura />);

    expect(await axe(leitura.container)).toHaveNoViolations();
  });
});
