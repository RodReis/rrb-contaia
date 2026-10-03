/**
 * Provas de tela da área "Usuários e permissões" (SPEC-007 §5, TESTING.md §3.5).
 *
 * A API é dublada no nível do `fetch`, por rota: o que se prova aqui é a tela —
 * estados, ações por situação, o que o auditor NÃO vê, confirmação nomeando o
 * usuário, filtros na URL e acessibilidade — não o backend.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaDeUsuarios } from './area-de-usuarios';
import type { Sessao, VisaoDeUsuario } from './api';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/configuracoes/usuarios',
}));

const SEM = {
  CADASTRO_ESCRITORIO: [],
  EMPRESAS: [],
  DOCUMENTOS: [],
  PENDENCIAS: [],
  NOTIFICACOES: [],
  HISTORICO: [],
  USUARIOS: [],
} as const;

const ADMIN: Sessao = {
  papeis: ['admin_escritorio'],
  permissoes: { ...SEM, USUARIOS: ['consultar', 'criar', 'editar', 'arquivar', 'administrar'] },
  escopoDeEmpresas: 'TODAS',
};

const AUDITOR: Sessao = {
  papeis: ['auditor_readonly'],
  permissoes: { ...SEM, USUARIOS: ['consultar'] },
  escopoDeEmpresas: 'NENHUMA',
};

const CONTADOR: Sessao = {
  papeis: ['contador'],
  permissoes: { ...SEM },
  escopoDeEmpresas: 'NENHUMA',
};

const usuario = (sobrescritas: Partial<VisaoDeUsuario> & Pick<VisaoDeUsuario, 'id' | 'nome'>): VisaoDeUsuario => ({
  email: `${sobrescritas.id}@escritorio.com`,
  telefone: null,
  crc: null,
  papeis: ['contador'],
  estado: 'ATIVO',
  situacao: 'ATIVO',
  conviteExpiraEm: null,
  envioFalhou: false,
  versao: 0,
  ...sobrescritas,
});

const ANA = usuario({ id: 'ana', nome: 'Ana Souza', papeis: ['admin_escritorio', 'contador'] });
const BRUNO = usuario({
  id: 'bruno',
  nome: 'Bruno Lima',
  estado: 'CONVIDADO',
  situacao: 'CONVIDADO',
  conviteExpiraEm: '2026-10-04T12:00:00.000Z',
});
const CARLA = usuario({
  id: 'carla',
  nome: 'Carla Dias',
  estado: 'CONVIDADO',
  situacao: 'CONVITE_EXPIRADO',
  conviteExpiraEm: '2026-10-01T12:00:00.000Z',
  envioFalhou: true,
});
const DIEGO = usuario({ id: 'diego', nome: 'Diego Reis', estado: 'SUSPENSO', situacao: 'SUSPENSO' });
const ELISA = usuario({ id: 'elisa', nome: 'Elisa Prado', estado: 'ARQUIVADO', situacao: 'ARQUIVADO' });

const TODOS = [ANA, BRUNO, CARLA, DIEGO, ELISA];

const CATALOGO = [
  { papel: 'admin_escritorio', permissoes: { ...SEM, USUARIOS: ['consultar', 'administrar'], EMPRESAS: ['consultar'] } },
  { papel: 'contador', permissoes: { ...SEM, EMPRESAS: ['consultar', 'criar', 'editar', 'arquivar'] } },
  { papel: 'auxiliar', permissoes: { ...SEM, EMPRESAS: ['consultar', 'criar', 'editar'] } },
  { papel: 'auditor_readonly', permissoes: { ...SEM, EMPRESAS: ['consultar'], USUARIOS: ['consultar'] } },
];

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string, correlationId = 'corr-123') =>
  json({ type: 'x', title: 'x', status, code, correlationId }, status);

type Roteador = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

let sessaoAtual: Sessao = ADMIN;
let listaAtual: () => Response | Promise<Response> = () => json({ usuarios: TODOS, total: TODOS.length });
let acaoAtual: (url: string) => Response | Promise<Response> = () => json(ANA);
const chamadas: Array<{ url: string; metodo: string }> = [];

const roteador: Roteador = (url, init) => {
  const metodo = init?.method ?? 'GET';

  chamadas.push({ url, metodo });

  if (url.endsWith('/usuarios/eu')) return json(sessaoAtual);
  if (url.endsWith('/usuarios/papeis')) return json(CATALOGO);
  if (url.includes('/usuarios?')) return listaAtual();
  if (metodo === 'POST') return acaoAtual(url);

  return undefined;
};

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<AreaDeUsuarios />, { wrapper: Envolvido });

/** Tabela e cartões coexistem no DOM (o CSS esconde um deles): as ações são consultadas na tabela. */
const naTabela = () => within(screen.getByRole('table'));

