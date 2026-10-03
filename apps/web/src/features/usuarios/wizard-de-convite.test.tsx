/**
 * Provas de tela do wizard de convite (SPEC-007 §3.2 e §5.1): duas etapas,
 * papel obrigatório, revisão antes do envio, erros do servidor no lugar certo.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { papelDeTeste, sessaoDe } from '../papeis/papeis.fixtures';
import type { Sessao } from './api';
import { WizardDeConvite } from './wizard-de-convite';

const empurrar = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empurrar, replace: vi.fn() }),
  usePathname: () => '/configuracoes/usuarios/novo',
}));

const ADMIN: Sessao = sessaoDe(['admin_escritorio']);
const AUDITOR: Sessao = sessaoDe(['auditor_readonly']);

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string) =>
  json({ type: 'x', title: 'x', status, code, correlationId: 'corr-1' }, status);

const CRIADO = {
  id: 'novo',
  nome: 'Ana Souza',
  email: 'ana@escritorio.com',
  telefone: null,
  crc: null,
  papeis: ['contador'],
  papeisPersonalizados: [],
  estado: 'CONVIDADO',
  situacao: 'CONVIDADO',
  conviteExpiraEm: null,
  envioFalhou: false,
  versao: 0,
};

let sessaoAtual: Sessao = ADMIN;
let papeisAtivos: ReturnType<typeof papelDeTeste>[] = [];
let listaDePapeis: (() => Response | Promise<Response>) | null = null;
let aoCriar: () => Response | Promise<Response> = () => json(CRIADO, 201);
const chamadas: Array<{ url: string; metodo: string; corpo: unknown }> = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<WizardDeConvite />, { wrapper: Envolvido });

const preencherDados = async (
  dados: Partial<Record<'nome' | 'email' | 'telefone' | 'crc', string>> = {},
): Promise<void> => {
  const valores = { nome: 'Ana Souza', email: 'ana@escritorio.com', telefone: '', crc: '', ...dados };

  await userEvent.type(await screen.findByLabelText(/Nome completo/u), valores.nome);
  await userEvent.type(screen.getByLabelText(/^E-mail/u), valores.email);

  if (valores.telefone !== '') await userEvent.type(screen.getByLabelText(/Telefone/u), valores.telefone);
  if (valores.crc !== '') await userEvent.type(screen.getByLabelText(/Registro no CRC/u), valores.crc);
};

const avancar = () => userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

const irParaPapeis = async (dados?: Parameters<typeof preencherDados>[0]): Promise<void> => {
  await preencherDados(dados);
  await avancar();
  await screen.findByRole('group', { name: 'Papéis' });
};

const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));

beforeEach(() => {
  sessaoAtual = ADMIN;
  papeisAtivos = [];
  listaDePapeis = null;
  aoCriar = () => json(CRIADO, 201);
  chamadas.length = 0;
  empurrar.mockClear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';

      chamadas.push({
        url: String(url),
        metodo,
        corpo: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      });

      if (String(url).endsWith('/usuarios/eu')) return json(sessaoAtual);
      if (String(url).includes('/papeis?')) {
        return listaDePapeis?.() ?? json({ papeis: papeisAtivos, total: papeisAtivos.length });
      }
      if (metodo === 'POST' && String(url).endsWith('/usuarios')) return aoCriar();

      throw new Error(`rota sem dublê: ${metodo} ${String(url)}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const envios = () => chamadas.filter((c) => c.metodo === 'POST' && c.url.endsWith('/usuarios'));

describe('etapa 1 — Dados', () => {
  it('mostra as duas etapas, com a primeira como atual', async () => {
    renderizar();

    await screen.findByLabelText(/Nome completo/u);

    const etapas = screen.getByRole('navigation', { name: 'Etapas do convite' });

    expect(within(etapas).getByText('Dados')).toBeInTheDocument();
    expect(within(etapas).getByText('Papéis e revisão')).toBeInTheDocument();
    expect(within(etapas).getByText('etapa atual')).toBeInTheDocument();
  });

  it('nome e e-mail são obrigatórios; telefone e CRC, opcionais', async () => {
    renderizar();

    expect(await screen.findByLabelText(/Nome completo/u)).toBeRequired();
    expect(screen.getByLabelText(/^E-mail/u)).toBeRequired();
    expect(screen.getByLabelText(/Telefone/u)).not.toBeRequired();
    expect(screen.getByLabelText(/Registro no CRC/u)).not.toBeRequired();
  });

  it('não avança sem dados válidos e mostra o que corrigir, sem desabilitar o botão', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await avancar();

    expect(await screen.findByText('Informe o nome completo')).toBeInTheDocument();
    expect(screen.getByText('E-mail inválido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    expect(screen.queryByRole('group', { name: 'Papéis' })).not.toBeInTheDocument();
  });

  it('telefone preenchido e inválido bloqueia o avanço', async () => {
    renderizar();
    await preencherDados({ telefone: '123' });
    await avancar();

    expect(await screen.findByText('Telefone inválido')).toBeInTheDocument();
  });

  it('com dados válidos, vai para a etapa de papéis e revisão', async () => {
    renderizar();
    await irParaPapeis();

    expect(screen.getByRole('group', { name: 'Papéis' })).toBeInTheDocument();
  });
});

describe('etapa 2 — Papéis e revisão', () => {
  it('oferece os quatro papéis padrão com a descrição de cada um', async () => {
    renderizar();
    await irParaPapeis();

    for (const papel of ['Administrador do escritório', 'Contador', 'Auxiliar', 'Auditor (somente leitura)']) {
      expect(screen.getByRole('checkbox', { name: papel })).not.toBeChecked();
    }

    expect(screen.getByRole('checkbox', { name: 'Auxiliar' })).toHaveAccessibleDescription(
      /não arquiva empresas/u,
    );
  });

  it('mostra a revisão dos dados antes do envio', async () => {
    renderizar();
    await irParaPapeis({ telefone: '11987654321', crc: 'SP-123' });

    const revisao = screen.getByRole('region', { name: 'Revisão do convite' });

    expect(within(revisao).getByText('Ana Souza')).toBeInTheDocument();
    expect(within(revisao).getByText('ana@escritorio.com')).toBeInTheDocument();
    expect(within(revisao).getByText('(11) 98765-4321')).toBeInTheDocument();
    expect(within(revisao).getByText('SP-123')).toBeInTheDocument();
  });

  it('sem papel o envio é recusado com a mensagem no lugar certo, e nada é enviado', async () => {
    renderizar();
    await irParaPapeis();

    await enviar();

    expect(await screen.findByText('Selecione ao menos um papel.')).toBeInTheDocument();
    expect(envios()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeEnabled();
  });

  it('com papéis marcados, envia os dados normalizados e volta para a lista', async () => {
    renderizar();
    await irParaPapeis({ telefone: '(11) 98765-4321', crc: ' SP-123 ' });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auxiliar' }));
    await enviar();

    await waitFor(() => expect(envios()).toHaveLength(1));

    expect(envios()[0]?.corpo).toEqual({
      nome: 'Ana Souza',
      email: 'ana@escritorio.com',
      telefone: '11987654321',
      crc: 'SP-123',
      papeis: ['contador', 'auxiliar'],
      papeisPersonalizados: [],
    });
    await waitFor(() => expect(empurrar).toHaveBeenCalledWith('/configuracoes/usuarios'));
  });

  it('as permissões se somam: o aviso explica isso ao marcar mais de um papel', async () => {
    renderizar();
    await irParaPapeis();

    expect(screen.getByText(/permissões se somam/u)).toBeInTheDocument();
  });

  it('Voltar mantém o que foi digitado', async () => {
    renderizar();
    await irParaPapeis();

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(await screen.findByLabelText(/Nome completo/u)).toHaveValue('Ana Souza');
    expect(screen.getByLabelText(/^E-mail/u)).toHaveValue('ana@escritorio.com');
  });

  it('o papel marcado sobrevive a Voltar e Continuar', async () => {
    renderizar();
    await irParaPapeis();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Auditor (somente leitura)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await avancar();

    expect(await screen.findByRole('checkbox', { name: 'Auditor (somente leitura)' })).toBeChecked();
  });
});

describe('erros do servidor', () => {
  it('e-mail em uso volta à etapa 1 com a mensagem no campo, sem revelar de quem é', async () => {
    aoCriar = () => problema(409, 'EMAIL_JA_UTILIZADO');

    renderizar();
    await irParaPapeis();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await enviar();

    expect(await screen.findByText('Este e-mail já está em uso.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^E-mail/u)).toHaveAttribute('aria-invalid', 'true');
    expect(empurrar).not.toHaveBeenCalled();
  });

  it('usuário arquivado orienta o novo convite e leva aos arquivados', async () => {
    aoCriar = () => problema(409, 'USUARIO_ARQUIVADO_USE_NOVO_CONVITE');

    renderizar();
    await irParaPapeis();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await enviar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Inicie um novo convite');
    expect(screen.getByRole('link', { name: 'Ver usuários arquivados' })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios?estado=ARQUIVADO',
    );
  });

  it('Keycloak fora mantém a etapa e tudo o que foi preenchido, para tentar de novo', async () => {
    aoCriar = () => problema(503, 'IDENTIDADE_INDISPONIVEL');

    renderizar();
    await irParaPapeis();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await enviar();

    await waitFor(() => expect(envios()).toHaveLength(1));

    expect(await screen.findByRole('button', { name: 'Enviar convite' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Contador' })).toBeChecked();
    expect(empurrar).not.toHaveBeenCalled();
  });

  it('erro de campo vindo do servidor aparece no campo', async () => {
    aoCriar = () =>
      json(
        {
          type: 'x',
          title: 'x',
          status: 422,
          code: 'CAMPO_OBRIGATORIO',
          correlationId: 'corr-2',
          campos: [{ campo: 'email', codigo: 'EMAIL_INVALIDO' }],
        },
        422,
      );

    renderizar();
    await irParaPapeis();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await enviar();

    expect(await screen.findByText('E-mail inválido')).toBeInTheDocument();
  });
});

describe('permissão e acessibilidade', () => {
  it('quem só consulta não vê o formulário', async () => {
    sessaoAtual = AUDITOR;

    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver esta área')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nome completo/u)).not.toBeInTheDocument();
  });

  it('as duas etapas não têm violação detectável pelo axe', async () => {
    const { container } = renderizar();
    await screen.findByLabelText(/Nome completo/u);
    expect(await axe(container)).toHaveNoViolations();

    await preencherDados();
    await avancar();
    await screen.findByRole('group', { name: 'Papéis' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Enter no campo de nome avança a etapa: o formulário se opera só pelo teclado', async () => {
    renderizar();
    await preencherDados();

    await userEvent.type(screen.getByLabelText(/Nome completo/u), '{Enter}');

    expect(await screen.findByRole('group', { name: 'Papéis' })).toBeInTheDocument();
  });
});

describe('papéis personalizados na etapa de papéis (SPEC-008 §3.4)', () => {
  const REVISOR = papelDeTeste({ id: 'p-revisor', nome: 'Revisor fiscal', papelBase: 'contador', descricao: 'Confere guias' });
  const CONFERENTE = papelDeTeste({ id: 'p-conferente', nome: 'Conferente', papelBase: 'auxiliar' });

  it('oferece os papéis personalizados ativos num segundo grupo, com a descrição ou a base', async () => {
    papeisAtivos = [REVISOR, CONFERENTE];

    renderizar();
    await irParaPapeis();

    const grupo = await screen.findByRole('group', { name: 'Papéis personalizados' });

    expect(within(grupo).getByRole('checkbox', { name: 'Revisor fiscal' })).toHaveAccessibleDescription(
      'Confere guias',
    );
    expect(within(grupo).getByRole('checkbox', { name: 'Conferente' })).toHaveAccessibleDescription(
      'Baseado em Auxiliar.',
    );
    expect(screen.getByRole('group', { name: 'Papéis padrão' })).toBeInTheDocument();
  });

  it('só os ativos são pedidos ao servidor: papel arquivado não pode ser atribuído', async () => {
    papeisAtivos = [REVISOR];

    renderizar();
    await irParaPapeis();
    await screen.findByRole('checkbox', { name: 'Revisor fiscal' });

    const consulta = chamadas.find((c) => c.url.includes('/papeis?'))?.url ?? '';

    expect(consulta).toContain('estado=ATIVO');
    expect(consulta).toContain('limite=100');
  });

  it('papel padrão e personalizado se combinam, e o envio leva os dois', async () => {
    papeisAtivos = [REVISOR, CONFERENTE];

    renderizar();
    await irParaPapeis();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Revisor fiscal' }));
    await enviar();

    await waitFor(() => expect(envios()).toHaveLength(1));

    expect(envios()[0]?.corpo).toMatchObject({
      papeis: ['contador'],
      papeisPersonalizados: ['p-revisor'],
    });
  });

  it('só um papel personalizado já basta: a regra é ao menos um papel, de qualquer tipo', async () => {
    papeisAtivos = [REVISOR];

    renderizar();
    await irParaPapeis();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Revisor fiscal' }));
    await enviar();

    await waitFor(() => expect(envios()).toHaveLength(1));

    expect(envios()[0]?.corpo).toMatchObject({ papeis: [], papeisPersonalizados: ['p-revisor'] });
  });

  it('a revisão do convite lista os papéis personalizados pelo nome', async () => {
    papeisAtivos = [REVISOR];

    renderizar();
    await irParaPapeis();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Auxiliar' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Revisor fiscal' }));

    const revisao = screen.getByRole('region', { name: 'Revisão do convite' });

    expect(revisao).toHaveTextContent('Papéis');
    expect(revisao).toHaveTextContent('Auxiliar, Revisor fiscal');
  });

  it('sem nenhum papel de qualquer tipo o envio continua recusado', async () => {
    papeisAtivos = [REVISOR];

    renderizar();
    await irParaPapeis();
    await screen.findByRole('checkbox', { name: 'Revisor fiscal' });
    await enviar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Selecione ao menos um papel');
    expect(envios()).toHaveLength(0);
  });

  it('sem papel personalizado ativo, o grupo explica e leva à criação', async () => {
    renderizar();
    await irParaPapeis();

    const grupo = await screen.findByRole('group', { name: 'Papéis personalizados' });

    expect(grupo).toHaveTextContent('ainda não tem papéis personalizados ativos');
    expect(within(grupo).getByRole('link', { name: 'Criar papel personalizado' })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios/papeis/novo',
    );
  });

  it('falha ao carregar os personalizados mostra o erro no grupo, sem derrubar os papéis padrão', async () => {
    listaDePapeis = () =>
      json({ type: 'x', title: 'x', status: 500, code: 'ERRO_INTERNO', correlationId: 'corr-ps' }, 500);

    renderizar();
    await irParaPapeis();

    expect(await screen.findByText('corr-ps')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Contador' })).toBeInTheDocument();
  });

  it('as duas listas de papéis não têm violação detectável pelo axe', async () => {
    papeisAtivos = [REVISOR, CONFERENTE];

    const { container } = renderizar();

    await irParaPapeis();
    await screen.findByRole('checkbox', { name: 'Revisor fiscal' });

    expect(await axe(container)).toHaveNoViolations();
  });
});
