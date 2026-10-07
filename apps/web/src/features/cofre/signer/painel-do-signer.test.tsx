/**
 * Painel operacional do Signer na empresa (SPEC-012 §5.3, §5.4): estado por finalidade, teste manual
 * sem disparo duplicado, resultado acionável com `correlationId` e histórico paginado em 15 itens
 * com filtros. A API é dublada no `fetch`, por rota.
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Envolvido, instalarFetch, json, problema, type Roteador } from '../cofre.fixtures';
import { PainelDoSigner } from './painel-do-signer';
import {
  estadoComFalhaNoEsocial,
  estadoDaEmpresa,
  estadoSemCertificado,
  historico,
  itemDoHistorico,
  resultadoDoTeste,
} from './signer.fixtures';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));

vi.mock('sonner', () => ({ toast }));

const EMPRESA = 'e1';

type Chamada = { url: string; metodo: string; corpo: string };

const chamadas: Chamada[] = [];
let estado: () => Response | Promise<Response> = () => json(estadoDaEmpresa(EMPRESA));
let paginaDoHistorico: (busca: URLSearchParams) => Response | Promise<Response> = () => json(historico([]));
let teste: () => Response | Promise<Response> = () =>
  json([resultadoDoTeste({ finalidade: 'DFE_TESTE' }), resultadoDoTeste({ finalidade: 'ESOCIAL_TESTE' })]);

const roteador: Roteador = (url, init) => {
  chamadas.push({ url, metodo: init?.method ?? 'GET', corpo: String(init?.body ?? '') });

  if (url.endsWith(`/empresas/${EMPRESA}/signer`)) return estado();
  if (url.includes(`/empresas/${EMPRESA}/signer/historico`)) {
    return paginaDoHistorico(new URL(url, 'http://localhost').searchParams);
  }
  if (url.endsWith(`/empresas/${EMPRESA}/signer/testes`) && init?.method === 'POST') return teste();

  return undefined;
};

const itens = (quantidade: number) =>
  Array.from({ length: quantidade }, (_, indice) =>
    itemDoHistorico({
      id: `ev-${indice + 1}`,
      correlationId: `corr-evento-${String(indice + 1).padStart(4, '0')}`,
      iniciadoEm: new Date(Date.UTC(2026, 9, 7, 14, 30 - indice)).toISOString(),
    }),
  );

const renderizar = (propriedades: { podeTestar?: boolean; temCertificadoVigente?: boolean } = {}) =>
  render(
    <PainelDoSigner
      empresaId={EMPRESA}
      temCertificadoVigente={propriedades.temCertificadoVigente ?? true}
      podeTestar={propriedades.podeTestar ?? true}
    />,
    { wrapper: Envolvido },
  );

/** Abre o Select pelo teclado (o caminho que o Radix trata igual em qualquer ambiente) e escolhe a opção. */
const escolher = async (usuario: ReturnType<typeof userEvent.setup>, filtro: string, opcao: string): Promise<void> => {
  (await screen.findByRole('combobox', { name: filtro })).focus();
  await usuario.keyboard('{Enter}');
  await usuario.click(await screen.findByRole('option', { name: opcao }));
};

const postsDeTeste = () =>
  chamadas.filter((chamada) => chamada.metodo === 'POST' && chamada.url.endsWith('/signer/testes'));

beforeEach(() => {
  chamadas.length = 0;
  toast.error.mockClear();
  estado = () => json(estadoDaEmpresa(EMPRESA));
  paginaDoHistorico = () => json(historico(itens(3)));
  teste = () =>
    json([resultadoDoTeste({ finalidade: 'DFE_TESTE' }), resultadoDoTeste({ finalidade: 'ESOCIAL_TESTE' })]);
  instalarFetch(roteador);
});

