/**
 * Estados obrigatórios da aba "Plano de contas" (SPEC-013 §5.3), um teste por estado, com axe
 * nos principais. A API é dublada no `fetch` (com problem+json nas recusas); a URL é dublada com
 * estado, para a tentativa aberta por `?tentativa=` ser a mesma que a tela navega.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaPlanoDeContas } from './aba-plano-de-contas';
import {
  Envolvido,
  SO_CONSULTA,
  TENTATIVA,
  conta,
  criarBackend,
  csvDoModelo,
  desinstalarDownloads,
  instalarDownloads,
  instalarFetch,
  json,
  navegacao,
  previa,
  previaParcial,
  problema,
  rejeicao,
  tentativaDoHistorico,
} from './plano-contas.fixtures';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('./plano-contas.fixtures');

  return {
    useRouter: () => ({ replace: url.replace, push: url.push }),
    useSearchParams: () => useSyncExternalStore(url.assinar, url.ler, url.ler),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

let backend = criarBackend();

const renderizar = (somenteLeitura = false) =>
  render(<AbaPlanoDeContas empresaId="empresa-1" somenteLeitura={somenteLeitura} />, { wrapper: Envolvido });

const abrirTentativa = (tentativa: ReturnType<typeof previa>): void => {
  backend.estado.tentativa = tentativa;
  navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
};

const cartaoDaImportacao = (): HTMLElement => screen.getByRole('region', { name: /Importação/u });

beforeEach(() => {
  vi.clearAllMocks();
  navegacao.definir('aba=plano-contas');
  backend = criarBackend();
  instalarFetch(backend.roteador);
});

afterEach(() => {
  vi.useRealTimers();
  desinstalarDownloads();
});

describe('carregando', () => {
  it('mostra skeleton com a forma do conteúdo, sem spinner no lugar das tabelas', async () => {
    backend.estado.lerTentativa = () => new Promise<Response>(() => undefined);
    backend.estado.lerHistorico = () => new Promise<Response>(() => undefined);
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);

    renderizar();

    expect(await screen.findByText('Carregando a importação')).toBeInTheDocument();
    expect(screen.getByText('Carregando o histórico de importações').closest('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('sem plano e sem tentativa', () => {
  it('convida a importar, explica a pendência e diz que o histórico está vazio', async () => {
    const { container } = renderizar();

    expect(await screen.findByRole('heading', { name: 'Esta empresa ainda não tem plano de contas' })).toBeInTheDocument();
    expect(screen.getByText(/mantém a pendência de plano de contas na Central de Pendências/u)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Nenhuma importação ainda' })).toBeInTheDocument();
    expect(within(cartaoDaImportacao()).getByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
    expect(screen.getByText(/linhas de dados, com cabeçalho na/u)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('não promete o que a fatia não entrega: sem centro de custo, IA, vetorização ou correção inline', async () => {
    const { container } = renderizar();
    await screen.findByRole('heading', { name: 'Nenhuma importação ainda' });

    expect(container.textContent).not.toMatch(/centro de custo|vetoriza|\bRAG\b|correção inline|sugest|classificador/iu);
    expect(container.textContent).not.toMatch(/\bIA\b/u);
  });
});

describe('arquivo selecionado', () => {
  it('lê o cabeçalho e mostra o mapeamento com as colunas do modelo já escolhidas', async () => {
    const usuario = userEvent.setup();
    const { container } = renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvDoModelo());

    expect(await screen.findByText('Associe as colunas do arquivo')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Código/u })).toHaveTextContent('codigo');
    expect(screen.getByRole('combobox', { name: /Conta-pai/u })).toHaveTextContent('conta_pai');
    expect(screen.getByRole('table', { name: /Amostra das primeiras linhas/u })).toBeInTheDocument();
    expect(screen.getByText(/5 colunas separadas por ponto e vírgula/u)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('arquivo rejeitado antes do envio', () => {
  it.each([
    ['formato que não é CSV', new File(['x'], 'plano.xlsx', { type: 'application/vnd.ms-excel' }), 'Formato não aceito. Envie .csv.'],
    ['CSV só com cabeçalho', new File(['codigo;nome\n'], 'vazio.csv', { type: 'text/csv' }), 'O arquivo não tem nenhuma linha de dados para importar.'],
    ['acima de 10 MB', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.csv', { type: 'text/csv' }), 'Arquivo acima do limite de 10 MB.'],
  ])('recusa %s sem enviar nada', async (_caso, arquivo, motivo) => {
    const usuario = userEvent.setup({ applyAccept: false });
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), arquivo);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(`Arquivo recusado antes do envio: ${arquivo.name}`);
    expect(alerta).toHaveTextContent(motivo);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('validação em andamento', () => {
  it('mostra o progresso, anuncia sem repetir e acompanha por consulta', async () => {
    abrirTentativa(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }));
    const { container } = renderizar();

    expect(await screen.findByText('Validando o arquivo inteiro')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Validando o arquivo.');
    expect(screen.getByText('Validação').closest('[aria-current="step"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Confirmar importação/u })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('prévia', () => {
  it('sem rejeições: todas as linhas válidas, confirmar e cancelar disponíveis', async () => {
    abrirTentativa(previa());
    const { container } = renderizar();

    expect(await screen.findByText(/Todas as 6 linhas lidas são válidas/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar importação' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancelar importação' })).toBeEnabled();
    expect(screen.queryByRole('table', { name: /Linhas rejeitadas/u })).not.toBeInTheDocument();
    expect(screen.getByText('plano-legado.csv', { selector: 'dd' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('com aceitação parcial: totais, tabela de rejeições com cabeçalhos e relatório', async () => {
    abrirTentativa(previaParcial());
    const { container } = renderizar();

    const tabela = await screen.findByRole('table', { name: /Linhas rejeitadas de plano-legado.csv/u });
    expect(within(tabela).getAllByRole('columnheader').map((celula) => celula.textContent)).toEqual([
      'Linha',
      'Código',
      'Campo',
      'Erro',
      'O que fazer',
    ]);
    expect(within(tabela).getByRole('rowheader', { name: '4' })).toBeInTheDocument();
    expect(within(tabela).getByText('Conta-pai inexistente')).toBeInTheDocument();
    expect(within(tabela).getByText('CODIGO_DUPLICADO_NO_ARQUIVO')).toBeInTheDocument();
    // A repetição aponta o campo Código (SPEC-013 §3.4): o rótulo aparece no cabeçalho e na linha.
    expect(within(tabela).getAllByText('Código')).toHaveLength(2);
    expect(within(tabela).queryByText('Linha inteira')).not.toBeInTheDocument();
    expect(screen.getByText(/2 linhas foram rejeitadas e fica de fora/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar relatório CSV' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('pagina as rejeições pela URL e busca a página seguinte no servidor', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previaParcial({ totais: { lidas: 30, novas: 9, atualizadas: 0, rejeitadas: 21 } }));
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: /Próxima/u }));

    expect(navegacao.ler().get('rejeicoes')).toBe('2');
    expect(await screen.findByRole('rowheader', { name: '99' })).toBeInTheDocument();
  });
});

describe('flags da API na prévia', () => {
  it.each([
    ['podeConfirmar falso', { podeConfirmar: false }, false, true],
    ['podeCancelar falso', { podeCancelar: false }, true, false],
    ['sem versão da prévia', { versaoDaPrevia: null }, false, true],
  ] as const)('%s: a tela segue a API mesmo com a permissão', async (_caso, sobrescritas, confirmar, cancelar) => {
    abrirTentativa(previa(sobrescritas));
    renderizar();

    await screen.findByText(/Todas as 6 linhas lidas são válidas/u);
    expect(screen.queryByRole('button', { name: 'Confirmar importação' }) !== null).toBe(confirmar);
    expect(screen.queryByRole('button', { name: 'Cancelar importação' }) !== null).toBe(cancelar);
  });

  it('sem nenhuma das duas ações, explica o que fazer', async () => {
    abrirTentativa(previa({ podeConfirmar: false, podeCancelar: false }));
    renderizar();

    expect(await screen.findByText(/Esta prévia não aceita mais confirmação nem cancelamento/u)).toBeInTheDocument();
  });
});

describe('zero linhas válidas', () => {
  it('termina como rejeitada, sem confirmar, com os motivos e a pendência explicada', async () => {
    abrirTentativa(
      previa({
        estado: 'REJEITADA',
        totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 },
        amostraRejeicoes: [rejeicao(), rejeicao({ numeroDaLinha: 5, codigoDeErro: 'CICLO_HIERARQUICO' })],
        podeConfirmar: false,
        podeCancelar: false,
        finalizadoEm: '2026-10-08T12:31:00.000Z',
      }),
    );
    const { container } = renderizar();

    expect(await screen.findByRole('heading', { name: 'Nenhuma linha foi aplicada' })).toBeInTheDocument();
    expect(screen.getByText(/pendência de plano de contas segue aberta/u)).toBeInTheDocument();
    expect(screen.getByText('Ciclo na hierarquia')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('confirmação', () => {
  it('em andamento: o diálogo trava e a tela diz o que está acontecendo', async () => {
    const usuario = userEvent.setup();
    backend.estado.confirmar = () => new Promise<Response>(() => undefined);
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('4 contas novas serão incluídas e 2 existentes serão atualizadas pelo código');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByText(/Confirmação em andamento/u)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Confirmar importação' })).toBeDisabled();
    expect(within(dialogo).getByRole('button', { name: 'Confirmar importação' })).toHaveAttribute('aria-busy', 'true');
  });

  it('concluída: mostra o desfecho e confirma por toast de sucesso', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeInTheDocument();
    expect(screen.getByText(/4 contas novas incluídas e 2 atualizadas/u)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Importação concluída: 4 contas novas e 2 atualizadas.');
    const corpo = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/confirmar'))?.[1]?.body;
    expect(corpo).toBe(JSON.stringify({ versaoDaPrevia: 3 }));
  });

  it('concluída com rejeições: toast warning com o atalho do relatório', async () => {
    const usuario = userEvent.setup();
    const downloads = instalarDownloads();
    backend.estado.confirmar = () =>
      json(previaParcial({ estado: 'CONCLUIDA_COM_REJEICOES', finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    abrirTentativa(previaParcial());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByRole('heading', { name: 'Importação concluída com rejeições' })).toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalledWith(
      'Importação concluída com ressalvas: 3 contas novas e 1 atualizada; 2 linhas rejeitadas.',
      expect.objectContaining({ duration: 8000, action: expect.objectContaining({ label: 'Baixar relatório' }) }),
    );

    const opcoes = vi.mocked(toast.warning).mock.calls[0]?.[1];
    const acao = opcoes?.action;
    if (typeof acao === 'object' && acao !== null && 'onClick' in acao) {
      Reflect.apply(acao.onClick, undefined, []);
    }
    await waitFor(() => expect(downloads.criar).toHaveBeenCalled());
  });
});

describe('cancelada', () => {
  it('cancela pelo diálogo, preserva a tentativa e diz que o plano não mudou', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Cancelar importação' }));
    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Nenhuma conta é criada ou alterada');
    expect(within(dialogo).getByRole('button', { name: 'Manter prévia' })).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar importação' }));

    expect(await screen.findByRole('heading', { name: 'Importação cancelada' })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Importação cancelada. O plano de contas não foi alterado.');
  });
});

describe('falha técnica', () => {
  it('mostra o diagnóstico fechado, o correlationId copiável e a nova tentativa', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(
      previa({
        estado: 'FALHA',
        totais: null,
        versaoDaPrevia: null,
        relatorioDisponivel: false,
        correlationId: 'corr-falha-777',
        diagnostico: { codigo: 'ARMAZENAMENTO_INDISPONIVEL', mensagem: 'O arquivo não pôde ser lido do armazenamento. Envie de novo.' },
      }),
    );
    const { container } = renderizar();

    expect(await screen.findByRole('heading', { name: 'A importação falhou por um problema técnico' })).toBeInTheDocument();
    expect(screen.getByText('O arquivo não pôde ser lido do armazenamento. Envie de novo.')).toBeInTheDocument();
    expect(screen.getByText('corr-falha-777')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Baixar relatório CSV' })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Copiar código de suporte' }));
    expect(await navigator.clipboard.readText()).toBe('corr-falha-777');
    expect(toast.success).toHaveBeenCalledWith('Código de suporte copiado.');
    expect(await axe(container)).toHaveNoViolations();

    await usuario.click(screen.getByRole('button', { name: 'Enviar nova tentativa' }));
    expect(navegacao.ler().get('tentativa')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
  });
});

describe('conflito por plano alterado', () => {
  it('mostra o estado com foco, sem confirmar de novo, e cancela para validar de novo', async () => {
    const usuario = userEvent.setup();
    backend.estado.confirmar = () => problema(409, 'CONFLITO_DE_VERSAO');
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    // O diálogo dá lugar ao estado na tela, que recebe o foco: o toast seria uma terceira cópia.
    const titulo = await screen.findByText('O plano de contas mudou depois desta validação');
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole('button', { name: 'Cancelar e validar novamente' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar prévia' }));

    await waitFor(() => expect(navegacao.ler().get('tentativa')).toBeNull());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/cancelar'))).toBe(true);
    expect(await screen.findByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
  });
});

describe('histórico', () => {
  it('lista 15 por página, abre a tentativa pela URL e pagina pela URL', async () => {
    const usuario = userEvent.setup();
    backend.estado.historico = [
      tentativaDoHistorico({
        estado: 'CONCLUIDA_COM_REJEICOES',
        totais: { lidas: 6, novas: 3, atualizadas: 1, rejeitadas: 2 },
        usuarioConfirmadorOuCancelador: { id: '55555555-5555-4555-8555-555555555555', nome: 'Bruno Reis' },
      }),
    ];
    backend.estado.lerHistorico = () =>
      json({ pagina: 1, itensPorPagina: 15, total: 16, itens: backend.estado.historico });
    backend.estado.tentativa = previaParcial({ estado: 'CONCLUIDA_COM_REJEICOES' });
    const { container } = renderizar();

    const tabela = await screen.findByRole('table', { name: /Importações do plano de contas/u });
    expect(within(tabela).getByText('Concluída com rejeições')).toBeInTheDocument();
    expect(within(tabela).getByText('confirmada por Bruno Reis')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await usuario.click(screen.getByRole('button', { name: /Próxima/u }));
    expect(navegacao.ler().get('historico')).toBe('2');

    await usuario.click(within(tabela).getByRole('button', { name: /Abrir a importação de plano-legado.csv/u }));
    expect(navegacao.ler().get('tentativa')).toBe(TENTATIVA);
    expect(await screen.findByRole('heading', { name: 'Importação concluída com rejeições' })).toBeInTheDocument();
  });

  it('indisponível: só a seção mostra o erro, com código e nova tentativa', async () => {
    const usuario = userEvent.setup();
    let falhar = true;
    backend.estado.lerHistorico = () =>
      falhar ? problema(500, 'FALHA_TECNICA', {}, 'corr-hist-500') : json({ pagina: 1, itensPorPagina: 15, total: 0, itens: [] });
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Não foi possível carregar o histórico de importações' })).toBeInTheDocument();
    expect(screen.getByText('corr-hist-500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();

    falhar = false;
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('heading', { name: 'Nenhuma importação ainda' })).toBeInTheDocument();
  });

  it('avisa a tentativa que ainda aguarda confirmação quando a aba abre sem tentativa', async () => {
    const usuario = userEvent.setup();
    backend.estado.historico = [tentativaDoHistorico({ estado: 'AGUARDANDO_CONFIRMACAO', fimEm: null })];
    backend.estado.tentativa = previa();
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Abrir importação' }));

    expect(navegacao.ler().get('tentativa')).toBe(TENTATIVA);
    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
  });
});

describe('relatório indisponível', () => {
  it('diz que falhou, mantém o histórico e o mesmo botão tenta de novo', async () => {
    const usuario = userEvent.setup();
    const downloads = instalarDownloads();
    let falhar = true;
    backend.estado.baixar = () =>
      falhar ? problema(409, 'ESTADO_INVALIDO_PARA_ACAO', {}, 'corr-rel-409') : new Response('linha\r\n', { status: 200 });
    backend.estado.historico = [tentativaDoHistorico({ estado: 'CONCLUIDA_COM_REJEICOES' })];
    abrirTentativa(previaParcial({ estado: 'CONCLUIDA_COM_REJEICOES' }));
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Baixar relatório CSV' }));

    const alerta = await screen.findByText(/O relatório não está disponível agora/u);
    expect(alerta).toHaveTextContent('corr-rel-409');
    expect(screen.getByRole('table', { name: /Importações do plano de contas/u })).toBeInTheDocument();
    expect(downloads.criar).not.toHaveBeenCalled();

    falhar = false;
    await usuario.click(screen.getByRole('button', { name: 'Tentar baixar de novo o relatório' }));
    await waitFor(() => expect(downloads.criar).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/O relatório não está disponível agora/u)).not.toBeInTheDocument();
  });
});

describe('permissão insuficiente', () => {
  it('quem só consulta não vê envio nem confirmação, mas vê histórico e relatório', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    abrirTentativa(previaParcial());
    const { container } = renderizar();

    expect(await screen.findByText(/feito por quem tem a permissão Confirmar importação/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar importação' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar relatório CSV' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('quem só consulta não recebe a zona de envio do CSV', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    renderizar();

    expect(
      await screen.findByText('Seu papel pode consultar o plano de contas, mas não tem permissão para importar.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo CSV do plano de contas')).not.toBeInTheDocument();
  });

  it('empresa arquivada é só consulta, mesmo para quem pode importar', async () => {
    renderizar(true);

    expect(await screen.findByText(/Empresa arquivada: o plano e o histórico ficam para consulta/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
  });

  it('tentativa de outra empresa aparece como não encontrada, sem dado algum', async () => {
    backend.estado.lerTentativa = () => problema(404, 'TENTATIVA_NAO_ENCONTRADA');
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Importação não encontrada nesta empresa' })).toBeInTheDocument();
  });
});

describe('plano vigente', () => {
  it('lista as contas com sintéticas como grupo e busca pela URL com atraso', async () => {
    const usuario = userEvent.setup();
    backend.estado.contas = [
      conta(),
      conta({ id: '66666666-6666-4666-8666-666666666666', codigo: '1.1', nome: 'Caixa', tipo: 'analitica', contaPai: '1' }),
      conta({ id: '77777777-7777-4777-8777-777777777777', codigo: '9', nome: 'Antiga', tipo: 'analitica', arquivada: true }),
    ];
    const { container } = renderizar();

    const tabela = await screen.findByRole('table', { name: /Contas do plano vigente/u });
    expect(within(tabela).getByRole('rowheader', { name: '1.1' })).toBeInTheDocument();
    expect(within(tabela).getByText('Arquivada')).toBeInTheDocument();
    expect(within(tabela).getAllByText('raiz')).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();

    await usuario.type(screen.getByRole('searchbox', { name: 'Buscar por código ou nome' }), 'Caixa');

    await waitFor(() => expect(navegacao.ler().get('busca')).toBe('Caixa'));
    expect(navegacao.replace).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/contas?pagina=1&busca=Caixa'))).toBe(true),
    );
  });
});

describe('histórico do navegador', () => {
  it('abrir e fechar a tentativa criam entrada (o "voltar" funciona); paginar só troca a URL', async () => {
    const usuario = userEvent.setup();
    backend.estado.historico = [tentativaDoHistorico()];
    backend.estado.lerHistorico = () =>
      json({ pagina: 1, itensPorPagina: 15, total: 16, itens: backend.estado.historico });
    backend.estado.tentativa = previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' });
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: /Próxima/u }));
    expect(navegacao.replace).toHaveBeenCalledTimes(1);
    expect(navegacao.push).not.toHaveBeenCalled();

    await usuario.click(await screen.findByRole('button', { name: /Abrir a importação de plano-legado.csv/u }));
    expect(navegacao.push).toHaveBeenCalledTimes(1);
    expect(navegacao.ler().get('tentativa')).toBe(TENTATIVA);

    await usuario.click(await screen.findByRole('button', { name: 'Fechar tentativa' }));
    expect(navegacao.push).toHaveBeenCalledTimes(2);
    expect(navegacao.ler().get('tentativa')).toBeNull();
  });

  it('busca digitada não sobrescreve a que mudou por fora (voltar do navegador)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    backend.estado.contas = [conta()];
    renderizar();

    const campo = await screen.findByRole('searchbox', { name: 'Buscar por código ou nome' });
    await usuario.type(campo, 'Cai');
    act(() => navegacao.definir('aba=plano-contas&busca=Ativo'));

    await waitFor(() => expect(campo).toHaveValue('Ativo'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(navegacao.ler().get('busca')).toBe('Ativo');
    expect(navegacao.replace).not.toHaveBeenCalled();
  });

  it('router.replace lento: a tecla digitada enquanto a URL não chegou não se perde', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // A navegação do App Router é assíncrona: a URL só reflete o `replace` depois.
    navegacao.replace.mockImplementation((destino: string) => {
      setTimeout(() => navegacao.definir(destino.slice(destino.indexOf('?') + 1)), 500);
    });
    backend.estado.contas = [conta()];
    renderizar();

    const campo = await screen.findByRole('searchbox', { name: 'Buscar por código ou nome' });
    await usuario.type(campo, 'Cai');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(navegacao.replace).toHaveBeenCalledTimes(1);

    // Digita antes de a URL refletir "Cai"; o eco da própria publicação não apaga o rascunho.
    await usuario.type(campo, 'x');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(campo).toHaveValue('Caix');
    await waitFor(() => expect(navegacao.ler().get('busca')).toBe('Caix'));
    // Volta ao dublê original (o `mockReset` do Vitest 3 restaura a implementação de `vi.fn(impl)`).
    navegacao.replace.mockReset();
  });
});
