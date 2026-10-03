/**
 * Provas de tela da seção "Papéis personalizados" (SPEC-008 §5.1): filtro de
 * estado com `Ativos` por padrão, busca e página na URL, ações por situação,
 * arquivamento bloqueado para papel em uso e o que o auditor não vê.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VisaoDePapel } from './api';
import { ListaDePapeis } from './lista-de-papeis';
import { catalogoDeTeste, papelDeTeste } from './papeis.fixtures';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams({ aba: 'papeis' });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/configuracoes/usuarios',
}));

const ALFA = papelDeTeste({
  id: 'alfa',
  nome: 'Alfa fiscal',
  descricao: 'Confere guias de ICMS',
  papelBase: 'contador',
  usuariosVinculados: 2,
});
const BETA = papelDeTeste({ id: 'beta', nome: 'Beta documentos', papelBase: 'auxiliar' });
const GAMA = papelDeTeste({
  id: 'gama',
  nome: 'Gama antigo',
  papelBase: 'auditor_readonly',
  estado: 'ARQUIVADO',
  revisao: 4,
});

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string, correlationId = 'corr-l1') =>
  json({ type: 'x', title: 'x', status, code, correlationId }, status);

let listaAtual: () => Response | Promise<Response> = () => json({ papeis: [ALFA, BETA], total: 2 });
let aoArquivar: (url: string) => Response | Promise<Response> = () => json(ALFA);
const chamadas: Array<{ url: string; metodo: string; corpo: unknown }> = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = (podeAdministrar = true) =>
  render(<ListaDePapeis podeAdministrar={podeAdministrar} />, { wrapper: Envolvido });

const consultasAoServidor = () =>
  chamadas.filter((c) => c.metodo === 'GET' && c.url.includes('/papeis?')).map((c) => c.url);

const naTabela = () => within(screen.getByRole('table'));

beforeEach(() => {
  parametrosAtuais = new URLSearchParams({ aba: 'papeis' });
  listaAtual = () => json({ papeis: [ALFA, BETA], total: 2 });
  aoArquivar = () => json(ALFA);
  chamadas.length = 0;
  substituir.mockClear();

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

      if (endereco.endsWith('/papeis/catalogo')) return json(catalogoDeTeste());
      if (metodo === 'GET' && endereco.includes('/papeis?')) return listaAtual();
      if (metodo === 'POST' && endereco.endsWith('/arquivar')) return aoArquivar(endereco);

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

describe('carregamento e erro', () => {
  it('anuncia o carregamento com skeleton', async () => {
    listaAtual = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Carregando os papéis personalizados')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('erro de servidor mostra o que fazer e o correlationId, sem esconder os papéis padrão', async () => {
    listaAtual = () => problema(500, 'ERRO_INTERNO', 'corr-777');

    renderizar();

    expect(await screen.findByText('corr-777')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Contador' })).toBeInTheDocument();
  });

  it('sessão expirada orienta entrar de novo', async () => {
    listaAtual = () => problema(401, 'HTTP_401');

    renderizar();

    expect(await screen.findByRole('link', { name: 'Entrar novamente' })).toHaveAttribute(
      'href',
      '/api/auth/entrar',
    );
  });
});

describe('lista de papéis personalizados', () => {
  it('mostra nome, descrição, base por extenso, situação e usuários vinculados', async () => {
    renderizar();

    const tabela = await screen.findByRole('table', { name: /Papéis personalizados deste escritório/u });
    const alfa = within(tabela).getByRole('row', { name: /Alfa fiscal/u });

    expect(within(alfa).getByText('Confere guias de ICMS')).toBeInTheDocument();
    expect(within(alfa).getByText('Contador')).toBeInTheDocument();
    expect(within(alfa).getByText('Ativo')).toBeInTheDocument();
    expect(within(alfa).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('2 papéis personalizados.')).toBeInTheDocument();
    // O identificador técnico da base nunca aparece.
    expect(screen.queryByText('contador')).not.toBeInTheDocument();
  });

  it('o filtro padrão é Ativos e o servidor recebe estado=ATIVO e a página de 25', async () => {
    renderizar();
    await screen.findByRole('table');

    const consulta = consultasAoServidor()[0] ?? '';

    expect(consulta).toContain('estado=ATIVO');
    expect(consulta).toContain('limite=25');
    expect(consulta).toContain('deslocamento=0');
  });

  it('Arquivados e Todos são seleção explícita, lida da URL', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis', estado: 'ARQUIVADO' });
    const arquivados = renderizar();

    await screen.findByRole('table');
    expect(consultasAoServidor()[0]).toContain('estado=ARQUIVADO');
    arquivados.unmount();

    chamadas.length = 0;
    parametrosAtuais = new URLSearchParams({ aba: 'papeis', estado: 'todos' });
    renderizar();

    await screen.findByRole('table');
    expect(consultasAoServidor()[0]).not.toContain('estado=');
  });

  it('trocar a situação publica na URL (Ativos sai da URL) e volta à primeira página', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis', pagina: '3' });

    renderizar();
    await screen.findByRole('table');

    screen.getByRole('combobox', { name: /Situação do papel/u }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?aba=papeis&estado=ARQUIVADO', {
      scroll: false,
    });
  });

  it('a busca só chega à URL depois do debounce', async () => {
    renderizar();
    await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar papel/u }), 'alfa');

    expect(substituir).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?aba=papeis&busca=alfa', {
        scroll: false,
      }),
    );
  });

  it('a busca da URL vai ao servidor', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis', busca: 'alf' });

    renderizar();
    await screen.findByRole('table');

    expect(consultasAoServidor()[0]).toContain('busca=alf');
  });

  it('paginação de servidor: 60 papéis são 3 páginas e Próxima publica a página na URL', async () => {
    listaAtual = () => json({ papeis: [ALFA, BETA], total: 60 });

    renderizar();
    await screen.findByRole('table');

    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?aba=papeis&pagina=2', {
      scroll: false,
    });
  });

  it('sem filtro e sem papel, o vazio convida a criar o primeiro (administrador)', async () => {
    listaAtual = () => json({ papeis: [], total: 0 });

    renderizar();

    expect(await screen.findByText('Nenhum papel personalizado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Criar papel/u })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios/papeis/novo',
    );
  });

  it('com filtro e sem resultado, o vazio é outro e oferece limpar', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis', busca: 'inexistente' });
    listaAtual = () => json({ papeis: [], total: 0 });

    renderizar();

    expect(await screen.findByText('Nenhum papel encontrado')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?aba=papeis', { scroll: false });
  });

  it('conteúdo longo quebra linha em vez de estourar a tabela', async () => {
    const longo = papelDeTeste({
      id: 'longo',
      nome: 'Papel de conferência fiscal e contábil com um nome muito longo para provar a quebra de linha',
      descricao: 'x'.repeat(280),
    });

    listaAtual = () => json({ papeis: [longo], total: 1 });

    renderizar();
    const nome = await screen.findAllByText(/Papel de conferência fiscal/u);

    for (const elemento of nome) {
      expect(elemento.className).toMatch(/break-words/u);
    }
  });
});

describe('ações (administrador)', () => {
  it.each([
    ['Alfa fiscal', ['Editar', 'Arquivar']],
    ['Beta documentos', ['Editar', 'Arquivar']],
  ])('ações da linha de papel ativo %s: %j', async (nome, esperadas) => {
    renderizar();
    const linha = naTabelaLinha(await screen.findByRole('table'), nome);

    const rotulos = [...linha.querySelectorAll('a[href], button')].map(
      (elemento) => elemento.getAttribute('aria-label') ?? elemento.textContent ?? '',
    );

    expect(rotulos).toEqual(esperadas.map((acao) => `${acao} — ${nome}`));
  });

  it('papel arquivado oferece Reativar (que leva à revisão), não Arquivar', async () => {
    listaAtual = () => json({ papeis: [GAMA], total: 1 });

    renderizar();
    const linha = naTabelaLinha(await screen.findByRole('table'), 'Gama antigo');

    expect(within(linha).getByText('Arquivado')).toBeInTheDocument();
    expect(within(linha).getByRole('link', { name: 'Reativar — Gama antigo' })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios/papeis/gama',
    );
    expect(within(linha).queryByRole('button', { name: /Arquivar/u })).not.toBeInTheDocument();
  });

  it('arquivar pede confirmação que nomeia o papel e só chama a API ao confirmar, com a revisão da linha', async () => {
    listaAtual = () => json({ papeis: [BETA], total: 1 });

    renderizar();
    await screen.findByRole('table');

    await userEvent.click(naTabela().getByRole('button', { name: 'Arquivar — Beta documentos' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Arquivar “Beta documentos”?');
    expect(dialogo).toHaveTextContent('nada é excluído');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Arquivar papel' }));

    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1));

    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toEqual({ revisaoEsperada: 1 });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('papel em uso: o diálogo já avisa quantos usuários e o bloqueio do servidor é explicado nele', async () => {
    aoArquivar = () => problema(409, 'PAPEL_EM_USO');
    listaAtual = () => json({ papeis: [ALFA], total: 1 });

    renderizar();
    await screen.findByRole('table');

    await userEvent.click(naTabela().getByRole('button', { name: 'Arquivar — Alfa fiscal' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('atribuído a 2 usuários');

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Arquivar papel' }));

    expect(await screen.findByText('Não é possível continuar')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remova ou substitua o papel nesses usuários');
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
  });

  it('depois de arquivar a lista é lida de novo', async () => {
    listaAtual = () => json({ papeis: [BETA], total: 1 });

    renderizar();
    await screen.findByRole('table');

    const antes = consultasAoServidor().length;

    await userEvent.click(naTabela().getByRole('button', { name: 'Arquivar — Beta documentos' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Arquivar papel' }),
    );

    await waitFor(() => expect(consultasAoServidor().length).toBeGreaterThan(antes));
  });
});

describe('o auditor só consulta', () => {
  it('vê só Ver em cada linha e nenhuma ação de mutação nem Criar papel', async () => {
    renderizar(false);
    const tabela = await screen.findByRole('table');

    expect(screen.queryByRole('link', { name: /Criar papel/u })).not.toBeInTheDocument();

    for (const proibida of ['Arquivar', 'Reativar', 'Editar']) {
      expect(within(tabela).queryByRole('button', { name: new RegExp(proibida, 'u') })).not.toBeInTheDocument();
      expect(within(tabela).queryByRole('link', { name: new RegExp(proibida, 'u') })).not.toBeInTheDocument();
    }

    expect(within(tabela).getAllByRole('link', { name: /^Ver — / })).toHaveLength(2);
  });

  it('o vazio não oferece criar papel a quem só consulta', async () => {
    listaAtual = () => json({ papeis: [], total: 0 });

    renderizar(false);

    expect(await screen.findByText('Nenhum papel personalizado')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Criar papel/u })).not.toBeInTheDocument();
  });
});

describe('papéis padrão', () => {
  it('mostram o que cada um concede, com os nomes do catálogo, e nenhuma edição', async () => {
    renderizar();

    const auditor = await screen.findByRole('article', { name: 'Auditor (somente leitura)' });

    await userEvent.click(within(auditor).getByText('Ver o que concede'));

    expect(within(auditor).getByText(/Arquivos e versões:/u).closest('dd')).toHaveTextContent(
      'Consultar, Visualizar, Baixar',
    );
    expect(within(auditor).queryByRole('button', { name: /Editar|Salvar/u })).not.toBeInTheDocument();
  });

  it('falha no catálogo mostra erro próprio e a lista de personalizados continua', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        const endereco = String(url);

        if (endereco.endsWith('/papeis/catalogo')) return problema(500, 'ERRO_INTERNO', 'corr-cat');
        if ((init?.method ?? 'GET') === 'GET' && endereco.includes('/papeis?')) return listaAtual();

        throw new Error(`rota sem dublê: ${endereco}`);
      },
    );

    renderizar();

    expect(await screen.findByText('Não foi possível carregar os papéis padrão')).toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('teclado e acessibilidade', () => {
  it('a ação da primeira linha é alcançável e abre o diálogo com Enter', async () => {
    renderizar();
    await screen.findByRole('table');

    const botao = naTabela().getByRole('button', { name: 'Arquivar — Alfa fiscal' });

    botao.focus();
    expect(botao).toHaveFocus();

    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('a lista não tem violação detectável pelo axe (administrador e auditor)', async () => {
    const admin = renderizar();

    await screen.findByRole('table');
    expect(await axe(admin.container)).toHaveNoViolations();
    admin.unmount();

    const auditor = renderizar(false);

    await screen.findByRole('table');
    expect(await axe(auditor.container)).toHaveNoViolations();
  });

  it('os estados vazio e de erro não têm violação pelo axe', async () => {
    listaAtual = () => json({ papeis: [], total: 0 });
    const vazio = renderizar();

    await screen.findByText('Nenhum papel personalizado');
    expect(await axe(vazio.container)).toHaveNoViolations();
    vazio.unmount();

    listaAtual = () => problema(500, 'ERRO_INTERNO');
    const erro = renderizar();

    await screen.findByText('corr-l1');
    expect(await axe(erro.container)).toHaveNoViolations();
  });
});

function naTabelaLinha(tabela: HTMLElement, nome: string): HTMLElement {
  return within(tabela).getByRole('row', { name: new RegExp(nome, 'u') });
}

// Mantém o tipo usado nas linhas de teste visível ao compilador.
export type { VisaoDePapel };
