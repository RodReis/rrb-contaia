/**
 * Etapa de empregados no cadastro da empresa (SPEC-014 §3.1, §5.2): depois do plano de contas,
 * opcional, com o mesmo fluxo da aba "Empregados". Sem empregado confirmado, a pendência continua
 * visível e o cadastro não trava. Quem não consulta empregados segue direto para a lista, como na F13.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SO_CONSULTA,
  TENTATIVA,
  TODAS_AS_PERMISSOES,
  criarBackend,
  empregado,
  instalarFetch,
  json,
  navegacao,
  previa,
} from '../empregados/empregados.fixtures';
import { criarBackend as criarBackendDoPlano } from '../plano-contas/plano-contas.fixtures';
import type { VisaoDaEmpresa } from './api';
import { PaginaDaEmpresa } from './pagina-da-empresa';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('../empregados/empregados.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

const EMPRESA = 'empresa-1';
const DO_PLANO = ['empresas.plano_contas.consultar', 'empresas.plano_contas.importar'];

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

let empregados = criarBackend();
let plano = criarBackendDoPlano();
let permissoes: string[] = [];
let empresaNoServidor = visao('CADASTRO_INCOMPLETO');
let cliente = new QueryClient();

const Provedor = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
);

const abrirPagina = () => render(<PaginaDaEmpresa empresaId={EMPRESA} />, { wrapper: Provedor });

const foiPara = (destino: string): boolean => navegacao.push.mock.calls.some(([alvo]) => alvo === destino);

/** Ativa a empresa e sai do plano de contas sem importar. */
const chegarNaEtapa = async (usuario: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await usuario.click(await screen.findByRole('button', { name: 'Ativar empresa' }));
  await screen.findByRole('heading', { level: 2, name: 'Plano de contas' });
  await usuario.click(await screen.findByRole('button', { name: 'Continuar sem importar' }));

  return screen.findByRole('heading', { level: 2, name: 'Empregados' });
};

beforeEach(() => {
  vi.clearAllMocks();
  navegacao.definir('');
  empregados = criarBackend();
  plano = criarBackendDoPlano();
  permissoes = [...DO_PLANO, ...TODAS_AS_PERMISSOES];
  empresaNoServidor = visao('CADASTRO_INCOMPLETO');
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  instalarFetch((url, init) => {
    const metodo = init?.method ?? 'GET';

    if (url.endsWith('/api/proxy/usuarios/eu')) {
      return json({ papeis: ['contador'], permissoes, escopoDeEmpresas: 'CARTEIRA' });
    }
    if (url === `/api/proxy/empresas/${EMPRESA}` && metodo === 'GET') {
      return json(empresaNoServidor);
    }
    if (url === `/api/proxy/empresas/${EMPRESA}/ativar` && metodo === 'POST') {
      empresaNoServidor = visao('ATIVA');
      return json(empresaNoServidor);
    }
    if (url.includes('/api/proxy/pendencias')) {
      return json({ pendencias: [], total: 0 });
    }

    return empregados.roteador(url, init) ?? plano.roteador(url, init);
  });
});

describe('ordem das etapas', () => {
  it('o plano de contas anuncia a etapa de empregados como próxima', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    await usuario.click(await screen.findByRole('button', { name: 'Ativar empresa' }));
    await screen.findByRole('heading', { level: 2, name: 'Plano de contas' });

    const passos = within(screen.getByRole('navigation', { name: 'Etapas do cadastro' })).getAllByRole('listitem');
    expect(passos).toHaveLength(6);
    expect(passos[4]).toHaveTextContent('etapa atual');
    expect(passos[5]).toHaveTextContent('Empregados (opcional)');
    expect(passos[5]).toHaveTextContent('pendente');
  });

  it('"Continuar sem importar" no plano leva à etapa de empregados, sem sair da página', async () => {
    const usuario = userEvent.setup();
    abrirPagina();

    const titulo = await chegarNaEtapa(usuario);

    expect(foiPara('/empresas')).toBe(false);
    await waitFor(() => expect(titulo).toHaveFocus());
    const passos = within(screen.getByRole('navigation', { name: 'Etapas do cadastro' })).getAllByRole('listitem');
    expect(passos).toHaveLength(6);
    expect(passos[4]).toHaveTextContent('concluída');
    expect(passos[5]).toHaveTextContent('etapa atual');
    expect(screen.getByText('Etapa opcional')).toBeInTheDocument();
  });

  it('quem não consulta empregados segue do plano direto para a lista, como antes', async () => {
    const usuario = userEvent.setup();
    permissoes = [...DO_PLANO];
    abrirPagina();

    await usuario.click(await screen.findByRole('button', { name: 'Ativar empresa' }));
    await usuario.click(await screen.findByRole('button', { name: 'Continuar sem importar' }));

    expect(foiPara('/empresas')).toBe(true);
  });
});

describe('etapa de empregados', () => {
  it('reaproveita o fluxo da aba, explica a pendência e deixa continuar sem importar', async () => {
    const usuario = userEvent.setup();
    const { container } = abrirPagina();

    await chegarNaEtapa(usuario);

    expect(await screen.findByLabelText('Arquivo CSV dos empregados')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2, name: 'Empregados' })).toHaveLength(1);
    expect(
      await screen.findByText(/pendência Empregados não importados continua visível na Central de Pendências/u),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await usuario.click(screen.getByRole('button', { name: 'Continuar sem importar' }));
    expect(foiPara('/empresas')).toBe(true);
  });

  it('importação concluída: "Concluir", sem prometer a pendência', async () => {
    const usuario = userEvent.setup();
    abrirPagina();
    await chegarNaEtapa(usuario);

    empregados.estado.tentativa = previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' });
    empregados.estado.empregados = [empregado()];
    navegacao.definir(`aba=empregados&tentativa=${TENTATIVA}`);

    const concluir = await screen.findByRole('button', { name: 'Concluir' });
    expect(screen.queryByText(/pendência Empregados não importados continua visível/u)).not.toBeInTheDocument();
    await usuario.click(concluir);
    expect(foiPara('/empresas')).toBe(true);
  });

  it('sem permissão para importar: só informa e deixa concluir', async () => {
    const usuario = userEvent.setup();
    permissoes = [...DO_PLANO, ...SO_CONSULTA];
    abrirPagina();
    await chegarNaEtapa(usuario);

    expect(
      await screen.findByText('Seu papel pode consultar os empregados, mas não tem permissão para importar.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo CSV dos empregados')).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(foiPara('/empresas')).toBe(true);
  });
});
