/**
 * E2E SPEC-013: importação do plano de contas por CSV, pela pilha real da composição Docker:
 * Keycloak, PostgreSQL (RLS), Redis/BullMQ, MinIO, API e workers em contêiner, Web no host.
 * Nada é dublado no caminho da importação: a tela envia o CSV, a API grava o original no MinIO e
 * enfileira, o worker valida em staging e a confirmação aplica numa transação.
 *
 * Jornada (§9, §10): CSV legado em Latin-1 com `;` → mapeamento → validação parcial → prévia →
 * confirmação → plano atualizado → relatório CSV → histórico, com o `correlationId` do envio na
 * tentativa, na fila, nos eventos e no erro. Contrafactuais: arquivo acima de 10 MB e de 10.000
 * linhas, cabeçalho inválido, só cabeçalho, zero linhas válidas, ciclo, pai ausente e rejeitado,
 * código repetido, conta arquivada, conflito concorrente (409), falha do worker (fila sem consumidor
 * e armazenamento que recusa o original até esgotar o retry), reenvio idêntico e cancelamento.
 * Permissões, notificação só do iniciador, pendência e a etapa opcional do onboarding. Provas
 * visuais nos dois temas e nos três viewports, axe em cada estado-chave e varredura de segredo.
 *
 * Isolamento: escritório, usuários e empresas próprios (`e2e-f13-*`, CNPJs `1313…`). Nenhum
 * contêiner é derrubado: a falha do worker pausa só a fila de validação do plano (o `afterAll` a
 * retoma mesmo se a prova falhar no meio), porque na CI as specs rodam em paralelo.
 *
 * Depende de: composição no ar (`pnpm docker:up`) com API e workers, `pnpm db:migrate`, `pnpm build`
 * e dos processos Web, cofre e dublê da CNPJá (o `playwright.config.ts` os sobe).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Pool } from 'pg';

import {
  cnpjValido,
  criarEmpresa,
  criarEscritorio,
  criarIdentidade,
  criarUsuario,
  entrarComo,
  limparEscritorios,
  removerIdentidadesComPrefixo,
  vincular,
  type Pessoa,
} from './fixtures/ambiente';
import {
  MAPEAMENTO_DO_MODELO,
  abrirAba,
  baixarPeloBotao,
  bytesDa,
  caminhoDa,
  campoDe,
  codigoDo,
  confirmarPelaTela,
  contasDa,
  dadosDoJob,
  destinatariosDaNotificacao,
  enviarPelaApi,
  erroAoLerNoArmazenamento,
  escolherColuna,
  esperarEstado,
  eventosDa,
  gerarArquivosGrandes,
  jobsMortosDa,
  logsDe,
  notificacoesDoUsuario,
  pausarAValidacao,
  pelaApi,
  pendenciaDoPlano,
  provarVisualmente,
  retomarAValidacao,
  tentativa,
  tentativasDa,
  textoDaTela,
  totalNaTela,
  validarPelaTela,
  type ArquivosGerados,
  type AchadosVisuais,
} from './fixtures/plano-contas';

const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';
const PASTA_DAS_PROVAS = resolve(`test-results/${ESCOPO}/e2e/provas`);

const CNPJ_DO_ESCRITORIO = cnpjValido('131313130001');
const CNPJ_DO_OUTRO_ESCRITORIO = cnpjValido('139913990002');
const cnpjDaEmpresa = (sequencial: number): string => cnpjValido(`1313${String(sequencial).padStart(4, '0')}0001`);

const pessoa = (papel: string, nome: string): Pessoa => ({
  usuario: `e2e-f13-${papel}`,
  senha: `senha-${papel}-f13-123456`,
  nome,
});
const ADMIN = pessoa('admin', 'Administradora Plano');
const CONTADOR = pessoa('contador', 'Contador Plano');
const COLEGA = pessoa('colega', 'Colega de Carteira');
const AUXILIAR = pessoa('auxiliar', 'Auxiliar Plano');
const DE_FORA = pessoa('contador-fora', 'Contadora de Fora');
const OUTRO_ADMIN = pessoa('outro-admin', 'Administrador de Outro Escritório');
const PESSOAS = [ADMIN, CONTADOR, COLEGA, AUXILIAR, DE_FORA, OUTRO_ADMIN];

/**
 * CNPJ que o dublê da CNPJá conhece (`tests/e2e/duble-da-cnpja.mjs`, o mesmo da spec-002, que usa
 * outro escritório): o cadastro nasce pelo caminho do produto, pré-preenchido pela fonte externa.
 */
const CNPJ_DO_ONBOARDING = '19131243000197';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

// Fila, worker, retry com backoff e contêineres derrubados: cada passo tem folga própria.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

// O login preenche senha no Keycloak: trace, vídeo e captura automática a gravariam.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// -- Estado da prova -----------------------------------------------------------------------------

let tenantId = '';
let contadorId = '';
let colegaId = '';
const empresa = { alfa: '', beta: '', gama: '', delta: '', limites: '', onboarding: '' };

const contextos: BrowserContext[] = [];
let admin: Page;
let contador: Page;
let colega: Page;
let auxiliar: Page;
let deFora: Page;
let outroAdmin: Page;

let arquivos: ArquivosGerados;

/** Tentativa da jornada principal (Alfa) e o id de correlação que a tela mandou no envio. */
let principal = { tentativaId: '', correlationId: '' };
/** Prévia da Beta (aceitação parcial), consultada pelo auxiliar antes de ser cancelada. */
let previaDaBeta = '';

/** Tudo que os navegadores da prova receberam em texto: nenhum segredo pode estar aqui. */
const corposRecebidos: string[] = [];
/**
 * Achados das provas visuais por estado (axe por tema e rolagem horizontal). Só são afirmados no
 * teste final dedicado: no modo serial, um achado visual não pode esconder o resto da jornada.
 */
const achados: Record<string, AchadosVisuais> = {};

const provar = async (page: Page, estado: string, opcoes: Parameters<typeof provarVisualmente>[3]): Promise<void> => {
  achados[estado] = await provarVisualmente(page, PASTA_DAS_PROVAS, estado, opcoes);
};

const escutarRespostas = (page: Page): void => {
  page.on('response', (resposta) => {
    if (/json|text|html|javascript|csv/u.test(resposta.headers()['content-type'] ?? '')) {
      void resposta.text().then(
        (corpo) => corposRecebidos.push(corpo),
        () => undefined,
      );
    }
  });
};

// -- Preparação ----------------------------------------------------------------------------------

/** Conta do plano gravada direto no banco: é o plano vigente que a importação encontra. */
const semearContas = async (
  empresaId: string,
  contas: ReadonlyArray<readonly [codigo: string, nome: string, tipo: string, natureza: string, pai: string | null, arquivada?: boolean]>,
): Promise<void> => {
  for (const [codigo, nome, tipo, natureza, pai, arquivada] of contas) {
    await pool.query(
      `insert into app.conta_contabil
         (tenant_id, empresa_id, codigo, nome, tipo, natureza, conta_pai, arquivada, arquivada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 then now() end)`,
      [tenantId, empresaId, codigo, nome, tipo, natureza, pai, arquivada === true],
    );
  }
};

