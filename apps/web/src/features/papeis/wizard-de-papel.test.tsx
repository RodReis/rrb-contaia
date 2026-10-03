/**
 * Provas de tela do wizard de criação de papel (SPEC-008 §3.1 e §5.2): três
 * etapas, base obrigatória, matriz inicial do molde, revisão com diferenças e
 * erros do servidor no lugar certo.
 */
import { moldeDoPapelPadrao } from '@contaia/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Sessao } from '../usuarios/api';
import { catalogoDeTeste, detalheDeTeste, sessaoDe } from './papeis.fixtures';
import { WizardDePapel } from './wizard-de-papel';

const empurrar = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empurrar, replace: vi.fn() }),
  usePathname: () => '/configuracoes/usuarios/papeis/novo',
}));

const ADMIN: Sessao = sessaoDe(['admin_escritorio']);
const AUDITOR: Sessao = sessaoDe(['auditor_readonly']);

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string) =>
  json({ type: 'x', title: 'x', status, code, correlationId: 'corr-p1' }, status);

let sessaoAtual: Sessao = ADMIN;
let catalogoAtual: () => Response | Promise<Response> = () => json(catalogoDeTeste());
let aoCriar: () => Response | Promise<Response> = () =>
  json(detalheDeTeste({ id: 'novo', nome: 'Revisor fiscal' }), 201);
const chamadas: Array<{ url: string; metodo: string; corpo: unknown }> = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<WizardDePapel />, { wrapper: Envolvido });

const criacoes = () => chamadas.filter((c) => c.metodo === 'POST' && c.url.endsWith('/papeis'));

const preencherIdentificacao = async (nome = 'Revisor fiscal', base = 'Contador'): Promise<void> => {
  await userEvent.type(await screen.findByLabelText(/Nome do papel/u), nome);
  await userEvent.type(screen.getByLabelText('Descrição'), 'Confere guias e obrigações');

  if (base !== '') {
    await userEvent.click(screen.getByRole('radio', { name: base }));
  }
};

const continuar = () => userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

const irParaPermissoes = async (nome?: string, base?: string): Promise<void> => {
  await preencherIdentificacao(nome, base);
  await continuar();
  await screen.findByText(/Marque o que o papel pode fazer/u);
};

const irParaRevisao = async (nome?: string, base?: string): Promise<void> => {
  await irParaPermissoes(nome, base);
  await continuar();
  await screen.findByRole('heading', { name: 'Revisão do papel' });
};

beforeEach(() => {
  sessaoAtual = ADMIN;
  catalogoAtual = () => json(catalogoDeTeste());
  aoCriar = () => json(detalheDeTeste({ id: 'novo', nome: 'Revisor fiscal' }), 201);
  chamadas.length = 0;
  empurrar.mockClear();

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
      if (endereco.endsWith('/papeis/catalogo')) return catalogoAtual();
      if (metodo === 'POST' && endereco.endsWith('/papeis')) return aoCriar();

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
    catalogoAtual = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Carregando o formulário de papel')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('falha ao carregar o catálogo mostra o correlationId e permite tentar de novo', async () => {
    catalogoAtual = () => problema(500, 'ERRO_INTERNO');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar o catálogo de permissões',
    );
    expect(screen.getByText('corr-p1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('quem não administra usuários e papéis vê a explicação, não o formulário', async () => {
    sessaoAtual = AUDITOR;

    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver esta área')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nome do papel/u)).not.toBeInTheDocument();
  });
});

