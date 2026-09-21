/**
 * Provas de tela da manutenção da empresa (TESTING.md §3.5, SPEC-003 §9).
 *
 * A API é dublada no nível do `fetch`: o que se prova aqui é a tela — as três
 * abas, o CNPJ bloqueado, a comparação campo a campo com a CNPJá, a empresa
 * arquivada em modo de consulta e a acessibilidade.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManutencaoDaEmpresa } from './manutencao-da-empresa';
import type { VisaoDaEmpresa } from './api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const visao = (situacao: 'ativo' | 'arquivado' = 'ativo'): VisaoDaEmpresa => ({
  id: 'empresa-1',
  situacao,
  cadastro: {
    status: 'ATIVA',
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
  podeAtivar: false,
  exigeConfirmacaoDeSituacaoExterna: false,
});

const respostaJson = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });

const Envolvido = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderizar = (situacao: 'ativo' | 'arquivado' = 'ativo') =>
  render(<ManutencaoDaEmpresa visao={visao(situacao)} arquivada={situacao === 'arquivado'} />, {
    wrapper: Envolvido,
  });

const responderCom = (...respostas: Response[]): void => {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  for (const resposta of respostas) {
    mock.mockResolvedValueOnce(resposta);
  }
};

beforeEach(() => {
  // Sem resposta padrão na fila: as abas só buscam quando abertas, e uma
  // resposta enfileirada "por garantia" seria consumida pela primeira chamada
  // real do teste — foi o que escondeu o resultado da CNPJá.
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('abas da manutenção (§3.1)', () => {
  it('oferece Identificação, Dados fiscais, Endereços e Documentos', () => {
    renderizar();

    const abas = screen.getByRole('tablist', { name: /seções da empresa/iu });

    expect(within(abas).getByRole('tab', { name: 'Identificação' })).toBeInTheDocument();
    expect(within(abas).getByRole('tab', { name: 'Dados fiscais' })).toBeInTheDocument();
    expect(within(abas).getByRole('tab', { name: 'Endereços' })).toBeInTheDocument();
    // A aba Documentos entrou na F4 (SPEC-004); as provas dela ficam em
    // `aba-de-documentos.test.tsx`.
    expect(within(abas).getByRole('tab', { name: 'Documentos' })).toBeInTheDocument();
  });
});

describe('CNPJ imutável (§3.2)', () => {
  it('exibe o CNPJ formatado sem oferecer edição', () => {
    renderizar();

    expect(screen.getAllByText('11.222.333/0001-81').length).toBeGreaterThan(0);
    // Exibido, nunca editável: não existe campo de texto de CNPJ nesta tela.
    expect(screen.queryByRole('textbox', { name: /cnpj/iu })).not.toBeInTheDocument();
  });
});

describe('empresa arquivada é somente consulta (§3.5)', () => {
  it('avisa o estado e oferece reativação no lugar do arquivamento', () => {
    renderizar('arquivado');

    expect(screen.getByRole('status')).toHaveTextContent(/somente para consulta/iu);
    expect(
      screen.getByRole('button', { name: /reativar empresa/iu }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /arquivar empresa/iu }),
    ).not.toBeInTheDocument();
  });

  it('desabilita os campos e esconde o salvar', () => {
    renderizar('arquivado');

    expect(screen.getByRole('textbox', { name: /razão social/iu })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /salvar alterações/iu }),
    ).not.toBeInTheDocument();
  });

  it('não oferece a consulta à CNPJá', () => {
    renderizar('arquivado');

    expect(
      screen.queryByRole('button', { name: /consultar cnpjá/iu }),
    ).not.toBeInTheDocument();
  });
});

describe('arquivamento exige justificativa (§3.5)', () => {
  it('recusa confirmar com a justificativa vazia', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: /arquivar empresa/iu }));
    await usuario.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Arquivar empresa' }),
    );

    expect(await screen.findByText('Informe a justificativa.')).toBeInTheDocument();
    // Nada foi enviado: a validação é anterior à requisição.
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/arquivar'),
      expect.anything(),
    );
  });
});

describe('atualização pela CNPJá (§3.3)', () => {
  it('mostra as diferenças sem aplicar nada e exige seleção', async () => {
    const usuario = userEvent.setup();
    renderizar();

    responderCom(
      respostaJson({
        situacao: 'comparado',
        diferencas: [
          {
            campo: 'razaoSocial',
            valorAtual: 'Padaria Aurora Comércio de Alimentos LTDA',
            valorExterno: 'Padaria Aurora Alimentos LTDA',
          },
        ],
        situacaoCadastralExterna: 'Ativa',
        alertaDeSituacaoExterna: false,
        motivo: null,
      }),
    );

    await usuario.click(screen.getByRole('button', { name: /consultar cnpjá/iu }));

    // A diferença é um item marcável, e não apenas texto: "Razão social"
    // também é rótulo do formulário acima, então a busca é pelo checkbox.
    const escolha = await screen.findByRole('checkbox', { name: /razão social/iu });

    expect(escolha).toBeInTheDocument();
    expect(screen.getByText(/Padaria Aurora Alimentos LTDA/u)).toBeInTheDocument();

    // Sem marcar nada, aplicar fica indisponível: a fonte externa não aplica
    // sozinha e a seleção é do usuário.
    const aplicar = screen.getByRole('button', { name: /aplicar selecionados/iu });
    expect(aplicar).toBeDisabled();

    await usuario.click(escolha);
    expect(aplicar).toBeEnabled();
  });

  it('alerta situação externa diferente de Ativa sem bloquear a edição', async () => {
    const usuario = userEvent.setup();
    renderizar();

    responderCom(
      respostaJson({
        situacao: 'sem_diferencas',
        diferencas: [],
        situacaoCadastralExterna: 'Baixada',
        alertaDeSituacaoExterna: true,
        motivo: null,
      }),
    );

    await usuario.click(screen.getByRole('button', { name: /consultar cnpjá/iu }));

    expect(await screen.findByText(/Baixada/u)).toBeInTheDocument();
    // O formulário continua editável: alerta não é bloqueio.
    expect(screen.getByRole('textbox', { name: /razão social/iu })).toBeEnabled();
  });

  it('falha externa preserva os dados e mantém a edição manual', async () => {
    const usuario = userEvent.setup();
    renderizar();

    responderCom(
      respostaJson({
        situacao: 'sem_fonte',
        diferencas: [],
        situacaoCadastralExterna: null,
        alertaDeSituacaoExterna: false,
        motivo: 'indisponivel',
      }),
    );

    await usuario.click(screen.getByRole('button', { name: /consultar cnpjá/iu }));

    expect(
      await screen.findByText(/não foi possível consultar a cnpjá/iu),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /razão social/iu })).toBeEnabled();
  });

  it('informa quando não há diferença', async () => {
    const usuario = userEvent.setup();
    renderizar();

    responderCom(
      respostaJson({
        situacao: 'sem_diferencas',
        diferencas: [],
        situacaoCadastralExterna: 'Ativa',
        alertaDeSituacaoExterna: false,
        motivo: null,
      }),
    );

    await usuario.click(screen.getByRole('button', { name: /consultar cnpjá/iu }));

    expect(await screen.findByText(/já estão atualizados/iu)).toBeInTheDocument();
  });
});

describe('vigência de regime e CNAE (§3.2)', () => {
  it('oferece o campo de vigência com teto na data de hoje', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('tab', { name: 'Dados fiscais' }));

    const vigencia = await screen.findByLabelText(/vigência da alteração/iu);
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    // Vigência futura é recusada pelo servidor; o seletor não a oferece.
    expect(vigencia).toHaveAttribute('max', hoje);
  });
});

describe('acessibilidade', () => {
  it('não acusa violação nas abas da empresa ativa', async () => {
    const { container } = renderizar();

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: /seções da empresa/iu })).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