const novaPagina = async (browser: Browser, quem: Pessoa): Promise<Page> => {
  // `bypassCSP`: o axe é injetado na página para a checagem de acessibilidade.
  const contexto = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();

  contextos.push(contexto);
  await entrarComo(page, quem);

  return page;
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);

  // Uma rodada morta no meio da falha do worker deixaria a fila pausada (o Redis é persistente).
  await retomarAValidacao();
  await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO, CNPJ_DO_OUTRO_ESCRITORIO]);
  await removerIdentidadesComPrefixo('e2e-f13-');
  rmSync(PASTA_DAS_PROVAS, { recursive: true, force: true });
  arquivos = gerarArquivosGrandes();

  tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F13');
  const outroTenantId = await criarEscritorio(pool, CNPJ_DO_OUTRO_ESCRITORIO, 'Outro Escritório E2E da F13');

  const ids: Record<string, string> = {};
  for (const [quem, papel, tenant] of [
    [ADMIN, 'admin_escritorio', tenantId],
    [CONTADOR, 'contador', tenantId],
    [COLEGA, 'contador', tenantId],
    [AUXILIAR, 'auxiliar', tenantId],
    [DE_FORA, 'contador', tenantId],
    [OUTRO_ADMIN, 'admin_escritorio', outroTenantId],
  ] as const) {
    ids[quem.usuario] = await criarUsuario(pool, tenant, await criarIdentidade(quem), quem, papel);
  }
  contadorId = ids[CONTADOR.usuario] ?? '';
  colegaId = ids[COLEGA.usuario] ?? '';

  empresa.alfa = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(1), 'Alfa Plano E2E');
  empresa.beta = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(2), 'Beta Plano E2E');
  empresa.gama = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(3), 'Gama Plano E2E');
  empresa.delta = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(4), 'Delta Plano E2E');
  empresa.limites = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(5), 'Limites Plano E2E');

  // Carteira: o contador nas cinco ativas; o colega e o auxiliar na Alfa (e o auxiliar na Beta);
  // a contadora de fora em nenhuma delas. A administradora alcança o escritório inteiro.
  for (const id of [empresa.alfa, empresa.beta, empresa.gama, empresa.delta, empresa.limites]) {
    await vincular(pool, tenantId, contadorId, id);
  }
  await vincular(pool, tenantId, colegaId, empresa.alfa);
  await vincular(pool, tenantId, ids[AUXILIAR.usuario] ?? '', empresa.alfa);
  await vincular(pool, tenantId, ids[AUXILIAR.usuario] ?? '', empresa.beta);

  // Plano vigente da Alfa: uma conta fora do CSV (fica intacta), uma que o CSV atualiza e uma
  // arquivada que o CSV traz (é rejeitada e não reativa).
  await semearContas(empresa.alfa, [
    ['1', 'Ativo', 'sintetica', 'devedora', null],
    ['1.1', 'Ativo Circulante', 'sintetica', 'devedora', '1'],
    ['1.1.01', 'Caixa', 'analitica', 'devedora', '1.1'],
    ['1.1.02', 'Bancos', 'analitica', 'devedora', '1.1'],
    ['3', 'Receitas', 'sintetica', 'credora', null],
    ['3.9', 'Receitas Antigas', 'analitica', 'credora', '3', true],
  ]);
  await semearContas(empresa.beta, [
    ['3', 'Receitas', 'sintetica', 'credora', null],
    ['3.9', 'Receitas Antigas', 'analitica', 'credora', '3', true],
  ]);

  admin = await novaPagina(browser, ADMIN);
  contador = await novaPagina(browser, CONTADOR);
  colega = await novaPagina(browser, COLEGA);
  auxiliar = await novaPagina(browser, AUXILIAR);
  deFora = await novaPagina(browser, DE_FORA);
  outroAdmin = await novaPagina(browser, OUTRO_ADMIN);
  // Depois do login (o formulário do Keycloak não é resposta do produto): tudo o que cada
  // navegador recebe do produto entra na varredura de segredo.
  for (const page of [admin, contador, colega, auxiliar, deFora, outroAdmin]) {
    escutarRespostas(page);
  }
});

test.afterAll(async () => {
  // A fila pausada volta a andar, mesmo se a prova falhar no meio.
  await retomarAValidacao().catch(() => undefined);
  if (arquivos !== undefined) {
    rmSync(arquivos.pasta, { recursive: true, force: true });
  }
  await Promise.all(contextos.map((contexto) => contexto.close()));
  await pool.end();
});

// -- Limites do arquivo (recusa antes do staging) ------------------------------------------------

test('arquivo acima de 10 MB, acima de 10.000 linhas, cabeçalho inválido e só cabeçalho: recusados antes do staging, com o motivo', async () => {
  await abrirAba(contador, empresa.limites);
  const entrada = contador.getByLabel('Arquivo CSV do plano de contas');
  const recusa = contador.getByRole('alert').filter({ hasText: 'Arquivo recusado antes do envio' });

  // O navegador recusa sem enviar: tamanho, cabeçalho repetido e arquivo sem linha de dados.
  await entrada.setInputFiles(arquivos.acimaDoTamanho);
  await expect(recusa).toContainText(basename(arquivos.acimaDoTamanho));
  await expect(recusa).toContainText('Arquivo acima do limite de 10 MB');
  await expect(recusa).toContainText('Nada foi enviado');

  await entrada.setInputFiles(caminhoDa('plano-cabecalho-invalido.csv'));
  await expect(recusa).toContainText('O cabeçalho do arquivo está ausente, repetido ou em branco');

  await entrada.setInputFiles(caminhoDa('plano-so-cabecalho.csv'));
  await expect(recusa).toContainText('O arquivo não tem nenhuma linha de dados para importar');

  // 10.001 linhas cabem no tamanho: o cabeçalho é lido, o servidor conta as linhas e recusa (413).
  await entrada.setInputFiles(arquivos.acimaDasLinhas);
  await expect(contador.getByText('Associe as colunas do arquivo')).toBeVisible();
  const [resposta] = await Promise.all([
    contador.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/plano-contas/importacoes')),
    contador.getByRole('button', { name: 'Validar arquivo' }).click(),
  ]);
  expect(resposta.status()).toBe(413);
  const naoAceito = contador.getByRole('alert').filter({ hasText: 'O arquivo não foi aceito para validação' });
  await expect(naoAceito).toContainText('O arquivo passa do limite de 10 MB ou de 10.000 linhas');
  await expect(naoAceito).toContainText('Código de suporte:');

  // A API é a fronteira real: as mesmas recusas chegam como problem+json com correlationId.
  const casos = [
    [readFileSync(arquivos.acimaDoTamanho), 'grande.csv', 413, 'ARQUIVO_ACIMA_DO_LIMITE'],
    [readFileSync(arquivos.acimaDasLinhas), 'linhas.csv', 413, 'ARQUIVO_ACIMA_DO_LIMITE'],
    [bytesDa('plano-cabecalho-invalido.csv'), 'cabecalho.csv', 422, 'CABECALHO_INVALIDO'],
    [bytesDa('plano-so-cabecalho.csv'), 'vazio.csv', 422, 'ARQUIVO_VAZIO'],
  ] as const;
  for (const [conteudo, nome, status, codigo] of casos) {
    // Só letras, dígitos e hífen (até 64): é o formato que o proxy repassa e a API aceita.
    const correlationId = `e2e-f13-limite-${status}-${codigo.toLowerCase().replaceAll('_', '-')}`;
    const recusada = await enviarPelaApi(contador, empresa.limites, { nome, conteudo }, MAPEAMENTO_DO_MODELO, correlationId);

    expect(recusada.status, nome).toBe(status);
    expect(codigoDo(recusada), nome).toBe(codigo);
    expect(campoDe(recusada.corpo, 'correlationId'), nome).toBe(correlationId);
  }

  // Nada foi criado: nem tentativa, nem job.
  expect(await tentativasDa(pool, empresa.limites)).toEqual([]);
});

