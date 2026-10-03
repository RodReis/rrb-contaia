/**
 * Provas do fluxo de envio do certificado (SPEC-011 §3.1, §5.2, §6.2): o ticket
 * sai da API, o arquivo e a senha vão DIRETO ao cofre, a recusa aparece no campo
 * certo com `correlationId`, e a senha nunca passa pelo proxy, pelo armazenamento
 * do navegador nem fica na tela depois do envio.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MENSAGEM_DA_RECUSA } from '@contaia/shared';
import { FormularioDeEnvio } from './formulario-de-envio';
import {
  COFRE_URL,
  ITEM_DESATIVADO,
  ITEM_SO_CONSULTA,
  PADARIA,
  SENHA_SENTINELA,
  XhrDublado,
  arquivoDeCertificado,
  certificado,
  instalarFetch,
  instalarXhr,
  json,
  pagina,
  problema,
  Envolvido,
  type Roteador,
} from './cofre.fixtures';

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));

const ROTA_DO_TICKET = '/api/proxy/empresas/e-valido/certificados/ingestoes';
const TICKET = { ticket: 'ticket.assinado', cofreUrl: COFRE_URL, operacao: 'SUBSTITUICAO', expiraEm: '2026-10-03T15:05:00.000Z' };

let ticket: () => Response | Promise<Response> = () => json(TICKET, 201);
const chamadas: { url: string; metodo: string; corpo: string }[] = [];

const roteador: Roteador = (url, init) => {
  chamadas.push({ url, metodo: init?.method ?? 'GET', corpo: String(init?.body ?? '') });

  if (/\/empresas\/[^/]+\/certificados\/ingestoes$/u.test(url)) return ticket();
  if (url.includes('/certificados/responsaveis')) {
    return json([
      { id: 'ana', nome: 'Ana Lima', email: 'ana@escritorio.com', papel: 'contador' },
      { id: 'carlos', nome: 'Carlos Dias', email: 'carlos@escritorio.com', papel: 'admin_escritorio' },
    ]);
  }
  if (url.includes('/api/proxy/certificados?')) {
    return json(pagina([PADARIA, ITEM_DESATIVADO, ITEM_SO_CONSULTA]));
  }

  return undefined;
};

const renderizar = (empresa = PADARIA) =>
  render(<FormularioDeEnvio empresaInicial={empresa} />, { wrapper: Envolvido });

const campoDeArquivo = () => screen.getByLabelText('Arquivo do certificado (.pfx ou .p12)');
const campoDeSenha = () => screen.getByLabelText(/Senha do certificado/u, { selector: 'input' });
const enviar = () => screen.getByRole('button', { name: 'Validar e guardar no cofre' });

/** Preenche o que falta para um envio válido: arquivo e senha (o responsável vem do certificado atual). */
const prepararEnvio = async (usuario: ReturnType<typeof userEvent.setup>) => {
  await usuario.upload(campoDeArquivo(), arquivoDeCertificado());
  await usuario.type(campoDeSenha(), SENHA_SENTINELA);
};

const enviarComSucesso = async (usuario: ReturnType<typeof userEvent.setup>) => {
  await prepararEnvio(usuario);
  await usuario.click(enviar());
  await waitFor(() => expect(XhrDublado.ultimo).not.toBeNull());
};

