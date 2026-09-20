/**
 * Provas de tela do cadastro do escritório (TESTING.md §3.5).
 *
 * A API é dublada no nível do `fetch`: o que se prova aqui é a tela — estados,
 * validação, máscara, acessibilidade — não o backend.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WizardDoEscritorio } from './wizard';
import type { VisaoDoCadastro } from './api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const cadastroVazio: VisaoDoCadastro = {
  cadastro: {
    status: 'CADASTRO_INCOMPLETO',
    identificacao: null,
    responsavel: null,
    enderecoPrincipal: null,
    documentosArquivoIds: [],
    versao: 0,
  },
  etapasConcluidas: [],
  proximaEtapa: 'identificacao',
  enderecos: [],
  arquivos: [],
};

const cadastroAtivo: VisaoDoCadastro = {
  cadastro: {
    status: 'ATIVO',
    identificacao: {
      cnpj: '11222333000181',
      razaoSocial: 'Escritório Contábil Exemplo LTDA',
      logoArquivoId: 'arq-logo',
    },
    responsavel: {
      nomeCompleto: 'Maria Souza',
      cpf: '52998224725',
      crc: '1SP123456/O-5',
      email: 'maria@escritorio.cnt.br',
      telefone: '11987654321',
    },
    enderecoPrincipal: {
      cep: '01310100',
      logradouro: 'Avenida Paulista',
      numero: '1000',
      complemento: null,
      bairro: 'Bela Vista',
      municipio: 'São Paulo',
      uf: 'SP',
    },
    documentosArquivoIds: ['arq-doc'],
    versao: 5,
  },
  etapasConcluidas: ['identificacao', 'responsavel', 'endereco', 'documentos', 'revisao'],
  proximaEtapa: null,
  enderecos: [],
  arquivos: [
    {
      id: 'arq-logo',
      tipo: 'LOGO',
      nomeOriginal: 'logo.png',
      tipoConteudo: 'image/png',
      tamanhoBytes: 2048,
    },
    {
      id: 'arq-doc',
      tipo: 'DOCUMENTO',
      nomeOriginal: 'contrato-social.pdf',
      tipoConteudo: 'application/pdf',
      tamanhoBytes: 4096,
    },
  ],
};

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

const renderizar = () => render(<WizardDoEscritorio />, { wrapper: Envolvido });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const responderCom = (...respostas: Response[]): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  for (const resposta of respostas) {
    mock.mockResolvedValueOnce(resposta);
  }
};

describe('estado de carregamento', () => {
  it('anuncia o carregamento antes de a resposta chegar', () => {
    responderCom(respostaJson(cadastroVazio));

    const { container } = renderizar();

    expect(screen.getByText('Carregando o cadastro do escritório')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('estado de erro', () => {
  it('mostra a falha em linguagem de usuário com o correlationId copiável', async () => {
    responderCom(
      respostaJson(
        {
          type: 'https://contaia.local/erros/interno',
          title: 'Falha interna',
          status: 500,
          code: 'ERRO_INTERNO',
          correlationId: 'corr-123',
        },
        500,
      ),
    );

    renderizar();

    const alerta = await screen.findByRole('alert');

    expect(within(alerta).getByText('Não foi possível carregar o cadastro')).toBeInTheDocument();
    expect(within(alerta).getByText('corr-123')).toBeInTheDocument();
    // A mensagem crua do backend não é exibida (FRONTEND.md §14).
    expect(screen.queryByText('Falha interna')).not.toBeInTheDocument();
  });
});

describe('wizard de conclusão', () => {
  it('abre na primeira etapa incompleta e identifica a situação sem depender de cor', async () => {
    responderCom(respostaJson(cadastroVazio));

    renderizar();

    const passos = await screen.findByRole('navigation', { name: 'Etapas do cadastro' });

    expect(within(passos).getByText('Identificação')).toBeInTheDocument();
    expect(within(passos).getAllByText('pendente')).toHaveLength(4);
    expect(within(passos).getByText('etapa atual')).toBeInTheDocument();
    expect(
      within(passos).getByRole('button', { name: /Identificação/ }),
    ).toHaveAttribute('aria-current', 'step');
  });

  it('recusa CNPJ inválido no próprio campo, sem enviar à API', async () => {
    responderCom(respostaJson(cadastroVazio));

    const usuario = userEvent.setup();

    renderizar();

    const cnpj = await screen.findByLabelText(/CNPJ do escritório/);

    await usuario.type(cnpj, '11222333000182');
    await usuario.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    expect(await screen.findByText('CNPJ inválido')).toBeInTheDocument();
    expect(cnpj).toHaveAttribute('aria-invalid', 'true');
    // Só a carga inicial: a etapa inválida não chega a ser enviada.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('aplica máscara de CNPJ mantendo o valor cru no envio', async () => {
    responderCom(respostaJson(cadastroVazio), respostaJson(cadastroVazio));

    const usuario = userEvent.setup();

    renderizar();

    const cnpj = await screen.findByLabelText(/CNPJ do escritório/);

    await usuario.type(cnpj, '11222333000181');
    await usuario.type(screen.getByLabelText(/Razão social/), 'Escritório Exemplo');

    expect(cnpj).toHaveValue('11.222.333/0001-81');

    await usuario.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const corpo = JSON.parse(String(mock.mock.calls[1]?.[1]?.body)) as { cnpj: string };

    // O estado guarda o dígito; a máscara é apresentação (FRONTEND.md §9).
    expect(corpo.cnpj).toBe('11222333000181');
  });

  it('não tem violação de acessibilidade', async () => {
    responderCom(respostaJson(cadastroVazio));

    const { container } = renderizar();

    await screen.findByRole('navigation', { name: 'Etapas do cadastro' });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('cadastro ativo', () => {
  it('mostra as quatro abas de edição e não reabre o wizard', async () => {
    responderCom(respostaJson(cadastroAtivo));

    renderizar();

    const abas = await screen.findByRole('tablist', {
      name: 'Seções do cadastro do escritório',
    });

    expect(within(abas).getAllByRole('tab').map((aba) => aba.textContent)).toEqual([
      'Identificação',
      'Responsável',
      'Endereços',
      'Arquivos',
    ]);

    expect(
      screen.queryByRole('navigation', { name: 'Etapas do cadastro' }),
    ).not.toBeInTheDocument();
  });

  it('não tem violação de acessibilidade na edição por abas', async () => {
    responderCom(respostaJson(cadastroAtivo));

    const { container } = renderizar();

    await screen.findByRole('tablist', { name: 'Seções do cadastro do escritório' });

    expect(await axe(container)).toHaveNoViolations();
  });
});