test('histórico: 15 tentativas por página, da mais recente para a mais antiga', async () => {
  // Dezesseis tentativas terminais gravadas direto no banco (o que se prova aqui é a paginação).
  await pool.query(
    `insert into app.importacao_plano_contas
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        estado, totais, usuario_iniciador_id, correlation_id, criado_em, iniciado_em, finalizado_em)
     select $1, $2, encode(sha256(convert_to('historico-' || g, 'UTF8')), 'hex'), $3::jsonb,
            'historico-' || lpad(g::text, 2, '0') || '.csv', 100, 'e2e/historico-' || g,
            'REJEITADA', '{"lidas":1,"novas":0,"atualizadas":0,"rejeitadas":1}'::jsonb, $4,
            'e2e-f13-historico-' || g, now() - (17 - g) * interval '1 minute',
            now() - (17 - g) * interval '1 minute', now() - (17 - g) * interval '1 minute'
       from generate_series(1, 16) g`,
    [tenantId, empresa.limites, JSON.stringify(MAPEAMENTO_DO_MODELO), contadorId],
  );

  await abrirAba(contador, empresa.limites);
  const historico = contador.getByRole('region', { name: 'Histórico de importações' });
  const linhas = historico.getByRole('table').getByRole('row');

  await expect(linhas).toHaveCount(16); // cabeçalho + 15
  await expect(linhas.nth(1)).toContainText('historico-16.csv');
  await expect(linhas.nth(15)).toContainText('historico-02.csv');
  await expect(historico.getByRole('navigation', { name: 'Paginação do histórico de importações' })).toContainText(
    /Página 1 de 2 · 16 importações/u,
  );

  await historico.getByRole('button', { name: 'Próxima' }).click();
  await expect(contador).toHaveURL(/historico=2/u);
  await expect(linhas).toHaveCount(2);
  await expect(linhas.nth(1)).toContainText('historico-01.csv');
});

// -- Jornada principal (Alfa) --------------------------------------------------------------------

test('jornada: CSV legado (Latin-1, `;`) → mapeamento → validação parcial → prévia sem mudar o plano', async () => {
  const antes = await contasDa(pool, empresa.alfa);
  const envios: string[] = [];
  contador.on('request', (pedido) => {
    if (pedido.method() === 'POST' && pedido.url().endsWith('/plano-contas/importacoes')) {
      envios.push(pedido.url());
    }
  });

  await abrirAba(contador, empresa.alfa);
  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-legado.csv'));

  // O cabeçalho do ERP foi lido em Latin-1 com `;`: a coluna "Natureza" bate com o modelo e vem
  // escolhida; o resto é decisão de quem importa.
  await expect(contador.getByText('Associe as colunas do arquivo')).toBeVisible();
  await expect(contador.getByText('6 colunas separadas por ponto e vírgula')).toBeVisible();
  await expect(contador.getByRole('columnheader', { name: /Descrição/u })).toBeVisible();
  await expect(contador.getByRole('combobox', { name: /^Natureza/u })).toContainText('Natureza');
  await expect(contador.getByRole('combobox', { name: /^Código/u })).toContainText('Escolha a coluna');

  // Mapeamento incompleto não envia nada: diz o que falta.
  await contador.getByRole('button', { name: 'Validar arquivo' }).click();
  await expect(contador.getByRole('alert').filter({ hasText: 'O mapeamento ainda não pode ser validado' })).toContainText(
    'Revise: Código, Nome, Tipo, Conta-pai.',
  );
  expect(envios).toEqual([]);

  await escolherColuna(contador, /^Código/u, 'Cod');
  await escolherColuna(contador, /^Nome/u, 'Descrição');
  await escolherColuna(contador, /^Tipo/u, 'Tipo Conta');
  await escolherColuna(contador, /^Conta-pai/u, 'Cod Superior');

  await provar(contador, 'upload-mapeamento', {
    recarregar: false,
    pronto: (page) => page.getByText('Associe as colunas do arquivo'),
  });

  principal = await validarPelaTela(contador);
  expect(principal.correlationId).toMatch(/^[A-Za-z0-9-]{8,64}$/u);

  await expect(contador.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 60_000 });
  await expect(contador.getByText('Aguardando confirmação').first()).toBeVisible();
  await expect(totalNaTela(contador, 'Linhas lidas')).toHaveText('8');
  await expect(totalNaTela(contador, 'Novas')).toHaveText('3');
  await expect(totalNaTela(contador, 'Atualizadas')).toHaveText('3');
  await expect(totalNaTela(contador, 'Rejeitadas')).toHaveText('2');

  const rejeicoes = contador.getByRole('table', { name: /Linhas rejeitadas de plano-legado\.csv/u });
  const linhaFisica = (numero: string) =>
    rejeicoes.getByRole('row').filter({ has: contador.getByRole('rowheader', { name: numero, exact: true }) });
  await expect(linhaFisica('8')).toContainText('3.9');
  await expect(linhaFisica('8')).toContainText('CONTA_ARQUIVADA');
  await expect(linhaFisica('8')).toContainText('reative-a separadamente');
  await expect(linhaFisica('9')).toContainText('4.1');
  await expect(linhaFisica('9')).toContainText('CONTA_PAI_INEXISTENTE');

  // Nenhuma conta muda antes da confirmação humana.
  expect(await contasDa(pool, empresa.alfa)).toEqual(antes);
});

