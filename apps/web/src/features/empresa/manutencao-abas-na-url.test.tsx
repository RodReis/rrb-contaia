/**
 * A aba aberta da empresa vive na URL (`?aba=`, SPEC-013 §3.10): o link da notificação de
 * importação cai no Plano de contas e na tentativa; aba desconhecida ou sem permissão volta para
 * a primeira permitida; trocar de aba atualiza a URL.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Envolvido,
  SO_CONSULTA,
  TENTATIVA,
  criarBackend,
  instalarFetch,
  json,
  navegacao,
  previa,
} from '../plano-contas/plano-contas.fixtures';
import type { VisaoDaEmpresa } from './api';
import { ManutencaoDaEmpresa } from './manutencao-da-empresa';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('../plano-contas/plano-contas.fixtures');

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

const renderizar = () => render(<ManutencaoDaEmpresa visao={visao} arquivada={false} />, { wrapper: Envolvido });

/** As abas aparecem quando a sessão diz o que o papel pode (antes disso, skeleton). */
const abas = () => screen.findByRole('tablist', { name: /seções da empresa/iu });

beforeEach(() => {
  vi.clearAllMocks();
  backend = criarBackend();
  // As demais rotas da página (pendências, endereços…) não interessam aqui: respondem vazio.
  instalarFetch(
    (url, init) =>
      backend.roteador(url, init) ??
      (url.endsWith('/empresas/empresa-1/documentos')
        ? json({ empresaId: 'empresa-1', exigencias: [] })
        : new Response('{}', { status: 200 })),
  );
});

describe('aba na URL', () => {
  it('?aba=plano-contas abre o Plano de contas para quem o consulta', async () => {
    navegacao.definir('aba=plano-contas');
    renderizar();

    const aba = await within(await abas()).findByRole('tab', { name: 'Plano de contas' });
    await waitFor(() => expect(aba).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Plano de contas' })).toBeInTheDocument();
  });

  it('deep link com a sessão ainda carregando: skeleton, sem passar por Identificação', async () => {
    let liberarSessao: () => void = () => undefined;
    const sessaoPronta = new Promise<void>((resolver) => {
      liberarSessao = resolver;
    });
    instalarFetch(async (url, init) => {
      if (url.endsWith('/api/proxy/usuarios/eu')) {
        await sessaoPronta;
      }

      return (
        backend.roteador(url, init) ??
        (url.endsWith('/empresas/empresa-1/documentos')
          ? json({ empresaId: 'empresa-1', exigencias: [] })
          : new Response('{}', { status: 200 }))
      );
    });
    navegacao.definir('aba=plano-contas');
    renderizar();

    // Enquanto a sessão não chega, a aba pedida não existe ainda: nada de abrir Identificação.
    expect(screen.getByText('Carregando a aba da empresa')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: /seções da empresa/iu })).not.toBeInTheDocument();

    liberarSessao();
    const aba = await within(await screen.findByRole('tablist', { name: /seções da empresa/iu })).findByRole('tab', {
      name: 'Plano de contas',
    });
    expect(aba).toHaveAttribute('aria-selected', 'true');
    expect(navegacao.replace).not.toHaveBeenCalled();
  });

  it('o link da notificação abre a tentativa na aba', async () => {
    backend.estado.tentativa = previa();
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
    renderizar();

    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
  });

  it('aba desconhecida volta para a primeira', async () => {
    navegacao.definir('aba=inexistente');
    renderizar();

    await within(await abas()).findByRole('tab', { name: 'Plano de contas' });
    expect(within(await abas()).getByRole('tab', { name: 'Identificação' })).toHaveAttribute('aria-selected', 'true');
  });

  it('aba sem permissão volta para a primeira e nem aparece', async () => {
    backend.estado.permissoes = [];
    navegacao.definir('aba=plano-contas');
    renderizar();

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/usuarios/eu'))).toBe(true),
    );
    expect(within(await abas()).queryByRole('tab', { name: 'Plano de contas' })).not.toBeInTheDocument();
    expect(within(await abas()).getByRole('tab', { name: 'Identificação' })).toHaveAttribute('aria-selected', 'true');
  });

  it('colaboradores sem administrar usuários também volta para a primeira', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    navegacao.definir('aba=colaboradores');
    renderizar();

    await within(await abas()).findByRole('tab', { name: 'Plano de contas' });
    expect(within(await abas()).getByRole('tab', { name: 'Identificação' })).toHaveAttribute('aria-selected', 'true');
  });

  it('trocar de aba atualiza a URL e a primeira aba fica sem parâmetro', async () => {
    const usuario = userEvent.setup();
    navegacao.definir('');
    renderizar();

    await usuario.click(within(await abas()).getByRole('tab', { name: 'Documentos' }));
    expect(navegacao.replace).toHaveBeenLastCalledWith('/empresas/empresa-1?aba=documentos', { scroll: false });
    expect(within(await abas()).getByRole('tab', { name: 'Documentos' })).toHaveAttribute('aria-selected', 'true');

    await usuario.click(within(await abas()).getByRole('tab', { name: 'Identificação' }));
    expect(navegacao.replace).toHaveBeenLastCalledWith('/empresas/empresa-1', { scroll: false });
  });
});