describe('etapa 1 — Identificação e base', () => {
  it('mostra as três etapas, com a primeira como atual', async () => {
    renderizar();

    const etapas = await screen.findByRole('navigation', { name: 'Etapas da criação do papel' });

    expect(within(etapas).getByText('Identificação e base')).toBeInTheDocument();
    expect(within(etapas).getByText('Permissões')).toBeInTheDocument();
    expect(within(etapas).getByText('Revisão e criação')).toBeInTheDocument();
    expect(within(etapas).getByText('etapa atual')).toBeInTheDocument();
  });

  it('oferece os quatro papéis padrão como base, com a descrição de cada um', async () => {
    renderizar();

    await screen.findByLabelText(/Nome do papel/u);

    for (const base of ['Administrador do escritório', 'Contador', 'Auxiliar', 'Auditor (somente leitura)']) {
      expect(screen.getByRole('radio', { name: base })).not.toBeChecked();
    }

    expect(screen.getByRole('radio', { name: 'Auxiliar' })).toHaveAccessibleDescription(
      /não arquiva empresas/u,
    );
  });

  it('não avança sem nome nem base e mostra os dois erros de uma vez', async () => {
    renderizar();
    await screen.findByLabelText(/Nome do papel/u);

    await continuar();

    expect(await screen.findByText('Informe o nome do papel')).toBeInTheDocument();
    expect(screen.getByText('Escolha o papel padrão de origem.')).toBeInTheDocument();
    expect(screen.queryByText(/Marque o que o papel pode fazer/u)).not.toBeInTheDocument();
  });

  it('nome com mais de 80 caracteres é recusado antes de ir ao servidor', async () => {
    renderizar();

    await userEvent.type(await screen.findByLabelText(/Nome do papel/u), 'x'.repeat(81));
    await userEvent.click(screen.getByRole('radio', { name: 'Contador' }));
    await continuar();

    expect(await screen.findByText('Use no máximo 80 caracteres')).toBeInTheDocument();
  });

  it('com nome e base, vai para a etapa de permissões', async () => {
    renderizar();

    await irParaPermissoes();

    expect(screen.getByRole('region', { name: 'Documentos da empresa' })).toBeInTheDocument();
  });
});

describe('etapa 2 — Permissões', () => {
  it('a matriz começa como o molde do papel padrão escolhido', async () => {
    renderizar();

    await irParaPermissoes('Revisor', 'Auditor (somente leitura)');

    const empresas = screen.getByRole('region', { name: 'Empresas' });
    const cadastro = within(empresas).getByRole('group', { name: 'Cadastro e ciclo de vida' });

    expect(within(cadastro).getByRole('checkbox', { name: 'Consultar' })).toBeChecked();
    expect(within(cadastro).getByRole('checkbox', { name: 'Criar' })).not.toBeChecked();
  });

  it('a área exclusiva aparece bloqueada mesmo partindo do administrador', async () => {
    renderizar();

    await irParaPermissoes('Gestor', 'Administrador do escritório');

    const area = screen.getByRole('region', { name: 'Usuários e permissões, bloqueada' });

    for (const caixa of within(area).getAllByRole('checkbox')) {
      expect(caixa).toBeDisabled();
      expect(caixa).not.toBeChecked();
    }
  });

  it('Voltar mantém o que foi digitado e a matriz editada, se a base não mudou', async () => {
    renderizar();

    await irParaPermissoes('Revisor fiscal', 'Auxiliar');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Notificações de pendências' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ocultar e remover/u }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(await screen.findByLabelText(/Nome do papel/u)).toHaveValue('Revisor fiscal');
    expect(screen.getByRole('radio', { name: 'Auxiliar' })).toBeChecked();

    await continuar();

    const notificacoes = await screen.findByRole('region', { name: 'Notificações de pendências' });

    expect(within(notificacoes).getByText('Módulo oculto')).toBeInTheDocument();
  });

  it('trocar a base recarrega a matriz do novo molde', async () => {
    renderizar();

    await irParaPermissoes('Revisor fiscal', 'Auxiliar');
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Auditor (somente leitura)' }));
    await continuar();

    const empresas = await screen.findByRole('region', { name: 'Empresas' });

    expect(
      within(within(empresas).getByRole('group', { name: 'Cadastro e ciclo de vida' })).getByRole('checkbox', {
        name: 'Criar',
      }),
    ).not.toBeChecked();
  });
});