test('confirmação: inclui as novas, atualiza pelo código, não toca a ausente nem a arquivada', async () => {
  const antes = await contasDa(pool, empresa.alfa);

  await confirmarPelaTela(contador);
  await expect(contador.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible({
    timeout: 30_000,
  });

  const depois = await contasDa(pool, empresa.alfa);

  expect([...depois.keys()]).toEqual(['1', '1.1', '1.1.01', '1.1.02', '1.1.03', '1.2', '1.2.01', '3', '3.9']);
  expect(depois.get('1.1.02')?.nome).toBe('Bancos Conta Movimento');
  expect(depois.get('1.1.03')).toMatchObject({ nome: 'Aplicações Financeiras', tipo: 'analitica', conta_pai: '1.1' });
  expect(depois.get('1.2')).toMatchObject({ nome: 'Ativo Não Circulante', tipo: 'sintetica', conta_pai: '1' });
  // Ausente do CSV: inalterada, sem nem a versão subir. Arquivada: nem atualizada nem reativada.
  expect(depois.get('1.1.01')).toEqual(antes.get('1.1.01'));
  expect(depois.get('3.9')).toEqual(antes.get('3.9'));
  expect(depois.has('4.1')).toBe(false);

  // O correlationId do envio está na tentativa, na fila e na trilha (o do worker é o do envio).
  const registro = await tentativa(pool, principal.tentativaId);
  expect(registro).toMatchObject({
    estado: 'CONCLUIDA_COM_REJEICOES',
    correlation_id: principal.correlationId,
    totais: { lidas: 8, novas: 3, atualizadas: 3, rejeitadas: 2 },
    usuario_iniciador_id: contadorId,
    usuario_confirmador_id: contadorId,
  });
  expect(dadosDoJob(principal.tentativaId)).toEqual({
    tenantId,
    empresaId: empresa.alfa,
    tentativaId: principal.tentativaId,
    correlationId: principal.correlationId,
  });
  const eventos = await eventosDa(pool, principal.tentativaId);
  expect(eventos.map((evento) => evento.acao)).toEqual([
    'CRIACAO',
    'INICIAR_VALIDACAO',
    'VALIDACAO_SUCESSO',
    'CONFIRMAR',
    'APLICACAO_SUCESSO_COM_REJEICOES',
  ]);
  expect(eventos.slice(0, 3).map((evento) => evento.correlation_id)).toEqual(Array(3).fill(principal.correlationId));
  for (const evento of eventos) {
    expect(evento.correlation_id).toMatch(/^[A-Za-z0-9-]{8,64}$/u);
  }

  // O plano vigente da tela já mostra o resultado.
  const plano = contador.getByRole('region', { name: 'Plano de contas vigente' });
  await expect(plano).toContainText('Aplicações Financeiras');
  await expect(plano).toContainText('Bancos Conta Movimento');
  await expect(plano.getByRole('row').filter({ hasText: 'Receitas Antigas' })).toContainText('Arquivada');

  await provar(contador, 'resultado-com-rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'Importação concluída com rejeições' }),
  });
});

