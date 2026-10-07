/**
 * O Signer dentro do cofre (SPEC-012 §5.1–§5.3): cartão geral, coluna `Signer mTLS` por empresa em
 * lote, painel no detalhe e a permissão decidindo o que aparece. A API é dublada no `fetch`, por rota.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaDoCofre } from './area-do-cofre';
import {
  Envolvido,
  ITEM_SEM_CERTIFICADO,
  ITEM_VENCIDO,
  PADARIA,
  SESSAO_DO_COFRE,
  detalhe,
  instalarFetch,
  json,
  pagina,
  problema,
  type Roteador,
} from './cofre.fixtures';
import {
  PAINEL_OPERACIONAL,
  SESSAO_COM_SIGNER,
  SESSAO_SIGNER_SO_CONSULTA,
  estadoComFalhaNoEsocial,
  estadoDaEmpresa,
  estadoSemCertificado,
  historico,
  itemDoHistorico,
} from './signer/signer.fixtures';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/configuracoes/cofre',
}));

const ITENS = [PADARIA, ITEM_VENCIDO, ITEM_SEM_CERTIFICADO];

let sessao: unknown = SESSAO_COM_SIGNER;
let estados: () => Response | Promise<Response> = () =>
  json({
    empresas: [
      estadoDaEmpresa(PADARIA.empresaId),
      estadoComFalhaNoEsocial(ITEM_VENCIDO.empresaId),
      estadoSemCertificado(ITEM_SEM_CERTIFICADO.empresaId),
    ],
  });
let painel: () => Response | Promise<Response> = () => json(PAINEL_OPERACIONAL);
const chamadas: string[] = [];

const roteador: Roteador = (url) => {
  chamadas.push(url);

  if (url.endsWith('/usuarios/eu')) return json(sessao);
  if (url.endsWith('/signer/painel')) return painel();
  if (url.includes('/signer/estados?')) return estados();
  if (/\/empresas\/[^/]+\/signer\/historico/u.test(url)) return json(historico([itemDoHistorico({ id: 'ev-1' })]));
  if (/\/empresas\/[^/]+\/signer$/u.test(url)) return json(estadoDaEmpresa(PADARIA.empresaId));

  const alvo = /\/empresas\/([^/]+)\/certificados$/u.exec(url);

  if (alvo !== null) {
    const encontrado = ITENS.find((candidato) => candidato.empresaId === alvo[1]);

    return encontrado === undefined ? problema(404, 'EMPRESA_NAO_ENCONTRADA') : json(detalhe(encontrado));
  }

  if (url.includes('/api/proxy/certificados?')) return json(pagina(ITENS));
  if (url.includes('/certificados/responsaveis')) return json([]);

  return undefined;
};

const renderizar = () => render(<AreaDoCofre />, { wrapper: Envolvido });
const tabela = async () => within(await screen.findByRole('table'));
const linhaDe = async (empresa: string) => within((await tabela()).getByRole('row', { name: new RegExp(empresa, 'u') }));
const chamadasAoSigner = () => chamadas.filter((url) => url.includes('/signer'));

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  sessao = SESSAO_COM_SIGNER;
  estados = () =>
    json({
      empresas: [
        estadoDaEmpresa(PADARIA.empresaId),
        estadoComFalhaNoEsocial(ITEM_VENCIDO.empresaId),
        estadoSemCertificado(ITEM_SEM_CERTIFICADO.empresaId),
      ],
    });
  painel = () => json(PAINEL_OPERACIONAL);
  chamadas.length = 0;
  substituir.mockClear();
  instalarFetch(roteador);
});

describe('AreaDoCofre — Signer', () => {
  it('sem a permissão de consulta nada do Signer aparece nem é pedido à API', async () => {
    sessao = SESSAO_DO_COFRE;
    renderizar();

    await tabela();

    expect(screen.queryByRole('heading', { name: 'Microserviço Signer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Signer mTLS' })).not.toBeInTheDocument();
    expect(chamadasAoSigner()).toHaveLength(0);
  });

  it('com a permissão: cartão geral, coluna por empresa e uma única leitura em lote da página', async () => {
    renderizar();
    const lista = await tabela();

    expect(await screen.findByText('Operacional', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Microserviço Signer' })).toBeInTheDocument();
    expect(lista.getByRole('columnheader', { name: 'Signer mTLS' })).toBeInTheDocument();

    const padaria = await linhaDe('Padaria Aurora');

    expect(await padaria.findByRole('group', { name: 'Resumo do Signer mTLS' })).toHaveTextContent('Operacional');

    const lote = chamadas.filter((url) => url.includes('/signer/estados?'));

    expect(lote).toHaveLength(1);
    for (const alvo of ITENS) {
      expect(lote[0]).toContain(alvo.empresaId);
    }
  });

  it('cada linha mostra o estado da própria empresa: falha e sem certificado em texto', async () => {
    renderizar();

    const vencido = await linhaDe(ITEM_VENCIDO.empresaNome);
    const semCertificado = await linhaDe(ITEM_SEM_CERTIFICADO.empresaNome);

    expect(await vencido.findByRole('group', { name: 'Resumo do Signer mTLS' })).toHaveTextContent('Falha');
    expect(await semCertificado.findByRole('group', { name: 'Resumo do Signer mTLS' })).toHaveTextContent(
      'Sem certificado',
    );
  });

  it('falha ao ler os estados não derruba a lista: a coluna diz que o estado está indisponível', async () => {
    estados = () => problema(503, 'SIGNER_INDISPONIVEL', {}, 'corr-lote');
    renderizar();

    const padaria = await linhaDe('Padaria Aurora');

    expect(await padaria.findByText('Estado indisponível agora')).toBeInTheDocument();
    expect(padaria.getByText('Válido')).toBeInTheDocument();
  });

  it('o botão da linha abre o painel da empresa pela URL', async () => {
    renderizar();
    const padaria = await linhaDe('Padaria Aurora');

    await userEvent.setup().click(await padaria.findByRole('button', { name: 'Abrir o painel do Signer de Padaria Aurora' }));

    expect(String(substituir.mock.calls.at(-1)?.[0])).toBe('/configuracoes/cofre?empresa=e-valido');
  });

  it('?empresa= abre o painel do Signer no detalhe, com o teste para quem pode testar', async () => {
    parametrosAtuais = new URLSearchParams('empresa=e-valido');
    renderizar();

    const dialogo = await screen.findByRole('dialog');

    expect(await within(dialogo).findByRole('heading', { name: 'Signer mTLS' })).toBeInTheDocument();
    expect(await within(dialogo).findByRole('button', { name: 'Testar mTLS' })).toBeEnabled();
    expect(await within(dialogo).findByRole('list', { name: 'Histórico do Signer' })).toBeInTheDocument();
  });

  it('quem só consulta vê o painel sem o botão de teste', async () => {
    sessao = SESSAO_SIGNER_SO_CONSULTA;
    parametrosAtuais = new URLSearchParams('empresa=e-valido');
    renderizar();

    const dialogo = await screen.findByRole('dialog');

    expect(await within(dialogo).findByRole('heading', { name: 'Signer mTLS' })).toBeInTheDocument();
    expect(within(dialogo).queryByRole('button', { name: 'Testar mTLS' })).not.toBeInTheDocument();
  });

  it('empresa sem certificado vigente: o painel não oferece teste', async () => {
    parametrosAtuais = new URLSearchParams(`empresa=${ITEM_SEM_CERTIFICADO.empresaId}`);
    renderizar();

    const dialogo = await screen.findByRole('dialog');

    expect(await within(dialogo).findByRole('button', { name: 'Testar mTLS' })).toBeDisabled();
  });

  it('o detalhe sem a permissão do Signer não traz o painel', async () => {
    sessao = SESSAO_DO_COFRE;
    parametrosAtuais = new URLSearchParams('empresa=e-valido');
    renderizar();

    const dialogo = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialogo).getByText('Certificado vigente')).toBeInTheDocument());
    expect(within(dialogo).queryByRole('heading', { name: 'Signer mTLS' })).not.toBeInTheDocument();
  });

  it('acessível: sem violações do axe com cartão, coluna e lista', async () => {
    const { container } = renderizar();

    await screen.findByText('Operacional', { selector: 'p' });
    const padaria = await linhaDe('Padaria Aurora');

    await padaria.findByRole('group', { name: 'Resumo do Signer mTLS' });

    expect(await axe(container)).toHaveNoViolations();
  });
});