beforeEach(() => {
  ticket = () => json(TICKET, 201);
  chamadas.length = 0;
  Object.values(toast).forEach((funcao) => funcao.mockClear());
  instalarFetch(roteador);
  instalarXhr();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('FormularioDeEnvio — caminho feliz', () => {
  it('pede o ticket com só o responsável, envia ao cofre e mostra o sucesso com a validade', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await usuario.upload(campoDeArquivo(), arquivoDeCertificado('padaria.pfx'));
    expect(screen.getByText('padaria.pfx')).toBeInTheDocument();
    await usuario.type(campoDeSenha(), SENHA_SENTINELA);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Responsável pelo certificado/u })).toHaveTextContent(
        'Ana Lima',
      ),
    );

    await usuario.click(enviar());
    await waitFor(() => expect(XhrDublado.ultimo).not.toBeNull());

    // 1. A API recebe só o responsável: nem arquivo, nem senha.
    const pedido = chamadas.find((chamada) => chamada.url === ROTA_DO_TICKET);

    expect(pedido?.metodo).toBe('POST');
    expect(JSON.parse(pedido?.corpo ?? '{}')).toEqual({ responsavelId: 'ana' });

    // 2. O cofre recebe ticket, senha e arquivo, sem credenciais.
    const envio = XhrDublado.ultimo?.registro;

    expect(envio?.url).toBe(`${COFRE_URL}/ingestao`);
    expect(envio?.withCredentials).toBe(false);
    expect(envio?.campos['ticket']).toBe('ticket.assinado');
    expect(envio?.campos['senha']).toBe(SENHA_SENTINELA);
    expect((envio?.campos['arquivo'] as File).name).toBe('padaria.pfx');

    // 3. Durante o envio o botão avisa e não aceita reentrada.
    expect(enviar()).toBeDisabled();

    XhrDublado.ultimo?.progresso(1024, 2048);
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Progresso do envio' })).toHaveAttribute(
        'aria-valuenow',
        '50',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Enviando o arquivo ao cofre…');

    XhrDublado.ultimo?.progresso(2048, 2048);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Validando o certificado no cofre…'),
    );

    XhrDublado.ultimo?.responder(200, { certificado: certificado({ validoAte: '2028-03-09' }) });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Certificado substituído.', {
        description: 'Padaria Aurora · válido até 09/03/2028',
      }),
    );
    expect(await screen.findByText(/Certificado substituído: Padaria Aurora · válido até 09\/03\/2028/u)).toBeInTheDocument();
  });

  it('depois do envio a senha e o arquivo somem do formulário', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);
    XhrDublado.ultimo?.responder(200, { certificado: certificado() });

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(campoDeSenha()).toHaveValue('');
    expect(screen.queryByText('empresa.pfx')).not.toBeInTheDocument();
    expect(screen.getByText('Arraste o arquivo .pfx ou .p12 aqui')).toBeInTheDocument();
  });

  it('cadastro numa empresa sem responsável padrão exige escolher o responsável', async () => {
    const usuario = userEvent.setup();
    renderizar(ITEM_DESATIVADO);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Responsável/u })).toBeEnabled());
    await usuario.upload(campoDeArquivo(), arquivoDeCertificado());
    await usuario.type(campoDeSenha(), SENHA_SENTINELA);
    await usuario.click(enviar());

    expect(await screen.findByText('Escolha o responsável pelo certificado.')).toBeInTheDocument();
    expect(XhrDublado.ultimo).toBeNull();
  });

  it('cadastro conclui com "Certificado guardado no cofre." quando a operação é CADASTRO', async () => {
    ticket = () => json({ ...TICKET, operacao: 'CADASTRO' }, 201);
    const usuario = userEvent.setup();
    renderizar(ITEM_DESATIVADO);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Responsável/u })).toBeEnabled());
    // O Select do Radix abre por teclado no jsdom, como nas demais telas do produto.
    screen.getByRole('combobox', { name: /Responsável pelo certificado/u }).focus();
    await userEvent.keyboard('{Enter}{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Responsável pelo certificado/u })).toHaveTextContent(
        /Ana Lima|Carlos Dias/u,
      ),
    );
    await prepararEnvio(usuario);
    await usuario.click(enviar());
    await waitFor(() => expect(XhrDublado.ultimo).not.toBeNull());
    XhrDublado.ultimo?.responder(200, { certificado: certificado() });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Certificado guardado no cofre.', expect.anything()),
    );
  });
});