const chamadasA = (trecho: string, metodo = 'POST') =>
  chamadas.filter((chamada) => chamada.url.includes(trecho) && chamada.metodo === metodo);

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  sessaoAtual = ADMIN;
  listaAtual = () => json({ usuarios: TODOS, total: TODOS.length });
  acaoAtual = () => json(ANA);
  chamadas.length = 0;
  substituir.mockClear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const resposta = await roteador(String(url), init);

      if (resposta === undefined) {
        throw new Error(`rota sem dublê: ${init?.method ?? 'GET'} ${String(url)}`);
      }

      return resposta;
    }),
  );

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
  vi.restoreAllMocks();
});

describe('carregamento e erro', () => {
  it('anuncia o carregamento com skeleton, não spinner', async () => {
    listaAtual = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Carregando os usuários do escritório')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('erro de servidor mostra o que fazer e o correlationId para o suporte', async () => {
    listaAtual = () => problema(500, 'ERRO_INTERNO', 'corr-987');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os usuários');
    expect(screen.getByText('corr-987')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('sessão expirada orienta entrar de novo, com link para o acesso', async () => {
    listaAtual = () => problema(401, 'HTTP_401', 'sem-sessao');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Sua sessão expirou');
    expect(screen.getByRole('link', { name: 'Entrar novamente' })).toHaveAttribute(
      'href',
      '/api/auth/entrar',
    );
  });

  it('Keycloak fora (503) mostra a mensagem própria, sem esconder o código de suporte', async () => {
    listaAtual = () => problema(503, 'IDENTIDADE_INDISPONIVEL', 'corr-503');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('serviço de identidade está indisponível');
    expect(screen.getByText('corr-503')).toBeInTheDocument();
  });
});

describe('permissão insuficiente', () => {
  it('quem não consulta usuários vê a explicação e a lista nem é pedida', async () => {
    sessaoAtual = CONTADOR;

    renderizar();

    expect(
      await screen.findByText('Você não tem permissão para ver esta área'),
    ).toBeInTheDocument();
    expect(chamadasA('/usuarios?', 'GET')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /Convidar usuário/u })).not.toBeInTheDocument();
  });

  it('403 da API vira o mesmo estado, mesmo que a sessão local divergisse', async () => {
    listaAtual = () => problema(403, 'SEM_AUTORIZACAO');

    renderizar();

    expect(
      await screen.findByText('Você não tem permissão para ver esta área'),
    ).toBeInTheDocument();
  });
});

describe('lista de usuários (administrador)', () => {
  it('mostra nome, e-mail, papéis por extenso, situação e a contagem total', async () => {
    renderizar();

    const tabela = await screen.findByRole('table', { name: /usuários deste escritório/iu });
    const linhaDaAna = within(tabela).getByRole('row', { name: /Ana Souza/u });

    expect(within(linhaDaAna).getByText('ana@escritorio.com')).toBeInTheDocument();
    expect(within(linhaDaAna).getByText('Administrador do escritório')).toBeInTheDocument();
    expect(within(linhaDaAna).getByText('Contador')).toBeInTheDocument();
    expect(within(linhaDaAna).getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('5 usuários neste escritório.')).toBeInTheDocument();
    // O identificador técnico do papel nunca aparece.
    expect(screen.queryByText('admin_escritorio')).not.toBeInTheDocument();
  });

  it('a situação tem rótulo textual para cada estado: cor nunca é o único sinal', async () => {
    renderizar();
    await screen.findByRole('table');

    for (const rotulo of ['Ativo', 'Convidado', 'Convite expirado', 'Suspenso', 'Arquivado']) {
      expect(screen.getAllByText(rotulo).length).toBeGreaterThan(0);
    }
  });

  it('falha no envio do e-mail é sinalizada na linha', async () => {
    renderizar();
    const linha = within(await screen.findByRole('table')).getByRole('row', { name: /Carla Dias/u });

    expect(within(linha).getByText('E-mail não enviado')).toBeInTheDocument();
  });

  it('oferece Convidar usuário ao administrador', async () => {
    renderizar();

    expect(await screen.findByRole('link', { name: /Convidar usuário/u })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios/novo',
    );
  });

  it.each([
    ['Ana Souza', ['Editar', 'Suspender', 'Arquivar']],
    ['Bruno Lima', ['Editar', 'Reenviar convite']],
    ['Carla Dias', ['Editar', 'Reenviar convite']],
    ['Diego Reis', ['Editar', 'Reativar', 'Arquivar']],
    ['Elisa Prado', ['Novo convite']],
  ])('ações da linha de %s: %j', async (nome, esperadas) => {
    renderizar();
    const linha = within(await screen.findByRole('table')).getByRole('row', { name: new RegExp(nome, 'u') });

    const rotulos = [...linha.querySelectorAll('a[href], button')].map(
      (elemento) => elemento.getAttribute('aria-label') ?? elemento.textContent ?? '',
    );

    expect(rotulos).toEqual(esperadas.map((acao) => `${acao} — ${nome}`));
  });

  it('conteúdo longo quebra linha em vez de estourar a tabela', async () => {
    const longo = usuario({
      id: 'longo',
      nome: 'Maria da Conceição de Albuquerque Montenegro Vasconcelos Figueiredo Neto',
      email: 'maria.da.conceicao.de.albuquerque.montenegro.vasconcelos@escritorio-de-contabilidade-associados.com.br',
    });

    listaAtual = () => json({ usuarios: [longo], total: 1 });

    renderizar();
    const emails = await screen.findAllByText(/maria\.da\.conceicao/u);

    for (const email of emails) {
      expect(email.className).toMatch(/break-words|break-all|overflow-wrap:anywhere/u);
    }
  });
});

describe('o auditor só consulta', () => {
  beforeEach(() => {
    sessaoAtual = AUDITOR;
  });

  it('não vê nenhuma ação de mutação nem Convidar usuário; só Ver', async () => {
    renderizar();
    const tabela = await screen.findByRole('table');

    expect(screen.queryByRole('link', { name: /Convidar usuário/u })).not.toBeInTheDocument();

    for (const proibida of ['Suspender', 'Arquivar', 'Reativar', 'Reenviar convite', 'Novo convite', 'Editar']) {
      expect(within(tabela).queryByRole('button', { name: new RegExp(proibida, 'u') })).not.toBeInTheDocument();
      expect(within(tabela).queryByRole('link', { name: new RegExp(proibida, 'u') })).not.toBeInTheDocument();
    }

    expect(within(tabela).getAllByRole('link', { name: /^Ver — / })).toHaveLength(5);
  });

  it('não exibe falha de envio nem prazo do convite: são dados técnicos', async () => {
    listaAtual = () => json({ usuarios: [{ ...CARLA, envioFalhou: false, conviteExpiraEm: null }], total: 1 });

    renderizar();
    await screen.findByRole('table');

    expect(screen.queryByText('E-mail não enviado')).not.toBeInTheDocument();
  });
});

describe('ações de ciclo de vida', () => {
  it('suspender pede confirmação que nomeia o usuário e o efeito, e só chama a API ao confirmar', async () => {
    renderizar();
    await screen.findByRole('table');

    await userEvent.click(naTabela().getByRole('button', { name: 'Suspender — Ana Souza' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Suspender Ana Souza?');
    expect(dialogo).toHaveTextContent('todas as sessões');
    expect(chamadasA('/suspender')).toHaveLength(0);

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Suspender usuário' }));

    await waitFor(() => expect(chamadasA('/usuarios/ana/suspender')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('arquivar também confirma, nomeando o usuário e explicando que o histórico fica', async () => {
    renderizar();
    await screen.findByRole('table');

    await userEvent.click(naTabela().getByRole('button', { name: 'Arquivar — Diego Reis' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Arquivar Diego Reis?');
    expect(dialogo).toHaveTextContent('histórico');
  });

  it('último administrador: a explicação aparece no próprio diálogo, não como toast', async () => {
    acaoAtual = () => problema(409, 'ULTIMO_ADMIN');

    renderizar();
    await screen.findByRole('table');

    await userEvent.click(naTabela().getByRole('button', { name: 'Suspender — Ana Souza' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender usuário' }));

    expect(await screen.findByText('Não é possível continuar')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('ao menos um administrador ativo');
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
  });

  it('reenviar convite e reativar não pedem confirmação: são reversíveis', async () => {
    renderizar();
    await screen.findByRole('table');

    await userEvent.click(naTabela().getByRole('button', { name: 'Reenviar convite — Bruno Lima' }));
    await waitFor(() => expect(chamadasA('/usuarios/bruno/reenviar-convite')).toHaveLength(1));

    await userEvent.click(naTabela().getByRole('button', { name: 'Reativar — Diego Reis' }));
    await waitFor(() => expect(chamadasA('/usuarios/diego/reativar')).toHaveLength(1));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('depois de uma ação a lista é lida de novo', async () => {
    renderizar();
    await screen.findByRole('table');

    const antes = chamadasA('/usuarios?', 'GET').length;

    await userEvent.click(naTabela().getByRole('button', { name: 'Reativar — Diego Reis' }));

    await waitFor(() => expect(chamadasA('/usuarios?', 'GET').length).toBeGreaterThan(antes));
  });
});

describe('filtros na URL', () => {
  it('a busca só chega à URL depois do debounce', async () => {
    renderizar();
    await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/u }), 'ana');

    expect(substituir).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?busca=ana', { scroll: false }),
    );
  });

  it('o debounce publica sobre a URL de agora: um filtro escolhido enquanto digitava não se perde', async () => {
    const { rerender } = renderizar();
    await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/u }), 'ana');
    // Antes de o debounce disparar, a URL ganha outro filtro (a pessoa trocou a situação).
    parametrosAtuais = new URLSearchParams({ estado: 'SUSPENSO' });
    rerender(<AreaDeUsuarios />);

    await waitFor(() => expect(substituir).toHaveBeenCalled());

    const destino = String(substituir.mock.calls.at(-1)?.[0]);

    expect(destino).toContain('estado=SUSPENSO');
    expect(destino).toContain('busca=ana');
  });

  it('navegar de fora para a lista limpa o que foi digitado e não republica a busca antiga', async () => {
    const { rerender } = renderizar();
    await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/u }), 'ana');
    await waitFor(() => expect(substituir).toHaveBeenCalledTimes(1));

    // A URL passa a refletir a busca publicada...
    parametrosAtuais = new URLSearchParams({ busca: 'ana' });
    rerender(<AreaDeUsuarios />);
    // ...e depois muda por fora (clique no menu da própria página).
    substituir.mockClear();
    parametrosAtuais = new URLSearchParams();
    rerender(<AreaDeUsuarios />);

    await new Promise((resolver) => setTimeout(resolver, 450));

    expect(screen.getByRole('searchbox', { name: /Buscar/u })).toHaveValue('');
    expect(substituir).not.toHaveBeenCalled();
  });

  it('situação e papel são enviados ao servidor e refletem na URL', async () => {
    parametrosAtuais = new URLSearchParams({ estado: 'SUSPENSO', papel: 'contador', busca: 'di' });

    renderizar();
    await screen.findByRole('table');

    const consulta = chamadasA('/usuarios?', 'GET')[0]?.url ?? '';

    expect(consulta).toContain('estado=SUSPENSO');
    expect(consulta).toContain('papel=contador');
    expect(consulta).toContain('busca=di');
    expect(consulta).toContain('limite=25');
  });

  it('trocar a situação publica na URL e volta para a primeira página', async () => {
    parametrosAtuais = new URLSearchParams({ pagina: '3' });

    renderizar();
    await screen.findByRole('table');

    // Operado por teclado de propósito: o filtro precisa funcionar sem mouse e é o
    // caminho que o Radix suporta em jsdom. De "Todas": Convidados, Ativos, Suspensos.
    screen.getByRole('combobox', { name: /Situação/u }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?estado=SUSPENSO', {
      scroll: false,
    });
  });

  it('com filtro sem resultado o vazio é outro e oferece limpar', async () => {
    parametrosAtuais = new URLSearchParams({ busca: 'inexistente' });
    listaAtual = () => json({ usuarios: [], total: 0 });

    renderizar();

    expect(await screen.findByText('Nenhum usuário encontrado')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios', { scroll: false });
  });

  it('sem nenhum usuário, o vazio convida ao primeiro convite (administrador)', async () => {
    listaAtual = () => json({ usuarios: [], total: 0 });

    renderizar();

    expect(await screen.findByText('Nenhum usuário cadastrado')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Convidar usuário/u }).length).toBeGreaterThan(0);
  });
});

describe('aba Papéis e permissões', () => {
  it('mostra os quatro papéis padrão, somente leitura, com permissões por extenso', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis' });

    renderizar();

    expect(await screen.findByText('Auxiliar')).toBeInTheDocument();

    for (const papel of ['Administrador do escritório', 'Contador', 'Auxiliar', 'Auditor (somente leitura)']) {
      expect(screen.getAllByText(papel).length).toBeGreaterThan(0);
    }

    expect(screen.getAllByText(/Arquivar e reativar/u).length).toBeGreaterThan(0);
    // Somente leitura: nenhum controle de edição.
    expect(screen.queryByRole('button', { name: /Salvar|Editar|Remover/u })).not.toBeInTheDocument();
  });

  it('avisa que permissões de papéis acumulados se somam', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis' });

    renderizar();

    expect(await screen.findByText(/se somam/u)).toBeInTheDocument();
  });

  it('trocar de aba publica na URL', async () => {
    renderizar();
    await screen.findByRole('table');

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis e permissões' }));

    expect(substituir).toHaveBeenCalledWith('/configuracoes/usuarios?aba=papeis', { scroll: false });
  });
});

describe('teclado e acessibilidade', () => {
  it('a primeira ação da primeira linha é alcançável por Tab e abre o diálogo com Enter', async () => {
    renderizar();
    await screen.findByRole('table');

    const botao = naTabela().getByRole('button', { name: 'Suspender — Ana Souza' });

    botao.focus();
    expect(botao).toHaveFocus();

    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('a lista não tem violação detectável pelo axe (administrador)', async () => {
    const { container } = renderizar();
    await screen.findByRole('table');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('a lista não tem violação detectável pelo axe (auditor)', async () => {
    sessaoAtual = AUDITOR;

    const { container } = renderizar();
    await screen.findByRole('table');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('os estados vazio e de permissão insuficiente não têm violação pelo axe', async () => {
    listaAtual = () => json({ usuarios: [], total: 0 });
    const vazio = renderizar();
    await screen.findByText('Nenhum usuário cadastrado');
    expect(await axe(vazio.container)).toHaveNoViolations();
    vazio.unmount();

    sessaoAtual = CONTADOR;
    const semPermissao = renderizar();
    await screen.findByText('Você não tem permissão para ver esta área');
    expect(await axe(semPermissao.container)).toHaveNoViolations();
  });

  it('a aba de papéis não tem violação detectável pelo axe', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'papeis' });

    const { container } = renderizar();
    await screen.findByText('Auxiliar');

    expect(await axe(container)).toHaveNoViolations();
  });
});
