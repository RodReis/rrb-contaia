/**
 * Provas de tela da edição de papel (SPEC-008 §3.5 e §5.2): abas Resumo e
 * Permissões, confirmação de redução com os usuários afetados, bloqueio de
 * arquivamento de papel em uso, reativação com revisão, revisão concorrente e
 * a leitura sem mutação para quem só consulta.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Sessao } from '../usuarios/api';
import type { DetalheDePapel } from './api';
import { EdicaoDePapel } from './edicao-de-papel';
import { catalogoDeTeste, detalheDeTeste, sessaoDe } from './papeis.fixtures';

const avisar = vi.fn();
const sucesso = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    info: (mensagem: string) => avisar(mensagem),
    success: (mensagem: string) => sucesso(mensagem),
    error: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/configuracoes/usuarios/papeis/papel-1',
}));

const ADMIN: Sessao = sessaoDe(['admin_escritorio']);
const AUDITOR: Sessao = sessaoDe(['auditor_readonly']);
const CONTADOR: Sessao = sessaoDe(['contador']);

const PAPEL: DetalheDePapel = detalheDeTeste({
  id: 'papel-1',
  nome: 'Revisor fiscal',
  descricao: 'Confere guias',
  papelBase: 'contador',
  revisao: 3,
  permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar', 'historico.global.consultar'],
  usuarios: [],
});

const EM_USO: DetalheDePapel = {
  ...PAPEL,
  usuariosVinculados: 2,
  usuarios: [
    { id: 'u1', nome: 'Ana Souza' },
    { id: 'u2', nome: 'Bruno Lima' },
  ],
};

const ARQUIVADO: DetalheDePapel = {
  ...PAPEL,
  estado: 'ARQUIVADO',
  revisao: 4,
  incompatibilidades: ['empresas.cadastro.excluir'],
};

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string) =>
  json({ type: 'x', title: 'x', status, code, correlationId: 'corr-e1' }, status);

let sessaoAtual: Sessao = ADMIN;
let papelAtual: () => Response | Promise<Response> = () => json(PAPEL);
let aoSalvar: () => Response | Promise<Response> = () => json(PAPEL);
let aoArquivar: () => Response | Promise<Response> = () => json(PAPEL);
let aoReativar: () => Response | Promise<Response> = () => json(PAPEL);
const chamadas: Array<{ url: string; metodo: string; corpo: unknown }> = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<EdicaoDePapel papelId="papel-1" />, { wrapper: Envolvido });

const enviados = (metodo: string, trecho = '/papeis/papel-1') =>
  chamadas.filter((c) => c.metodo === metodo && c.url.endsWith(trecho));

const abrirPermissoes = async (): Promise<void> => {
  await userEvent.click(await screen.findByRole('tab', { name: 'Permissões' }));
};

beforeEach(() => {
  sessaoAtual = ADMIN;
  papelAtual = () => json(PAPEL);
  aoSalvar = () => json(PAPEL);
  aoArquivar = () => json({ ...PAPEL, estado: 'ARQUIVADO', revisao: 4 });
  aoReativar = () => json({ ...PAPEL, revisao: 5 });
  chamadas.length = 0;
  avisar.mockClear();
  sucesso.mockClear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      const endereco = String(url);

      chamadas.push({
        url: endereco,
        metodo,
        corpo: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      });

      if (endereco.endsWith('/usuarios/eu')) return json(sessaoAtual);
      if (endereco.endsWith('/papeis/catalogo')) return json(catalogoDeTeste());
      if (metodo === 'GET' && endereco.endsWith('/papeis/papel-1')) return papelAtual();
      if (metodo === 'PUT' && endereco.endsWith('/papeis/papel-1')) return aoSalvar();
      if (metodo === 'POST' && endereco.endsWith('/papeis/papel-1/arquivar')) return aoArquivar();
      if (metodo === 'POST' && endereco.endsWith('/papeis/papel-1/reativar')) return aoReativar();

      throw new Error(`rota sem dublê: ${metodo} ${endereco}`);
    }),
  );

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
  vi.restoreAllMocks();
});

describe('carregamento, erro e permissão', () => {
  it('anuncia o carregamento com skeleton', async () => {
    papelAtual = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Carregando o papel')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('papel inexistente ou de outro escritório mostra a mensagem e volta à lista', async () => {
    papelAtual = () => problema(404, 'PAPEL_NAO_ENCONTRADO');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Papel não encontrado neste escritório');
    expect(screen.getByText('corr-e1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para a lista' })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios?aba=papeis',
    );
  });

  it('erro de servidor traz o correlationId e o botão de tentar de novo', async () => {
    papelAtual = () => problema(500, 'ERRO_INTERNO');

    renderizar();

    expect(await screen.findByText('corr-e1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('quem não consulta usuários e papéis vê a explicação', async () => {
    sessaoAtual = CONTADOR;

    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver esta área')).toBeInTheDocument();
  });
});

describe('resumo', () => {
  it('mostra nome, situação, revisão, origem e a data em São Paulo', async () => {
    renderizar();

    expect(await screen.findByRole('heading', { level: 1, name: /Revisor fiscal/u })).toBeInTheDocument();
    // A situação aparece no cabeçalho (selo) e no resumo.
    expect(screen.getAllByText('Ativo')).toHaveLength(2);
    expect(screen.getByText('Revisão 3')).toBeInTheDocument();
    expect(screen.getByText(/Baseado em Contador/u)).toBeInTheDocument();
    // 2026-10-02T15:30Z = 02/10/2026 12:30 em America/Sao_Paulo (I-11).
    expect(screen.getByText(/02\/10\/2026.*12:30/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome do papel/u)).toHaveValue('Revisor fiscal');
    expect(screen.getByLabelText('Descrição')).toHaveValue('Confere guias');
  });

  it('sem usuários vinculados, orienta onde atribuir', async () => {
    renderizar();

    expect(await screen.findByText(/Nenhum usuário tem este papel/u)).toBeInTheDocument();
  });

  it('lista os usuários vinculados com link para cada um', async () => {
    papelAtual = () => json(EM_USO);

    renderizar();

    expect(await screen.findByRole('link', { name: 'Ana Souza' })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios/u1',
    );
    expect(screen.getByRole('link', { name: 'Bruno Lima' })).toBeInTheDocument();
    expect(screen.getByText(/2 usuários têm este papel/u)).toBeInTheDocument();
  });
});

describe('salvar sem redução', () => {
  it('renomear e mudar a descrição envia a matriz atual com a revisão que a tela leu', async () => {
    renderizar();

    const nome = await screen.findByLabelText(/Nome do papel/u);

    await userEvent.clear(nome);
    await userEvent.type(nome, 'Revisor sênior');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(enviados('PUT')).toHaveLength(1));

    expect(enviados('PUT')[0]?.corpo).toEqual({
      nome: 'Revisor sênior',
      descricao: 'Confere guias',
      permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar', 'historico.global.consultar'],
      revisaoEsperada: 3,
      confirmaReducao: false,
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(sucesso).toHaveBeenCalled());
  });

  it('ampliar permissões num papel atribuído também grava direto, sem confirmação', async () => {
    papelAtual = () => json(EM_USO);

    renderizar();
    await abrirPermissoes();

    await userEvent.click(
      screen.getByRole('button', { name: 'Liberar consulta em Notificações de pendências' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(enviados('PUT')).toHaveLength(1));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('mostra as alterações ainda não salvas, com adicionadas e retiradas', async () => {
    renderizar();
    await abrirPermissoes();

    await userEvent.click(
      screen.getByRole('button', { name: 'Liberar consulta em Notificações de pendências' }),
    );

    expect(await screen.findByRole('heading', { name: 'Alterações ainda não salvas' })).toBeInTheDocument();
    expect(screen.getByText('Notificações de pendências › Sino e histórico › Consultar')).toBeInTheDocument();
    expect(screen.getByText(/Em relação a a revisão 3/u)).toBeInTheDocument();
  });

  it('papel sem usuários vinculados reduz permissões sem confirmação', async () => {
    renderizar();
    await abrirPermissoes();

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Histórico de Informações' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ocultar e remover/u }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(enviados('PUT')).toHaveLength(1));

    expect(enviados('PUT')[0]?.corpo).toMatchObject({
      permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar'],
      confirmaReducao: false,
    });
  });

  it('nome em branco impede o envio e leva à aba Resumo com o erro', async () => {
    renderizar();

    await userEvent.clear(await screen.findByLabelText(/Nome do papel/u));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Informe o nome do papel')).toBeInTheDocument();
    expect(enviados('PUT')).toHaveLength(0);
  });
});

describe('redução em papel atribuído (§3.5)', () => {
  const reduzir = async (): Promise<void> => {
    await abrirPermissoes();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Histórico de Informações' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ocultar e remover/u }));
  };

  beforeEach(() => {
    papelAtual = () => json(EM_USO);
  });

  it('abre um diálogo que nomeia os usuários vinculados e quantas permissões saem', async () => {
    renderizar();
    await reduzir();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Confirmar redução de permissões?');
    expect(dialogo).toHaveTextContent('2 usuários');
    expect(dialogo).toHaveTextContent('Ana Souza, Bruno Lima');
    expect(dialogo).toHaveTextContent('1 permissão');
    expect(dialogo).toHaveTextContent('Quem tiver outro papel que conceda a mesma ação continua');
    expect(enviados('PUT')).toHaveLength(0);
  });

  it('cancelar não grava nada', async () => {
    renderizar();
    await reduzir();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(enviados('PUT')).toHaveLength(0);
  });

  it('confirmar envia a matriz reduzida com confirmaReducao verdadeiro', async () => {
    renderizar();
    await reduzir();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar e salvar' }));

    await waitFor(() => expect(enviados('PUT')).toHaveLength(1));

    expect(enviados('PUT')[0]?.corpo).toMatchObject({
      permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar'],
      revisaoEsperada: 3,
      confirmaReducao: true,
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('Enter no campo de nome não atalha a confirmação: avisa e não grava', async () => {
    renderizar();
    await reduzir();
    await userEvent.click(screen.getByRole('tab', { name: 'Resumo' }));

    await userEvent.type(await screen.findByLabelText(/Nome do papel/u), '{Enter}');

    expect(enviados('PUT')).toHaveLength(0);
    expect(avisar).toHaveBeenCalledWith(
      'Esta alteração reduz permissões. Use “Salvar alterações” para confirmar.',
    );
  });

  it('se o servidor ainda pedir confirmação, a explicação aparece no próprio diálogo', async () => {
    aoSalvar = () => problema(409, 'REDUCAO_NAO_CONFIRMADA');

    renderizar();
    await reduzir();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar e salvar' }));

    expect(await screen.findByText('Não é possível continuar')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Confirme a redução de permissões');
  });
});

describe('redução não confirmada fora do diálogo', () => {
  it('a tela leu o papel sem vínculos mas o servidor exige confirmação: recarrega e avisa, sem calar', async () => {
    aoSalvar = () => problema(409, 'REDUCAO_NAO_CONFIRMADA');

    renderizar();
    await abrirPermissoes();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Histórico de Informações' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ocultar e remover/u }));

    const antes = chamadas.filter((c) => c.metodo === 'GET' && c.url.endsWith('/papeis/papel-1')).length;

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() =>
      expect(avisar).toHaveBeenCalledWith(expect.stringContaining('Confirme a redução de permissões')),
    );
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('revise e salve de novo'));
    await waitFor(() =>
      expect(chamadas.filter((c) => c.metodo === 'GET' && c.url.endsWith('/papeis/papel-1')).length).toBeGreaterThan(
        antes,
      ),
    );
  });
});

describe('revisão concorrente e nome duplicado', () => {
  it('409 de versão avisa que nada foi aplicado e oferece recarregar', async () => {
    aoSalvar = () => problema(409, 'CONFLITO_DE_VERSAO');

    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: 'Salvar alterações' }));

    const aviso = await screen.findByRole('alert');

    expect(aviso).toHaveTextContent('Estes dados mudaram enquanto você editava');
    expect(aviso).toHaveTextContent('não foram aplicadas');

    const antes = chamadas.filter((c) => c.metodo === 'GET' && c.url.endsWith('/papeis/papel-1')).length;

    await userEvent.click(within(aviso).getByRole('button', { name: 'Recarregar a última revisão' }));

    await waitFor(() =>
      expect(chamadas.filter((c) => c.metodo === 'GET' && c.url.endsWith('/papeis/papel-1')).length).toBeGreaterThan(
        antes,
      ),
    );
  });

  it('nome duplicado aparece no próprio campo, na aba Resumo', async () => {
    aoSalvar = () => problema(409, 'PAPEL_NOME_DUPLICADO');

    renderizar();
    await abrirPermissoes();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await userEvent.click(await screen.findByRole('tab', { name: 'Resumo' }));

    expect(
      await screen.findByText('Já existe um papel com este nome neste escritório.'),
    ).toBeInTheDocument();
  });

  it('chave da área exclusiva recusada pelo servidor vai para a matriz com a explicação', async () => {
    aoSalvar = () => problema(403, 'PERMISSAO_EXCLUSIVA');

    renderizar();
    await userEvent.click(await screen.findByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('exclusivos do administrador');
  });
});

describe('arquivar (§3.5)', () => {
  it('papel sem usuários arquiva depois da confirmação, enviando a revisão que a tela leu', async () => {
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar papel' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Arquivar “Revisor fiscal”?');
    expect(dialogo).toHaveTextContent('nada é excluído');

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Arquivar papel' }));

    await waitFor(() => expect(enviados('POST', '/papeis/papel-1/arquivar')).toHaveLength(1));

    expect(enviados('POST', '/papeis/papel-1/arquivar')[0]?.corpo).toEqual({ revisaoEsperada: 3 });
  });

  it('papel em uso: o diálogo avisa quantos usuários e o servidor recusa com a explicação', async () => {
    papelAtual = () => json(EM_USO);
    aoArquivar = () => problema(409, 'PAPEL_EM_USO');

    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar papel' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('atribuído a 2 usuários');

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Arquivar papel' }));

    expect(await screen.findByText('Não é possível continuar')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remova ou substitua o papel nesses usuários');
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
  });
});

describe('papel arquivado: reativação com revisão (§3.5)', () => {
  beforeEach(() => {
    papelAtual = () => json(ARQUIVADO);
  });

  it('explica que só volta por reativação e que vínculos antigos não voltam', async () => {
    renderizar();

    expect(await screen.findAllByText('Arquivado')).toHaveLength(2);
    expect(screen.getByText(/não pode ser atribuído/u)).toBeInTheDocument();
    expect(screen.getByText(/vínculos anteriores com usuários não são restaurados/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome do papel/u)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Arquivar papel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument();
  });

  it('avisa as permissões que deixaram de existir no catálogo, com o nome como veio', async () => {
    renderizar();

    const aviso = await screen.findByRole('region', {
      name: '1 permissão preservada não existe mais no catálogo',
    });

    expect(aviso).toHaveTextContent('Elas não serão restauradas');
    expect(aviso).toHaveTextContent('empresas.cadastro.excluir');
  });

  it('reativar abre a confirmação com a contagem e a nota sobre vínculos e descartes', async () => {
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: 'Reativar papel' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Reativar “Revisor fiscal”?');
    expect(dialogo).toHaveTextContent('3 permissões');
    expect(dialogo).toHaveTextContent('Nenhum vínculo anterior com usuários é restaurado');
    expect(dialogo).toHaveTextContent('1 permissão que não existe mais no catálogo será descartada');
  });

  it('confirmar envia a matriz revisada, a revisão lida e a confirmação das incompatibilidades', async () => {
    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: 'Reativar papel' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reativar papel' }),
    );

    await waitFor(() => expect(enviados('POST', '/papeis/papel-1/reativar')).toHaveLength(1));

    expect(enviados('POST', '/papeis/papel-1/reativar')[0]?.corpo).toEqual({
      revisaoEsperada: 4,
      permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar', 'historico.global.consultar'],
      confirmaIncompatibilidades: true,
    });
  });

  it('a matriz pode ser ajustada na revisão antes de reativar', async () => {
    renderizar();
    await abrirPermissoes();

    // Arquivado e administrador: a matriz é a revisão obrigatória, então segue editável.
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Histórico de Informações' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ocultar e remover/u }));
    await userEvent.click(screen.getByRole('button', { name: 'Reativar papel' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reativar papel' }),
    );

    await waitFor(() => expect(enviados('POST', '/papeis/papel-1/reativar')).toHaveLength(1));

    expect(enviados('POST', '/papeis/papel-1/reativar')[0]?.corpo).toMatchObject({
      permissoes: ['empresas.cadastro.consultar', 'empresas.cadastro.criar'],
    });
  });

  it('sem incompatibilidade a confirmação das incompatibilidades vai falsa', async () => {
    papelAtual = () => json({ ...ARQUIVADO, incompatibilidades: [] });

    renderizar();

    await userEvent.click(await screen.findByRole('button', { name: 'Reativar papel' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reativar papel' }),
    );

    await waitFor(() => expect(enviados('POST', '/papeis/papel-1/reativar')).toHaveLength(1));

    expect(enviados('POST', '/papeis/papel-1/reativar')[0]?.corpo).toMatchObject({
      confirmaIncompatibilidades: false,
    });
  });
});

describe('quem só consulta', () => {
  beforeEach(() => {
    sessaoAtual = AUDITOR;
    papelAtual = () => json(EM_USO);
  });

  it('vê tudo desabilitado, sem salvar, arquivar nem reativar', async () => {
    renderizar();

    expect(await screen.findByText('Você tem acesso somente leitura a este papel.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome do papel/u)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Salvar alterações|Arquivar papel|Reativar papel/u })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para a lista' })).toBeInTheDocument();
  });

  it('na aba Permissões as caixas ficam desabilitadas e não há ocultar nem liberar', async () => {
    renderizar();
    await abrirPermissoes();

    for (const caixa of screen.getAllByRole('checkbox')) {
      expect(caixa).toBeDisabled();
    }

    expect(screen.queryByRole('button', { name: /Ocultar módulo|Liberar consulta/u })).not.toBeInTheDocument();
  });
});

describe('acessibilidade', () => {
  it('as duas abas não têm violação detectável pelo axe', async () => {
    papelAtual = () => json(EM_USO);

    const { container } = renderizar();

    await screen.findByLabelText(/Nome do papel/u);
    expect(await axe(container)).toHaveNoViolations();

    await abrirPermissoes();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('o papel arquivado e a visão do auditor não têm violação pelo axe', async () => {
    papelAtual = () => json(ARQUIVADO);

    const arquivado = renderizar();

    await screen.findAllByText('Arquivado');
    expect(await axe(arquivado.container)).toHaveNoViolations();
    arquivado.unmount();

    sessaoAtual = AUDITOR;
    papelAtual = () => json(EM_USO);

    const leitura = renderizar();

    await screen.findByText('Você tem acesso somente leitura a este papel.');
    expect(await axe(leitura.container)).toHaveNoViolations();
  });
});