describe('FormularioDeEnvio — a senha e o arquivo não vazam', () => {
  it('nada do corpo, da senha ou do arquivo passa pelo proxy, pelo armazenamento ou pelo DOM', async () => {
    const usuario = userEvent.setup();
    const { container } = renderizar();
    await enviarComSucesso(usuario);
    XhrDublado.ultimo?.responder(200, { certificado: certificado() });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    for (const chamada of chamadas) {
      expect(chamada.url).not.toContain(SENHA_SENTINELA);
      expect(chamada.corpo).not.toContain(SENHA_SENTINELA);
      expect(chamada.corpo).not.toContain('pfx');
    }
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(SENHA_SENTINELA);
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(SENHA_SENTINELA);
    expect(container.innerHTML).not.toContain(SENHA_SENTINELA);
    expect(document.body.innerHTML).not.toContain(SENHA_SENTINELA);
  });

  it('nenhum log do navegador recebe a senha', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => undefined),
    );
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);
    XhrDublado.ultimo?.responder(422, {
      type: 'x',
      title: 'x',
      status: 422,
      code: 'CERTIFICADO_SENHA_INCORRETA',
      correlationId: 'corr-1',
    });
    await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_SENHA_INCORRETA);

    for (const espiao of espioes) {
      expect(JSON.stringify(espiao.mock.calls)).not.toContain(SENHA_SENTINELA);
      espiao.mockRestore();
    }
  });
});

describe('FormularioDeEnvio — recusa ligada ao campo certo', () => {
  const recusar = (codigo: string, correlationId = 'corr-cofre-77') =>
    XhrDublado.ultimo?.responder(422, { type: 'x', title: 'x', status: 422, code: codigo, correlationId });

  it('senha incorreta: erro no campo da senha, foco nele, senha limpa e correlationId visível', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);

    recusar('CERTIFICADO_SENHA_INCORRETA');

    expect(await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_SENHA_INCORRETA)).toBeInTheDocument();
    expect(campoDeSenha()).toHaveAttribute('aria-invalid', 'true');
    expect(campoDeSenha()).toHaveValue('');
    await waitFor(() => expect(campoDeSenha()).toHaveFocus());
    const alerta = screen.getByRole('alert');

    expect(alerta).toHaveTextContent('O cofre não aceitou o certificado');
    expect(within(alerta).getByText('corr-cofre-77')).toBeInTheDocument();
    // Erro de campo não vira toast (FRONTEND.md §13).
    expect(toast.error).not.toHaveBeenCalled();
    // O arquivo continua escolhido: só a senha precisa ser digitada de novo.
    expect(screen.getByText('empresa.pfx')).toBeInTheDocument();
  });

  it.each([
    ['CERTIFICADO_EXPIRADO'],
    ['CERTIFICADO_AINDA_NAO_VIGENTE'],
    ['CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['CERTIFICADO_CONTEINER_INVALIDO'],
  ] as const)('%s: erro no campo do arquivo', async (codigo) => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);

    recusar(codigo);

    expect(await screen.findByText(MENSAGEM_DA_RECUSA[codigo])).toBeInTheDocument();
    expect(campoDeArquivo()).toHaveAttribute('aria-invalid', 'true');
  });

  it('CNPJ divergente: erro no campo da empresa, que o texto identifica', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);

    recusar('CERTIFICADO_CNPJ_DIVERGENTE');

    const mensagem = await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_CNPJ_DIVERGENTE);
    const gatilho = screen.getByRole('button', { name: /Padaria Aurora/u });

    expect(gatilho.getAttribute('aria-describedby')).toBe(mensagem.id);
  });

  it('responsável inválido: erro no campo do responsável', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);

    recusar('CERTIFICADO_RESPONSAVEL_INVALIDO');

    expect(
      await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_RESPONSAVEL_INVALIDO),
    ).toBeInTheDocument();
  });

  it('cofre indisponível: falha do envio todo, com toast persistente e nada de campo marcado', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);

    XhrDublado.ultimo?.falharNaRede();

    const alerta = await screen.findByRole('alert');

    expect(alerta).toHaveTextContent('O cofre está indisponível');
    expect(alerta).toHaveTextContent(MENSAGEM_DA_RECUSA.COFRE_INDISPONIVEL);
    expect(toast.error).toHaveBeenCalledWith(
      MENSAGEM_DA_RECUSA.COFRE_INDISPONIVEL,
      expect.objectContaining({ duration: Infinity }),
    );
    expect(campoDeSenha()).toHaveAttribute('aria-invalid', 'false');
    expect(campoDeSenha()).toHaveValue('');
  });

  it('ticket vencido ou já usado: a mensagem manda enviar de novo', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await enviarComSucesso(usuario);

    recusar('CERTIFICADO_TICKET_INVALIDO');

    expect(
      await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_TICKET_INVALIDO),
    ).toBeInTheDocument();
  });

  it('a API recusa antes do cofre: nada é enviado e a senha continua digitada', async () => {
    ticket = () => problema(403, 'SEM_AUTORIZACAO', {}, 'corr-api-3');
    const usuario = userEvent.setup();
    renderizar();
    await prepararEnvio(usuario);

    await usuario.click(enviar());

    const alerta = await screen.findByRole('alert');

    expect(alerta).toHaveTextContent('Não foi possível enviar o certificado');
    expect(within(alerta).getByText('corr-api-3')).toBeInTheDocument();
    expect(XhrDublado.ultimo).toBeNull();
    expect(campoDeSenha()).toHaveValue(SENHA_SENTINELA);
  });
});

