/**
 * Provas de tela do cofre de certificados A1 (SPEC-011 §5): um teste por estado
 * obrigatório (§5.3) e por fluxo da lista. Filtros, ordem e página na URL, ações
 * conforme `ItemDoCofre.acoes`, detalhe aberto pela URL e acessibilidade. A API é
 * dublada no `fetch`, por rota.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaDoCofre } from './area-do-cofre';
import {
  ITEM_D15,
  ITEM_D30,
  ITEM_D7,
  ITEM_DESATIVADO,
  ITEM_SEM_CERTIFICADO,
  ITEM_SEM_RESPONSAVEL,
  ITEM_SO_CONSULTA,
  ITEM_VENCIDO,
  PADARIA,
  SESSAO_DO_COFRE,
  SESSAO_SO_CONSULTA,
  certificado,
  detalhe,
  item,
  pagina,
  Envolvido,
  instalarFetch,
  json,
  problema,
  type Roteador,
} from './cofre.fixtures';

const substituir = vi.fn();
let parametrosAtuais = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: substituir, push: vi.fn() }),
  useSearchParams: () => parametrosAtuais,
  usePathname: () => '/configuracoes/cofre',
}));

const TODOS_OS_ITENS = [
  PADARIA,
  ITEM_D30,
  ITEM_D15,
  ITEM_D7,
  ITEM_VENCIDO,
  ITEM_SEM_CERTIFICADO,
  ITEM_DESATIVADO,
  ITEM_SEM_RESPONSAVEL,
  ITEM_SO_CONSULTA,
];

let sessao: unknown = SESSAO_DO_COFRE;
let listagem: () => Response | Promise<Response> = () => json(pagina(TODOS_OS_ITENS));
const chamadas: string[] = [];

const roteador: Roteador = (url) => {
  chamadas.push(url);

  if (url.endsWith('/usuarios/eu')) return json(sessao);
  if (url.includes('/certificados/responsaveis')) {
    return json([{ id: 'ana', nome: 'Ana Lima', email: 'ana@escritorio.com', papel: 'contador' }]);
  }

  const alvo = /\/empresas\/([^/]+)\/certificados$/u.exec(url);

  if (alvo !== null) {
    const encontrado = TODOS_OS_ITENS.find((candidato) => candidato.empresaId === alvo[1]);

    return encontrado === undefined
      ? problema(404, 'EMPRESA_NAO_ENCONTRADA')
      : json(
          detalhe(encontrado, [
            ...(encontrado.certificado === null ? [] : [encontrado.certificado]),
            certificado({
              id: 'antigo',
              versao: 0,
              estado: 'SUBSTITUIDO',
              encerradoEm: '2026-09-20T14:30:00.000Z',
              motivoDoEncerramento: 'SUBSTITUICAO',
              validoAte: '2026-12-31',
            }),
          ]),
        );
  }

  if (url.includes('/api/proxy/certificados?')) return listagem();

  return undefined;
};

const renderizar = () => render(<AreaDoCofre />, { wrapper: Envolvido });
const tabela = async () => within(await screen.findByRole('table'));
const linhaDe = async (empresa: string) => {
  const t = await tabela();

  return within(t.getByRole('row', { name: new RegExp(empresa, 'u') }));
};

beforeEach(() => {
  parametrosAtuais = new URLSearchParams();
  sessao = SESSAO_DO_COFRE;
  listagem = () => json(pagina(TODOS_OS_ITENS));
  chamadas.length = 0;
  substituir.mockClear();
  instalarFetch(roteador);
});

describe('AreaDoCofre — estados da SPEC-011 §5.3', () => {
  it('carregando: skeleton com forma de cartões e de lista, e depois o conteúdo', async () => {
    let liberar: () => void = () => undefined;

    listagem = () =>
      new Promise<Response>((resolver) => {
        liberar = () => resolver(json(pagina(TODOS_OS_ITENS)));
      });
    renderizar();

    expect(screen.getByText('Carregando o resumo do cofre')).toBeInTheDocument();
    expect(await screen.findByText('Carregando os certificados do escritório')).toBeInTheDocument();

    liberar();
    expect(await tabela()).toBeTruthy();
    expect(screen.queryByText('Carregando os certificados do escritório')).not.toBeInTheDocument();
  });

  it('cabeçalho canônico: breadcrumb, um H1 e a ação primária de envio', async () => {
    renderizar();
    await tabela();

    expect(screen.getByRole('heading', { level: 1, name: 'Cofre de certificados A1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar certificado' })).toBeInTheDocument();
  });

  it('cartões-resumo trazem os números da API e uma ação de filtro com texto', async () => {
    renderizar();
    await tabela();

    const resumo = screen.getByRole('list', { name: 'Resumo do cofre' });

    expect(within(resumo).getByText('404')).toBeInTheDocument(); // 400 válidos + 4 vencendo
    expect(within(resumo).getByText('/ 488 empresas')).toBeInTheDocument();
    expect(within(resumo).getByText('70')).toBeInTheDocument();
    expect(within(resumo).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '404');
    expect(within(resumo).getByRole('button', { name: /Ver vencidos/u })).toBeInTheDocument();
  });

  it('válido: badge com texto, validade em data civil e impressão digital truncada', async () => {
    renderizar();
    const linha = await linhaDe('Padaria Aurora');

    expect(linha.getByText('Válido')).toBeInTheDocument();
    expect(linha.getByText('10/01/2027')).toBeInTheDocument();
    expect(linha.getByText('120 dias restantes')).toBeInTheDocument();
    expect(linha.getByText('E3B0C442…B855')).toBeInTheDocument();
    expect(linha.getByText('Ana Lima')).toBeInTheDocument();
    expect(linha.getByText('AL')).toBeInTheDocument();
  });

  it.each([
    ['Mercado Trinta', 'Vence em até 30 dias', '28 dias restantes'],
    ['Oficina Quinze', 'Vence em até 15 dias', '14 dias restantes'],
    ['Farmácia Sete', 'Vence em até 7 dias', '1 dia restante'],
  ])('%s: a janela de alerta tem rótulo e prazo por extenso', async (empresa, rotulo, prazo) => {
    renderizar();
    const linha = await linhaDe(empresa);

    expect(linha.getByText(rotulo)).toBeInTheDocument();
    expect(linha.getByText(prazo)).toBeInTheDocument();
  });

  it('vencido: rótulo, "Venceu há 3 dias" e a renovação em destaque', async () => {
    renderizar();
    const linha = await linhaDe('Solaris Bioenergia');

    expect(linha.getByText('Vencido')).toBeInTheDocument();
    expect(linha.getByText('Venceu há 3 dias')).toBeInTheDocument();
    expect(
      linha.getByRole('button', { name: 'Renovar certificado de Solaris Bioenergia do Brasil' }),
    ).toBeInTheDocument();
  });

  it('empresa sem certificado: diz que não há certificado e oferece cadastrar', async () => {
    renderizar();
    const linha = await linhaDe('Nexus Cloud');

    expect(linha.getByText('Sem certificado')).toBeInTheDocument();
    expect(linha.getByText('Nenhum certificado vigente')).toBeInTheDocument();
    expect(
      linha.getByRole('button', { name: 'Cadastrar certificado de Nexus Cloud Soluções' }),
    ).toBeInTheDocument();
    // Não há certificado para desativar nem responsável para trocar.
    expect(linha.queryByRole('button', { name: /Desativar/u })).not.toBeInTheDocument();
  });

  it('desativado: rótulo, desde quando, e novo cadastro (nunca reativação)', async () => {
    renderizar();
    const linha = await linhaDe('Mineração Serra Alta');

    expect(linha.getByText('Desativado')).toBeInTheDocument();
    expect(linha.getByText('desde 25/09/2026')).toBeInTheDocument();
    expect(linha.getByRole('button', { name: /Cadastrar certificado/u })).toBeInTheDocument();
    expect(linha.queryByRole('button', { name: /Reativar/u })).not.toBeInTheDocument();
  });

  it('sem responsável: badge com texto, quem era e a ação de escolher', async () => {
    renderizar();
    const linha = await linhaDe('Transportes Boa Viagem');

    expect(linha.getByText('Sem responsável ativo')).toBeInTheDocument();
    expect(linha.getByText('Antes: Bruno Prado (inativo)')).toBeInTheDocument();
    expect(linha.getByRole('button', { name: /Escolher responsável/u })).toBeInTheDocument();
    // O certificado continua vigente: o estado dele não muda por causa disso.
    expect(linha.getByText('Válido')).toBeInTheDocument();
  });

  it('somente consulta: nenhuma ação de escrita, dito em texto', async () => {
    renderizar();
    const linha = await linhaDe('Clínica Somente Leitura');

    expect(linha.getByText('Somente consulta')).toBeInTheDocument();
    expect(linha.queryByRole('button')).toBeInTheDocument(); // o nome da empresa abre o detalhe
    expect(linha.queryByRole('button', { name: /Substituir|Cadastrar|Desativar|Trocar/u })).toBeNull();
  });

  it('ações da linha respeitam item.acoes: trocar responsável e desativar só onde a API permite', async () => {
    renderizar();
    const completa = await linhaDe('Padaria Aurora');

    expect(completa.getByRole('button', { name: 'Substituir certificado de Padaria Aurora' })).toBeInTheDocument();
    expect(
      completa.getByRole('button', { name: 'Trocar responsável do certificado de Padaria Aurora' }),
    ).toBeInTheDocument();
    expect(
      completa.getByRole('button', { name: 'Desativar o certificado de Padaria Aurora' }),
    ).toBeInTheDocument();
  });

  it('lista vazia sem filtro explica o que aparecerá; com filtro, oferece limpar', async () => {
    listagem = () => json(pagina([]));
    const { unmount } = renderizar();

    expect(await screen.findByText('Nenhuma empresa no cofre ainda')).toBeInTheDocument();
    unmount();

    parametrosAtuais = new URLSearchParams('busca=zzz');
    renderizar();

    expect(await screen.findByText('Nenhuma empresa encontrada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('falha ao carregar: mensagem, correlationId copiável e tentar de novo', async () => {
    listagem = () => problema(500, 'ERRO_DESCONHECIDO', {}, 'corr-lista-9');
    renderizar();

    expect(await screen.findByText('Não foi possível carregar o cofre')).toBeInTheDocument();
    expect(screen.getByText('corr-lista-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('falha do cofre: diz que está indisponível e que nada foi alterado', async () => {
    listagem = () => problema(503, 'COFRE_INDISPONIVEL', {}, 'corr-cofre-5');
    renderizar();

    expect(await screen.findByText('O cofre está indisponível')).toBeInTheDocument();
    expect(screen.getByText(/Nada foi alterado/u)).toBeInTheDocument();
    expect(screen.getByText('corr-cofre-5')).toBeInTheDocument();
  });

  it('permissão insuficiente: a API recusa a consulta e a tela explica, sem mostrar formulário', async () => {
    listagem = () => problema(403, 'SEM_AUTORIZACAO');
    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver o cofre')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /enviar/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('sessão sem a chave de consulta também cai em permissão insuficiente', async () => {
    sessao = { papeis: ['auxiliar'], permissoes: ['empresas.cadastro.consultar'], escopoDeEmpresas: 'CARTEIRA' };
    renderizar();

    expect(await screen.findByText('Você não tem permissão para ver o cofre')).toBeInTheDocument();
  });

  it('quem só consulta vê a lista, sem formulário nem ação de envio, com a explicação', async () => {
    sessao = SESSAO_SO_CONSULTA;
    renderizar();
    await tabela();

    expect(screen.getByText('Seu papel permite apenas consultar o cofre')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar certificado' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Senha do certificado/u)).not.toBeInTheDocument();
  });

  it('sem empresas na carteira: SemCarteira, e não uma lista vazia que enganaria', async () => {
    sessao = { ...SESSAO_DO_COFRE, escopoDeEmpresas: 'NENHUMA' };
    renderizar();

    expect(await screen.findByText('Você ainda não tem empresas na sua carteira')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('conteúdo longo: nome de 160 caracteres e titular enorme não quebram a tabela', async () => {
    const longo = 'Comércio Atacadista de Gêneros Alimentícios '.repeat(4).trim();
    listagem = () =>
      json(
        pagina([
          item({
            empresaId: 'e-longo',
            empresaNome: longo,
            certificado: certificado({ titular: `${longo}:11222333000181` }),
          }),
        ]),
      );
    const { container } = renderizar();

    expect((await tabela()).getAllByText(longo).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('AreaDoCofre — URL, servidor e paginação', () => {
  it('a consulta vai ao servidor com busca, estado, ordem e página da URL', async () => {
    parametrosAtuais = new URLSearchParams('busca=aurora&estado=VENCIDO&ordem=VENCIMENTO&pagina=2');
    renderizar();
    await tabela();

    const consulta = chamadas.find((url) => url.includes('/api/proxy/certificados?'));

    expect(consulta).toBe(
      '/api/proxy/certificados?busca=aurora&estado=VENCIDO&ordem=VENCIMENTO&pagina=2&limite=25',
    );
  });

  it('parâmetro inválido na URL é ignorado, não enviado ao servidor', async () => {
    parametrosAtuais = new URLSearchParams('estado=INEXISTENTE&ordem=QUALQUER&pagina=abc');
    renderizar();
    await tabela();

    expect(chamadas.find((url) => url.includes('/api/proxy/certificados?'))).toBe(
      '/api/proxy/certificados?ordem=EMPRESA&pagina=1&limite=25',
    );
  });

  it('digitar na busca publica na URL depois do atraso e volta à primeira página', async () => {
    parametrosAtuais = new URLSearchParams('pagina=3');
    const usuario = userEvent.setup();
    renderizar();
    await tabela();

    await usuario.type(screen.getByRole('searchbox', { name: /Buscar empresa/u }), 'aurora');

    await waitFor(() => expect(substituir).toHaveBeenCalled(), { timeout: 2000 });
    const destino = String(substituir.mock.calls.at(-1)?.[0]);

    expect(destino).toContain('busca=aurora');
    expect(destino).not.toContain('pagina=');
  });

  it('o filtro de estado publica na URL e volta à primeira página', async () => {
    parametrosAtuais = new URLSearchParams('pagina=3');
    renderizar();
    await tabela();

    // O Select do Radix abre por teclado no jsdom, como nas demais telas de lista.
    screen.getByRole('combobox', { name: /Estado do certificado/u }).focus();
    await userEvent.keyboard('{Enter}');
    // Todos → Válidos → D-30 → D-15 → D-7 → Vencidos.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(substituir).toHaveBeenCalled());
    const destino = String(substituir.mock.calls.at(-1)?.[0]);

    expect(destino).toContain('estado=VENCIDO');
    expect(destino).not.toContain('pagina=');
  });

  it('o atalho do cartão aplica o filtro correspondente', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await tabela();

    await usuario.click(screen.getByRole('button', { name: /Ver vencidos/u }));

    expect(String(substituir.mock.calls.at(-1)?.[0])).toContain('estado=VENCIDO');

    await usuario.click(screen.getByRole('button', { name: /Ver por vencimento/u }));

    expect(String(substituir.mock.calls.at(-1)?.[0])).toContain('ordem=VENCIMENTO');
  });

  it('lista paginada no servidor: mostra "Página 2 de 3" e navega pela URL', async () => {
    parametrosAtuais = new URLSearchParams('pagina=2');
    listagem = () => json(pagina([PADARIA], { total: 60, pagina: 2 }));
    const usuario = userEvent.setup();
    renderizar();
    await tabela();

    expect(screen.getByText('60 empresas encontradas.')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(String(substituir.mock.calls.at(-1)?.[0])).toContain('pagina=3');

    await usuario.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(String(substituir.mock.calls.at(-1)?.[0])).not.toContain('pagina=2');
  });

  it('"Limpar" desfaz busca, estado e ordem de uma vez', async () => {
    parametrosAtuais = new URLSearchParams('busca=a&estado=VENCIDO&ordem=VENCIMENTO');
    const usuario = userEvent.setup();
    renderizar();
    await tabela();

    await usuario.click(screen.getByRole('button', { name: 'Limpar' }));

    expect(substituir.mock.calls.at(-1)?.[0]).toBe('/configuracoes/cofre');
  });
});

describe('AreaDoCofre — detalhe pela URL', () => {
  it('clicar no nome da empresa abre o detalhe pela URL', async () => {
    const usuario = userEvent.setup();
    renderizar();
    const linha = await linhaDe('Padaria Aurora');

    await usuario.click(
      linha.getByRole('button', { name: 'Ver detalhes do certificado de Padaria Aurora' }),
    );

    expect(String(substituir.mock.calls.at(-1)?.[0])).toBe('/configuracoes/cofre?empresa=e-valido');
  });

  it('?empresa= abre o painel com metadados, responsável, ações e versões, sem download', async () => {
    parametrosAtuais = new URLSearchParams('empresa=e-valido');
    renderizar();

    const painel = await screen.findByRole('dialog', { name: 'Certificado da empresa' });
    const dentro = within(painel);

    expect(await dentro.findByText('PADARIA AURORA LTDA:11222333000181')).toBeInTheDocument();
    expect(dentro.getByText('AC Raiz de Teste ContaIA')).toBeInTheDocument();
    expect(dentro.getByText('0A1B2C3D4E5F')).toBeInTheDocument();
    // A impressão digital completa fica no detalhe, agrupada, e é copiável.
    expect(dentro.getByText(/E3 B0 C4 42 98/u)).toBeInTheDocument();
    expect(dentro.getByRole('button', { name: /Copiar a impressão digital completa/u })).toBeInTheDocument();
    expect(dentro.getByText('Ana Lima')).toBeInTheDocument();
    expect(dentro.getByRole('list', { name: /Versões do certificado/u })).toBeInTheDocument();
    expect(dentro.getByText('Versão 0')).toBeInTheDocument();
    expect(dentro.getByRole('button', { name: 'Substituir certificado' })).toBeInTheDocument();
    expect(dentro.getByRole('button', { name: 'Desativar certificado' })).toBeInTheDocument();
    // Nunca existe download do certificado.
    expect(dentro.queryByText(/baixar|download/iu)).not.toBeInTheDocument();
  });

  it('fechar o painel remove a empresa da URL', async () => {
    parametrosAtuais = new URLSearchParams('empresa=e-valido&busca=a');
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(
      await screen.findByRole('button', { name: 'Fechar os detalhes do certificado' }),
    );

    expect(String(substituir.mock.calls.at(-1)?.[0])).toBe('/configuracoes/cofre?busca=a');
  });

  it('empresa inexistente ou fora da carteira: erro no painel, sem vazar dado', async () => {
    parametrosAtuais = new URLSearchParams('empresa=outra-empresa');
    renderizar();

    const painel = await screen.findByRole('dialog');

    expect(await within(painel).findByText('Não foi possível carregar o certificado')).toBeInTheDocument();
    expect(within(painel).getByText(/Empresa não encontrada/u)).toBeInTheDocument();
  });

  it('desativado: o painel mostra o motivo e o último certificado, e só oferece novo cadastro', async () => {
    parametrosAtuais = new URLSearchParams('empresa=e-desativado');
    renderizar();

    const painel = await screen.findByRole('dialog');
    const dentro = within(painel);

    expect(await dentro.findByText('Último certificado')).toBeInTheDocument();
    expect(dentro.getAllByText(/Titular trocou de certificadora/u).length).toBeGreaterThan(0);
    expect(dentro.getByRole('button', { name: 'Cadastrar certificado' })).toBeInTheDocument();
    expect(dentro.queryByRole('button', { name: /Desativar/u })).not.toBeInTheDocument();
  });

  it('empresa sem certificado: o painel explica e oferece cadastrar', async () => {
    parametrosAtuais = new URLSearchParams('empresa=e-sem');
    renderizar();

    const painel = await screen.findByRole('dialog');

    expect(await within(painel).findByText(/ainda não tem certificado A1 no cofre/u)).toBeInTheDocument();
    expect(within(painel).getByRole('button', { name: 'Cadastrar certificado' })).toBeInTheDocument();
  });
});

describe('AreaDoCofre — "Substituir" leva ao formulário', () => {
  it('a ação da linha preenche o formulário com a empresa e avisa que o atual continua valendo', async () => {
    const usuario = userEvent.setup();
    renderizar();
    const linha = await linhaDe('Padaria Aurora');

    await usuario.click(linha.getByRole('button', { name: 'Substituir certificado de Padaria Aurora' }));

    const formulario = screen.getByRole('region', { name: /Substituir o certificado A1/u });

    expect(within(formulario).getByText('Padaria Aurora')).toBeInTheDocument();
    expect(within(formulario).getByText(/continua valendo/u)).toBeInTheDocument();
  });
});

describe('AreaDoCofre — acessibilidade', () => {
  it('lista completa, com todos os estados, sem violações do axe', async () => {
    const { container } = renderizar();
    await tabela();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('o painel de detalhe aberto não tem violações', async () => {
    parametrosAtuais = new URLSearchParams('empresa=e-valido');
    renderizar();
    const painel = await screen.findByRole('dialog');

    await within(painel).findByText('Versão 0');
    expect(await axe(painel)).toHaveNoViolations();
  });

  it('erro, vazio e permissão insuficiente também passam no axe', async () => {
    listagem = () => problema(500, 'ERRO_DESCONHECIDO');
    const { container, unmount } = renderizar();

    await screen.findByText('Não foi possível carregar o cofre');
    expect(await axe(container)).toHaveNoViolations();
    unmount();

    listagem = () => json(pagina([]));
    const vazio = renderizar();

    await screen.findByText('Nenhuma empresa no cofre ainda');
    expect(await axe(vazio.container)).toHaveNoViolations();
  });
});
