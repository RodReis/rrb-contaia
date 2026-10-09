/**
 * Achados da revisão final da aba "Plano de contas" (SPEC-013 §5.3, §5.4; FRONTEND.md §16, §20):
 * regiões roláveis alcançáveis por teclado, histórico que acompanha o worker sem recarregar,
 * microcopy, diálogos destrutivos sem ambiguidade, foco que não se perde e o código de suporte.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaPlanoDeContas } from './aba-plano-de-contas';
import {
  Envolvido,
  SO_CONSULTA,
  TENTATIVA,
  conta,
  criarBackend,
  csvDoModelo,
  csvLegado,
  desinstalarDownloads,
  instalarDownloads,
  instalarFetch,
  json,
  navegacao,
  previa,
  previaParcial,
  problema,
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

const renderizar = () => render(<AbaPlanoDeContas empresaId="empresa-1" somenteLeitura={false} />, { wrapper: Envolvido });

const abrirTentativa = (tentativa: ReturnType<typeof previa>): void => {
  backend.estado.tentativa = tentativa;
  navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
};

const leiturasDe = (trecho: string): number =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(trecho)).length;

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

describe('regiões roláveis na horizontal (WCAG 2.1.1, axe scrollable-region-focusable)', () => {
  const regiaoFocavel = (nome: string): HTMLElement => {
    const regiao = screen.getByRole('region', { name: nome });

    expect(regiao).toHaveAttribute('tabindex', '0');
    act(() => regiao.focus());
    expect(regiao).toHaveFocus();
    // Foco visível com os tokens do anel (FRONTEND.md §17).
    expect(regiao.className).toMatch(/focus-visible:ring-2/u);

    return regiao;
  };

  it('a tabela de rejeições é uma região focável e o código de erro quebra em qualquer ponto', async () => {
    abrirTentativa(previaParcial());
    const { container } = renderizar();
    await screen.findByRole('table', { name: /Linhas rejeitadas de plano-legado.csv/u });

    const regiao = regiaoFocavel('Tabela das rejeições, rolável na horizontal');
    expect(within(regiao).getByText('CODIGO_DUPLICADO_NO_ARQUIVO').className).toMatch(/\[overflow-wrap:anywhere\]/u);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a amostra do arquivo no mapeamento é uma região focável', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvDoModelo());
    await screen.findByRole('table', { name: /Amostra das primeiras linhas/u });

    regiaoFocavel('Tabela da amostra do arquivo, rolável na horizontal');
  });

  it('histórico e plano vigente também (consistência das tabelas largas)', async () => {
    backend.estado.historico = [tentativaDoHistorico()];
    backend.estado.contas = [conta()];
    renderizar();
    await screen.findByRole('table', { name: /Importações do plano de contas/u });
    await screen.findByRole('table', { name: /Contas do plano vigente/u });

    regiaoFocavel('Tabela das tentativas, rolável na horizontal');
    regiaoFocavel('Tabela das contas, rolável na horizontal');
  });
});

describe('o histórico acompanha o worker sem recarregar a página', () => {
  it('VALIDANDO → AGUARDANDO_CONFIRMACAO atualiza a linha do histórico e o plano', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    backend.estado.historico = [tentativaDoHistorico({ estado: 'VALIDANDO', fimEm: null })];
    abrirTentativa(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }));
    renderizar();

    const tabela = await screen.findByRole('table', { name: /Importações do plano de contas/u });
    await within(tabela).findByText('Validando');
    const contasAntes = leiturasDe('/contas?');

    // O worker termina: a próxima leitura da tentativa traz a prévia; o histórico, também.
    backend.estado.tentativa = previa();
    backend.estado.historico = [tentativaDoHistorico({ estado: 'AGUARDANDO_CONFIRMACAO', fimEm: null })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    expect(await screen.findByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(await within(tabela).findByText('Aguardando confirmação')).toBeInTheDocument();
    await waitFor(() => expect(leiturasDe('/contas?')).toBeGreaterThan(contasAntes));
  });
});

describe('microcopy (PT-BR)', () => {
  it('quem só consulta lê que não tem permissão para importar', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    renderizar();

    expect(
      await screen.findByText('Seu papel pode consultar o plano de contas, mas não tem permissão para importar.'),
    ).toBeInTheDocument();
  });

  it('campo sem coluna diz "Escolha a coluna para o campo {Rótulo}."', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await usuario.upload(await screen.findByLabelText('Arquivo CSV do plano de contas'), csvLegado());
    await usuario.click(await screen.findByRole('button', { name: 'Validar arquivo' }));

    expect(await screen.findByText('Escolha a coluna para o campo Código.')).toBeInTheDocument();
    expect(screen.getByText('Escolha a coluna para o campo Conta-pai.')).toBeInTheDocument();
  });

  it('prévia de uma linha só usa o singular', async () => {
    abrirTentativa(previa({ totais: { lidas: 1, novas: 1, atualizadas: 0, rejeitadas: 0 } }));
    renderizar();

    expect(await screen.findByText(/A única linha lida é válida\./u)).toBeInTheDocument();
    expect(screen.queryByText(/Todas as 1/u)).not.toBeInTheDocument();
  });
});

describe('seleção do arquivo (WCAG 2.4.7)', () => {
  it('o input escondido sai da ordem de Tab: o botão é quem aciona', async () => {
    renderizar();

    expect(await screen.findByLabelText('Arquivo CSV do plano de contas')).toHaveAttribute('tabindex', '-1');
  });
});

describe('diálogos destrutivos sem dois "Cancelar"', () => {
  it('cancelar a importação: a recusa é "Manter prévia" e o nome longo quebra no título', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Cancelar importação' }));
    const dialogo = await screen.findByRole('alertdialog');

    expect(within(dialogo).getByRole('button', { name: 'Manter prévia' })).toBeInTheDocument();
    expect(within(dialogo).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(within(dialogo).getByRole('heading').className).toMatch(/\[overflow-wrap:anywhere\]/u);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Manter prévia' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/cancelar'))).toBe(false);
  });

  it('cancelar a prévia obsoleta (conflito): também "Manter prévia"', async () => {
    const usuario = userEvent.setup();
    backend.estado.confirmar = () => problema(409, 'CONFLITO_DE_VERSAO');
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(await screen.findByRole('button', { name: 'Cancelar e validar novamente' }));

    expect(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Manter prévia' })).toBeInTheDocument();
  });
});

describe('resumo sem barra de proporção (FRONTEND.md §16/§21)', () => {
  it('o aproveitamento é só texto', async () => {
    abrirTentativa(previaParcial());
    renderizar();

    expect(await screen.findByText('4 linhas válidas de 6 lidas.')).toBeVisible();
    expect(screen.queryByRole('img', { name: /linhas válidas/u })).not.toBeInTheDocument();
  });
});

describe('título da seção segue o estado da tentativa', () => {
  it.each([
    ['VALIDANDO', 'Importação em andamento', previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null })],
    ['AGUARDANDO_CONFIRMACAO', 'Importação em revisão', previa()],
    ['CONCLUIDA', 'Importação encerrada', previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' })],
  ] as const)('%s → "%s"', async (_estado, titulo, tentativa) => {
    abrirTentativa(tentativa);
    renderizar();

    expect(await screen.findByRole('heading', { level: 3, name: titulo })).toBeInTheDocument();
  });
});

describe('histórico: quem decidiu', () => {
  it('FALHA depois da confirmação não diz "confirmada por"', async () => {
    backend.estado.historico = [
      tentativaDoHistorico({
        estado: 'FALHA',
        usuarioConfirmadorOuCancelador: { id: '55555555-5555-4555-8555-555555555555', nome: 'Bruno Reis' },
      }),
    ];
    renderizar();

    const tabela = await screen.findByRole('table', { name: /Importações do plano de contas/u });
    expect(within(tabela).getByText('confirmação tentada por Bruno Reis')).toBeInTheDocument();
    expect(within(tabela).queryByText('confirmada por Bruno Reis')).not.toBeInTheDocument();
  });
});

describe('foco quando o controle acionado some', () => {
  const tituloDaSecao = (): HTMLElement => screen.getByRole('heading', { level: 3, name: /^Importação/u });

  it('"Fechar tentativa" leva o foco ao título da seção', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Fechar tentativa' }));

    await waitFor(() => expect(tituloDaSecao()).toHaveFocus());
    expect(tituloDaSecao()).toHaveTextContent('Importação por CSV');
  });

  it.each([
    ['Nova importação', previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' })],
    ['Enviar nova tentativa', previa({ estado: 'FALHA', totais: null, versaoDaPrevia: null, relatorioDisponivel: false })],
  ] as const)('"%s" leva o foco ao título da seção', async (rotulo, tentativa) => {
    const usuario = userEvent.setup();
    abrirTentativa(tentativa);
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: rotulo }));

    await waitFor(() => expect(tituloDaSecao()).toHaveFocus());
  });

  it('"Tentar de novo" do aviso de leitura: quando o aviso some, o foco vai ao título', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let falhar = false;
    backend.estado.lerTentativa = () =>
      falhar ? problema(503, 'FALHA_TECNICA') : json(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }));
    navegacao.definir(`aba=plano-contas&tentativa=${TENTATIVA}`);
    renderizar();
    await screen.findByText('Validando o arquivo inteiro');

    falhar = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    const aviso = await screen.findByText('Não foi possível atualizar o andamento desta importação.');

    falhar = false;
    await usuario.click(within(aviso.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(screen.queryByText('Não foi possível atualizar o andamento desta importação.')).not.toBeInTheDocument());
    await waitFor(() => expect(tituloDaSecao()).toHaveFocus());
  });
});

describe('código de suporte da tentativa no resumo (SPEC-013 §3.9)', () => {
  it('a prévia mostra o correlationId copiável', async () => {
    abrirTentativa(previa({ correlationId: 'corr-tentativa-042' }));
    renderizar();

    expect(await screen.findByText('corr-tentativa-042')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar código de suporte' })).toBeInTheDocument();
  });

  it('na falha técnica o código aparece uma vez só, junto da mensagem persistente', async () => {
    abrirTentativa(
      previa({ estado: 'FALHA', totais: null, versaoDaPrevia: null, relatorioDisponivel: false, correlationId: 'corr-falha-1' }),
    );
    renderizar();

    expect(await screen.findByText('corr-falha-1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copiar código de suporte' })).toHaveLength(1);
  });
});

describe('falha da aplicação: totais previstos, não aplicados', () => {
  it('em FALHA os totais de novas e atualizadas são rotulados como previstos', async () => {
    abrirTentativa(
      previa({
        estado: 'FALHA',
        totais: { lidas: 6, novas: 4, atualizadas: 2, rejeitadas: 0 },
        relatorioDisponivel: true,
        finalizadoEm: '2026-10-08T12:35:00.000Z',
      }),
    );
    renderizar();

    expect(await screen.findByText('Novas previstas')).toBeInTheDocument();
    expect(screen.getByText('Atualizadas previstas')).toBeInTheDocument();
    expect(screen.queryByText('Novas', { selector: 'dt' })).not.toBeInTheDocument();
  });
});

describe('download que falhou', () => {
  it('o botão diz o que vai tentar de novo', async () => {
    const usuario = userEvent.setup();
    instalarDownloads();
    backend.estado.baixar = () => problema(409, 'ESTADO_INVALIDO_PARA_ACAO', {}, 'corr-rel-409');
    abrirTentativa(previaParcial({ estado: 'CONCLUIDA_COM_REJEICOES' }));
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Baixar relatório CSV' }));

    expect(await screen.findByRole('button', { name: 'Tentar baixar de novo o relatório' })).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Baixar arquivo enviado' }));
    expect(await screen.findByRole('button', { name: 'Tentar baixar de novo o arquivo enviado' })).toBeInTheDocument();
  });
});