describe('FormularioDeEnvio — validação antes da rede', () => {
  it('campos obrigatórios vazios: erro em cada um, foco no primeiro e nada enviado', async () => {
    const usuario = userEvent.setup();
    render(<FormularioDeEnvio />, { wrapper: Envolvido });

    await usuario.click(enviar());

    expect(await screen.findByText('Escolha a empresa do certificado.')).toBeInTheDocument();
    expect(screen.getByText('Escolha o arquivo do certificado (.pfx ou .p12).')).toBeInTheDocument();
    expect(screen.getByText('Informe a senha do certificado.')).toBeInTheDocument();
    expect(screen.getByText('Escolha o responsável pelo certificado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Buscar por nome ou CNPJ/u })).toHaveFocus());
    expect(chamadas.some((chamada) => chamada.url === ROTA_DO_TICKET)).toBe(false);
    // O botão de envio nunca fica desabilitado por validação (PATTERNS.md §6).
    expect(enviar()).toBeEnabled();
  });

  it('extensão errada é recusada na hora, com a mensagem do cofre', async () => {
    const usuario = userEvent.setup({ applyAccept: false });
    renderizar();

    await usuario.upload(campoDeArquivo(), new File(['x'], 'chave.pem'));

    expect(await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_EXTENSAO_INVALIDA)).toBeInTheDocument();
    expect(screen.queryByText('chave.pem')).not.toBeInTheDocument();
  });

  it('arquivo acima de 10 MB e arquivo vazio são recusados na hora', async () => {
    const usuario = userEvent.setup();
    renderizar();
    const grande = new File(['x'], 'grande.pfx');

    Object.defineProperty(grande, 'size', { value: 10 * 1024 * 1024 + 1 });
    await usuario.upload(campoDeArquivo(), grande);
    expect(await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_TAMANHO_EXCEDIDO)).toBeInTheDocument();

    await usuario.upload(campoDeArquivo(), new File([], 'vazio.pfx'));
    expect(await screen.findByText(MENSAGEM_DA_RECUSA.CERTIFICADO_ARQUIVO_VAZIO)).toBeInTheDocument();
  });

  it('arrastar e soltar escolhe o arquivo; soltar vários é recusado', async () => {
    const { container } = renderizar();
    const alvo = container.querySelector<HTMLElement>('[data-zona-de-arquivo]');

    if (alvo === null) {
      throw new Error('zona de arquivo não encontrada');
    }

    fireEvent.dragOver(alvo, { dataTransfer: { files: [] } });
    expect(await screen.findByText('Solte para selecionar')).toBeInTheDocument();

    fireEvent.drop(alvo, { dataTransfer: { files: [arquivoDeCertificado('solto.p12')] } });
    expect(await screen.findByText('solto.p12')).toBeInTheDocument();

    fireEvent.drop(alvo, {
      dataTransfer: { files: [arquivoDeCertificado('a.pfx'), arquivoDeCertificado('b.pfx')] },
    });
    expect(await screen.findByText('Envie um único arquivo de certificado por vez.')).toBeInTheDocument();
  });

  it('o dropzone tem um input de arquivo de verdade, só para .pfx/.p12', () => {
    renderizar();

    const entrada = campoDeArquivo();

    expect(entrada).toHaveAttribute('type', 'file');
    expect(entrada).toHaveAttribute('accept', '.pfx,.p12');
  });

  it('duplo clique não envia duas vezes', async () => {
    const usuario = userEvent.setup();
    renderizar();
    await prepararEnvio(usuario);

    await usuario.dblClick(enviar());
    await waitFor(() => expect(XhrDublado.ultimo).not.toBeNull());

    expect(chamadas.filter((chamada) => chamada.url === ROTA_DO_TICKET)).toHaveLength(1);
    expect(XhrDublado.envios).toHaveLength(1);
  });

  it('a senha tem botão de mostrar/ocultar', async () => {
    const usuario = userEvent.setup();
    renderizar();

    expect(campoDeSenha()).toHaveAttribute('type', 'password');
    await usuario.click(screen.getByRole('button', { name: 'Mostrar senha do certificado' }));
    expect(campoDeSenha()).toHaveAttribute('type', 'text');
  });
});

