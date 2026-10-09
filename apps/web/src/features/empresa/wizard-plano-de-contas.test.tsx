/**
 * Etapa final opcional do cadastro: o plano de contas, logo depois da ativação (SPEC-013 §3.1,
 * §5.2). Empresa em `CADASTRO_INCOMPLETO` não está em carteira nem guarda dado operacional, então
 * o plano só pode ser importado depois de ativar: a etapa aparece na tela que sucede a ativação,
 * reaproveita o fluxo da aba "Plano de contas" e nunca bloqueia nada.
 *
 * A porta de entrada (`PaginaDaEmpresa`) é a unidade provada, porque é ela que troca o wizard pela
 * manutenção quando a empresa vira ATIVA — e é nessa troca que a etapa precisa sobreviver.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SO_CONSULTA,
  TENTATIVA,
  conta,
  criarBackend,
  desinstalarDownloads,
  instalarFetch,
  json,
  navegacao,
  previa,
  problema,
} from '../plano-contas/plano-contas.fixtures';
import type { VisaoDaEmpresa } from './api';
import { PaginaDaEmpresa } from './pagina-da-empresa';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('../plano-contas/plano-contas.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

const EMPRESA = 'empresa-1';

const visao = (status: 'CADASTRO_INCOMPLETO' | 'ATIVA'): VisaoDaEmpresa => ({
  id: EMPRESA,
  situacao: 'ativo',
  cadastro: {
    status,
    identificacao: {
      cnpj: '11222333000181',
      razaoSocial: 'Padaria Aurora Comércio de Alimentos LTDA',
      nomeFantasia: 'Padaria Aurora',
      logoArquivoId: null,
      telefone: '1133224455',
      email: 'contato@padariaaurora.com.br',
    },
    dadosFiscais: {
      regimeTributario: 'SIMPLES_NACIONAL',
      enquadramentoSimples: 'NAO_MEI',
      cnaePrincipal: '1091102',
      cnaesSecundarios: [],
      inscricaoEstadual: { situacao: 'ISENTO', numero: null },
      inscricaoMunicipal: { situacao: 'ISENTO', numero: null },
    },
    enderecoPrincipal: null,
    situacaoCadastralExterna: 'Ativa',
    validadoPorFonteExterna: true,
    versao: 3,
  },
  etapasConcluidas: ['identificacao', 'fiscal', 'endereco', 'revisao'],
  proximaEtapa: null,
  podeAtivar: status === 'CADASTRO_INCOMPLETO',
  exigeConfirmacaoDeSituacaoExterna: false,
});

let backend = criarBackend();
let cliente = new QueryClient();
let sessaoFalha = false;
let empresaNoServidor: VisaoDaEmpresa = visao('CADASTRO_INCOMPLETO');
let ativar: () => Response | Promise<Response> = () => {
  empresaNoServidor = visao('ATIVA');

  return json(empresaNoServidor);
};

const Provedor = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
);

/** Empresa, plano de contas e pendências dublados no mesmo `fetch`. */
const instalarApi = (): void => {
  instalarFetch((url, init) => {
    const metodo = init?.method ?? 'GET';

    if (url === `/api/proxy/empresas/${EMPRESA}` && metodo === 'GET') {
      return json(empresaNoServidor);
    }
    if (url === `/api/proxy/empresas/${EMPRESA}/ativar` && metodo === 'POST') {
      return ativar();
    }
    if (url.includes('/api/proxy/pendencias')) {
      return json({ pendencias: [], total: 0 });
    }
    if (sessaoFalha && url.endsWith('/api/proxy/usuarios/eu')) {
      return problema(503, 'FALHA_TECNICA', {}, 'corr-sessao-503');
    }

    return backend.roteador(url, init);
  });
};

const abrirPagina = () => render(<PaginaDaEmpresa empresaId={EMPRESA} />, { wrapper: Provedor });

const ativarEmpresa = async (usuario: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await usuario.click(await screen.findByRole('button', { name: 'Ativar empresa' }));
};

const tituloDaEtapa = (): Promise<HTMLElement> =>
  screen.findByRole('heading', { level: 2, name: 'Plano de contas' });

const foiPara = (destino: string): boolean => navegacao.push.mock.calls.some(([alvo]) => alvo === destino);