test('relatório CSV: BOM, `;`, contas e rejeições com a linha física; o original continua o mesmo arquivo', async () => {
  await abrirAba(contador, empresa.alfa, `&tentativa=${principal.tentativaId}`);
  await expect(contador.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible();

  const relatorio = await baixarPeloBotao(contador, 'Baixar relatório CSV');

  expect(relatorio.nome).toBe('relatorio-plano-legado.csv');
  expect([...relatorio.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const linhas = relatorio.bytes.subarray(3).toString('utf8').split('\r\n');

  expect(linhas[0]).toBe('linha;codigo;nome;tipo;natureza;conta_pai;status;acao;codigo_de_erro;campo;mensagem');
  expect(linhas).toContain('5;1.1.03;Aplicações Financeiras;analitica;devedora;1.1;VALIDA;INCLUIR;;;');
  expect(linhas).toContain('4;1.1.02;Bancos Conta Movimento;analitica;devedora;1.1;VALIDA;ATUALIZAR;;;');
  // Rejeições com a linha física, o campo (SPEC-013 §3.4), o código estável e a mensagem do worker.
  // A mensagem com `;` vai entre aspas (escape de CSV do relatório).
  expect(linhas).toContain(
    '8;3.9;Receitas Antigas Reclassificadas;analitica;credora;3;REJEITADA;;CONTA_ARQUIVADA;codigo;' +
      '"A conta está arquivada e a importação não a altera; reative-a separadamente antes de importar."',
  );
  expect(linhas).toContain(
    '9;4.1;Custos Diretos;analitica;devedora;4;REJEITADA;;CONTA_PAI_INEXISTENTE;conta_pai;' +
      'A conta-pai não existe no plano de contas nem entre as linhas válidas do arquivo.',
  );
  expect(linhas.filter((linha) => linha !== '')).toHaveLength(9);

  const original = await baixarPeloBotao(contador, 'Baixar arquivo enviado');
  expect(original.bytes.equals(bytesDa('plano-legado.csv'))).toBe(true);
});

test('histórico da Alfa: a tentativa aparece com situação, totais e quem enviou', async () => {
  await abrirAba(contador, empresa.alfa);
  const historico = contador.getByRole('region', { name: 'Histórico de importações' });
  const linha = historico.getByRole('row').filter({ hasText: 'plano-legado.csv' });

  await expect(linha).toHaveCount(1);
  await expect(linha).toContainText('Concluída com rejeições');
  await expect(linha).toContainText(CONTADOR.nome);
  // Colunas de dados: enviada em (0), situação (1), novas (2), atualizadas (3), rejeitadas (4).
  await expect(linha.getByRole('cell').nth(2)).toHaveText('3');
  await expect(linha.getByRole('cell').nth(3)).toHaveText('3');
  await expect(linha.getByRole('cell').nth(4)).toHaveText('2');

  // O histórico guarda o correlationId do envio (SPEC-013 §3.9, §10).
  const historicoDaApi = await pelaApi(contador, `/empresas/${empresa.alfa}/plano-contas/importacoes`);
  const itens = campoDe(historicoDaApi.corpo, 'itens') as Array<{ id: string; correlationId: string }>;
  expect(itens.find((item) => item.id === principal.tentativaId)?.correlationId).toBe(principal.correlationId);

  await provar(contador, 'historico', {
    recarregar: true,
    pronto: (page) => page.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').nth(1),
    recorte: (page) => page.getByRole('region', { name: 'Histórico de importações' }),
  });
});

test('reenvio idêntico reaproveita o resultado: sem nova tentativa, conta ou notificação', async () => {
  const contasAntes = await contasDa(pool, empresa.alfa);
  const tentativasAntes = await tentativasDa(pool, empresa.alfa);
  const notificacoesAntes = await notificacoesDoUsuario(pool, contadorId);

  await abrirAba(contador, empresa.alfa);
  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-legado.csv'));
  await escolherColuna(contador, /^Código/u, 'Cod');
  await escolherColuna(contador, /^Nome/u, 'Descrição');
  await escolherColuna(contador, /^Tipo/u, 'Tipo Conta');
  await escolherColuna(contador, /^Conta-pai/u, 'Cod Superior');
  const reenvio = await validarPelaTela(contador);

  expect(reenvio.tentativaId).toBe(principal.tentativaId);
  await expect(contador.getByText(/já tinha sido processado: o resultado foi reaproveitado/u)).toBeVisible();
  // O envio relê o histórico (sem recarregar a página).
  await expect(
    contador.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').filter({ hasText: 'plano-legado.csv' }),
  ).toContainText('Resultado reaproveitado');

  expect(await contasDa(pool, empresa.alfa)).toEqual(contasAntes);
  expect((await tentativasDa(pool, empresa.alfa)).map((t) => t.id)).toEqual(tentativasAntes.map((t) => t.id));
  expect(await notificacoesDoUsuario(pool, contadorId)).toBe(notificacoesAntes);
  expect((await tentativa(pool, principal.tentativaId))?.reutilizada_por_idempotencia).toBe(true);
  expect((await eventosDa(pool, principal.tentativaId)).at(-1)?.acao).toBe('REUTILIZACAO');
});

test('notificação só para quem iniciou: o colega da mesma carteira não recebe', async () => {
  expect(await destinatariosDaNotificacao(pool, principal.tentativaId)).toEqual([contadorId]);
  expect(await notificacoesDoUsuario(pool, colegaId)).toBe(0);

  await contador.goto('/empresas');
  await contador.getByRole('button', { name: 'Notificações' }).click();
  const painel = contador.getByRole('dialog', { name: 'Painel de notificações' });
  const aviso = painel.getByText('Importação do plano de contas concluída com rejeições');

  await expect(aviso).toBeVisible();
  // O aviso abre a tentativa correspondente.
  await aviso.click();
  await expect(contador).toHaveURL(new RegExp(`/empresas/${empresa.alfa}\\?aba=plano-contas&tentativa=${principal.tentativaId}`, 'u'));

  // O painel do colega pela API (decisão do servidor) e pela tela, depois de carregado.
  const painelDaApi = await pelaApi(colega, '/notificacoes/painel');
  expect(painelDaApi.status).toBe(200);
  expect(painelDaApi.texto).not.toContain('IMPORTACAO_PLANO_CONTAS_CONCLUIDA');

  await colega.goto('/empresas');
  await colega.getByRole('button', { name: 'Notificações' }).click();
  const painelDoColega = colega.getByRole('dialog', { name: 'Painel de notificações' });
  await expect(
    painelDoColega.getByRole('heading', { name: 'Sem notificações' }).or(painelDoColega.getByRole('listitem').first()),
  ).toBeVisible({ timeout: 20_000 });
  await expect(painelDoColega.getByText(/Importação do plano de contas/u)).toHaveCount(0);
  await colega.keyboard.press('Escape');
});

// -- Aceitação parcial, permissões e cancelamento (Beta) -----------------------------------------

test('aceitação parcial: ciclo, pai ausente, código repetido, pai rejeitado e conta arquivada, com código estável', async () => {
  const antes = await contasDa(pool, empresa.beta);

  await abrirAba(contador, empresa.beta);
  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-parcial.csv'));
  // Cabeçalho do modelo: as cinco colunas vêm escolhidas.
  await expect(contador.getByRole('combobox', { name: /^Conta-pai/u })).toContainText('conta_pai');
  const enviado = await validarPelaTela(contador);

  previaDaBeta = enviado.tentativaId;
  await expect(contador.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 60_000 });
  await expect(totalNaTela(contador, 'Linhas lidas')).toHaveText('14');
  await expect(totalNaTela(contador, 'Novas')).toHaveText('5');
  await expect(totalNaTela(contador, 'Rejeitadas')).toHaveText('9');

  const pagina = await pelaApi(contador, `/empresas/${empresa.beta}/plano-contas/importacoes/${previaDaBeta}/rejeicoes`);
  const itens = campoDe(pagina.corpo, 'itens') as Array<{
    numeroDaLinha: number;
    codigo: string;
    campo: string | null;
    codigoDeErro: string;
  }>;

  // Linha física, código, campo e código de erro estável de cada rejeição (SPEC-013 §3.4).
  expect(itens.map((item) => [item.numeroDaLinha, item.codigo, item.campo, item.codigoDeErro])).toEqual([
    [5, '5.1', 'conta_pai', 'CICLO_HIERARQUICO'],
    [6, '5.2', 'conta_pai', 'CICLO_HIERARQUICO'],
    [7, '6.1', 'conta_pai', 'CONTA_PAI_INEXISTENTE'],
    [8, '7', 'codigo', 'CODIGO_DUPLICADO_NO_ARQUIVO'],
    [9, '7', 'codigo', 'CODIGO_DUPLICADO_NO_ARQUIVO'],
    [10, '7.1', 'conta_pai', 'CONTA_PAI_REJEITADA'],
    [11, '3.9', 'codigo', 'CONTA_ARQUIVADA'],
    // Filha da conta arquivada que o lote traz: o pai foi rejeitado no lote (vínculo causal).
    [14, '3.9.1', 'conta_pai', 'CONTA_PAI_REJEITADA'],
    // Pai novo analítico no mesmo lote: analítica não tem filhas (SPEC-013 §3.4).
    [15, '1.1.01.01', 'conta_pai', 'VALOR_FORA_DO_DOMINIO'],
  ]);

  const tabela = contador.getByRole('table', { name: /Linhas rejeitadas de plano-parcial\.csv/u });
  for (const codigo of [
    'CICLO_HIERARQUICO',
    'CONTA_PAI_INEXISTENTE',
    'CODIGO_DUPLICADO_NO_ARQUIVO',
    'CONTA_PAI_REJEITADA',
    'CONTA_ARQUIVADA',
    'VALOR_FORA_DO_DOMINIO',
  ]) {
    await expect(tabela.getByText(codigo, { exact: true }).first()).toBeVisible();
  }
  expect(await contasDa(pool, empresa.beta)).toEqual(antes);

  await provar(contador, 'previa-parcial', {
    recarregar: true,
    pronto: (page) => page.getByRole('button', { name: 'Confirmar importação' }),
  });
  await provar(contador, 'rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByRole('table', { name: /Linhas rejeitadas/u }),
    recorte: (page) => page.locator('section[aria-labelledby^="rejeicoes-"]'),
  });
});

test('auxiliar consulta e baixa, mas não importa nem confirma: a tela esconde e a API nega', async () => {
  await abrirAba(auxiliar, empresa.beta);
  await expect(
    auxiliar.getByText('Seu papel pode consultar o plano de contas, mas não tem permissão para importar.'),
  ).toBeVisible();
  await expect(auxiliar.getByLabel('Arquivo CSV do plano de contas')).toHaveCount(0);

  await auxiliar.getByRole('button', { name: 'Abrir importação' }).click();
  await expect(auxiliar.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible();
  await expect(auxiliar.getByRole('button', { name: 'Confirmar importação' })).toHaveCount(0);
  await expect(auxiliar.getByRole('button', { name: 'Cancelar importação' })).toHaveCount(0);
  await expect(auxiliar.getByText(/feito por quem tem a permissão Confirmar importação/u)).toBeVisible();

  const relatorio = await baixarPeloBotao(auxiliar, 'Baixar relatório CSV');
  expect(relatorio.bytes.toString('utf8')).toContain('CICLO_HIERARQUICO');

  const base = `/empresas/${empresa.beta}/plano-contas`;
  const envio = await enviarPelaApi(auxiliar, empresa.beta, { nome: 'aux.csv', conteudo: bytesDa('plano-bom.csv') });
  expect([envio.status, codigoDo(envio)]).toEqual([403, 'SEM_AUTORIZACAO']);
  for (const acao of ['confirmar', 'cancelar']) {
    const negada = await pelaApi(auxiliar, `${base}/importacoes/${previaDaBeta}/${acao}`, {
      metodo: 'POST',
      corpo: acao === 'confirmar' ? { versaoDaPrevia: 0 } : {},
    });
    expect(negada.status, acao).toBe(403);
  }
  for (const consulta of ['/contas', '/importacoes', `/importacoes/${previaDaBeta}`, '/modelo']) {
    expect((await pelaApi(auxiliar, `${base}${consulta}`)).status, consulta).toBe(200);
  }
  expect((await tentativa(pool, previaDaBeta))?.estado).toBe('AGUARDANDO_CONFIRMACAO');
});

test('cancelar preserva tentativa, arquivo, relatório e trilha, sem alterar o plano', async () => {
  const antes = await contasDa(pool, empresa.beta);

  await abrirAba(contador, empresa.beta, `&tentativa=${previaDaBeta}`);
  await contador.getByRole('button', { name: 'Cancelar importação' }).click();
  await contador.getByRole('alertdialog').getByRole('button', { name: 'Cancelar importação' }).click();
  await expect(contador.getByRole('heading', { name: 'Importação cancelada' })).toBeVisible();

  expect(await contasDa(pool, empresa.beta)).toEqual(antes);
  expect(await tentativa(pool, previaDaBeta)).toMatchObject({ estado: 'CANCELADA', usuario_cancelador_id: contadorId });
  expect((await eventosDa(pool, previaDaBeta)).at(-1)?.acao).toBe('CANCELAR');

  // O que foi enviado e o relatório continuam disponíveis.
  expect((await baixarPeloBotao(contador, 'Baixar relatório CSV')).bytes.toString('utf8')).toContain('CONTA_ARQUIVADA');
  expect((await baixarPeloBotao(contador, 'Baixar arquivo enviado')).bytes.equals(bytesDa('plano-parcial.csv'))).toBe(true);
});

test('fora da carteira: 403 EMPRESA_FORA_DA_CARTEIRA; outro escritório: 404; nenhum dado revelado', async () => {
  const base = `/empresas/${empresa.alfa}/plano-contas`;
  const rotas = ['/contas', '/importacoes', `/importacoes/${principal.tentativaId}`, `/importacoes/${principal.tentativaId}/relatorio`];

  for (const rota of rotas) {
    const fora = await pelaApi(deFora, `${base}${rota}`);
    expect([fora.status, codigoDo(fora)], `fora da carteira ${rota}`).toEqual([403, 'EMPRESA_FORA_DA_CARTEIRA']);
    expect(fora.texto).not.toContain('Bancos Conta Movimento');

    const outro = await pelaApi(outroAdmin, `${base}${rota}`);
    expect([outro.status, codigoDo(outro)], `outro escritório ${rota}`).toEqual([404, 'EMPRESA_NAO_ENCONTRADA']);
    expect(outro.texto).not.toContain('Bancos Conta Movimento');
  }
  const envio = await enviarPelaApi(deFora, empresa.alfa, { nome: 'fora.csv', conteudo: bytesDa('plano-bom.csv') });
  expect([envio.status, codigoDo(envio)]).toEqual([403, 'EMPRESA_FORA_DA_CARTEIRA']);
  expect((await tentativasDa(pool, empresa.alfa)).map((t) => t.id)).toEqual([principal.tentativaId]);

  await deFora.goto(`/empresas/${empresa.alfa}?aba=plano-contas`);
  await expect(deFora.getByText(/não está na sua carteira/u).first()).toBeVisible({ timeout: 20_000 });
  await expect(deFora.getByText('Bancos Conta Movimento')).toHaveCount(0);
});

// -- Conflito concorrente (Gama) -----------------------------------------------------------------

test('conflito concorrente: o plano muda entre a prévia e a confirmação → 409, painel e nova tentativa', async () => {
  await abrirAba(contador, empresa.gama);
  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-bom.csv'));
  const a = await validarPelaTela(contador);
  await expect(contador.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 60_000 });

  // Outra importação da mesma empresa é validada e confirmada pela API enquanto a prévia A está na tela.
  const b = await enviarPelaApi(contador, empresa.gama, { nome: basename(arquivos.variante), conteudo: readFileSync(arquivos.variante) });
  expect(b.status).toBe(202);
  const idDeB = String(campoDe(b.corpo, 'tentativaId'));
  await esperarEstado(pool, idDeB, 'AGUARDANDO_CONFIRMACAO');
  const previaDeB = await pelaApi(contador, `/empresas/${empresa.gama}/plano-contas/importacoes/${idDeB}`);
  const confirmacaoDeB = await pelaApi(contador, `/empresas/${empresa.gama}/plano-contas/importacoes/${idDeB}/confirmar`, {
    metodo: 'POST',
    corpo: { versaoDaPrevia: campoDe(previaDeB.corpo, 'versaoDaPrevia') },
  });
  expect(campoDe(confirmacaoDeB.corpo, 'estado')).toBe('CONCLUIDA');
  const planoDeB = await contasDa(pool, empresa.gama);

  // A confirmação da prévia obsoleta é recusada inteira.
  const [conflito] = await Promise.all([
    contador.waitForResponse((r) => r.url().endsWith(`/importacoes/${a.tentativaId}/confirmar`)),
    confirmarPelaTela(contador),
  ]);
  expect(conflito.status()).toBe(409);
  expect(((await conflito.json()) as { code: string }).code).toBe('CONFLITO_DE_VERSAO');
  const painel = contador.getByRole('alert').filter({ hasText: 'O plano de contas mudou depois desta validação' });
  await expect(painel).toContainText('Nenhuma conta foi alterada.');
  expect(await contasDa(pool, empresa.gama)).toEqual(planoDeB);
  expect((await tentativa(pool, a.tentativaId))?.estado).toBe('AGUARDANDO_CONFIRMACAO');

  await provar(contador, 'conflito-409', {
    recarregar: true,
    preparar: async (page) => {
      await expect(page.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 30_000 });
      await confirmarPelaTela(page);
    },
    pronto: (page) => page.getByText('O plano de contas mudou depois desta validação'),
  });

  // "Cancelar e validar novamente": cancela A e volta ao envio; o mesmo arquivo vira nova tentativa.
  await contador.getByRole('button', { name: 'Cancelar e validar novamente' }).click();
  await contador.getByRole('alertdialog').getByRole('button', { name: 'Cancelar prévia' }).click();
  await expect(contador.getByText('Arraste o CSV do plano de contas aqui')).toBeVisible();
  expect((await tentativa(pool, a.tentativaId))?.estado).toBe('CANCELADA');

  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-bom.csv'));
  const nova = await validarPelaTela(contador);
  expect(nova.tentativaId).not.toBe(a.tentativaId);
  await expect(contador.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 60_000 });
  await expect(totalNaTela(contador, 'Atualizadas')).toHaveText('6');
  await confirmarPelaTela(contador);
  await expect(contador.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
});

