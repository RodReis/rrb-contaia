/**
 * Provas de tela da edição de usuário (SPEC-007 §3.3 e §5.1): abas Dados e
 * Papéis, e-mail imutável depois da ativação, proteção do último administrador,
 * leitura sem mutação para o auditor e o retorno do usuário arquivado.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { papelDeTeste, sessaoDe } from '../papeis/papeis.fixtures';
import type { Sessao, VisaoDeUsuario } from './api';
import { EdicaoDeUsuario } from './edicao-de-usuario';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/configuracoes/usuarios/ana',
}));

const ADMIN: Sessao = sessaoDe(['admin_escritorio']);
const AUDITOR: Sessao = sessaoDe(['auditor_readonly']);

const ANA: VisaoDeUsuario = {
  id: 'ana',
  nome: 'Ana Souza',
  email: 'ana@escritorio.com',
  telefone: '11987654321',
  crc: 'SP-123',
  papeis: ['contador'],
  papeisPersonalizados: [],
  estado: 'ATIVO',
  situacao: 'ATIVO',
  conviteExpiraEm: null,
  envioFalhou: false,
  versao: 3,
};

const CONVIDADO: VisaoDeUsuario = {
  ...ANA,
  estado: 'CONVIDADO',
  situacao: 'CONVIDADO',
  conviteExpiraEm: '2026-10-04T12:00:00.000Z',
};

const ARQUIVADO: VisaoDeUsuario = { ...ANA, estado: 'ARQUIVADO', situacao: 'ARQUIVADO' };

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string) =>
  json({ type: 'x', title: 'x', status, code, correlationId: 'corr-9' }, status);

let sessaoAtual: Sessao = ADMIN;
let papeisPersonalizados: ReturnType<typeof papelDeTeste>[] = [];
let usuarioAtual: () => Response | Promise<Response> = () => json(ANA);
let aoSalvar: () => Response | Promise<Response> = () => json(ANA);
const chamadas: Array<{ url: string; metodo: string; corpo: unknown }> = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<EdicaoDeUsuario usuarioId="ana" />, { wrapper: Envolvido });

const salvos = (metodo: string, trecho: string) =>
  chamadas.filter((c) => c.metodo === metodo && c.url.includes(trecho));

beforeEach(() => {
  sessaoAtual = ADMIN;
  papeisPersonalizados = [];
  usuarioAtual = () => json(ANA);
  aoSalvar = () => json(ANA);
  chamadas.length = 0;

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
      if (metodo === 'GET' && endereco.includes('/papeis?')) return json({ papeis: papeisPersonalizados, total: papeisPersonalizados.length });
      if (metodo === 'GET' && endereco.endsWith('/usuarios/ana')) return usuarioAtual();
      if (metodo === 'PUT' || metodo === 'POST') return aoSalvar();

      throw new Error(`rota sem dublê: ${metodo} ${endereco}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('carregamento e erro', () => {
  it('anuncia o carregamento com skeleton', async () => {
    usuarioAtual = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Carregando o usuário')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('usuário inexistente ou de outro escritório mostra a mensagem e volta à lista', async () => {
    usuarioAtual = () => problema(404, 'USUARIO_NAO_ENCONTRADO');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuário não encontrado neste escritório');
    expect(screen.getByRole('link', { name: 'Voltar para a lista' })).toHaveAttribute(
      'href',
      '/configuracoes/usuarios',
    );
  });

  it('erro de servidor traz o correlationId e o botão de tentar de novo', async () => {
    usuarioAtual = () => problema(500, 'ERRO_INTERNO');

    renderizar();

    expect(await screen.findByText('corr-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });
});

describe('abas Dados e Papéis (administrador)', () => {
  it('abre na aba Dados com os valores atuais e o estado do usuário', async () => {
    renderizar();

    expect(await screen.findByRole('heading', { level: 1, name: 'Ana Souza' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome completo/u)).toHaveValue('Ana Souza');
    expect(screen.getByLabelText(/Telefone/u)).toHaveValue('(11) 98765-4321');
    expect(screen.getByLabelText(/Registro no CRC/u)).toHaveValue('SP-123');
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0);
  });

  it('e-mail de usuário ativo é imutável: campo desabilitado, com a explicação', async () => {
    renderizar();

    const email = await screen.findByLabelText(/^E-mail/u);

    expect(email).toBeDisabled();
    expect(email).toHaveValue('ana@escritorio.com');
    expect(screen.getByText(/só pode ser corrigido antes de o convite ser aceito/u)).toBeInTheDocument();
  });

  it('e-mail de usuário que ainda não aceitou o convite pode ser corrigido', async () => {
    usuarioAtual = () => json(CONVIDADO);

    renderizar();

    expect(await screen.findByLabelText(/^E-mail/u)).toBeEnabled();
  });

  it('a aba Papéis mostra os papéis atuais marcados', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));

    expect(await screen.findByRole('checkbox', { name: 'Contador' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Auxiliar' })).not.toBeChecked();
  });

  it('salvar envia dados E papéis juntos e avisa o sucesso sem sair da página', async () => {
    renderizar();

    const nome = await screen.findByLabelText(/Nome completo/u);

    await userEvent.clear(nome);
    await userEvent.type(nome, 'Ana Maria Souza');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));

    expect(salvos('PUT', '/usuarios/ana')[0]?.corpo).toEqual({
      nome: 'Ana Maria Souza',
      telefone: '11987654321',
      crc: 'SP-123',
      papeis: ['contador'],
      papeisPersonalizados: [],
    });
    expect(screen.getByLabelText(/Nome completo/u)).toBeInTheDocument();
  });

  it('trocar papéis e salvar envia a nova união, mantendo os dados', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auxiliar' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auditor (somente leitura)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));

    expect(salvos('PUT', '/usuarios/ana')[0]?.corpo).toMatchObject({
      nome: 'Ana Souza',
      papeis: ['auxiliar', 'auditor_readonly'],
    });
  });

  it('usuário ativo precisa manter ao menos um papel: sem papel não salva', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Selecione ao menos um papel.')).toBeInTheDocument();
    expect(salvos('PUT', '/usuarios/ana')).toHaveLength(0);
  });

  it('dado inválido na aba Dados leva o foco de volta e impede o envio', async () => {
    renderizar();

    const nome = await screen.findByLabelText(/Nome completo/u);

    await userEvent.clear(nome);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Informe o nome completo')).toBeInTheDocument();
    expect(salvos('PUT', '/usuarios/ana')).toHaveLength(0);
  });

  it('último administrador: a proteção aparece num AlertDialog, não como toast', async () => {
    aoSalvar = () => problema(409, 'ULTIMO_ADMIN');

    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('ao menos um administrador ativo');

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Entendi' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('e-mail em uso volta como erro no próprio campo, quando editável', async () => {
    usuarioAtual = () => json(CONVIDADO);
    aoSalvar = () => problema(409, 'EMAIL_JA_UTILIZADO');

    renderizar();

    const email = await screen.findByLabelText(/^E-mail/u);

    await userEvent.clear(email);
    await userEvent.type(email, 'outra@escritorio.com');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Este e-mail já está em uso.')).toBeInTheDocument();
  });

  it('corrigir o e-mail de um convidado envia o e-mail novo', async () => {
    usuarioAtual = () => json(CONVIDADO);

    renderizar();

    const email = await screen.findByLabelText(/^E-mail/u);

    await userEvent.clear(email);
    await userEvent.type(email, 'corrigido@escritorio.com');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));

    expect(salvos('PUT', '/usuarios/ana')[0]?.corpo).toMatchObject({ email: 'corrigido@escritorio.com' });
  });

  it('usuário ativo nunca envia o e-mail no corpo', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));

    expect(salvos('PUT', '/usuarios/ana')[0]?.corpo).not.toHaveProperty('email');
  });
});

describe('auditor só consulta', () => {
  beforeEach(() => {
    sessaoAtual = AUDITOR;
  });

  it('vê os dados, mas todos os campos ficam desabilitados e não há botão de salvar', async () => {
    renderizar();

    expect(await screen.findByLabelText(/Nome completo/u)).toBeDisabled();
    expect(screen.getByLabelText(/Telefone/u)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument();
    expect(screen.getByText(/somente leitura/iu)).toBeInTheDocument();
  });

  it('na aba Papéis as caixas ficam desabilitadas', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));

    expect(await screen.findByRole('checkbox', { name: 'Contador' })).toBeDisabled();
  });

  it('não vê o estado técnico do convite', async () => {
    usuarioAtual = () => json({ ...CONVIDADO, conviteExpiraEm: null, envioFalhou: false });

    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    expect(screen.queryByText(/Convite válido até/u)).not.toBeInTheDocument();
  });
});

describe('usuário arquivado', () => {
  beforeEach(() => {
    usuarioAtual = () => json(ARQUIVADO);
  });

  it('explica que só volta por novo convite e troca Salvar por Enviar novo convite', async () => {
    renderizar();

    expect(await screen.findByText(/revise os dados e os papéis/iu)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar novo convite' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument();
  });

  it('o e-mail continua imutável', async () => {
    renderizar();

    expect(await screen.findByLabelText(/^E-mail/u)).toBeDisabled();
  });

  it('o novo convite leva os dados e papéis revisados, sem e-mail', async () => {
    renderizar();

    const nome = await screen.findByLabelText(/Nome completo/u);

    await userEvent.clear(nome);
    await userEvent.type(nome, 'Ana Revisada');
    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Auxiliar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar novo convite' }));

    await waitFor(() => expect(salvos('POST', '/usuarios/ana/novo-convite')).toHaveLength(1));

    expect(salvos('POST', '/usuarios/ana/novo-convite')[0]?.corpo).toEqual({
      nome: 'Ana Revisada',
      telefone: '11987654321',
      crc: 'SP-123',
      papeis: ['contador', 'auxiliar'],
      papeisPersonalizados: [],
    });
  });

  it('sem papel revisado não há novo convite', async () => {
    renderizar();
    await screen.findByLabelText(/Nome completo/u);

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar novo convite' }));

    expect(await screen.findByText('Selecione ao menos um papel.')).toBeInTheDocument();
    expect(salvos('POST', '/novo-convite')).toHaveLength(0);
  });
});

describe('acessibilidade', () => {
  it('as duas abas não têm violação detectável pelo axe', async () => {
    const { container } = renderizar();
    await screen.findByLabelText(/Nome completo/u);
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole('tab', { name: 'Papéis' }));
    await screen.findByRole('checkbox', { name: 'Contador' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a visão do auditor não tem violação detectável pelo axe', async () => {
    sessaoAtual = AUDITOR;

    const { container } = renderizar();
    await screen.findByLabelText(/Nome completo/u);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('papéis personalizados do usuário (SPEC-008 §3.4)', () => {
  const REVISOR = papelDeTeste({ id: 'p-revisor', nome: 'Revisor fiscal', papelBase: 'contador' });
  const CONFERENTE = papelDeTeste({ id: 'p-conferente', nome: 'Conferente', papelBase: 'auxiliar' });

  const comRevisor: VisaoDeUsuario = {
    ...ANA,
    papeisPersonalizados: [{ id: 'p-revisor', nome: 'Revisor fiscal', estado: 'ATIVO' }],
  };

  beforeEach(() => {
    papeisPersonalizados = [REVISOR, CONFERENTE];
  });

  it('a aba Papéis mostra os personalizados ativos, com os atuais marcados', async () => {
    usuarioAtual = () => json(comRevisor);

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));

    expect(await screen.findByRole('checkbox', { name: 'Revisor fiscal' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Conferente' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Contador' })).toBeChecked();
  });

  it('trocar o papel personalizado e salvar envia os identificadores, mantendo os padrão', async () => {
    usuarioAtual = () => json(comRevisor);

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Revisor fiscal' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Conferente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));

    expect(salvos('PUT', '/usuarios/ana')[0]?.corpo).toMatchObject({
      papeis: ['contador'],
      papeisPersonalizados: ['p-conferente'],
    });
  });

  it('o usuário pode ficar só com papel personalizado, tirando o padrão', async () => {
    usuarioAtual = () => json(comRevisor);

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));

    expect(salvos('PUT', '/usuarios/ana')[0]?.corpo).toMatchObject({
      papeis: [],
      papeisPersonalizados: ['p-revisor'],
    });
  });

  it('sem nenhum papel de qualquer tipo não salva', async () => {
    usuarioAtual = () => json(comRevisor);

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Contador' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Revisor fiscal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Selecione ao menos um papel');
    expect(salvos('PUT', '/usuarios/ana')).toHaveLength(0);
  });

  it('papel personalizado arquivado ainda vinculado não é oferecido nem reenviado ao salvar', async () => {
    usuarioAtual = () =>
      json({
        ...ARQUIVADO,
        papeisPersonalizados: [{ id: 'p-antigo', nome: 'Papel antigo', estado: 'ARQUIVADO' }],
      });

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));

    expect(screen.queryByRole('checkbox', { name: 'Papel antigo' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar novo convite' }));

    await waitFor(() => expect(salvos('POST', '/usuarios/ana/novo-convite')).toHaveLength(1));

    expect(salvos('POST', '/usuarios/ana/novo-convite')[0]?.corpo).toMatchObject({
      papeisPersonalizados: [],
    });
  });

  it('papel arquivado recusado pelo servidor mantém a tela e o que foi escolhido, sem sair da página', async () => {
    usuarioAtual = () => json(comRevisor);
    aoSalvar = () => problema(409, 'PAPEL_ARQUIVADO');

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Conferente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(salvos('PUT', '/usuarios/ana')).toHaveLength(1));
    expect(screen.getByRole('tab', { name: 'Papéis' })).toBeInTheDocument();
  });

  it('o auditor vê os personalizados, mas as caixas ficam desabilitadas', async () => {
    sessaoAtual = AUDITOR;
    usuarioAtual = () => json(comRevisor);

    renderizar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));

    const revisor = await screen.findByRole('checkbox', { name: 'Revisor fiscal' });

    expect(revisor).toBeChecked();
    expect(revisor).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Criar papel personalizado' })).not.toBeInTheDocument();
  });

  it('a aba Papéis com personalizados não tem violação detectável pelo axe', async () => {
    usuarioAtual = () => json(comRevisor);

    const { container } = renderizar();

    await userEvent.click(await screen.findByRole('tab', { name: 'Papéis' }));
    await screen.findByRole('checkbox', { name: 'Revisor fiscal' });

    expect(await axe(container)).toHaveNoViolations();
  });
});