beforeEach(() => {
  vi.clearAllMocks();
  navegacao.definir('');
  backend = criarBackend();
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  empresaNoServidor = visao('CADASTRO_INCOMPLETO');
  sessaoFalha = false;
  ativar = () => {
    empresaNoServidor = visao('ATIVA');

    return json(empresaNoServidor);
  };
  instalarApi();
});

afterEach(() => {
  desinstalarDownloads();
});

describe('depois da ativação', () => {
  it('fica na página e mostra a etapa final opcional, sem navegar para a lista', async () => {
    const usuario = userEvent.setup();
    const { container } = abrirPagina();

    await ativarEmpresa(usuario);

    const titulo = await tituloDaEtapa();
    expect(toast.success).toHaveBeenCalledWith('Empresa ativada.');
    expect(foiPara('/empresas')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Ativar empresa' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Padaria Aurora' })).toBeInTheDocument();
    expect(within(titulo.closest('section') ?? container).getByText('Etapa opcional')).toBeInTheDocument();
    expect(screen.getByText(/A empresa já está ativa/u)).toBeInTheDocument();
    expect(screen.getByText(/aba Plano de contas desta empresa/u)).toBeInTheDocument();
    expect(screen.getByText(/pendência Plano de contas incompleto continua visível na Central de Pendências/u)).toBeInTheDocument();
  });

  it('move o foco para o título da etapa', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);

    const titulo = await tituloDaEtapa();
    await waitFor(() => expect(titulo).toHaveFocus());
  });

  it('reaproveita o fluxo de importação da aba, sem repetir o título', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);

    await tituloDaEtapa();
    expect(await screen.findByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
    expect(screen.getByLabelText('Arquivo CSV do plano de contas')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2, name: 'Plano de contas' })).toHaveLength(1);
  });

  it('mostra os quatro passos do cadastro concluídos e o plano de contas como passo opcional atual', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();

    const passos = within(screen.getByRole('navigation', { name: 'Etapas do cadastro' })).getAllByRole('listitem');
    expect(passos).toHaveLength(5);
    passos.slice(0, 4).forEach((passo) => expect(passo).toHaveTextContent('concluída'));
    expect(passos[4]).toHaveTextContent('Plano de contas (opcional)');
    expect(passos[4]).toHaveTextContent('etapa atual');
    expect(passos[4]?.querySelector('[aria-current="step"]')).not.toBeNull();
  });

  it('atualiza as pendências e as empresas para a pendência do plano aparecer', async () => {
    const usuario = userEvent.setup();
    const invalidar = vi.spyOn(cliente, 'invalidateQueries');
    abrirPagina();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();

    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['pendencias'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['empresas'] });
  });

  it('não tem violações de acessibilidade', async () => {
    const usuario = userEvent.setup();
    const { container } = abrirPagina();

    await ativarEmpresa(usuario);
    await screen.findByRole('button', { name: 'Escolher arquivo CSV' });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('seguir sem importar', () => {
  it('"Continuar sem importar" leva para a lista de empresas', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);
    await usuario.click(await screen.findByRole('button', { name: 'Continuar sem importar' }));

    expect(foiPara('/empresas')).toBe(true);
  });

  it('com a validação em andamento ou aguardando confirmação, o caminho segue sendo "Continuar sem importar"', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();
    backend.estado.tentativa = previa();
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);

    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar sem importar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument();
  });
});

describe('importação terminada', () => {
  it('concluída: oferece "Concluir", tira a promessa da pendência e leva para a lista', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();
    backend.estado.tentativa = previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' });
    // O servidor já tem as contas da importação concluída.
    backend.estado.contas = [conta()];
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);

    const concluir = await screen.findByRole('button', { name: 'Concluir' });
    expect(screen.queryByRole('button', { name: 'Continuar sem importar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/pendência Plano de contas incompleto continua visível/u)).not.toBeInTheDocument();

    await usuario.click(concluir);
    expect(foiPara('/empresas')).toBe(true);
  });

  it('rejeitada: oferece "Concluir" e mantém a explicação da pendência', async () => {
    abrirPagina();
    const usuario = userEvent.setup();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();
    backend.estado.tentativa = previa({
      estado: 'REJEITADA',
      totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 },
      podeConfirmar: false,
      podeCancelar: false,
      finalizadoEm: '2026-10-08T12:31:00.000Z',
    });
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);

    expect(await screen.findByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(screen.getByText(/pendência Plano de contas incompleto continua visível/u)).toBeInTheDocument();
  });
});

