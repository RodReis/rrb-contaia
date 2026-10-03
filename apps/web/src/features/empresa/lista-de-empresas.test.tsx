/**
 * Provas de tela da listagem de empresas (TESTING.md §3.5, SPEC-002 §10).
 *
 * A API é dublada no nível do `fetch`: o que se prova aqui é a tela — os quatro
 * estados, os três vazios distintos, filtro na URL e acessibilidade — não o
 * backend.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListaDeEmpresas } from './lista-de-empresas';
import type { ListaDeEmpresas as Resposta } from './api';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

const empresa = {
  id: 'empresa-1',
  cnpj: '11222333000181',
  razaoSocial: 'Padaria Aurora Comércio de Alimentos LTDA',
  nomeFantasia: 'Padaria Aurora',
  regimeTributario: 'SIMPLES_NACIONAL',
  status: 'ATIVA',
  situacao: 'ativo',
  pendenciasAbertas: 0,
} as const;

const comEmpresas: Resposta = { empresas: [empresa], total: 1 };
const vazio: Resposta = { empresas: [], total: 0 };

const respostaJson = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderizar = () => render(<ListaDeEmpresas />, { wrapper: Envolvido });

const responderCom = (...respostas: Response[]): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  for (const resposta of respostas) {
    mock.mockResolvedValueOnce(resposta);
  }
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  substituir.mockClear();
  vi.stubGlobal('fetch', vi.fn());

  // O Radix usa APIs de ponteiro e de layout que o jsdom não implementa. Sem
  // estes dublês o `Select` monta mas nunca abre, e o teste falharia por
  // limitação do ambiente, não por defeito da tela.
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

describe('estado de carregamento', () => {
  it('anuncia o carregamento com skeleton, não spinner', () => {
    responderCom(respostaJson(comEmpresas));

    const { container } = renderizar();

    expect(screen.getByText('Carregando as empresas do escritório')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('estado de erro', () => {
  it('mostra a falha em linguagem de usuário com o correlationId copiável', async () => {
    responderCom(
      respostaJson(
        {
          type: 'https://contaia.local/erros/interno',
          title: 'falha',
          status: 500,
          code: 'ERRO_INTERNO',
          correlationId: 'corr-987',
        },
        500,
      ),
    );

    renderizar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as empresas',
    );
    expect(screen.getByText('corr-987')).toBeInTheDocument();
  });
});

describe('estado vazio', () => {
  it('sem nenhuma empresa, oferece o CTA funcional de cadastro', async () => {
    responderCom(respostaJson(vazio));

    renderizar();

    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Cadastrar empresa/u }).length).toBeGreaterThan(0);
  });

  it('com filtro ativo, o vazio é outro: fala de filtro e oferece limpar', async () => {
    // As três causas do vazio têm textos distintos (PATTERNS.md §5): tratar
    // "filtro sem resultado" como "nunca houve dado" é bug de UX.
    parametrosAtuais = new URLSearchParams({ busca: 'inexistente' });
    responderCom(respostaJson(vazio));

    renderizar();

    expect(await screen.findByText('Nenhuma empresa encontrada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });
});

describe('listagem', () => {
  it('mostra a contagem total do universo e os dados da empresa', async () => {
    responderCom(respostaJson({ empresas: [empresa], total: 488 }));

    renderizar();

    expect(await screen.findByText('488 empresas na carteira deste escritório.')).toBeInTheDocument();
    // CNPJ com máscara de apresentação e em fonte mono tabular.
    expect(screen.getAllByText('11.222.333/0001-81').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Simples Nacional').length).toBeGreaterThan(0);
  });

  it('empresa ativa abre e incompleta oferece continuar cadastro', async () => {
    responderCom(
      respostaJson({
        empresas: [empresa, { ...empresa, id: 'empresa-2', status: 'CADASTRO_INCOMPLETO' }],
        total: 2,
      }),
    );

    renderizar();

    expect((await screen.findAllByRole('link', { name: 'Abrir' })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Continuar cadastro' }).length).toBeGreaterThan(0);
  });

  it('status aparece com rótulo textual, não só cor', async () => {
    responderCom(respostaJson(comEmpresas));

    renderizar();

    // Cor nunca é o único sinal (COMPONENTS.md §3.4).
    expect((await screen.findAllByText('Ativa')).length).toBeGreaterThan(0);
  });

  it('a tabela tem legenda acessível', async () => {
    responderCom(respostaJson(comEmpresas));

    renderizar();

    await screen.findByRole('table');
    expect(
      screen.getByText(/Empresas clientes deste escritório, com CNPJ/u),
    ).toBeInTheDocument();
  });
});

describe('filtro na URL', () => {
  it('publica a busca na URL depois do debounce, não a cada tecla', async () => {
    const usuario = userEvent.setup();
    responderCom(respostaJson(comEmpresas), respostaJson(comEmpresas));

    renderizar();
    await screen.findByRole('table');

    await usuario.type(screen.getByLabelText(/Buscar/u), 'Aurora');

    // Antes do debounce a URL não mudou: cada tecla empilharia histórico.
    expect(substituir).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(substituir).toHaveBeenCalledWith('/empresas?busca=Aurora', { scroll: false });
      },
      { timeout: 2000 },
    );
  });

  it('trocar o filtro de situação volta para a primeira página', async () => {
    const usuario = userEvent.setup();
    parametrosAtuais = new URLSearchParams({ pagina: '3' });
    responderCom(respostaJson(comEmpresas), respostaJson(comEmpresas));

    renderizar();
    await screen.findByRole('table');

    // Operado por teclado de propósito: o filtro precisa funcionar sem mouse
    // (FRONTEND.md §20) e é o caminho que o Radix suporta em jsdom.
    const seletor = screen.getByRole('combobox', { name: /Situação/u });
    seletor.focus();
    await usuario.keyboard('{Enter}');
    await usuario.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    // Duas setas a partir de `Ativas` chegam em `Arquivadas` (SPEC-003 §3.1).
    // Manter a página 3 de um resultado que encolheu mostraria vazio por engano.
    expect(substituir).toHaveBeenCalledWith('/empresas?status=ARQUIVADA', {
      scroll: false,
    });
  });

  it('a busca é enviada ao servidor, não filtrada no cliente', async () => {
    parametrosAtuais = new URLSearchParams({ busca: 'Aurora', status: 'ATIVA' });
    responderCom(respostaJson(comEmpresas));

    renderizar();
    await screen.findByRole('table');

    const chamada = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(String(chamada)).toContain('busca=Aurora');
    expect(String(chamada)).toContain('status=ATIVA');
    expect(String(chamada)).toContain('limite=25');
  });
});

describe('usuário sem carteira (SPEC-007 §3.1)', () => {
  const semCarteira: Resposta = { empresas: [], total: 0, escopoDeEmpresas: 'NENHUMA' };

  it('explica a ausência de alçada em vez de convidar a cadastrar a primeira empresa', async () => {
    responderCom(respostaJson(semCarteira));

    renderizar();

    expect(await screen.findByText('Você ainda não tem empresas na sua carteira')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma empresa cadastrada')).not.toBeInTheDocument();
  });

  it('não oferece cadastrar empresa: a API recusaria e a empresa ficaria órfã', async () => {
    responderCom(respostaJson(semCarteira));

    renderizar();
    await screen.findByText('Você ainda não tem empresas na sua carteira');

    expect(screen.queryByRole('link', { name: /Cadastrar empresa/u })).not.toBeInTheDocument();
  });

  it('o estado de ausência de alçada não tem violação detectável pelo axe', async () => {
    responderCom(respostaJson(semCarteira));

    const { container } = renderizar();
    await screen.findByText('Você ainda não tem empresas na sua carteira');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o administrador com carteira vazia continua vendo o convite ao primeiro cadastro', async () => {
    responderCom(respostaJson(vazio));

    renderizar();

    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();
  });
});

describe('acessibilidade', () => {
  it('a listagem não tem violação detectável pelo axe', async () => {
    responderCom(respostaJson(comEmpresas));

    const { container } = renderizar();
    await screen.findByRole('table');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o estado vazio não tem violação detectável pelo axe', async () => {
    responderCom(respostaJson(vazio));

    const { container } = renderizar();
    await screen.findByText('Nenhuma empresa cadastrada');

    expect(await axe(container)).toHaveNoViolations();
  });
});