describe('PainelDoSigner — estado por finalidade', () => {
  it('carregando: esqueleto anunciado por texto, e depois o estado das duas finalidades', async () => {
    let liberar: () => void = () => undefined;

    estado = () =>
      new Promise<Response>((resolver) => {
        liberar = () => resolver(json(estadoDaEmpresa(EMPRESA)));
      });
    renderizar();

    expect(screen.getByText('Carregando o estado do Signer da empresa')).toBeInTheDocument();

    liberar();
    const lista = await screen.findByRole('list', { name: 'Finalidades do Signer mTLS' });

    expect(within(lista).getByText('DF-e')).toBeInTheDocument();
    expect(within(lista).getByText('eSocial')).toBeInTheDocument();
  });

  it('falha de uma finalidade: o motivo vem em PT-BR acionável, sem o código cru', async () => {
    estado = () => json(estadoComFalhaNoEsocial(EMPRESA));
    renderizar();

    expect(await screen.findByText(/O destino simulado recusou a conexão mTLS/u)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SIGNER_MTLS_RECUSADO');
  });

  it('empresa sem certificado vigente: explica e leva ao cofre, sem oferecer teste', async () => {
    estado = () => json(estadoSemCertificado(EMPRESA));
    renderizar({ temCertificadoVigente: false });

    expect(await screen.findByText(/não tem certificado A1 vigente/iu)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Testar mTLS' })).toBeDisabled();
  });

  it('falha ao ler o estado sem dado anterior: erro com código de suporte e nova tentativa', async () => {
    estado = () => problema(503, 'SIGNER_INDISPONIVEL', {}, 'corr-estado-falha');
    renderizar();

    expect(await screen.findByText('Não foi possível ler o estado do Signer da empresa')).toBeInTheDocument();
    expect(screen.getByText(/corr-estado-falha/u)).toBeInTheDocument();

    estado = () => json(estadoDaEmpresa(EMPRESA));
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Tentar de novo' })[0]!);

    expect(await screen.findByRole('list', { name: 'Finalidades do Signer mTLS' })).toBeInTheDocument();
  });
});

describe('PainelDoSigner — teste manual', () => {
  it('quem só consulta não vê o botão e fica sabendo por quê', async () => {
    renderizar({ podeTestar: false });
    await screen.findByRole('list', { name: 'Finalidades do Signer mTLS' });

    expect(screen.queryByRole('button', { name: 'Testar mTLS' })).not.toBeInTheDocument();
    expect(screen.getByText(/seu papel permite apenas consultar/iu)).toBeInTheDocument();
  });

  it('em andamento: o botão fica desabilitado e ocupado, e o segundo clique não dispara outro teste', async () => {
    let liberar: () => void = () => undefined;

    teste = () =>
      new Promise<Response>((resolver) => {
        liberar = () =>
          resolver(json([resultadoDoTeste({ finalidade: 'DFE_TESTE' }), resultadoDoTeste({ finalidade: 'ESOCIAL_TESTE' })]));
      });
    renderizar();
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Testar mTLS' }));
    const ocupado = await screen.findByRole('button', { name: /Testando/u });

    expect(ocupado).toBeDisabled();
    expect(ocupado).toHaveAttribute('aria-busy', 'true');
    await usuario.click(ocupado);
    expect(postsDeTeste()).toHaveLength(1);

    liberar();
    expect(await screen.findByRole('button', { name: 'Testar mTLS' })).toBeEnabled();
  });

  it('a região do resultado já existe, vazia, antes do teste (só assim o leitor de tela anuncia a mudança)', async () => {
    renderizar();
    await screen.findByRole('button', { name: 'Testar mTLS' });

    const regiao = screen.getByRole('status', { name: 'Resultado do teste mTLS' });

    expect(regiao).toBeEmptyDOMElement();
  });

  it('sucesso nas duas finalidades: resultado anunciado, com o código de suporte', async () => {
    renderizar();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Testar mTLS' }));

    const resultado = await screen.findByRole('status', { name: 'Resultado do teste mTLS' });

    expect(within(resultado).getByText(/DF-e: teste concluído com sucesso/u)).toBeInTheDocument();
    expect(within(resultado).getByText(/eSocial: teste concluído com sucesso/u)).toBeInTheDocument();
    expect(within(resultado).getByText(/corr-teste-0001/u)).toBeInTheDocument();
    expect(postsDeTeste()[0]?.corpo).toBe('{}');
  });

  it('falha acionável de uma finalidade: mostra a mensagem e o código de suporte, sem erro de tela', async () => {
    teste = () =>
      json([
        resultadoDoTeste({ finalidade: 'DFE_TESTE' }),
        resultadoDoTeste({
          finalidade: 'ESOCIAL_TESTE',
          resultado: 'FALHA',
          codigo: CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_VENCIDO,
          correlationId: 'corr-teste-falha',
        }),
      ]);
    renderizar();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Testar mTLS' }));

    const resultado = await screen.findByRole('status', { name: 'Resultado do teste mTLS' });

    expect(within(resultado).getByText(/eSocial: falhou/u)).toBeInTheDocument();
    expect(within(resultado).getByText(/Envie um certificado renovado/u)).toBeInTheDocument();
    expect(within(resultado).getByText(/corr-teste-falha/u)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('teste já em andamento em outra aba (409): toast persistente com a mensagem e o código de suporte', async () => {
    teste = () => problema(409, CODIGOS_DE_ERRO.SIGNER_TESTE_EM_ANDAMENTO, {}, 'corr-409');
    renderizar();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Testar mTLS' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      'Já existe um teste em andamento para esta empresa. Aguarde o resultado.',
      expect.objectContaining({ duration: Infinity, description: 'Código de suporte: corr-409' }),
    );
  });

  it('depois do teste, estado e histórico são relidos', async () => {
    renderizar();
    await screen.findByRole('list', { name: 'Histórico do Signer' });
    const antes = chamadas.filter((chamada) => chamada.url.includes('/historico')).length;

    await userEvent.setup().click(screen.getByRole('button', { name: 'Testar mTLS' }));

    await waitFor(() =>
      expect(chamadas.filter((chamada) => chamada.url.includes('/historico')).length).toBeGreaterThan(antes),
    );
  });
});

describe('PainelDoSigner — histórico', () => {
  it('lista do mais recente ao mais antigo, com horário de São Paulo, resultado em texto e latência', async () => {
    renderizar();

    const lista = await screen.findByRole('list', { name: 'Histórico do Signer' });
    const eventos = within(lista).getAllByRole('listitem');

    expect(eventos).toHaveLength(3);
    expect(within(eventos[0]!).getByText('07/10/2026 11:30')).toBeInTheDocument();
    expect(within(eventos[0]!).getByText('DF-e')).toBeInTheDocument();
    expect(within(eventos[0]!).getByText('Sucesso')).toBeInTheDocument();
    expect(within(eventos[0]!).getByText('12 ms')).toBeInTheDocument();
    expect(within(eventos[0]!).getByText(/corr-evento-0001/u)).toBeInTheDocument();
    expect(within(eventos[1]!).getByText('07/10/2026 11:29')).toBeInTheDocument();
  });

  it('mostra falha e recusa com a mensagem do código, e marca a reutilização idempotente', async () => {
    paginaDoHistorico = () =>
      json(
        historico([
          itemDoHistorico({
            id: 'a',
            resultado: 'FALHA',
            codigo: CODIGOS_DE_ERRO.SIGNER_DESTINO_INDISPONIVEL,
          }),
          itemDoHistorico({
            id: 'b',
            resultado: 'RECUSA',
            codigo: CODIGOS_DE_ERRO.SIGNER_CERTIFICADO_AUSENTE,
            finalidade: 'ESOCIAL_TESTE',
          }),
          itemDoHistorico({ id: 'c', reutilizado: true, origemDiagnostico: null }),
        ]),
      );
    renderizar();

    const eventos = within(await screen.findByRole('list', { name: 'Histórico do Signer' })).getAllByRole('listitem');

    expect(within(eventos[0]!).getByText('Falha')).toBeInTheDocument();
    expect(within(eventos[0]!).getByText(/O destino simulado não respondeu/u)).toBeInTheDocument();
    expect(within(eventos[1]!).getByText('Recusa')).toBeInTheDocument();
    expect(within(eventos[1]!).getByText(/não tem certificado A1 vigente/u)).toBeInTheDocument();
    expect(within(eventos[2]!).getByText('Resultado reutilizado')).toBeInTheDocument();
  });

  it('não exibe campo fora do contrato público, mesmo que a resposta o traga (sem XML nem referência do segredo)', async () => {
    paginaDoHistorico = () =>
      json(
        historico([
          {
            ...itemDoHistorico({ id: 'a' }),
            referenciaSegredo: 'kv/data/certificados/SENTINELA-DE-SEGREDO',
            xml: '<Signature>SENTINELA-DE-XML</Signature>',
          } as never,
        ]),
      );
    renderizar();
    await screen.findByRole('list', { name: 'Histórico do Signer' });

    expect(document.body.textContent).not.toMatch(/SENTINELA|<Signature|kv\/data/u);
  });

  it('nada no histórico oferece expandir, baixar ou copiar o conteúdo da operação', async () => {
    renderizar();
    const lista = await screen.findByRole('list', { name: 'Histórico do Signer' });

    expect(within(lista).queryAllByRole('button')).toHaveLength(0);
    expect(within(lista).queryAllByRole('link')).toHaveLength(0);
  });

  it('histórico vazio: estado próprio, sem filtro para limpar', async () => {
    paginaDoHistorico = () => json(historico([]));
    renderizar();

    expect(await screen.findByText('Nenhum evento do Signer ainda')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
  });

  it('pagina em 15 por vez: a próxima pede a página 2 e a anterior volta', async () => {
    paginaDoHistorico = (busca) =>
      json(historico(itens(15), { total: 31, pagina: Number(busca.get('pagina')) }));
    renderizar();
    const usuario = userEvent.setup();

    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await usuario.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
    expect(chamadas.some((chamada) => chamada.url.includes('historico?pagina=2'))).toBe(true);

    await usuario.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument();
  });

  it('filtra por finalidade: pede ao servidor e volta à primeira página', async () => {
    paginaDoHistorico = (busca) =>
      json(historico(itens(15), { total: 31, pagina: Number(busca.get('pagina')) }));
    renderizar();
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Próxima' }));
    await screen.findByText('Página 2 de 3');

    await escolher(usuario, 'Finalidade', 'eSocial');

    await waitFor(() =>
      expect(chamadas.some((chamada) => /historico\?pagina=1&finalidade=ESOCIAL_TESTE/u.test(chamada.url))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('filtro sem resultado: diz que nada corresponde e oferece limpar', async () => {
    paginaDoHistorico = (busca) =>
      busca.get('resultado') === null ? json(historico(itens(3))) : json(historico([], { total: 0 }));
    renderizar();
    const usuario = userEvent.setup();

    await escolher(usuario, 'Resultado', 'Recusa');

    expect(await screen.findByText('Nenhum evento corresponde aos filtros')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('list', { name: 'Histórico do Signer' })).toBeInTheDocument();
  });

  it('página sem resultado (além do último evento): volta à primeira página', async () => {
    paginaDoHistorico = (busca) =>
      busca.get('pagina') === '1'
        ? json(historico(itens(15), { total: 20 }))
        : json(historico([], { total: 20, pagina: Number(busca.get('pagina')) }));
    renderizar();
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Próxima' }));

    expect(await screen.findByText('Esta página não tem eventos')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Voltar à primeira página' }));
    expect(await screen.findByRole('list', { name: 'Histórico do Signer' })).toBeInTheDocument();
  });

  it('falha ao ler o histórico: mantém a última página lida e marca como desatualizado', async () => {
    paginaDoHistorico = (busca) =>
      busca.get('pagina') === '1'
        ? json(historico(itens(15), { total: 31 }))
        : problema(503, CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL, {}, 'corr-historico-falha');
    renderizar();
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Próxima' }));

    expect(await screen.findByText(/Histórico desatualizado/u)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Histórico do Signer' })).toBeInTheDocument();
  });

  it('falha ao ler o histórico sem página anterior: erro com código de suporte', async () => {
    paginaDoHistorico = () => problema(503, CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL, {}, 'corr-historico-falha');
    renderizar();

    expect(await screen.findByText('Não foi possível ler o histórico do Signer')).toBeInTheDocument();
    expect(screen.getByText(/corr-historico-falha/u)).toBeInTheDocument();
  });

  it('sem permissão no servidor: acesso negado, sem tentar de novo', async () => {
    estado = () => problema(403, 'SEM_AUTORIZACAO');
    paginaDoHistorico = () => problema(403, 'SEM_AUTORIZACAO');
    renderizar();

    expect((await screen.findAllByText('Você não tem permissão para ver o Signer')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });
});

describe('PainelDoSigner — acessibilidade', () => {
  it('sem violações do axe com estado, teste e histórico', async () => {
    const { container } = renderizar();

    await screen.findByRole('list', { name: 'Histórico do Signer' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Testar mTLS' }));
    await screen.findByRole('status', { name: 'Resultado do teste mTLS' });

    expect(await axe(container)).toHaveNoViolations();
  });
});