describe('etapa 3 — Revisão e criação', () => {
  it('mostra os dados, o papel de origem e as diferenças em relação ao molde', async () => {
    renderizar();

    await irParaPermissoes('Revisor fiscal', 'Contador');
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar módulo Notificações de pendências' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ocultar e remover/u }));
    await continuar();

    await screen.findByRole('heading', { name: 'Revisão do papel' });

    expect(screen.getByText('Revisor fiscal')).toBeInTheDocument();
    expect(screen.getByText('Confere guias e obrigações')).toBeInTheDocument();
    expect(screen.getAllByText('Contador').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Permissões retiradas (2)' })).toBeInTheDocument();
    expect(
      screen.getByText('Notificações de pendências › Sino e histórico › Marcar como lida'),
    ).toBeInTheDocument();
  });

  it('sem nenhuma diferença, diz isso', async () => {
    renderizar();

    await irParaRevisao('Revisor', 'Auxiliar');

    expect(screen.getByText(/Nenhuma diferença em relação a/u)).toBeInTheDocument();
  });

  it('criar envia nome, descrição, base e a matriz inteira, e volta para a lista', async () => {
    renderizar();

    await irParaRevisao('  Revisor fiscal  ', 'Contador');
    await userEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    await waitFor(() => expect(criacoes()).toHaveLength(1));

    expect(criacoes()[0]?.corpo).toEqual({
      nome: 'Revisor fiscal',
      descricao: 'Confere guias e obrigações',
      papelBase: 'contador',
      permissoes: [...moldeDoPapelPadrao('contador')],
    });
    await waitFor(() => expect(empurrar).toHaveBeenCalledWith('/configuracoes/usuarios?aba=papeis'));
  });

  it('descrição vazia vai como null', async () => {
    renderizar();

    await userEvent.type(await screen.findByLabelText(/Nome do papel/u), 'Sem descrição');
    await userEvent.click(screen.getByRole('radio', { name: 'Auxiliar' }));
    await continuar();
    await screen.findByText(/Marque o que o papel pode fazer/u);
    await continuar();
    await userEvent.click(await screen.findByRole('button', { name: 'Criar papel' }));

    await waitFor(() => expect(criacoes()).toHaveLength(1));

    expect(criacoes()[0]?.corpo).toMatchObject({ descricao: null });
  });

  it('Voltar da revisão devolve à matriz sem perder nada', async () => {
    renderizar();

    await irParaRevisao('Revisor', 'Auxiliar');
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(await screen.findByText(/Marque o que o papel pode fazer/u)).toBeInTheDocument();
    expect(criacoes()).toHaveLength(0);
  });
});

describe('erros do servidor', () => {
  it('nome duplicado volta à etapa 1, com a mensagem no campo e o resto preservado', async () => {
    aoCriar = () => problema(409, 'PAPEL_NOME_DUPLICADO');

    renderizar();

    await irParaRevisao('Revisor fiscal', 'Contador');
    await userEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    expect(
      await screen.findByText('Já existe um papel com este nome neste escritório.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome do papel/u)).toHaveValue('Revisor fiscal');
    expect(screen.getByLabelText('Descrição')).toHaveValue('Confere guias e obrigações');
    expect(screen.getByRole('radio', { name: 'Contador' })).toBeChecked();
    expect(empurrar).not.toHaveBeenCalled();
  });

  it('chave da área exclusiva recusada pelo servidor volta à matriz com a explicação', async () => {
    aoCriar = () => problema(403, 'PERMISSAO_EXCLUSIVA');

    renderizar();

    await irParaRevisao();
    await userEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('exclusivos do administrador');
    expect(screen.getByText(/Marque o que o papel pode fazer/u)).toBeInTheDocument();
  });

  it('matriz inválida volta à matriz; falha de infraestrutura mantém a revisão para tentar de novo', async () => {
    aoCriar = () => problema(422, 'MATRIZ_INVALIDA');

    renderizar();

    await irParaRevisao();
    await userEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Marque ao menos uma permissão.');
  });

  it('erro 500 mantém a etapa de revisão e nada é perdido', async () => {
    aoCriar = () => problema(500, 'ERRO_INTERNO');

    renderizar();

    await irParaRevisao('Revisor fiscal', 'Contador');
    await userEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    await waitFor(() => expect(criacoes()).toHaveLength(1));
    expect(screen.getByRole('heading', { name: 'Revisão do papel' })).toBeInTheDocument();
    expect(empurrar).not.toHaveBeenCalled();
  });
});

describe('teclado e acessibilidade', () => {
  it('Enter no campo de nome avança a etapa quando a base está escolhida', async () => {
    renderizar();

    await userEvent.click(await screen.findByRole('radio', { name: 'Contador' }));
    await userEvent.type(screen.getByLabelText(/Nome do papel/u), 'Revisor{Enter}');

    expect(await screen.findByText(/Marque o que o papel pode fazer/u)).toBeInTheDocument();
  });

  it('as três etapas não têm violação detectável pelo axe', async () => {
    const { container } = renderizar();

    await preencherIdentificacao();
    expect(await axe(container)).toHaveNoViolations();

    await continuar();
    await screen.findByText(/Marque o que o papel pode fazer/u);
    expect(await axe(container)).toHaveNoViolations();

    await continuar();
    await screen.findByRole('heading', { name: 'Revisão do papel' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
