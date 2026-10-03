/**
 * Provas da aba "Certificados" do Histórico de Informações (SPEC-011 §3.7):
 * sucessos e recusas em ordem de data, código estável da recusa, identidade
 * técnica, filtros e página na URL, somente leitura e a integração com a página
 * do Histórico (a aba só aparece com a permissão do módulo).
 */
import { MENSAGEM_DA_RECUSA, type EventoDeCertificado } from '@contaia/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoricoDeInformacoes } from '../historico/historico-de-informacoes';
import {
  SESSAO_DO_COFRE,
  Envolvido,
  instalarFetch,
  json,
  problema,
  type Roteador,
} from './cofre.fixtures';
import { HistoricoDeCertificados } from './historico-de-certificados';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
}));

const evento = (sobrescritas: Partial<EventoDeCertificado> & Pick<EventoDeCertificado, 'id'>): EventoDeCertificado => ({
  empresaId: 'e-valido',
  empresaNome: 'Padaria Aurora',
  acao: 'CADASTRO',
  resultado: 'SUCESSO',
  codigo: null,
  motivo: null,
  usuarioId: 'ana',
  usuarioNome: 'Ana Lima',
  identidadeTecnica: null,
  correlationId: `corr-${sobrescritas.id}`,
  ocorridoEm: '2026-10-02T15:30:00.000Z',
  ...sobrescritas,
});

const EVENTOS: readonly EventoDeCertificado[] = [
  evento({ id: 'e7', acao: 'RECUSA', resultado: 'RECUSADO', codigo: 'CERTIFICADO_CNPJ_DIVERGENTE', ocorridoEm: '2026-10-03T13:00:00.000Z' }),
  evento({ id: 'e6', acao: 'ALERTA_EMITIDO', codigo: 'D15', usuarioId: null, usuarioNome: null, identidadeTecnica: 'job-de-alertas', ocorridoEm: '2026-10-02T09:00:00.000Z' }),
  evento({ id: 'e5', acao: 'RESPONSAVEL_PERDIDO', usuarioId: null, usuarioNome: null, identidadeTecnica: 'cofre' }),
  evento({ id: 'e4', acao: 'RESPONSAVEL_ALTERADO' }),
  evento({ id: 'e3', acao: 'DESATIVACAO', motivo: 'Titular trocou de certificadora.' }),
  evento({ id: 'e2', acao: 'SUBSTITUICAO' }),
  evento({ id: 'e1', acao: 'CADASTRO', ocorridoEm: '2026-09-20T12:00:00.000Z' }),
];

let sessao: unknown = SESSAO_DO_COFRE;
let historico: () => Response = () => json({ eventos: EVENTOS, total: EVENTOS.length });
const chamadas: string[] = [];

const roteador: Roteador = (url) => {
  chamadas.push(url);

  if (url.endsWith('/usuarios/eu')) return json(sessao);
  if (url.includes('/historico/certificados')) return historico();
  if (url.includes('/historico/campos')) return json([]);
  if (url.includes('/historico?') || url.includes('/historico/empresas')) {
    return json({ eventos: [], total: 0 });
  }
  if (url.includes('/historico/usuarios')) return json({ eventos: [], total: 0 });

  return undefined;
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams('aba=CERTIFICADOS');
  sessao = SESSAO_DO_COFRE;
  historico = () => json({ eventos: EVENTOS, total: EVENTOS.length });
  chamadas.length = 0;
  substituir.mockClear();
  instalarFetch(roteador);
});