// -- Falha do worker (Delta) ---------------------------------------------------------------------

/**
 * Como a falha é induzida: a fila de validação do plano é PAUSADA (o job espera sem consumidor,
 * como com o worker fora do ar) e a chave do original desta tentativa passa a apontar para um
 * objeto que o MinIO recusa servir (nome acima do limite de 1.024 bytes do S3). Retomada a fila,
 * o worker lê, o armazenamento recusa com erro transitório (`ARMAZENAMENTO_INDISPONIVEL`) e o
 * BullMQ repete com backoff até o teto (5 tentativas): a tentativa termina em FALHA. Nenhum
 * contêiner é derrubado — na CI esta prova roda em paralelo com specs que usam o mesmo MinIO e os
 * mesmos workers (o monitor do Signer da spec-012). "Pilha de volta" = o mesmo arquivo reenviado:
 * a API grava o original na chave correta e a nova tentativa valida.
 */
test('falha do worker: sem consumidor a tentativa espera; o armazenamento recusa até esgotar o retry → FALHA acionável com correlationId; o reenvio cria nova tentativa', async () => {
  test.setTimeout(420_000);

  await pausarAValidacao();
  await abrirAba(contador, empresa.delta);
  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-bom.csv'));
  const enviado = await validarPelaTela(contador);

  await expect(contador.getByText('Validando o arquivo inteiro')).toBeVisible();
  expect((await tentativa(pool, enviado.tentativaId))?.estado).toBe('RECEBIDA');
  expect(dadosDoJob(enviado.tentativaId)).toEqual({
    tenantId,
    empresaId: empresa.delta,
    tentativaId: enviado.tentativaId,
    correlationId: enviado.correlationId,
  });
  await provar(contador, 'validacao-em-andamento', {
    recarregar: true,
    pronto: (page) => page.getByText('Validando o arquivo inteiro'),
  });

  const chaveOriginal = (await tentativa(pool, enviado.tentativaId))?.arquivo_chave ?? '';
  const chaveRecusada = `${chaveOriginal}/${'x'.repeat(1_100)}`;

  // PRÉ-CONDIÇÃO da indução: o original existe, e a chave longa é recusada pelo MinIO com um erro
  // que NÃO é "objeto ausente" (`NoSuchKey`/`NotFound` seriam definitivos, sem retry, e a prova do
  // teto de tentativas não valeria). O worker relê a chave do banco em cada tentativa.
  expect(await erroAoLerNoArmazenamento(chaveOriginal), 'o original da tentativa está no MinIO').toBeNull();
  const erroDaChaveRecusada = await erroAoLerNoArmazenamento(chaveRecusada);
  expect(
    erroDaChaveRecusada !== null && !['NoSuchKey', 'NotFound'].includes(erroDaChaveRecusada),
    `indução inválida neste MinIO: a chave acima de 1.024 bytes deu "${erroDaChaveRecusada ?? 'leitura com sucesso'}"`,
  ).toBe(true);

  await pool.query('update app.importacao_plano_contas set arquivo_chave = $2 where id = $1', [
    enviado.tentativaId,
    chaveRecusada,
  ]);
  await retomarAValidacao();
  await esperarEstado(pool, enviado.tentativaId, 'FALHA', 240_000);

  const falha = (await eventosDa(pool, enviado.tentativaId)).find((evento) => evento.acao === 'FALHA_TECNICA');
  expect(falha).toMatchObject({ codigo: 'ARMAZENAMENTO_INDISPONIVEL', correlation_id: enviado.correlationId });
  // A FALHA é gravada antes da cópia para a fila morta (tratamento do `failed`): espera-se a cópia.
  // O retry foi controlado: as 5 tentativas do BullMQ, nenhuma a mais.
  await expect
    .poll(() => jobsMortosDa(enviado.tentativaId), { timeout: 15_000, intervals: [500] })
    .toEqual([
      expect.objectContaining({
        tentativaId: enviado.tentativaId,
        correlationId: enviado.correlationId,
        motivo: 'ARMAZENAMENTO_INDISPONIVEL',
        tentativas: 5,
      }),
    ]);
  expect(await destinatariosDaNotificacao(pool, enviado.tentativaId)).toEqual([contadorId]);

  const previa = await pelaApi(contador, `/empresas/${empresa.delta}/plano-contas/importacoes/${enviado.tentativaId}`);
  const diagnostico = campoDe(previa.corpo, 'diagnostico') as { codigo: string; mensagem: string } | null;
  expect(diagnostico?.codigo).toBe('ARMAZENAMENTO_INDISPONIVEL');

  await expect(contador.getByRole('heading', { name: 'A importação falhou por um problema técnico' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(contador.getByText(diagnostico?.mensagem ?? '—')).toBeVisible();
  await expect(contador.locator('code').filter({ hasText: enviado.correlationId })).toBeVisible();

  await provar(contador, 'falha-tecnica', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'A importação falhou por um problema técnico' }),
  });

  // "Enviar nova tentativa" com o mesmo arquivo: nova tentativa (FALHA sai da idempotência), que valida.
  await contador.getByRole('button', { name: 'Enviar nova tentativa' }).click();
  await contador.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-bom.csv'));
  const nova = await validarPelaTela(contador);
  expect(nova.tentativaId).not.toBe(enviado.tentativaId);
  await expect(contador.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 90_000 });

  // A validação terminou no worker, sem comando na tela: o fim do acompanhamento relê o histórico
  // (sem recarregar a página).
  const historico = contador.getByRole('region', { name: 'Histórico de importações' });
  await expect(historico.getByRole('row').filter({ hasText: 'Falha técnica' })).toHaveCount(1);
  await expect(historico.getByRole('row').filter({ hasText: 'Aguardando confirmação' })).toHaveCount(1);
});

