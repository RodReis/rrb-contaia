/**
 * Provas de tela da aba "Usuários e acessos" do Histórico (SPEC-007 §3.5):
 * somente leitura, antes/depois legíveis, autor "Sistema" nos eventos sem
 * autor humano, filtros e página na URL, horário em `America/Sao_Paulo`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventoDeUsuario, PaginaDeEventosDeUsuario } from './api';
import { HistoricoDeUsuarios } from './historico-de-usuarios';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams({ aba: 'USUARIOS_E_ACESSOS' });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

const evento = (sobrescritas: Partial<EventoDeUsuario> & Pick<EventoDeUsuario, 'id' | 'tipo'>): EventoDeUsuario => ({
  ocorridoEm: '2026-10-02T14:30:00.000Z',
  usuarioAfetadoId: 'ana',
  usuarioAfetadoNome: 'Ana Souza',
  autorId: 'admin',
  autorNome: 'Rodrigo Reis',
  antes: null,
  depois: null,
  ...sobrescritas,
});

const SUSPENSAO = evento({
  id: 'e3',
  tipo: 'SUSPENSO',
  antes: { estado: 'ATIVO' },
  depois: { estado: 'SUSPENSO' },
});

const PAPEIS = evento({
  id: 'e2',
  tipo: 'DADOS_E_PAPEIS_ALTERADOS',
  antes: { papeis: ['contador'], nome: 'Ana' },
  depois: { papeis: ['auxiliar', 'auditor_readonly'], nome: 'Ana Souza' },
});

const EXPIRACAO = evento({
  id: 'e1',
  tipo: 'CONVITE_EXPIRADO',
  autorId: null,
  autorNome: null,
  // 2026-10-02T02:30Z = 01/10/2026 23:30 em America/Sao_Paulo (I-11).
  ocorridoEm: '2026-10-02T02:30:00.000Z',
});

const COM_EVENTOS: PaginaDeEventosDeUsuario = { eventos: [SUSPENSAO, PAPEIS, EXPIRACAO], total: 3 };
const VAZIO: PaginaDeEventosDeUsuario = { eventos: [], total: 0 };

const USUARIOS = {
  usuarios: [
    { id: 'ana', nome: 'Ana Souza', email: 'ana@x.com', telefone: null, crc: null, papeis: ['contador'], estado: 'ATIVO', situacao: 'ATIVO', conviteExpiraEm: null, envioFalhou: false, versao: 0 },
    { id: 'admin', nome: 'Rodrigo Reis', email: 'r@x.com', telefone: null, crc: null, papeis: ['admin_escritorio'], estado: 'ATIVO', situacao: 'ATIVO', conviteExpiraEm: null, envioFalhou: false, versao: 0 },
  ],
  total: 2,
};

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

let historicoAtual: () => Response | Promise<Response> = () => json(COM_EVENTOS);
const chamadas: string[] = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<HistoricoDeUsuarios />, { wrapper: Envolvido });

beforeEach(() => {
  parametrosAtuais = new URLSearchParams({ aba: 'USUARIOS_E_ACESSOS' });
  historicoAtual = () => json(COM_EVENTOS);
  chamadas.length = 0;
  substituir.mockClear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      chamadas.push(String(url));

      if (String(url).includes('/historico/usuarios')) return historicoAtual();
      if (String(url).includes('/usuarios?')) return json(USUARIOS);

      throw new Error(`rota sem dublê: ${String(url)}`);
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

/** Só os itens diretos da lista: os de alteração (antes → depois) são listas aninhadas. */
const eventosDe = (lista: HTMLElement): HTMLElement[] =>
  Array.from(lista.querySelectorAll<HTMLElement>(':scope > li'));

const consultaDoHistorico = (): string =>
  chamadas.find((url) => url.includes('/historico/usuarios')) ?? '';

describe('estados de tela', () => {
  it('anuncia o carregamento com skeleton', async () => {
    historicoAtual = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Carregando o histórico de usuários')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('erro mostra o que fazer e o correlationId', async () => {
    historicoAtual = () =>
      json({ type: 'x', title: 'x', status: 500, code: 'ERRO_INTERNO', correlationId: 'corr-55' }, 500);

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico');
    expect(screen.getByText('corr-55')).toBeInTheDocument();
  });

  it('sem nenhum evento, o vazio fala de aba sem registro', async () => {
    historicoAtual = () => json(VAZIO);

    renderizar();

    expect(await screen.findByText('Nenhum evento registrado')).toBeInTheDocument();
  });

  it('com filtro e sem resultado, o vazio é outro e oferece limpar', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'USUARIOS_E_ACESSOS', tipo: 'SUSPENSO' });
    historicoAtual = () => json(VAZIO);

    renderizar();

    expect(await screen.findByText('Nenhum evento no período ou filtro')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    expect(substituir).toHaveBeenCalledWith('/historico?aba=USUARIOS_E_ACESSOS', { scroll: false });
  });
});