describe('HistoricoDeCertificados', () => {
  it('lista sucessos e recusas do mais recente ao mais antigo, com autor, resultado e correlationId', async () => {
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });

    const lista = await screen.findByRole('list', { name: 'Eventos de certificado' });
    const itens = within(lista).getAllByRole('listitem');

    expect(itens).toHaveLength(7);
    expect(within(itens[0] as HTMLElement).getByText('Tentativa recusada')).toBeInTheDocument();
    expect(within(itens[0] as HTMLElement).getByText('Recusado')).toBeInTheDocument();
    expect(within(itens[6] as HTMLElement).getByText('Cadastro')).toBeInTheDocument();
    expect(within(itens[6] as HTMLElement).getByText('Concluído')).toBeInTheDocument();
    expect(within(itens[3] as HTMLElement).getByText('Responsável alterado')).toBeInTheDocument();
    expect(within(itens[3] as HTMLElement).getByText('corr-e4')).toBeInTheDocument();
  });

  it('recusa mostra a mensagem acionável e o código estável do motivo', async () => {
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    const lista = await screen.findByRole('list', { name: 'Eventos de certificado' });
    const recusa = within(within(lista).getAllByRole('listitem')[0] as HTMLElement);

    expect(recusa.getByText(MENSAGEM_DA_RECUSA.CERTIFICADO_CNPJ_DIVERGENTE)).toBeInTheDocument();
    expect(recusa.getByText('CERTIFICADO_CNPJ_DIVERGENTE')).toBeInTheDocument();
  });

  it('alerta de vencimento mostra o marco e a identidade técnica; desativação mostra o motivo', async () => {
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    const lista = await screen.findByRole('list', { name: 'Eventos de certificado' });
    const itens = within(lista).getAllByRole('listitem');

    expect(within(itens[1] as HTMLElement).getByText('Faltam 15 dias para o vencimento')).toBeInTheDocument();
    expect(within(itens[1] as HTMLElement).getByText('Verificação de vencimentos')).toBeInTheDocument();
    expect(within(itens[2] as HTMLElement).getByText('Cofre')).toBeInTheDocument();
    expect(within(itens[4] as HTMLElement).getByText('Titular trocou de certificadora.')).toBeInTheDocument();
  });

  it('data e hora em America/Sao_Paulo, e cada evento leva ao cofre da empresa', async () => {
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    const lista = await screen.findByRole('list', { name: 'Eventos de certificado' });
    const primeiro = within(within(lista).getAllByRole('listitem')[0] as HTMLElement);

    // 13:00Z em São Paulo (UTC-3) = 10:00.
    expect(primeiro.getByText(/03\/10\/2026.*10:00/u)).toBeInTheDocument();
    expect(primeiro.getByRole('link', { name: 'Padaria Aurora' })).toHaveAttribute(
      'href',
      '/configuracoes/cofre?empresa=e-valido',
    );
  });

  it('é somente leitura: nenhuma ação de editar, excluir ou corrigir evento', async () => {
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    await screen.findByRole('list', { name: 'Eventos de certificado' });

    expect(screen.queryByRole('button', { name: /editar|excluir|apagar|corrigir|remover/iu })).not.toBeInTheDocument();
  });

  it('nunca expõe arquivo, senha, chave ou token', async () => {
    const { container } = render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    await screen.findByRole('list', { name: 'Eventos de certificado' });

    expect(container.textContent).not.toMatch(/senha[:=]|pkcs12|private key|token do vault/iu);
  });

  it('carregando, vazio sem filtro, vazio com filtro e erro com correlationId', async () => {
    historico = () => json({ eventos: [], total: 0 });
    const vazio = render(<HistoricoDeCertificados />, { wrapper: Envolvido });

    expect(screen.getByText('Carregando o histórico de certificados')).toBeInTheDocument();
    expect(await screen.findByText('Nenhum evento de certificado registrado')).toBeInTheDocument();
    vazio.unmount();

    parametrosAtuais = new URLSearchParams('aba=CERTIFICADOS&acao=RECUSA');
    const comFiltro = render(<HistoricoDeCertificados />, { wrapper: Envolvido });

    expect(await screen.findByText('Nenhum evento no período ou filtro')).toBeInTheDocument();
    comFiltro.unmount();

    historico = () => problema(500, 'ERRO_DESCONHECIDO', {}, 'corr-hist-1');
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });

    expect(await screen.findByText('Não foi possível carregar o histórico')).toBeInTheDocument();
    expect(screen.getByText('corr-hist-1')).toBeInTheDocument();
  });

  it('a consulta leva os filtros da URL ao servidor', async () => {
    parametrosAtuais = new URLSearchParams(
      'aba=CERTIFICADOS&acao=RECUSA&resultado=RECUSADO&empresaId=e-valido&pagina=2',
    );
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    await screen.findByRole('list', { name: 'Eventos de certificado' });

    expect(chamadas.find((url) => url.includes('/historico/certificados'))).toBe(
      '/api/proxy/historico/certificados?acao=RECUSA&resultado=RECUSADO&empresaId=e-valido&limite=25&deslocamento=25',
    );
    expect(screen.getByText(/só os eventos de uma empresa/u)).toBeInTheDocument();
  });

  it('filtro de ação publica na URL mantendo a aba e volta à primeira página', async () => {
    parametrosAtuais = new URLSearchParams('aba=CERTIFICADOS&pagina=3');
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    await screen.findByRole('list', { name: 'Eventos de certificado' });

    // O Select do Radix abre por teclado no jsdom, como nas demais telas do produto.
    screen.getByRole('combobox', { name: /Ação/u }).focus();
    await userEvent.keyboard('{Enter}{ArrowDown}{Enter}');

    await waitFor(() => expect(substituir).toHaveBeenCalled());
    const destino = String(substituir.mock.calls.at(-1)?.[0]);

    expect(destino).toContain('aba=CERTIFICADOS');
    expect(destino).toContain('acao=CADASTRO');
    expect(destino).not.toContain('pagina=');
  });

  it('paginação: "Página 2 de 3" e navegação pela URL', async () => {
    parametrosAtuais = new URLSearchParams('aba=CERTIFICADOS&pagina=2');
    historico = () => json({ eventos: EVENTOS, total: 60 });
    const usuario = userEvent.setup();
    render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    await screen.findByRole('list', { name: 'Eventos de certificado' });

    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(String(substituir.mock.calls.at(-1)?.[0])).toContain('pagina=3');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<HistoricoDeCertificados />, { wrapper: Envolvido });
    await screen.findByRole('list', { name: 'Eventos de certificado' });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Histórico de Informações — aba Certificados', () => {
  const nomesDasAbas = async () =>
    (await screen.findAllByRole('tab')).map((aba) => aba.textContent ?? '');

  it('com a permissão do módulo, a aba aparece e o link direto abre o seu conteúdo', async () => {
    render(<HistoricoDeInformacoes />, { wrapper: Envolvido });

    expect(await screen.findByRole('list', { name: 'Eventos de certificado' })).toBeInTheDocument();
    expect(await nomesDasAbas()).toContain('Certificados');
    expect(screen.getByRole('tab', { name: 'Certificados', selected: true })).toBeInTheDocument();
  });

  it('trocar para a aba publica aba=CERTIFICADOS na URL', async () => {
    parametrosAtuais = new URLSearchParams();
    const usuario = userEvent.setup();
    render(<HistoricoDeInformacoes />, { wrapper: Envolvido });

    await usuario.click(await screen.findByRole('tab', { name: 'Certificados' }));

    expect(substituir).toHaveBeenCalledWith('/historico?aba=CERTIFICADOS', { scroll: false });
  });

  it('sem a permissão do módulo a aba não existe e o link direto cai na primeira aba', async () => {
    sessao = { papeis: ['contador'], permissoes: ['historico.global.consultar'], escopoDeEmpresas: 'CARTEIRA' };
    render(<HistoricoDeInformacoes />, { wrapper: Envolvido });

    await waitFor(() => expect(chamadas.some((url) => url.endsWith('/usuarios/eu'))).toBe(true));
    expect(await nomesDasAbas()).not.toContain('Certificados');
    expect(screen.queryByRole('list', { name: 'Eventos de certificado' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dados cadastrais', selected: true })).toBeInTheDocument();
  });
});