// -- Onboarding e pendência ----------------------------------------------------------------------

const abrirEtapa = async (page: Page, etapa: string): Promise<void> => {
  const titulo = page.getByRole('heading', { name: etapa, level: 2 });

  if (await titulo.isVisible().catch(() => false)) {
    return;
  }
  await page.getByRole('navigation', { name: 'Etapas do cadastro' }).getByRole('button', { name: new RegExp(`^${etapa}`, 'u') }).click();
  await expect(titulo).toBeVisible();
};

test('onboarding: depois de ativar, a etapa opcional "Plano de contas"; sem importar, a pendência fica na Central', async () => {
  // Pelo caminho do produto (o mesmo POST de "Iniciar cadastro"): a administradora que cria entra na
  // própria carteira já na criação, e só assim alcança o wizard da empresa incompleta (SPEC-009 §3.1).
  // Empresa em CADASTRO_INCOMPLETO gravada por SQL não está em carteira nenhuma e a RLS a esconde.
  const criacao = await pelaApi(admin, '/empresas', { metodo: 'POST', corpo: { cnpj: CNPJ_DO_ONBOARDING } });
  expect(criacao.status, criacao.texto.slice(0, 300)).toBe(201);
  empresa.onboarding = String(campoDe(criacao.corpo, 'id'));

  await admin.goto(`/empresas/${empresa.onboarding}`);
  await expect(admin.getByRole('navigation', { name: 'Etapas do cadastro' })).toBeVisible({ timeout: 30_000 });

  // As etapas pela tela, como na spec-002: identificação e endereço vêm da fonte externa; o regime
  // é escolha humana.
  await abrirEtapa(admin, 'Identificação');
  await admin.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(admin.getByText('Identificação salva.').first()).toBeVisible();
  await abrirEtapa(admin, 'Dados fiscais');
  await admin.getByRole('combobox', { name: /Regime tributário/u }).click();
  await admin.getByRole('option', { name: 'Lucro Presumido' }).click();
  await admin.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(admin.getByText('Dados fiscais salvos.').first()).toBeVisible();
  await abrirEtapa(admin, 'Revisão e ativação');
  await expect(admin.getByRole('button', { name: 'Ativar empresa' })).toBeEnabled();
  await admin.getByRole('button', { name: 'Ativar empresa' }).click();

  // A etapa final opcional aparece no lugar da revisão, na mesma página.
  await expect(admin.getByRole('heading', { level: 2, name: 'Plano de contas' })).toBeVisible({ timeout: 30_000 });
  await expect(admin.getByText('Etapa opcional').first()).toBeVisible();
  await expect(admin.getByText('Plano de contas (opcional)').first()).toBeVisible();
  await expect(admin.getByText(/a pendência Plano de contas incompleto continua visível/u)).toBeVisible();
  expect(await pendenciaDoPlano(pool, empresa.onboarding)).toEqual(['ABERTA']);

  await provar(admin, 'onboarding-plano-de-contas', {
    recarregar: false,
    pronto: (page) => page.getByText('Etapa opcional'),
  });

  await admin.getByRole('button', { name: 'Continuar sem importar' }).click();
  await admin.waitForURL(/\/empresas$/u);
  expect(
    (await pool.query<{ status: string }>('select status from app.empresa where id = $1', [empresa.onboarding])).rows[0]?.status,
  ).toBe('ATIVA');

  await admin.goto(`/pendencias?empresaId=${empresa.onboarding}`);
  await expect(admin.getByRole('row').filter({ hasText: 'Plano de contas incompleto' }).first()).toBeVisible({ timeout: 20_000 });
});

