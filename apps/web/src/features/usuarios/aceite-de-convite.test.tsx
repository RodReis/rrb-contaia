/**
 * Provas de tela do aceite público do convite (SPEC-007 §3.2): quem chega só
 * tem um link, define a senha e entra. O link inválido responde sempre igual.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AceiteDeConvite } from './aceite-de-convite';

const TOKEN = 'a'.repeat(43);

const json = (corpo: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, code: string) =>
  json({ type: 'x', title: 'x', status, code, correlationId: 'corr-7' }, status);

const CONVITE = {
  nome: 'Ana Souza',
  emailMascarado: 'a***@escritorio.com',
  expiraEm: '2026-10-04T15:30:00.000Z',
};

let consulta: () => Response | Promise<Response> = () => json(CONVITE);
let aceite: () => Response | Promise<Response> = () => json(null, 204);
const chamadas: Array<{ url: string; metodo: string; corpo: unknown; credenciais: string | undefined }> = [];

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<AceiteDeConvite token={TOKEN} />, { wrapper: Envolvido });

const SENHA = 'senha-bem-longa-123';

const preencher = async (senha = SENHA, confirmacao = SENHA): Promise<void> => {
  await userEvent.type(await screen.findByLabelText(/^Nova senha/u), senha);
  await userEvent.type(screen.getByLabelText(/^Confirme a senha/u), confirmacao);
};

const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Definir senha e entrar' }));

const aceites = () => chamadas.filter((c) => c.metodo === 'POST');

beforeEach(() => {
  consulta = () => json(CONVITE);
  aceite = () => json(null, 204);
  chamadas.length = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';

      chamadas.push({
        url: String(url),
        metodo,
        corpo: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
        credenciais: new Headers(init?.headers).get('authorization') ?? undefined,
      });

      if (metodo === 'GET' && String(url) === `/api/publico/convites/${TOKEN}`) return consulta();
      if (metodo === 'POST' && String(url) === '/api/publico/convites/aceitar') return aceite();

      throw new Error(`rota sem dublê: ${metodo} ${String(url)}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('consulta do convite', () => {
  it('anuncia o carregamento com skeleton', async () => {
    consulta = () => new Promise<Response>(() => undefined);

    const { container } = renderizar();

    expect(await screen.findByText('Verificando o seu convite')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('cumprimenta pelo nome e confirma o e-mail mascarado e a validade em horário de São Paulo', async () => {
    renderizar();

    expect(await screen.findByRole('heading', { level: 1, name: 'Defina a sua senha' })).toBeInTheDocument();
    expect(screen.getByText(/Olá, Ana Souza/u)).toBeInTheDocument();
    expect(screen.getByText('a***@escritorio.com')).toBeInTheDocument();
    // 2026-10-04T15:30Z = 04/10/2026 12:30 em America/Sao_Paulo (I-11).
    expect(screen.getByText(/04\/10\/2026/u)).toBeInTheDocument();
    expect(screen.getByText(/12:30/u)).toBeInTheDocument();
  });

  it('não envia nenhuma credencial na consulta: o link é tudo o que a pessoa tem', async () => {
    renderizar();
    await screen.findByLabelText(/^Nova senha/u);

    expect(chamadas[0]?.credenciais).toBeUndefined();
    expect(chamadas[0]?.url).toBe(`/api/publico/convites/${TOKEN}`);
  });

  it('link inválido (qualquer motivo) mostra a mesma orientação, sem dizer por quê e sem formulário', async () => {
    consulta = () => problema(404, 'CONVITE_INVALIDO');

    renderizar();

    const alerta = await screen.findByRole('alert');

    expect(alerta).toHaveTextContent('Este convite não é válido');
    expect(alerta).toHaveTextContent('novo link');
    expect(alerta).not.toHaveTextContent(/expirou|usado|invalidado/iu);
    expect(screen.queryByLabelText(/^Nova senha/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('excesso de tentativas (429) pede para aguardar', async () => {
    consulta = () => problema(429, 'HTTP_429');

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas');
  });

  it('servidor fora traz o código de suporte', async () => {
    consulta = () => problema(502, 'FALHA_DE_REDE');

    renderizar();

    expect(await screen.findByText('corr-7')).toBeInTheDocument();
  });
});

describe('definição da senha', () => {
  it('senha curta é recusada no campo, sem chamar a API e sem desabilitar o botão', async () => {
    renderizar();
    await preencher('curta', 'curta');
    await enviar();

    expect(await screen.findByText('A senha precisa ter ao menos 10 caracteres.')).toBeInTheDocument();
    expect(aceites()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Definir senha e entrar' })).toBeEnabled();
  });

  it('confirmação diferente da senha é recusada no campo da confirmação', async () => {
    renderizar();
    await preencher(SENHA, 'outra-senha-longa-1');
    await enviar();

    expect(await screen.findByText('As senhas não conferem.')).toBeInTheDocument();
    expect(aceites()).toHaveLength(0);
  });

  it('envia token e senha pela rota pública e mostra a conclusão com o caminho para entrar', async () => {
    renderizar();
    await preencher();
    await enviar();

    await waitFor(() => expect(aceites()).toHaveLength(1));

    expect(aceites()[0]?.corpo).toEqual({ token: TOKEN, senha: SENHA });
    expect(aceites()[0]?.credenciais).toBeUndefined();

    expect(await screen.findByRole('heading', { level: 1, name: 'Senha definida' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar no ContaIA' })).toHaveAttribute(
      'href',
      '/api/auth/entrar?destino=%2Fempresas',
    );
    expect(screen.queryByLabelText(/^Nova senha/u)).not.toBeInTheDocument();
  });

  it('senha recusada pela política do servidor volta ao campo e mantém o convite utilizável', async () => {
    aceite = () => problema(422, 'SENHA_FRACA');

    renderizar();
    await preencher();
    await enviar();

    expect(await screen.findByText(/não atende à política de segurança/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nova senha/u)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Definir senha e entrar' })).toBeEnabled();
  });

  it('convite que deixou de valer entre a consulta e o envio troca a tela pela orientação', async () => {
    aceite = () => problema(404, 'CONVITE_INVALIDO');

    renderizar();
    await preencher();
    await enviar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Este convite não é válido');
    expect(screen.queryByLabelText(/^Nova senha/u)).not.toBeInTheDocument();
  });

  it('Keycloak fora mantém o formulário preenchido para tentar de novo', async () => {
    aceite = () => problema(503, 'IDENTIDADE_INDISPONIVEL');

    renderizar();
    await preencher();
    await enviar();

    await waitFor(() => expect(aceites()).toHaveLength(1));

    expect(await screen.findByRole('button', { name: 'Definir senha e entrar' })).toBeEnabled();
    expect(screen.getByLabelText(/^Nova senha/u)).toHaveValue(SENHA);
  });

  it('enquanto envia, o botão fica desabilitado: não há segundo envio', async () => {
    let concluir: () => void = () => undefined;

    aceite = () =>
      new Promise<Response>((resolver) => {
        concluir = () => resolver(json(null, 204));
      });

    renderizar();
    await preencher();
    await enviar();

    expect(await screen.findByRole('button', { name: 'Enviando…' })).toBeDisabled();

    concluir();
    await screen.findByRole('heading', { name: 'Senha definida' });
    expect(aceites()).toHaveLength(1);
  });

  it('Enter na confirmação envia: o formulário se opera só pelo teclado', async () => {
    renderizar();
    await preencher();

    await userEvent.type(screen.getByLabelText(/^Confirme a senha/u), '{Enter}');

    await waitFor(() => expect(aceites()).toHaveLength(1));
  });
});

describe('acessibilidade', () => {
  it('o formulário não tem violação detectável pelo axe', async () => {
    const { container } = renderizar();
    await screen.findByLabelText(/^Nova senha/u);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o convite inválido e a conclusão não têm violação detectável pelo axe', async () => {
    consulta = () => problema(404, 'CONVITE_INVALIDO');
    const invalido = renderizar();
    await screen.findByRole('alert');
    expect(await axe(invalido.container)).toHaveNoViolations();
    invalido.unmount();

    consulta = () => json(CONVITE);
    const concluido = renderizar();
    await preencher();
    await enviar();
    await screen.findByRole('heading', { name: 'Senha definida' });
    expect(await axe(concluido.container)).toHaveNoViolations();
  });
});
