/**
 * Aba "Empregados" na manutenção da empresa (SPEC-014 §3.1, §3.9, §3.12): aparece só para quem
 * consulta empregados, abre pelo link da notificação (`?aba=empregados&tentativa=`) e, em empresa
 * arquivada, é só consulta. Nenhum controle de edição, arquivamento ou reativação de empregado.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Envolvido,
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
import type { VisaoDaEmpresa } from './api';
import { ManutencaoDaEmpresa } from './manutencao-da-empresa';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('../empregados/empregados.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

const visao: VisaoDaEmpresa = {
  id: 'empresa-1',
  situacao: 'ativo',
  cadastro: {
    status: 'ATIVA',
    identificacao: {
      cnpj: '11222333000181',
      razaoSocial: 'Padaria Aurora Comércio de Alimentos LTDA',
      nomeFantasia: 'Padaria Aurora',
      logoArquivoId: null,
      telefone: null,
      email: null,
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
  podeAtivar: false,
  exigeConfirmacaoDeSituacaoExterna: false,
};

let backend = criarBackend();

const renderizar = (arquivada = false) =>
  render(<ManutencaoDaEmpresa visao={{ ...visao, situacao: arquivada ? 'arquivado' : 'ativo' }} arquivada={arquivada} />, {
    wrapper: Envolvido,
  });

const abas = () => screen.findByRole('tablist', { name: /seções da empresa/iu });

beforeEach(() => {
  vi.clearAllMocks();
  backend = criarBackend();
  instalarFetch(
    (url, init) =>
      backend.roteador(url, init) ??
      (url.endsWith('/empresas/empresa-1/documentos')
        ? json({ empresaId: 'empresa-1', exigencias: [] })
        : new Response('{}', { status: 200 })),
  );
});

describe('aba Empregados', () => {
  it('?aba=empregados abre a aba para quem consulta empregados', async () => {
    navegacao.definir('aba=empregados');
    renderizar();

    const aba = await within(await abas()).findByRole('tab', { name: 'Empregados' });
    await waitFor(() => expect(aba).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Empregados' })).toBeInTheDocument();
  });

  it('não aparece para quem não consulta empregados, e o deep link volta para a primeira aba', async () => {
    backend.estado.permissoes = ['empresas.plano_contas.consultar'];
    navegacao.definir('aba=empregados');
    renderizar();

    await within(await abas()).findByRole('tab', { name: 'Plano de contas' });
    expect(within(await abas()).queryByRole('tab', { name: 'Empregados' })).not.toBeInTheDocument();
    expect(within(await abas()).getByRole('tab', { name: 'Identificação' })).toHaveAttribute('aria-selected', 'true');
  });

  it('o link da notificação abre a tentativa na aba', async () => {
    backend.estado.tentativa = previa();
    navegacao.definir(`aba=empregados&tentativa=${TENTATIVA}`);
    renderizar();

    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Empregados' })).toHaveAttribute('aria-selected', 'true');
  });

  it('empresa arquivada: consulta da base sem envio, sem editar, arquivar ou reativar empregado', async () => {
    backend.estado.permissoes = [...TODAS_AS_PERMISSOES];
    backend.estado.empregados = [empregado()];
    navegacao.definir('aba=empregados');
    renderizar(true);

    expect(await screen.findByText('Ana Beatriz Lima')).toBeInTheDocument();
    expect(screen.getByText(/Empresa arquivada: os empregados e o histórico ficam para consulta/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
    const painel = screen.getByRole('tabpanel');
    expect(within(painel).queryByRole('button', { name: /editar|arquivar|reativar/iu })).not.toBeInTheDocument();
  });

  it('quem só consulta vê a aba e a base', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    backend.estado.empregados = [empregado()];
    navegacao.definir('aba=empregados');
    renderizar();

    expect(await screen.findByText('Ana Beatriz Lima')).toBeInTheDocument();
  });
});