test('zero linhas válidas: REJEITADA, a pendência persiste; a primeira conta válida a resolve', async () => {
  await admin.goto(`/pendencias?empresaId=${empresa.onboarding}`);
  await admin.getByRole('link', { name: /Abrir aba Plano de contas de/u }).first().click();
  await expect(admin).toHaveURL(new RegExp(`/empresas/${empresa.onboarding}\\?aba=plano-contas`, 'u'));
  await expect(admin.getByRole('heading', { level: 2, name: 'Plano de contas' })).toBeVisible();

  await admin.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-sem-linhas-validas.csv'));
  const rejeitada = await validarPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Nenhuma linha foi aplicada' })).toBeVisible({ timeout: 60_000 });
  expect((await tentativa(pool, rejeitada.tentativaId))?.estado).toBe('REJEITADA');
  expect(await pendenciaDoPlano(pool, empresa.onboarding)).toEqual(['ABERTA']);
  expect(await contasDa(pool, empresa.onboarding)).toEqual(new Map());

  await admin.getByRole('button', { name: 'Nova importação' }).click();
  await admin.getByLabel('Arquivo CSV do plano de contas').setInputFiles(caminhoDa('plano-bom.csv'));
  await validarPelaTela(admin);
  await expect(admin.getByText(/Todas as 6 linhas lidas são válidas/u)).toBeVisible({ timeout: 60_000 });
  await provar(admin, 'previa-sem-rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByText(/Todas as 6 linhas lidas são válidas/u),
  });

  await confirmarPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
  expect(await pendenciaDoPlano(pool, empresa.onboarding)).toEqual(['RESOLVIDA']);

  // Marcador de lista carregada: a pendência de certificado ausente, aberta na mesma ativação
  // (SPEC-011), continua na Central; a do plano não está mais lá.
  await admin.goto(`/pendencias?empresaId=${empresa.onboarding}&estado=ABERTA`);
  await expect(admin.getByRole('row').filter({ hasText: 'Certificado ausente' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(admin.getByRole('row').filter({ hasText: 'Plano de contas incompleto' })).toHaveCount(0);
});

// -- Segredo e acessibilidade --------------------------------------------------------------------

test('nenhum segredo nem caminho de storage nas respostas ao navegador, nos logs da API e dos workers e nos artefatos', async () => {
  const chaves = (
    await pool.query<{ arquivo_chave: string }>(
      `select arquivo_chave from app.importacao_plano_contas where tenant_id = $1 and arquivo_chave not like 'e2e/%'`,
      [tenantId],
    )
  ).rows.map((linha) => linha.arquivo_chave);
  expect(chaves.length).toBeGreaterThan(0);

  // O valor do ambiente desta rodada E o de desenvolvimento do `.env.example`: um ambiente sem a
  // variável não deixa a varredura procurar só um valor que não é o usado.
  const segredos = [
    ...new Set(
      [
        process.env['MINIO_ROOT_PASSWORD'],
        'contaia_local_secret',
        process.env['POSTGRES_APP_PASSWORD'],
        'contaia_app_local',
        process.env['KEYCLOAK_CLIENT_SECRET'],
        'contaia-web-local-secret',
        process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'],
        'contaia-api-admin-local-secret',
        process.env['COFRE_SERVICE_TOKEN'],
        process.env['COFRE_ADMIN_TOKEN'],
        ...PESSOAS.map((quem) => quem.senha),
      ].filter((valor): valor is string => valor !== undefined && valor.length >= 8),
    ),
  ];
  expect(corposRecebidos.length).toBeGreaterThan(20);

  for (const termo of [...segredos, ...chaves]) {
    expect(corposRecebidos.filter((corpo) => corpo.includes(termo)).length, `"${termo.slice(0, 10)}…" chegou ao navegador`).toBe(0);
  }

  // Os logs não guardam segredo, nem a chave do original, nem o conteúdo das linhas do CSV.
  const conteudo = ['Receitas Antigas Reclassificadas', 'Aplicações Financeiras', 'Ciclo A'];
  for (const servico of ['api', 'workers']) {
    const logs = logsDe(servico);

    for (const termo of [...segredos, ...chaves, ...conteudo]) {
      expect(logs.includes(termo), `"${termo.slice(0, 10)}…" nos logs de ${servico}`).toBe(false);
    }
  }

  const comSegredo: string[] = [];
  const varrer = (pasta: string): void => {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome);

      if (statSync(caminho).isDirectory()) {
        varrer(caminho);
      } else if (/\.(json|xml|txt|log|md|html|svg|yml)$/u.test(nome)) {
        const texto = readFileSync(caminho, 'utf8');

        if (segredos.some((termo) => texto.includes(termo))) {
          comSegredo.push(caminho);
        }
      }
    }
  };
  try {
    varrer(resolve(`test-results/${ESCOPO}`));
  } catch {
    // Sem pasta de resultados ainda: nada a varrer.
  }
  expect(comSegredo).toEqual([]);
});

test('provas visuais: os 10 estados-chave capturados, sem violação do axe (WCAG 2.1 A/AA) e sem rolagem horizontal', () => {
  expect(Object.keys(achados).sort()).toEqual(
    [
      'conflito-409',
      'falha-tecnica',
      'historico',
      'onboarding-plano-de-contas',
      'previa-parcial',
      'previa-sem-rejeicoes',
      'rejeicoes',
      'resultado-com-rejeicoes',
      'upload-mapeamento',
      'validacao-em-andamento',
    ].sort(),
  );

  const violacoes = Object.fromEntries(
    Object.entries(achados)
      .map(([estado, achado]) => [estado, Object.values(achado.violacoes).flat()] as const)
      .filter(([, lista]) => lista.length > 0),
  );
  const rolagens = Object.fromEntries(
    Object.entries(achados)
      .map(([estado, achado]) => [estado, achado.rolagens] as const)
      .filter(([, lista]) => lista.length > 0),
  );

  expect(violacoes, 'violações do axe por estado').toEqual({});
  expect(rolagens, 'rolagem horizontal por estado').toEqual({});
});