describe('sem permissão para importar', () => {
  it('só informa, não oferece envio e deixa concluir', async () => {
    const usuario = userEvent.setup();
    backend.estado.permissoes = [...SO_CONSULTA];
    const { container } = abrirPagina();

    await ativarEmpresa(usuario);

    expect(await tituloDaEtapa()).toBeInTheDocument();
    expect(
      await screen.findByText('Seu papel pode consultar o plano de contas, mas não tem permissão para importar.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo CSV do plano de contas')).not.toBeInTheDocument();
    expect(screen.getByText(/pendência Plano de contas incompleto continua visível/u)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await usuario.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(foiPara('/empresas')).toBe(true);
  });
});

describe('ativação recusada', () => {
  it.each([
    ['409', 409, 'CADASTRO_INCOMPLETO'],
    ['422', 422, 'EMPRESA_NAO_PODE_SER_ATIVADA'],
  ])('%s: o wizard fica como está e nenhuma etapa aparece', async (_caso, status, codigo) => {
    const usuario = userEvent.setup();
    ativar = () => problema(status, codigo);
    abrirPagina();

    await ativarEmpresa(usuario);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Ativar empresa' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Plano de contas' })).not.toBeInTheDocument();
    expect(screen.queryByText('Etapa opcional')).not.toBeInTheDocument();
    expect(foiPara('/empresas')).toBe(false);
  });
});

describe('empresa que já estava ativa', () => {
  it('abrir o endereço do wizard cai na manutenção, como antes, sem a etapa', async () => {
    empresaNoServidor = visao('ATIVA');
    abrirPagina();

    expect(await screen.findByRole('tablist', { name: /seções da empresa/iu })).toBeInTheDocument();
    expect(screen.queryByText('Etapa opcional')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar sem importar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ativar empresa' })).not.toBeInTheDocument();
  });
});

describe('aviso da pendência segue o plano, não só a tentativa aberta', () => {
  it('depois de concluir e abrir "Nova importação", a pendência não volta a ser prometida', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();
    backend.estado.tentativa = previa();
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
    // A confirmação aplica as contas no servidor.
    backend.estado.contas = [conta()];
    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(await screen.findByRole('button', { name: 'Nova importação' }));

    expect(await screen.findByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/pendência Plano de contas incompleto continua visível/u)).not.toBeInTheDocument(),
    );
  });
});

describe('sessão indisponível não vira "sem permissão"', () => {
  it('erro ao carregar as permissões aparece como erro, com código de suporte e nova tentativa', async () => {
    const usuario = userEvent.setup();
    abrirPagina();
    await ativarEmpresa(usuario);
    await tituloDaEtapa();

    sessaoFalha = true;
    // Sessão relida do zero (sem dado anterior) e o servidor recusa.
    await act(async () => {
      await cliente.resetQueries({ queryKey: ['sessao'] });
    });

    expect(await screen.findByText('Não foi possível conferir as suas permissões')).toBeInTheDocument();
    expect(screen.getByText('corr-sessao-503')).toBeInTheDocument();
    expect(screen.queryByText(/não tem permissão para importar/u)).not.toBeInTheDocument();

    sessaoFalha = false;
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
  });
});

describe('aviso da pendência espera o plano', () => {
  it('enquanto o plano ainda carrega, não promete nem nega a pendência', async () => {
    const usuario = userEvent.setup();
    let liberarPlano: () => void = () => undefined;
    const planoPronto = new Promise<void>((resolver) => {
      liberarPlano = resolver;
    });
    instalarFetch(async (url, init) => {
      const metodo = init?.method ?? 'GET';
      if (url === `/api/proxy/empresas/${EMPRESA}` && metodo === 'GET') return json(empresaNoServidor);
      if (url === `/api/proxy/empresas/${EMPRESA}/ativar` && metodo === 'POST') return ativar();
      if (url.includes('/api/proxy/pendencias')) return json({ pendencias: [], total: 0 });
      if (url.includes('/plano-contas/contas?')) await planoPronto;
      return (await backend.roteador(url, init)) ?? new Response('{}', { status: 200 });
    });
    abrirPagina();

    await ativarEmpresa(usuario);
    await tituloDaEtapa();
    expect(screen.queryByText(/pendência Plano de contas incompleto continua visível/u)).not.toBeInTheDocument();

    liberarPlano();
    expect(await screen.findByText(/pendência Plano de contas incompleto continua visível/u)).toBeInTheDocument();
  });
});
