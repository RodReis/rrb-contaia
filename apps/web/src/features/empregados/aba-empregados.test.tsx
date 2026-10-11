/**
 * Estados obrigatórios da aba "Empregados" (SPEC-014 §5.3), um teste por estado, com axe nos
 * principais, teclado e a base em consulta. A API é dublada no `fetch` (problem+json nas recusas);
 * a URL é dublada com estado, para `?tentativa=` ser a mesma que a tela navega.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbaEmpregados } from './aba-empregados';
import {
  BASE,
  Envolvido,
  SO_CONSULTA,
  TENTATIVA,
  criarBackend,
  csvDoModelo,
  csvLegado,
  desinstalarDownloads,
  empregado,
  instalarDownloads,
  instalarFetch,
  json,
  navegacao,
  previa,
  previaParcial,
  problema,
  rejeicao,
  tentativaDoHistorico,
} from './empregados.fixtures';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { navegacao: url } = await import('./empregados.fixtures');

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
  render(<AbaEmpregados empresaId="empresa-1" nomeDaEmpresa="Padaria Aurora" somenteLeitura={somenteLeitura} />, {
    wrapper: Envolvido,
  });

const abrirTentativa = (tentativa: ReturnType<typeof previa>): void => {
  backend.estado.tentativa = tentativa;
  navegacao.definir(`aba=empregados&tentativa=${TENTATIVA}`);
};

const cartaoDaImportacao = (): HTMLElement => screen.getByRole('region', { name: /Importação/u });

const enviados = (): number => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST').length;

beforeEach(() => {
  vi.clearAllMocks();
  navegacao.definir('aba=empregados');
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
    backend.estado.lerBase = () => new Promise<Response>(() => undefined);
    navegacao.definir(`aba=empregados&tentativa=${TENTATIVA}`);

    renderizar();

    expect(await screen.findByText('Carregando a importação')).toBeInTheDocument();
    expect(screen.getByText('Carregando o histórico de importações').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Carregando os empregados').closest('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('sem empregado e sem tentativa', () => {
  it('convida a importar, explica a pendência e diz que o histórico está vazio', async () => {
    const { container } = renderizar();

    expect(await screen.findByRole('heading', { level: 2, name: 'Empregados' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Esta empresa ainda não tem empregados importados' })).toBeInTheDocument();
    expect(screen.getByText(/pendência de empregados não importados na Central de Pendências/u)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Nenhuma importação ainda' })).toBeInTheDocument();
    expect(within(cartaoDaImportacao()).getByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
    expect(screen.getByLabelText('Arquivo CSV dos empregados')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('explica o arquivo: só CSV, 10 MB, 10.000 linhas e os cinco campos obrigatórios', async () => {
    renderizar();
    const regras = await screen.findByRole('complementary', { name: 'Como preparar o CSV' });

    for (const rotulo of ['CPF', 'Nome completo', 'Matrícula', 'Data de nascimento', 'Data de admissão']) {
      expect(within(regras).getByText(rotulo)).toBeInTheDocument();
    }
    expect(regras).toHaveTextContent('10 MB');
    expect(regras).toHaveTextContent('10.000');
    expect(within(regras).getByText(/repetida no arquivo rejeita todas as linhas/u)).toBeInTheDocument();
    expect(await within(regras).findByRole('button', { name: 'Baixar modelo CSV' })).toBeInTheDocument();
    expect(regras.textContent).not.toMatch(/xlsx|ods|planilha/iu);
  });

  it('não promete o que a fatia não entrega: cargo, salário, dependentes, folha, eSocial, IA', async () => {
    const { container } = renderizar();
    await screen.findByRole('heading', { name: 'Nenhuma importação ainda' });

    expect(container.textContent).not.toMatch(/cargo|salário|dependente|folha|eSocial|vetoriza|sugest|plano de contas/iu);
    expect(container.textContent).not.toMatch(/\bIA\b/u);
  });
});

describe('arquivo selecionado', () => {
  it('lê o cabeçalho e mostra o mapeamento dos cinco campos já escolhidos pelo modelo', async () => {
    const usuario = userEvent.setup();
    const { container } = renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV dos empregados'), csvDoModelo());

    expect(await screen.findByText('Associe as colunas do arquivo')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^CPF/u })).toHaveTextContent('cpf');
    expect(screen.getByRole('combobox', { name: /Data de admissão/u })).toHaveTextContent('data_admissao');
    expect(screen.getByRole('table', { name: /Amostra das primeiras linhas/u })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('arquivo rejeitado antes do envio', () => {
  it.each([
    ['formato .xls, ainda recusado (SPEC-015 §3.1)', new File(['x'], 'empregados.xls', { type: 'application/vnd.ms-excel' }), 'O formato .xls (Excel 97-2003) não é aceito.'],
    ['CSV só com cabeçalho', new File(['cpf;nome\n'], 'vazio.csv', { type: 'text/csv' }), 'O arquivo não tem nenhuma linha de dados para importar.'],
    ['acima de 10 MB', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.csv', { type: 'text/csv' }), 'Arquivo acima do limite de 10 MB.'],
  ])('recusa %s sem enviar nada', async (_caso, arquivo, motivo) => {
    const usuario = userEvent.setup({ applyAccept: false });
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV dos empregados'), arquivo);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(`Arquivo recusado antes do envio: ${arquivo.name}`);
    expect(alerta).toHaveTextContent(motivo);
    expect(enviados()).toBe(0);
  });
});

describe('mapeamento incompleto ou inválido', () => {
  it('destaca os campos que faltam, leva o foco ao primeiro e não envia', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV dos empregados'), csvLegado());
    await usuario.click(await screen.findByRole('button', { name: /Validar arquivo/u }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('O mapeamento ainda não pode ser validado');
    expect(alerta).toHaveTextContent('CPF');
    expect(alerta).toHaveTextContent('Data de admissão');
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^CPF/u })).toHaveFocus());
    expect(enviados()).toBe(0);
  });

  it('o envio leva multipart com `arquivo` e o mapeamento JSON dos cinco campos', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.upload(await screen.findByLabelText('Arquivo CSV dos empregados'), csvDoModelo());
    await usuario.click(await screen.findByRole('button', { name: /Validar arquivo/u }));

    await waitFor(() => expect(enviados()).toBe(1));
    const [url, init] = vi.mocked(fetch).mock.calls.find(([, opcoes]) => opcoes?.method === 'POST') ?? [];
    expect(String(url)).toBe(`${BASE}/importacoes`);
    const corpo = init?.body instanceof FormData ? init.body : null;
    expect(corpo?.get('arquivo')).toBeInstanceOf(File);
    expect(JSON.parse(String(corpo?.get('mapeamento')))).toEqual({
      cpf: 'cpf',
      nome: 'nome',
      matricula: 'matricula',
      data_nascimento: 'data_nascimento',
      data_admissao: 'data_admissao',
    });
    expect(await screen.findByText('Validando o arquivo inteiro')).toBeInTheDocument();
  });
});

describe('validação em andamento', () => {
  it('mostra o progresso nas palavras de empregado e anuncia sem repetir', async () => {
    abrirTentativa(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }));
    const { container } = renderizar();

    expect(await screen.findByText('Validando o arquivo inteiro')).toBeInTheDocument();
    expect(screen.getByText(/conferida contra a base atual.*Nenhum empregado muda antes da sua confirmação/u)).toBeInTheDocument();
    const anuncio = container.querySelector('[aria-live="polite"]');
    expect(anuncio).toHaveTextContent('Validando o arquivo.');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('prévia', () => {
  it('sem rejeições: totais, mapeamento usado e decisão', async () => {
    abrirTentativa(previa());
    const { container } = renderizar();

    expect(await screen.findByText(/Todas as 6 linhas lidas são válidas/u)).toBeInTheDocument();
    expect(screen.getByText('Nome completo:')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Linhas rejeitadas' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar importação' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('aceitação parcial: rejeições com linha, CPF mascarado, matrícula com zeros, campo e código estável', async () => {
    abrirTentativa(previaParcial());
    const { container } = renderizar();

    const tabela = await screen.findByRole('table', { name: /Linhas rejeitadas de empregados-legado.csv/u });
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Linha', 'CPF', 'Matrícula', 'Campo', 'Erro', 'O que fazer']);
    const linhas = within(tabela).getAllByRole('row');
    expect(linhas[1]).toHaveTextContent('529.982.247-25');
    // O CPF é lido de uma vez, nunca partido caractere a caractere numa coluna estreita.
    expect(within(linhas[1] as HTMLElement).getByText('529.982.247-25')).toHaveClass('whitespace-nowrap');
    // CPF e matrícula juntos: a tabela aperta o respiro para "O que fazer" caber no cartão, sem ficar fora da borda.
    const celulas = within(linhas[1] as HTMLElement).getAllByRole('cell');
    expect(celulas.at(-1)).toHaveClass('min-w-[10rem]', 'px-sm');
    expect(linhas[1]).toHaveTextContent('00123');
    expect(linhas[1]).toHaveTextContent('CPF e matrícula repetidos no arquivo');
    expect(linhas[1]).toHaveTextContent('CHAVE_DUPLICADA_NO_ARQUIVO');
    expect(linhas[1]).toHaveTextContent('todas as ocorrências foram rejeitadas');
    expect(linhas[2]).toHaveTextContent('CPF com dígito verificador inválido.');
    expect(screen.getByText(/2 linhas foram rejeitadas e fica de fora/u)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('zero linhas válidas: rejeitada, nenhuma confirmação e a pendência explicada', async () => {
    abrirTentativa(
      previa({
        estado: 'REJEITADA',
        totais: { lidas: 2, novas: 0, atualizadas: 0, rejeitadas: 2 },
        amostraRejeicoes: [rejeicao(), rejeicao({ numeroDaLinha: 5 })],
        podeConfirmar: false,
        podeCancelar: false,
        finalizadoEm: '2026-10-08T12:31:00.000Z',
      }),
    );
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Nenhuma linha foi aplicada' })).toBeInTheDocument();
    expect(screen.getByText(/pendência de empregados não importados segue aberta/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
  });

  it('o diálogo de confirmação nomeia a empresa e os números da decisão', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previaParcial());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    const dialogo = await screen.findByRole('alertdialog');

    expect(dialogo).toHaveTextContent('Confirmar a importação de empregados-legado.csv em Padaria Aurora?');
    expect(dialogo).toHaveTextContent('3 empregados novos serão incluídos e 1 existente será atualizado por CPF e matrícula');
    expect(dialogo).toHaveTextContent('2 linhas rejeitadas ficam de fora e no relatório.');
    expect(dialogo).toHaveTextContent('Empregados que não estão no arquivo continuam como estão.');
  });
});

describe('teclado', () => {
  it('o diálogo prende o foco, fecha com Esc e devolve o foco ao acionador', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previa());
    renderizar();

    const confirmar = await screen.findByRole('button', { name: 'Confirmar importação' });
    confirmar.focus();
    await usuario.keyboard('{Enter}');
    const dialogo = await screen.findByRole('alertdialog');
    await usuario.tab();
    await usuario.tab();
    await usuario.tab();
    expect(dialogo.contains(document.activeElement)).toBe(true);

    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(confirmar).toHaveFocus());
  });

  it('o upload é alcançável por Tab e aciona o seletor de arquivo', async () => {
    const usuario = userEvent.setup();
    renderizar();
    const escolher = await screen.findByRole('button', { name: 'Escolher arquivo CSV' });
    const entrada = screen.getByLabelText<HTMLInputElement>('Arquivo CSV dos empregados');
    const clique = vi.spyOn(entrada, 'click');

    // Teto de Tabs: se o botão sair da ordem de foco, o teste falha dizendo isso, em vez de girar para sempre.
    for (let passos = 0; document.activeElement !== escolher; passos += 1) {
      if (passos >= 30) {
        throw new Error('“Escolher arquivo CSV” não foi alcançado em 30 Tabs');
      }
      await usuario.tab();
    }
    await usuario.keyboard('{Enter}');

    expect(clique).toHaveBeenCalled();
  });
});

describe('confirmação', () => {
  it('em andamento: diz que está aplicando e bloqueia reentrada', async () => {
    const usuario = userEvent.setup();
    backend.estado.confirmar = () => new Promise<Response>(() => undefined);
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByText('Confirmação em andamento: aplicando as linhas válidas à base de empregados.')).toBeInTheDocument();
  });

  it('concluída: desfecho, toast de sucesso e base relida', async () => {
    const usuario = userEvent.setup();
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    backend.estado.empregados = [empregado()];
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeInTheDocument();
    expect(screen.getByText(/4 empregados novos incluídos e 2 atualizados/u)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Importação concluída: 4 empregados novos e 2 atualizados.');
    expect(await screen.findByText('Ana Beatriz Lima')).toBeInTheDocument();
  });

  it('concluída com rejeições: toast warning com o relatório, e o estado fica na tela', async () => {
    const usuario = userEvent.setup();
    instalarDownloads();
    backend.estado.confirmar = () =>
      json(previaParcial({ estado: 'CONCLUIDA_COM_REJEICOES', finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    abrirTentativa(previaParcial());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByRole('heading', { name: 'Importação concluída com rejeições' })).toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalledWith(
      'Importação concluída com ressalvas: 3 empregados novos e 1 atualizado; 2 linhas rejeitadas.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Baixar relatório' }) }),
    );
  });

  it('conflito 409: base alterada, nada aplicado, valide novamente', async () => {
    const usuario = userEvent.setup();
    backend.estado.confirmar = () => problema(409, 'CONFLITO_DE_VERSAO');
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    const titulo = await screen.findByText('A base de empregados mudou depois desta validação');
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(screen.getByText(/Nenhum empregado foi alterado/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar e validar novamente' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('falha técnica na aplicação: toast nas palavras de empregado, com o código de suporte', async () => {
    const usuario = userEvent.setup();
    backend.estado.confirmar = () => problema(500, 'FALHA_TECNICA', {}, 'corr-falha-500');
    abrirTentativa(previa());
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar importação' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A importação falhou por um problema técnico. Nenhum empregado foi alterado; envie o arquivo de novo para uma nova tentativa.',
        expect.objectContaining({ description: 'Código de suporte: corr-falha-500' }),
      ),
    );
  });
});

describe('desfechos', () => {
  it('cancelada: nada mudou na base', async () => {
    abrirTentativa(previa({ estado: 'CANCELADA', podeConfirmar: false, podeCancelar: false, finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Importação cancelada' })).toBeInTheDocument();
    expect(screen.getByText(/Nenhum empregado foi incluído ou alterado/u)).toBeInTheDocument();
  });

  it('falha técnica: mensagem persistente, código de suporte copiável e nova tentativa', async () => {
    abrirTentativa(
      previa({
        estado: 'FALHA',
        podeConfirmar: false,
        podeCancelar: false,
        correlationId: 'corr-falha-777',
        diagnostico: { codigo: 'FALHA_NA_APLICACAO', mensagem: 'A aplicação falhou e nenhum empregado foi alterado.' },
        finalizadoEm: '2026-10-08T12:35:00.000Z',
      }),
    );
    const { container } = renderizar();

    expect(await screen.findByRole('heading', { name: 'A importação falhou por um problema técnico' })).toBeInTheDocument();
    expect(screen.getByText('A aplicação falhou e nenhum empregado foi alterado.')).toBeInTheDocument();
    expect(screen.getByText('corr-falha-777')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar código de suporte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar nova tentativa' })).toBeInTheDocument();
    expect(screen.getByText(/a base de empregados não mudou/u)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('histórico', () => {
  it('lista a tentativa e abre pela URL', async () => {
    const usuario = userEvent.setup();
    backend.estado.historico = [tentativaDoHistorico()];
    backend.estado.tentativa = previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-07T15:02:00.000Z' });
    renderizar();

    const tabela = await screen.findByRole('table', { name: /Importações de empregados, página 1/u });
    await usuario.click(within(tabela).getByRole('button', { name: /Abrir a importação de empregados-legado.csv/u }));

    expect(navegacao.push).toHaveBeenLastCalledWith(`/empresas/empresa-1?aba=empregados&tentativa=${TENTATIVA}`, {
      scroll: false,
    });
  });

  it('indisponível: erro só na seção, com código de suporte e nova tentativa', async () => {
    backend.estado.lerHistorico = () => problema(503, 'FALHA_TECNICA', {}, 'corr-hist-503');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar o histórico de importações')).toBeInTheDocument();
    expect(screen.getByText('corr-hist-503')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher arquivo CSV' })).toBeInTheDocument();
  });

  it('relatório indisponível: a falha fica ao lado do botão e o mesmo botão tenta de novo', async () => {
    const usuario = userEvent.setup();
    instalarDownloads();
    backend.estado.baixar = () => problema(409, 'ARQUIVO_INDISPONIVEL', {}, 'corr-rel-409');
    abrirTentativa(previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Baixar relatório CSV' }));

    expect(await screen.findByText(/O relatório não está disponível agora/u)).toBeInTheDocument();
    expect(screen.getByText('corr-rel-409')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar baixar de novo o relatório' })).toBeInTheDocument();
  });
});

describe('histórico — nome de arquivo', () => {
  it('nome longo fica numa linha com reticências, e o nome inteiro segue no título e no botão', async () => {
    const nome = `${'empregados-legado-'.repeat(6)}final.csv`;
    backend.estado.historico = [tentativaDoHistorico({ arquivo: { nome, tamanho: 2048, hash: 'b'.repeat(64) } })];
    renderizar();

    const tabela = await screen.findByRole('table', { name: /Importações de empregados, página 1/u });
    const celula = within(tabela).getByText(nome);
    expect(celula).toHaveClass('truncate');
    expect(celula).toHaveAttribute('title', nome);
    expect(within(tabela).getByRole('button', { name: new RegExp(`Abrir a importação de ${nome}`, 'u') })).toBeInTheDocument();
  });
});

describe('base em consulta', () => {
  it('lista os empregados com CPF mascarado em mono, matrícula preservada e datas civis, sem editar', async () => {
    backend.estado.empregados = [
      empregado(),
      empregado({ id: '77777777-7777-4777-8777-777777777777', nome: 'Bruno Costa', cpf: '11144477735', matricula: '7', arquivado: true }),
    ];
    const { container } = renderizar();

    const tabela = await screen.findByRole('table', { name: /Empregados da base, página 1/u });
    const ana = within(tabela).getByRole('row', { name: /Ana Beatriz Lima/u });
    const cpf = within(ana).getByText('529.982.247-25');
    expect(cpf).toHaveClass('font-mono', 'tabular-nums');
    expect(ana).toHaveTextContent('00123');
    expect(ana).toHaveTextContent('14/02/1990');
    expect(ana).toHaveTextContent('02/03/2015');
    expect(ana).toHaveTextContent('Ativo');
    expect(within(tabela).getByRole('row', { name: /Bruno Costa/u })).toHaveTextContent('Arquivado');
    // Ativo e Arquivado são o mesmo selo (só muda o tom): a linha da arquivada não fica mais alta.
    const ativo = within(ana).getByText('Ativo');
    const arquivado = within(tabela).getByText('Arquivado');
    expect(ativo).toHaveClass('inline-flex', 'py-xs', 'px-sm');
    expect(arquivado).toHaveClass('inline-flex', 'py-xs', 'px-sm');
    expect(ativo.closest('td')).toHaveClass('text-label-sm');
    // O tamanho `code-sm` do mono não pode ser descartado pela fusão de classes (cor e tamanho são `text-*`).
    expect(cpf.closest('td')).toHaveClass('text-code-sm');
    expect(screen.getByText(/2 empregados na base/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /editar|arquivar|reativar|excluir/iu })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('pagina no servidor com a página na URL', async () => {
    const usuario = userEvent.setup();
    backend.estado.empregados = [empregado()];
    backend.estado.totalDeEmpregados = 120;
    renderizar();

    const paginacao = await screen.findByRole('navigation', { name: 'Paginação dos empregados' });
    expect(paginacao).toHaveTextContent('Página 1 de 3');
    await usuario.click(within(paginacao).getByRole('button', { name: /Próxima/u }));

    expect(navegacao.replace).toHaveBeenLastCalledWith('/empresas/empresa-1?aba=empregados&empregados=2', { scroll: false });
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === `${BASE}?pagina=2`)).toBe(true),
    );
  });

  it('busca por nome, CPF ou matrícula pela URL, com atraso', async () => {
    const usuario = userEvent.setup();
    backend.estado.empregados = [empregado()];
    renderizar();

    await usuario.type(await screen.findByRole('searchbox', { name: 'Buscar por nome, CPF ou matrícula' }), '00123');

    await waitFor(() =>
      expect(navegacao.replace).toHaveBeenLastCalledWith('/empresas/empresa-1?aba=empregados&busca=00123', { scroll: false }),
    );
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === `${BASE}?pagina=1&busca=00123`)).toBe(true),
    );
  });

  it('busca sem resultado: estado próprio, com limpar', async () => {
    backend.estado.empregados = [];
    navegacao.definir('aba=empregados&busca=zzz');
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Nenhum empregado corresponde à busca' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar busca' })).toBeInTheDocument();
  });

  it('erro ao carregar a base: só a seção, com código de suporte', async () => {
    backend.estado.lerBase = () => problema(503, 'FALHA_TECNICA', {}, 'corr-base-503');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar os empregados')).toBeInTheDocument();
    expect(screen.getByText('corr-base-503')).toBeInTheDocument();
  });

  it('conteúdo longo: nome e arquivo extensos quebram sem estourar a tabela', async () => {
    const nomeLongo = 'Maria '.repeat(30).trim();
    backend.estado.empregados = [empregado({ nome: nomeLongo })];
    abrirTentativa(previa({ arquivo: { nome: `${'empregados-'.repeat(20)}.csv`, tamanho: 2048, hash: 'b'.repeat(64) } }));
    renderizar();

    const celula = await screen.findByText(nomeLongo);
    expect(celula.className).toMatch(/overflow-wrap:anywhere|break-words/u);
    expect(await screen.findByText(/Todas as 6 linhas lidas são válidas/u)).toBeInTheDocument();
  });
});

describe('permissões', () => {
  it('só consulta: sem envio nem confirmação, com a explicação; base e relatório seguem', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    abrirTentativa(previa());
    renderizar();

    expect(
      await screen.findByText(/A confirmação ou o cancelamento desta prévia é feito por quem tem a permissão Confirmar importação/u),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar relatório CSV' })).toBeInTheDocument();
  });

  it('sem importar: explica a permissão que falta e não oferece envio', async () => {
    backend.estado.permissoes = [...SO_CONSULTA];
    renderizar();

    expect(
      await screen.findByText('Seu papel pode consultar os empregados, mas não tem permissão para importar.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Importar em Empresas → Empregados/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
  });

  it('sem baixar relatório: nenhum download oferecido', async () => {
    backend.estado.permissoes = ['empresas.empregados.consultar'];
    abrirTentativa(previa({ estado: 'CONCLUIDA', finalizadoEm: '2026-10-08T12:35:00.000Z' }));
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Baixar/u })).not.toBeInTheDocument();
  });

  it('a API nega a consulta (403): estado de permissão insuficiente, sem dado', async () => {
    backend.estado.lerHistorico = () => problema(403, 'SEM_AUTORIZACAO', {}, 'corr-403');
    backend.estado.lerBase = () => problema(403, 'SEM_AUTORIZACAO', {}, 'corr-403');
    const { container } = renderizar();

    expect(await screen.findByRole('heading', { name: 'Seu papel não pode consultar os empregados desta empresa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('o 403 aparece direto, sem esperar a nova tentativa da consulta nem mostrar erro genérico', async () => {
    let leituras = 0;
    backend.estado.lerHistorico = () => {
      leituras += 1;

      // A segunda leitura (o retry do provedor) não volta: a decisão tem de sair da primeira recusa.
      return leituras === 1 ? problema(403, 'SEM_AUTORIZACAO', {}, 'corr-403') : new Promise<Response>(() => undefined);
    };
    backend.estado.lerBase = () => problema(403, 'SEM_AUTORIZACAO', {}, 'corr-403');
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });
    render(
      <QueryClientProvider client={cliente}>
        <AbaEmpregados empresaId="empresa-1" nomeDaEmpresa="Padaria Aurora" somenteLeitura={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Seu papel não pode consultar os empregados desta empresa' })).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('empresa fora da carteira (403): estado próprio, sem dado', async () => {
    backend.estado.lerHistorico = () => problema(403, 'EMPRESA_FORA_DA_CARTEIRA', {}, 'corr-carteira');
    backend.estado.lerBase = () => problema(403, 'EMPRESA_FORA_DA_CARTEIRA', {}, 'corr-carteira');
    renderizar();

    expect(await screen.findByRole('heading', { name: 'Esta empresa não está na sua carteira' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver minha carteira' })).toHaveAttribute('href', '/carteira');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('empresa arquivada: só consulta, sem envio', async () => {
    renderizar(true);

    expect(await screen.findByText(/Empresa arquivada: os empregados e o histórico ficam para consulta/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher arquivo CSV' })).not.toBeInTheDocument();
  });
});

describe('acompanhamento', () => {
  it('ao terminar a validação, anuncia uma vez e relê o histórico', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    abrirTentativa(previa({ estado: 'VALIDANDO', totais: null, versaoDaPrevia: null }));
    const { container } = renderizar();
    await screen.findByText('Validando o arquivo inteiro');

    const leiturasDoHistorico = (): number =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/empregados/importacoes?')).length;
    await waitFor(() => expect(leiturasDoHistorico()).toBeGreaterThan(0));
    const antes = leiturasDoHistorico();

    backend.estado.tentativa = previaParcial();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    const anuncio = container.querySelector('[aria-live="polite"]');
    await waitFor(() => expect(anuncio).toHaveTextContent('Validação concluída: 2 linhas rejeitadas.'));
    await waitFor(() => expect(leiturasDoHistorico()).toBeGreaterThan(antes));
  });
});