describe('FormularioDeEnvio — escolha da empresa', () => {
  it('busca no servidor, desabilita empresa sem permissão de envio e preenche o formulário', async () => {
    const usuario = userEvent.setup();
    render(<FormularioDeEnvio />, { wrapper: Envolvido });

    await usuario.click(screen.getByRole('button', { name: /Buscar por nome ou CNPJ/u }));
    const lista = await screen.findByRole('list', { name: 'Empresas encontradas' });

    expect(chamadas.some((chamada) => chamada.url.includes('limite=8'))).toBe(true);
    expect(within(lista).getByRole('button', { name: /Clínica Somente Leitura/u })).toBeDisabled();
    expect(within(lista).getByText('Sem permissão para enviar')).toBeInTheDocument();

    await usuario.click(within(lista).getByRole('button', { name: /Padaria Aurora/u }));

    expect(screen.getByRole('button', { name: /Padaria Aurora/u })).toBeInTheDocument();
    expect(screen.getByText(/continua valendo/u)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Substituir o certificado A1' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Responsável pelo certificado/u })).toHaveTextContent('Ana Lima'),
    );
  });

  it('empresa desativada: o aviso diz que o anterior fica no histórico', () => {
    renderizar(ITEM_DESATIVADO);

    expect(screen.getByText(/fica no histórico/u)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cadastrar o certificado A1' })).toBeInTheDocument();
  });
});

describe('FormularioDeEnvio — acessibilidade', () => {
  it('formulário vazio, preenchido e com erro de campo não têm violações do axe', async () => {
    const usuario = userEvent.setup();
    const { container } = renderizar();

    expect(await axe(container)).toHaveNoViolations();

    await usuario.upload(campoDeArquivo(), arquivoDeCertificado());
    await usuario.click(enviar());
    await screen.findByText('Informe a senha do certificado.');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('a zona de arquivo e a senha têm rótulo acessível', () => {
    renderizar();

    expect(campoDeArquivo()).toBeInTheDocument();
    expect(campoDeSenha()).toHaveAccessibleName(/Senha do certificado/u);
  });
});