describe('eventos', () => {
  it('mostra tipo, afetado, autor e horário de São Paulo, do mais recente ao mais antigo', async () => {
    renderizar();

    const lista = await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });
    const itens = eventosDe(lista);

    expect(itens).toHaveLength(3);
    expect(within(itens[0]!).getByText('Usuário suspenso')).toBeInTheDocument();
    expect(within(itens[0]!).getByText(/Ana Souza/u)).toBeInTheDocument();
    expect(within(itens[0]!).getByText(/Rodrigo Reis/u)).toBeInTheDocument();
    expect(within(itens[1]!).getByText('Dados e papéis alterados')).toBeInTheDocument();
    expect(within(itens[2]!).getByText('Convite expirado')).toBeInTheDocument();
    expect(within(itens[2]!).getByText(/01\/10\/2026/u)).toBeInTheDocument();
    expect(within(itens[2]!).getByText(/23:30/u)).toBeInTheDocument();
  });

  it('evento sem autor humano mostra "Sistema"', async () => {
    renderizar();

    const lista = await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    expect(within(eventosDe(lista)[2]!).getByText(/Sistema/u)).toBeInTheDocument();
  });

  it('antes e depois aparecem por extenso: situação e papéis com os rótulos do produto', async () => {
    renderizar();

    const lista = await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });
    const [suspensao, papeis] = eventosDe(lista);

    expect(within(suspensao!).getByText('Situação')).toBeInTheDocument();
    expect(within(suspensao!).getByText('Ativo')).toBeInTheDocument();
    expect(within(suspensao!).getByText('Suspenso')).toBeInTheDocument();
    expect(within(papeis!).getByText('Contador')).toBeInTheDocument();
    expect(within(papeis!).getByText('Auxiliar, Auditor (somente leitura)')).toBeInTheDocument();
    // O identificador técnico nunca aparece.
    expect(screen.queryByText(/auditor_readonly|admin_escritorio/u)).not.toBeInTheDocument();
  });

  it('não oferece nenhuma ação de escrita sobre o histórico', async () => {
    renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    expect(screen.queryByRole('button', { name: /editar|excluir|apagar|salvar|corrigir/iu })).not.toBeInTheDocument();
  });
});

describe('filtros e página na URL', () => {
  it('a consulta leva usuário afetado, autor, tipo e período convertidos para o contrato da API', async () => {
    parametrosAtuais = new URLSearchParams({
      aba: 'USUARIOS_E_ACESSOS',
      afetado: 'ana',
      autor: 'admin',
      tipo: 'SUSPENSO',
      inicio: '2026-10-01',
      fim: '2026-10-02',
    });

    renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    const consulta = consultaDoHistorico();

    expect(consulta).toContain('usuarioAfetadoId=ana');
    expect(consulta).toContain('autorId=admin');
    expect(consulta).toContain('tipo=SUSPENSO');
    expect(consulta).toContain('de=2026-10-01');
    expect(consulta).toContain('ate=2026-10-02');
    expect(consulta).toContain('limite=25');
  });

  it('o período digitado vai para a URL, mantendo a aba e voltando à primeira página', async () => {
    parametrosAtuais = new URLSearchParams({ aba: 'USUARIOS_E_ACESSOS', pagina: '3' });

    renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } });

    expect(substituir).toHaveBeenCalledWith('/historico?aba=USUARIOS_E_ACESSOS&inicio=2026-10-01', {
      scroll: false,
    });
  });

  it('o tipo de evento é filtrável por teclado e entra na URL', async () => {
    renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    screen.getByRole('combobox', { name: /Tipo de evento/u }).focus();
    await userEvent.keyboard('{Enter}');
    // De "Todos": Convite criado, Convite reenviado, Convite aceito.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(substituir).toHaveBeenCalledWith('/historico?aba=USUARIOS_E_ACESSOS&tipo=CONVITE_ACEITO', {
      scroll: false,
    });
  });

  it('usuário afetado e autor oferecem os usuários do escritório', async () => {
    renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    screen.getByRole('combobox', { name: /Usuário afetado/u }).focus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('option', { name: 'Ana Souza' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Rodrigo Reis' })).toBeInTheDocument();
  });

  it('pagina de 25 em 25 pela URL', async () => {
    historicoAtual = () => json({ eventos: [SUSPENSAO], total: 60 });

    renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(substituir).toHaveBeenCalledWith('/historico?aba=USUARIOS_E_ACESSOS&pagina=2', {
      scroll: false,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled());
  });
});

describe('acessibilidade', () => {
  it('a lista não tem violação detectável pelo axe', async () => {
    const { container } = renderizar();
    await screen.findByRole('list', { name: 'Eventos de usuários e acessos' });

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o estado vazio não tem violação detectável pelo axe', async () => {
    historicoAtual = () => json(VAZIO);

    const { container } = renderizar();
    await screen.findByText('Nenhum evento registrado');

    expect(await axe(container)).toHaveNoViolations();
  });
});
