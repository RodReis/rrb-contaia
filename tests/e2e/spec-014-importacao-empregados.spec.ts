/**
 * E2E SPEC-014: importação de empregados por CSV, pela pilha real da composição Docker: Keycloak,
 * PostgreSQL (RLS), Redis/BullMQ, MinIO, API e workers em contêiner, Web no host. Nada é dublado no
 * caminho da importação: a tela envia o CSV, a API grava o original no MinIO e enfileira, o worker
 * valida em staging e a confirmação aplica numa transação.
 *
 * Jornada (§9, §10): CSV legado em Latin-1 com `;` → mapeamento → validação parcial → prévia →
 * confirmação → base atualizada (reimportação: novo inclui, existente atualiza, ausente permanece,
 * arquivado não reativa) → relatório CSV → histórico, com o `correlationId` do envio na tentativa,
 * na fila e nos eventos. Contrafactuais: acima de 10 MB e de 10.000 linhas, ZIP com extensão `.csv`,
 * cabeçalho inválido, só cabeçalho, CPF inválido, datas impossíveis e ambíguas, nascimento igual à
 * admissão, chave repetida (todas as ocorrências), nome em branco, empregado arquivado, zero linhas
 * válidas (pendência segue), conflito concorrente (409), falha do worker (fila sem consumidor e
 * armazenamento que recusa o original até esgotar o retry), reenvio idêntico, mesmo arquivo com
 * outro mapeamento e cancelamento. Permissões por papel (papel personalizado de DP, contador,
 * auditor, auxiliar), carteira e tenant; notificações do iniciador e dos administradores com a
 * empresa na carteira; pendência e a etapa opcional do onboarding. Provas visuais nos dois temas e
 * nos três viewports, axe em cada estado-chave e varredura de segredo e de dado pessoal nos logs.
 *
 * Isolamento: escritório, usuários e empresas próprios (`e2e-f14-*`, CNPJs `1414…`). Nenhum
 * contêiner é derrubado: a falha do worker pausa só a fila de validação dos empregados (o `afterAll`
 * a retoma mesmo se a prova falhar no meio), porque na CI as specs rodam em paralelo — inclusive a
 * spec-013, que usa a outra fila nos mesmos workers.
 *
 * Depende de: composição no ar (`pnpm docker:up`) com API e workers, `pnpm db:migrate`, `pnpm build`
 * e dos processos Web, cofre e dublê da CNPJá (o `playwright.config.ts` os sobe).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  MAPEAMENTO_DO_LEGADO,
  MAPEAMENTO_DO_MODELO,
  ROTULO_DO_ARQUIVO,
  abrirAbaDeEmpregados,
  atribuirPapelDeDepartamentoPessoal,
  avisosDeEmpregadosDo,
  bytesDe,
  caminhoDe,
  destinatariosDosEmpregados,
  empregadosDa,
  enviarEmpregadosPelaApi,
  esperarEstadoDosEmpregados,
  eventosDaTentativa,
  gerarArquivosDeEmpregados,
  pendenciaDosEmpregados,
  semearEmpregados,
  tentativaDeEmpregados,
  tentativasDeEmpregadosDa,
  validarEmpregadosPelaTela,
  type ArquivosGeradosDeEmpregados,
} from './fixtures/empregados';
import {
  baixarPeloBotao,
  campoDe,
  codigoDo,
  confirmarPelaTela,
  dadosDoJob,
  erroAoLerNoArmazenamento,
  escolherColuna,
  jobsMortosDa,
  logsDe,
  pausarAValidacao,
  pelaApi,
  provarVisualmente,
  retomarAValidacao,
  totalNaTela,
  type AchadosVisuais,
} from './fixtures/plano-contas';

const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';
// Subpasta própria fora do escopo SPEC-014 (como a spec-013): com o escopo de outra SPEC, a spec-015
// grava em `provas/` e roda em paralelo; a limpeza dos `.png` desta spec não pode apagar as dela.
const PASTA_DAS_PROVAS = resolve(
  ESCOPO === 'SPEC-014' ? `test-results/${ESCOPO}/e2e/provas` : `test-results/${ESCOPO}/e2e/provas/spec-014`,
);
const FILA = 'empregados-validacao';

const CNPJ_DO_ESCRITORIO = cnpjValido('141414140001');
const CNPJ_DO_OUTRO_ESCRITORIO = cnpjValido('149914990002');
const cnpjDaEmpresa = (sequencial: number): string => cnpjValido(`1414${String(sequencial).padStart(4, '0')}0001`);

const pessoa = (papel: string, nome: string): Pessoa => ({
  usuario: `e2e-f14-${papel}`,
  senha: `senha-${papel}-f14-123456`,
  nome,
});
const ADMIN = pessoa('admin', 'Administradora Empregados');
const DP = pessoa('dp', 'Analista de Departamento Pessoal');
const CONTADOR = pessoa('contador', 'Contador Empregados');
const AUDITOR = pessoa('auditor', 'Auditora Empregados');
const AUXILIAR = pessoa('auxiliar', 'Auxiliar Empregados');
const DE_FORA = pessoa('contador-fora', 'Contadora de Fora');
const OUTRO_ADMIN = pessoa('outro-admin', 'Administrador de Outro Escritório');
const PESSOAS = [ADMIN, DP, CONTADOR, AUDITOR, AUXILIAR, DE_FORA, OUTRO_ADMIN];

/** CNPJ que o dublê da CNPJá conhece (o mesmo da spec-002 e da spec-013, cada uma no seu escritório). */
const CNPJ_DO_ONBOARDING = '19131243000197';

/** CPFs da base e dos arquivos (todos com dígitos verificadores corretos). */
const CPF = {
  ana: '14014014061',
  bruno: '14114114122',
  carla: '14214214293',
  debora: '14314314354',
  joao: '14414414415',
} as const;

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

// Fila, worker e retry com backoff: cada passo tem folga própria.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

// O login preenche senha no Keycloak: trace, vídeo e captura automática a gravariam.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// -- Estado da prova -----------------------------------------------------------------------------

let tenantId = '';
const ids = { admin: '', dp: '', contador: '', auditor: '', adminSemCarteira: '' };
const empresa = { alfa: '', beta: '', gama: '', delta: '', limites: '', onboarding: '' };

const contextos: BrowserContext[] = [];
let admin: Page;
let dp: Page;
let contador: Page;
let auditor: Page;
let auxiliar: Page;
let deFora: Page;
let outroAdmin: Page;

let arquivos: ArquivosGeradosDeEmpregados;

/** Tentativa da jornada principal (Alfa) e o id de correlação que a tela mandou no envio. */
let principal = { tentativaId: '', correlationId: '' };
/** Prévia da Beta, consultada por contador e auditor antes de ser cancelada. */
let previaDaBeta = '';

/** Tudo que os navegadores da prova receberam em texto: nenhum segredo pode estar aqui. */
const corposRecebidos: string[] = [];
/** Achados das provas visuais por estado; afirmados só no teste final dedicado. */
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

const novaPagina = async (browser: Browser, quem: Pessoa): Promise<Page> => {
  // `bypassCSP`: o axe é injetado na página para a checagem de acessibilidade.
  const contexto = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();

  contextos.push(contexto);
  await entrarComo(page, quem);

  return page;
};

/** Escolhe as quatro colunas que o cabeçalho do ERP não deixa sugerir (o CPF vem escolhido). */
const mapearOLegado = async (page: Page): Promise<void> => {
  await escolherColuna(page, /^Nome completo/u, 'Nome Funcionário');
  await escolherColuna(page, /^Matrícula/u, 'Matr.');
  await escolherColuna(page, /^Data de nascimento/u, 'Dt Nascimento');
  await escolherColuna(page, /^Data de admissão/u, 'Dt Admissão');
};

const previaDaApi = async (page: Page, empresaId: string, tentativaId: string): Promise<unknown> =>
  (await pelaApi(page, `/empresas/${empresaId}/empregados/importacoes/${tentativaId}`)).corpo;

/** Envia pela API, espera a prévia e confirma com a versão que ela traz. */
const importarPelaApi = async (page: Page, empresaId: string, nome: string, conteudo: Buffer): Promise<string> => {
  const envio = await enviarEmpregadosPelaApi(page, empresaId, { nome, conteudo });
  expect(envio.status, envio.texto.slice(0, 300)).toBe(202);
  const id = String(campoDe(envio.corpo, 'tentativaId'));

  await esperarEstadoDosEmpregados(pool, id, 'AGUARDANDO_CONFIRMACAO');
  const confirmacao = await pelaApi(page, `/empresas/${empresaId}/empregados/importacoes/${id}/confirmar`, {
    metodo: 'POST',
    corpo: { versaoDaPrevia: campoDe(await previaDaApi(page, empresaId, id), 'versaoDaPrevia') },
  });
  expect(confirmacao.status, confirmacao.texto.slice(0, 300)).toBe(200);

  return id;
};

const ordenados = (lista: readonly string[]): string[] => [...lista].sort();

// -- Preparação ----------------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);

  // Uma rodada morta no meio da falha do worker deixaria a fila pausada (o Redis é persistente).
  await retomarAValidacao(FILA);
  await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO, CNPJ_DO_OUTRO_ESCRITORIO]);
  await removerIdentidadesComPrefixo('e2e-f14-');
  // Só as capturas: a comparação com o protótipo (COMPARACAO.md) é escrita à mão e fica.
  try {
    for (const nome of readdirSync(PASTA_DAS_PROVAS)) {
      if (nome.endsWith('.png')) {
        rmSync(join(PASTA_DAS_PROVAS, nome), { force: true });
      }
    }
  } catch {
    // Primeira rodada: a pasta ainda não existe.
  }
  arquivos = gerarArquivosDeEmpregados();

  tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F14');
  const outroTenantId = await criarEscritorio(pool, CNPJ_DO_OUTRO_ESCRITORIO, 'Outro Escritório E2E da F14');

  const criados: Record<string, string> = {};
  for (const [quem, papel, tenant] of [
    [ADMIN, 'admin_escritorio', tenantId],
    [DP, 'auxiliar', tenantId],
    [CONTADOR, 'contador', tenantId],
    [AUDITOR, 'auditor_readonly', tenantId],
    [AUXILIAR, 'auxiliar', tenantId],
    [DE_FORA, 'contador', tenantId],
    [OUTRO_ADMIN, 'admin_escritorio', outroTenantId],
  ] as const) {
    criados[quem.usuario] = await criarUsuario(pool, tenant, await criarIdentidade(quem), quem, papel);
  }
  ids.admin = criados[ADMIN.usuario] ?? '';
  ids.dp = criados[DP.usuario] ?? '';
  ids.contador = criados[CONTADOR.usuario] ?? '';
  ids.auditor = criados[AUDITOR.usuario] ?? '';
  // Outra administradora do escritório, sem nenhuma empresa na carteira: alcança tudo, mas não é
  // "administradora com acesso à empresa" para o aviso (decisão para o PI no Card #16). Só existe
  // no banco: a prova é a de que ela NÃO recebe.
  ids.adminSemCarteira = await criarUsuario(
    pool,
    tenantId,
    randomUUID(),
    { usuario: 'e2e-f14-admin-sem-carteira', senha: '-', nome: 'Administrador sem Carteira' },
    'admin_escritorio',
  );
  // O `dp` do MVP-3 ainda não é papel padrão: entra como papel personalizado sobre o auxiliar.
  await atribuirPapelDeDepartamentoPessoal(pool, tenantId, ids.dp);

  empresa.alfa = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(1), 'Alfa Empregados E2E');
  empresa.beta = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(2), 'Beta Empregados E2E');
  empresa.gama = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(3), 'Gama Empregados E2E');
  empresa.delta = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(4), 'Delta Empregados E2E');
  empresa.limites = await criarEmpresa(pool, tenantId, cnpjDaEmpresa(5), 'Limites Empregados E2E');

  // Carteira: administradora e DP nas cinco; contador e auditora na Alfa e na Beta; o auxiliar na
  // Alfa; a contadora de fora em nenhuma.
  for (const id of [empresa.alfa, empresa.beta, empresa.gama, empresa.delta, empresa.limites]) {
    await vincular(pool, tenantId, ids.admin, id);
    await vincular(pool, tenantId, ids.dp, id);
  }
  for (const id of [empresa.alfa, empresa.beta]) {
    await vincular(pool, tenantId, ids.contador, id);
    await vincular(pool, tenantId, ids.auditor, id);
  }
  await vincular(pool, tenantId, criados[AUXILIAR.usuario] ?? '', empresa.alfa);

  // Base vigente da Alfa: uma empregada que o CSV atualiza, um ausente do CSV (fica intacto) e uma
  // arquivada que o CSV traz (é rejeitada e não reativa).
  await semearEmpregados(pool, tenantId, empresa.alfa, [
    [CPF.ana, 'Ana Antiga', '00100', '1990-03-15', '2015-02-01'],
    [CPF.bruno, 'Bruno Ausente', '00200', '1982-04-10', '2010-08-02'],
    [CPF.carla, 'Carla Arquivada', '00300', '1979-09-20', '2000-01-02', true],
  ]);

  admin = await novaPagina(browser, ADMIN);
  dp = await novaPagina(browser, DP);
  contador = await novaPagina(browser, CONTADOR);
  auditor = await novaPagina(browser, AUDITOR);
  auxiliar = await novaPagina(browser, AUXILIAR);
  deFora = await novaPagina(browser, DE_FORA);
  outroAdmin = await novaPagina(browser, OUTRO_ADMIN);
  for (const page of [admin, dp, contador, auditor, auxiliar, deFora, outroAdmin]) {
    escutarRespostas(page);
  }
});

test.afterAll(async () => {
  // A fila pausada volta a andar, mesmo se a prova falhar no meio.
  await retomarAValidacao(FILA).catch(() => undefined);
  if (arquivos !== undefined) {
    rmSync(arquivos.pasta, { recursive: true, force: true });
  }
  await Promise.all(contextos.map((contexto) => contexto.close()));
  await pool.end();
});

// -- Limites do arquivo (recusa antes do staging) ------------------------------------------------

test('base vazia; acima de 10 MB, acima de 10.000 linhas, ZIP com extensão .csv, cabeçalho inválido e só cabeçalho: recusados antes do staging', async () => {
  await abrirAbaDeEmpregados(dp, empresa.limites);
  await expect(dp.getByText('Esta empresa ainda não tem empregados importados')).toBeVisible({ timeout: 30_000 });
  // As regras do arquivo dizem só o que a fatia faz: nada de cargo, salário, folha ou eSocial.
  const conteudo = await dp.locator('main').innerText();
  for (const termo of [/cargo/iu, /sal[aá]rio/iu, /dependente/iu, /folha/iu, /esocial/iu]) {
    expect(conteudo, String(termo)).not.toMatch(termo);
  }
  await provar(dp, 'base-vazia', {
    recarregar: true,
    pronto: (page) => page.getByText('Esta empresa ainda não tem empregados importados'),
  });
  await provar(dp, 'historico-vazio', {
    recarregar: true,
    pronto: (page) => page.getByRole('region', { name: 'Histórico de importações' }).getByText('Nenhuma importação ainda'),
    recorte: (page) => page.getByRole('region', { name: 'Histórico de importações' }),
  });

  const entrada = dp.getByLabel(ROTULO_DO_ARQUIVO);
  const recusa = dp.getByRole('alert').filter({ hasText: 'Arquivo recusado antes do envio' });

  // O navegador recusa sem enviar: tamanho, conteúdo que não é CSV, cabeçalho repetido e arquivo
  // sem linha de dados.
  await entrada.setInputFiles(arquivos.acimaDoTamanho);
  await expect(recusa).toContainText(basename(arquivos.acimaDoTamanho));
  await expect(recusa).toContainText('Arquivo acima do limite de 10 MB');
  await expect(recusa).toContainText('Nada foi enviado');

  await entrada.setInputFiles(arquivos.zipComExtensaoCsv);
  await expect(recusa).toContainText('Não foi possível usar este arquivo.');

  await entrada.setInputFiles(caminhoDe('empregados-cabecalho-invalido.csv'));
  await expect(recusa).toContainText('O cabeçalho do arquivo está ausente, repetido ou em branco');

  await entrada.setInputFiles(caminhoDe('empregados-so-cabecalho.csv'));
  await expect(recusa).toContainText('O arquivo não tem nenhuma linha de dados para importar');
  await provar(dp, 'arquivo-rejeitado-antes-do-envio', {
    recarregar: false,
    pronto: (page) => page.getByRole('alert').filter({ hasText: 'Arquivo recusado antes do envio' }),
  });

  // 10.001 linhas cabem no tamanho: o cabeçalho é lido, o servidor conta as linhas e recusa (413).
  await entrada.setInputFiles(arquivos.acimaDasLinhas);
  await expect(dp.getByText('Associe as colunas do arquivo')).toBeVisible();
  const [resposta] = await Promise.all([
    dp.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/empregados/importacoes')),
    dp.getByRole('button', { name: 'Validar arquivo' }).click(),
  ]);
  expect(resposta.status()).toBe(413);
  const naoAceito = dp.getByRole('alert').filter({ hasText: 'O arquivo não foi aceito para validação' });
  await expect(naoAceito).toContainText('O arquivo passa do limite de 10 MB ou de 10.000 linhas');
  await expect(naoAceito).toContainText('Código de suporte:');

  // A API é a fronteira real: as mesmas recusas chegam como problem+json com correlationId.
  const casos = [
    [readFileSync(arquivos.acimaDoTamanho), 'grande.csv', 413, 'ARQUIVO_ACIMA_DO_LIMITE'],
    [readFileSync(arquivos.acimaDasLinhas), 'linhas.csv', 413, 'ARQUIVO_ACIMA_DO_LIMITE'],
    [readFileSync(arquivos.zipComExtensaoCsv), 'empregados.csv', 422, 'ARQUIVO_INVALIDO'],
    [bytesDe('empregados-cabecalho-invalido.csv'), 'cabecalho.csv', 422, 'CABECALHO_INVALIDO'],
    [bytesDe('empregados-so-cabecalho.csv'), 'vazio.csv', 422, 'ARQUIVO_VAZIO'],
  ] as const;
  for (const [conteudoDoArquivo, nome, status, codigo] of casos) {
    const correlationId = `e2e-f14-limite-${status}-${codigo.toLowerCase().replaceAll('_', '-')}`;
    const recusada = await enviarEmpregadosPelaApi(dp, empresa.limites, { nome, conteudo: conteudoDoArquivo }, MAPEAMENTO_DO_MODELO, correlationId);

    expect(recusada.status, nome).toBe(status);
    expect(codigoDo(recusada), nome).toBe(codigo);
    expect(campoDe(recusada.corpo, 'correlationId'), nome).toBe(correlationId);
  }

  // Mapeamento incompleto e coluna inexistente: 422 antes do storage.
  const incompleto = await enviarEmpregadosPelaApi(dp, empresa.limites, { nome: 'bom.csv', conteudo: bytesDe('empregados-bom.csv') }, {
    cpf: 'cpf',
    nome: 'nome',
    matricula: 'matricula',
    data_nascimento: 'data_nascimento',
  });
  expect([incompleto.status, codigoDo(incompleto)]).toEqual([422, 'MAPEAMENTO_INCOMPLETO']);

  // Nada foi criado: nem tentativa, nem job.
  expect(await tentativasDeEmpregadosDa(pool, empresa.limites)).toEqual([]);
});

test('histórico: 15 tentativas por página, da mais recente para a mais antiga', async () => {
  await pool.query(
    `insert into app.importacao_empregados
       (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
        estado, totais, usuario_iniciador_id, correlation_id, criado_em, iniciado_em, finalizado_em)
     select $1, $2, encode(sha256(convert_to('historico-' || g, 'UTF8')), 'hex'), $3::jsonb,
            'historico-' || lpad(g::text, 2, '0') || '.csv', 100, 'e2e/historico-' || g,
            'REJEITADA', '{"lidas":1,"novas":0,"atualizadas":0,"rejeitadas":1}'::jsonb, $4,
            'e2e-f14-historico-' || g, now() - (17 - g) * interval '1 minute',
            now() - (17 - g) * interval '1 minute', now() - (17 - g) * interval '1 minute'
       from generate_series(1, 16) g`,
    [tenantId, empresa.limites, JSON.stringify(MAPEAMENTO_DO_MODELO), ids.dp],
  );

  await abrirAbaDeEmpregados(dp, empresa.limites);
  const historico = dp.getByRole('region', { name: 'Histórico de importações' });
  const linhas = historico.getByRole('table').getByRole('row');

  await expect(linhas).toHaveCount(16); // cabeçalho + 15
  await expect(linhas.nth(1)).toContainText('historico-16.csv');
  await expect(linhas.nth(15)).toContainText('historico-02.csv');
  await expect(historico.getByRole('navigation', { name: 'Paginação do histórico de importações' })).toContainText(
    /Página 1 de 2 · 16 importações/u,
  );

  await historico.getByRole('button', { name: 'Próxima' }).click();
  await expect(dp).toHaveURL(/historico=2/u);
  await expect(linhas).toHaveCount(2);
  await expect(linhas.nth(1)).toContainText('historico-01.csv');
});

test('modelo do ContaIA: baixado pela tela, importado de volta com o mapeamento padrão e confirmado', async () => {
  await abrirAbaDeEmpregados(dp, empresa.limites);
  const modelo = await baixarPeloBotao(dp, 'Baixar modelo CSV');

  expect(modelo.nome).toBe('modelo-empregados.csv');
  expect([...modelo.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(modelo.bytes.subarray(3).toString('utf8').split('\r\n')[0]).toBe(
    'cpf;nome;matricula;data_nascimento;data_admissao',
  );

  // O mesmo arquivo, de volta pela tela: as cinco colunas vêm escolhidas e as linhas de exemplo valem.
  await dp.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles({ name: modelo.nome, mimeType: 'text/csv', buffer: modelo.bytes });
  await expect(dp.getByRole('combobox', { name: /^Data de admissão/u })).toContainText('data_admissao');
  const enviado = await validarEmpregadosPelaTela(dp);
  await expect(dp.getByText(/Todas as 2 linhas lidas são válidas/u)).toBeVisible({ timeout: 60_000 });
  await confirmarPelaTela(dp);
  await expect(dp.getByRole('heading', { name: 'Importação concluída', exact: true })).toBeVisible({ timeout: 30_000 });
  expect((await tentativaDeEmpregados(pool, enviado.tentativaId))?.estado).toBe('CONCLUIDA');
  expect([...(await empregadosDa(pool, empresa.limites)).keys()]).toEqual(['11144477735|00124', '52998224725|00123']);

  await provar(dp, 'concluida-sem-rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'Importação concluída', exact: true }),
  });
});

// -- Jornada principal (Alfa), pelo papel personalizado de DP ------------------------------------

test('jornada: CSV legado (Latin-1, `;`) → mapeamento → validação parcial → prévia sem mudar a base', async () => {
  const antes = await empregadosDa(pool, empresa.alfa);
  const envios: string[] = [];
  dp.on('request', (pedido) => {
    if (pedido.method() === 'POST' && pedido.url().endsWith('/empregados/importacoes')) {
      envios.push(pedido.url());
    }
  });

  await abrirAbaDeEmpregados(dp, empresa.alfa);
  await dp.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-legado.csv'));

  // O cabeçalho do ERP foi lido em Latin-1 com `;`: "CPF" bate com o modelo e vem escolhido; o
  // resto é decisão de quem importa.
  await expect(dp.getByText('Associe as colunas do arquivo')).toBeVisible();
  await expect(dp.getByText('6 colunas separadas por ponto e vírgula')).toBeVisible();
  await expect(dp.getByRole('columnheader', { name: /Nome Funcionário/u })).toBeVisible();
  await expect(dp.getByRole('combobox', { name: /^CPF/u })).toContainText('CPF');
  await expect(dp.getByRole('combobox', { name: /^Matrícula/u })).toContainText('Escolha a coluna');

  // Mapeamento incompleto não envia nada: diz o que falta.
  await dp.getByRole('button', { name: 'Validar arquivo' }).click();
  const pendente = dp.getByRole('alert').filter({ hasText: 'O mapeamento ainda não pode ser validado' });
  await expect(pendente).toContainText('Nome completo');
  await expect(pendente).toContainText('Data de admissão');
  expect(envios).toEqual([]);
  await provar(dp, 'mapeamento-incompleto', {
    recarregar: false,
    pronto: (page) => page.getByRole('alert').filter({ hasText: 'O mapeamento ainda não pode ser validado' }),
  });

  await mapearOLegado(dp);
  await provar(dp, 'arquivo-selecionado', {
    recarregar: false,
    pronto: (page) => page.getByText('Associe as colunas do arquivo'),
  });

  principal = await validarEmpregadosPelaTela(dp);
  expect(principal.correlationId).toMatch(/^[A-Za-z0-9-]{8,64}$/u);

  await expect(dp.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 60_000 });
  await expect(dp.getByText('Aguardando confirmação').first()).toBeVisible();
  await expect(totalNaTela(dp, 'Linhas lidas')).toHaveText('12');
  await expect(totalNaTela(dp, 'Novas')).toHaveText('3');
  await expect(totalNaTela(dp, 'Atualizadas')).toHaveText('1');
  await expect(totalNaTela(dp, 'Rejeitadas')).toHaveText('8');

  // Linha física, CPF e matrícula como vieram, campo e código estável de cada rejeição (§3.4).
  const pagina = await pelaApi(dp, `/empresas/${empresa.alfa}/empregados/importacoes/${principal.tentativaId}/rejeicoes`);
  const itens = campoDe(pagina.corpo, 'itens') as Array<{
    numeroDaLinha: number;
    cpf: string | null;
    matricula: string | null;
    campo: string | null;
    codigoDeErro: string;
  }>;
  expect(itens.map((item) => [item.numeroDaLinha, item.cpf, item.matricula, item.campo, item.codigoDeErro])).toEqual([
    [6, '123.456.789-00', '00610', 'cpf', 'CPF_INVALIDO'],
    [7, '146.146.146-47', '00700', 'data_nascimento', 'DATA_NASCIMENTO_INVALIDA'],
    [8, '147.147.147-08', '00800', 'data_admissao', 'DATA_ADMISSAO_INVALIDA'],
    [9, '148.148.148-79', '00900', 'data_admissao', 'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO'],
    // A mesma chave CPF + matrícula duas vezes (com e sem máscara): as duas são rejeitadas.
    [10, '145.145.145-86', '00600', 'matricula', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
    [11, '14514514586', '00600', 'matricula', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
    [12, '142.142.142-93', '00300', 'matricula', 'EMPREGADO_ARQUIVADO'],
    [13, '149.149.149-30', '01000', 'nome', 'CAMPO_OBRIGATORIO_AUSENTE'],
  ]);

  const rejeicoes = dp.getByRole('table', { name: /Linhas rejeitadas de empregados-legado\.csv/u });
  const linhaFisica = (numero: string) =>
    rejeicoes.getByRole('row').filter({ has: dp.getByRole('rowheader', { name: numero, exact: true }) });
  await expect(linhaFisica('12')).toContainText('142.142.142-93');
  await expect(linhaFisica('12')).toContainText('00300');
  await expect(linhaFisica('12')).toContainText('EMPREGADO_ARQUIVADO');
  // A linha orienta a reativação no cadastro de empregados do MVP-3 (SPEC §3.6, §7).
  await expect(linhaFisica('12')).toContainText('a reativação é feita no cadastro de empregados (MVP-3)');
  // CPF sem máscara no arquivo aparece mascarado; matrícula com zeros à esquerda, como veio.
  await expect(linhaFisica('11')).toContainText('145.145.145-86');
  for (const codigo of [
    'CPF_INVALIDO',
    'DATA_NASCIMENTO_INVALIDA',
    'DATA_ADMISSAO_INVALIDA',
    'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
    'CHAVE_DUPLICADA_NO_ARQUIVO',
    'CAMPO_OBRIGATORIO_AUSENTE',
  ]) {
    await expect(rejeicoes.getByText(codigo, { exact: true }).first()).toBeVisible();
  }

  // Nenhum empregado muda antes da confirmação humana.
  expect(await empregadosDa(pool, empresa.alfa)).toEqual(antes);

  await provar(dp, 'previa-parcial', {
    recarregar: true,
    pronto: (page) => page.getByRole('button', { name: 'Confirmar importação' }),
  });
  await provar(dp, 'rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByRole('table', { name: /Linhas rejeitadas/u }),
    recorte: (page) => page.locator('section[aria-labelledby^="rejeicoes-"]'),
  });
});

test('confirmação: inclui os novos, atualiza pela chave CPF + matrícula, não toca o ausente nem o arquivado', async () => {
  const antes = await empregadosDa(pool, empresa.alfa);

  await dp.getByRole('button', { name: 'Confirmar importação' }).click();
  const dialogo = dp.getByRole('alertdialog');
  await expect(dialogo).toContainText('Confirmar a importação de empregados-legado.csv em Alfa Empregados E2E?');
  await expect(dialogo).toContainText('3 empregados novos serão incluídos e 1 existente será atualizado');
  await provar(dp, 'confirmacao', { recarregar: false, pronto: (page) => page.getByRole('alertdialog') });
  // Esc fecha sem confirmar e o foco volta ao acionador.
  await dp.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
  await expect(dp.getByRole('button', { name: 'Confirmar importação' })).toBeFocused();
  expect(await empregadosDa(pool, empresa.alfa)).toEqual(antes);

  await confirmarPelaTela(dp);
  await expect(dp.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible({ timeout: 30_000 });

  const depois = await empregadosDa(pool, empresa.alfa);
  expect([...depois.keys()]).toEqual([
    `${CPF.ana}|00100`,
    `${CPF.bruno}|00200`,
    `${CPF.carla}|00300`,
    `${CPF.debora}|00400`,
    `${CPF.debora}|400`,
    `${CPF.joao}|00500`,
  ]);
  // Existente ativo: só nome, nascimento e admissão mudam.
  expect(depois.get(`${CPF.ana}|00100`)).toMatchObject({ nome: 'Ana Atualizada da Silva', arquivado: false });
  // Novos entram ativos; o mesmo CPF com outra matrícula é outro empregado (00400 ≠ 400).
  expect(depois.get(`${CPF.debora}|00400`)).toMatchObject({
    nome: 'Débora Conceição',
    data_nascimento: '1988-07-22',
    data_admissao: '2016-03-01',
    arquivado: false,
  });
  expect(depois.get(`${CPF.debora}|400`)).toMatchObject({ data_admissao: '2020-08-01', arquivado: false });
  // Ausente do CSV: inalterado, nem a versão sobe. Arquivado: nem atualizado nem reativado.
  expect(depois.get(`${CPF.bruno}|00200`)).toEqual(antes.get(`${CPF.bruno}|00200`));
  expect(depois.get(`${CPF.carla}|00300`)).toEqual(antes.get(`${CPF.carla}|00300`));

  // O correlationId do envio está na tentativa, na fila e na trilha.
  expect(await tentativaDeEmpregados(pool, principal.tentativaId)).toMatchObject({
    estado: 'CONCLUIDA_COM_REJEICOES',
    correlation_id: principal.correlationId,
    totais: { lidas: 12, novas: 3, atualizadas: 1, rejeitadas: 8 },
    usuario_iniciador_id: ids.dp,
    usuario_confirmador_id: ids.dp,
  });
  expect(dadosDoJob(principal.tentativaId, FILA)).toEqual({
    tenantId,
    empresaId: empresa.alfa,
    tentativaId: principal.tentativaId,
    correlationId: principal.correlationId,
  });
  const eventos = await eventosDaTentativa(pool, principal.tentativaId);
  expect(eventos.map((evento) => evento.acao)).toEqual([
    'CRIACAO',
    'INICIAR_VALIDACAO',
    'VALIDACAO_SUCESSO',
    'CONFIRMAR',
    'APLICACAO_SUCESSO_COM_REJEICOES',
  ]);
  expect(eventos.slice(0, 3).map((evento) => evento.correlation_id)).toEqual(Array(3).fill(principal.correlationId));

  // A base da tela já mostra o resultado, só em consulta: sem editar, arquivar ou reativar.
  const base = dp.getByRole('region', { name: 'Empregados importados' });
  await expect(base).toContainText('Ana Atualizada da Silva');
  await expect(base).toContainText('Débora Conceição');
  await expect(base).toContainText('140.140.140-61');
  await expect(base.getByRole('row').filter({ hasText: 'Carla Arquivada' })).toContainText('Arquivado');
  await expect(base.getByRole('button', { name: /editar|arquivar|reativar|excluir/iu })).toHaveCount(0);
  await expect(base.getByRole('link', { name: /editar|arquivar|reativar|excluir/iu })).toHaveCount(0);

  await provar(dp, 'concluida-com-rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'Importação concluída com rejeições' }),
  });
});

test('relatório CSV: BOM, `;`, linha física, CPF, matrícula, código e campo; o original continua o mesmo arquivo', async () => {
  await abrirAbaDeEmpregados(dp, empresa.alfa, `&tentativa=${principal.tentativaId}`);
  await expect(dp.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible();

  const relatorio = await baixarPeloBotao(dp, 'Baixar relatório CSV');

  expect(relatorio.nome).toBe('relatorio-empregados-legado.csv');
  expect([...relatorio.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const linhas = relatorio.bytes.subarray(3).toString('utf8').split('\r\n');

  expect(linhas[0]).toBe('linha;cpf;nome;matricula;data_nascimento;data_admissao;status;acao;codigo_de_erro;campo;mensagem');
  expect(linhas).toContain('2;140.140.140-61;Ana Atualizada da Silva;00100;1990-03-15;2015-02-01;VALIDA;ATUALIZAR;;;');
  expect(linhas).toContain('3;14314314354;Débora Conceição;00400;1988-07-22;2016-03-01;VALIDA;INCLUIR;;;');
  expect(linhas).toContain('5;143.143.143-54;Débora Conceição;400;1988-07-22;2020-08-01;VALIDA;INCLUIR;;;');
  const comecaCom = (prefixo: string): void => {
    expect(linhas.filter((linha) => linha.startsWith(prefixo)), prefixo).toHaveLength(1);
  };
  comecaCom('6;123.456.789-00;Pedro Inválido;00610;1980-01-01;2005-01-01;REJEITADA;;CPF_INVALIDO;cpf;');
  // A data impossível e a ambígua saem como vieram: nunca são interpretadas.
  comecaCom('7;146.146.146-47;Gabriela Fevereiro;00700;31/02/1990;2015-02-01;REJEITADA;;DATA_NASCIMENTO_INVALIDA;data_nascimento;');
  comecaCom('8;147.147.147-08;Hugo Ambíguo;00800;1985-12-12;1/2/20;REJEITADA;;DATA_ADMISSAO_INVALIDA;data_admissao;');
  comecaCom('9;148.148.148-79;Íris Invertida;00900;2001-05-10;2001-05-10;REJEITADA;;ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO;data_admissao;');
  comecaCom('10;145.145.145-86;Fábio Repetido;00600;');
  comecaCom('11;14514514586;Fábio Repetido Outra Vez;00600;');
  comecaCom('12;142.142.142-93;Carla Reativada;00300;1979-09-20;2000-01-02;REJEITADA;;EMPREGADO_ARQUIVADO;matricula;');
  expect(linhas.find((linha) => linha.startsWith('12;'))).toContain('a reativação é feita no cadastro de empregados (MVP-3)');
  comecaCom('13;149.149.149-30;;01000;1990-01-01;2012-01-01;REJEITADA;;CAMPO_OBRIGATORIO_AUSENTE;nome;');
  expect(linhas.filter((linha) => linha.includes('CHAVE_DUPLICADA_NO_ARQUIVO'))).toHaveLength(2);
  expect(linhas.filter((linha) => linha !== '')).toHaveLength(13);

  const original = await baixarPeloBotao(dp, 'Baixar arquivo enviado');
  expect(original.bytes.equals(bytesDe('empregados-legado.csv'))).toBe(true);
});

test('histórico da Alfa: a tentativa aparece com situação, totais, quem enviou e o correlationId', async () => {
  await abrirAbaDeEmpregados(dp, empresa.alfa);
  const historico = dp.getByRole('region', { name: 'Histórico de importações' });
  const linha = historico.getByRole('row').filter({ hasText: 'empregados-legado.csv' });

  await expect(linha).toHaveCount(1);
  await expect(linha).toContainText('Concluída com rejeições');
  await expect(linha).toContainText(DP.nome);
  // Colunas de dados: enviada em (0), situação (1), novas (2), atualizadas (3), rejeitadas (4).
  await expect(linha.getByRole('cell').nth(2)).toHaveText('3');
  await expect(linha.getByRole('cell').nth(3)).toHaveText('1');
  await expect(linha.getByRole('cell').nth(4)).toHaveText('8');

  const historicoDaApi = await pelaApi(dp, `/empresas/${empresa.alfa}/empregados/importacoes`);
  const itens = campoDe(historicoDaApi.corpo, 'itens') as Array<{ id: string; correlationId: string }>;
  expect(itens.find((item) => item.id === principal.tentativaId)?.correlationId).toBe(principal.correlationId);

  await provar(dp, 'historico', {
    recarregar: true,
    pronto: (page) => page.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').nth(1),
    recorte: (page) => page.getByRole('region', { name: 'Histórico de importações' }),
  });
});

test('reenvio idêntico reaproveita o resultado sem duplicar; o mesmo arquivo com outro mapeamento é nova tentativa', async () => {
  const baseAntes = await empregadosDa(pool, empresa.alfa);
  const tentativasAntes = await tentativasDeEmpregadosDa(pool, empresa.alfa);
  const avisosAntes = [await avisosDeEmpregadosDo(pool, ids.dp), await avisosDeEmpregadosDo(pool, ids.admin)];

  await abrirAbaDeEmpregados(dp, empresa.alfa);
  await dp.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-legado.csv'));
  await mapearOLegado(dp);
  const reenvio = await validarEmpregadosPelaTela(dp);

  expect(reenvio.tentativaId).toBe(principal.tentativaId);
  await expect(dp.getByText(/já tinha sido processado: o resultado foi reaproveitado/u)).toBeVisible();
  await expect(
    dp.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').filter({ hasText: 'empregados-legado.csv' }),
  ).toContainText('Resultado reaproveitado');

  expect(await empregadosDa(pool, empresa.alfa)).toEqual(baseAntes);
  expect((await tentativasDeEmpregadosDa(pool, empresa.alfa)).map((t) => t.id)).toEqual(tentativasAntes.map((t) => t.id));
  expect([await avisosDeEmpregadosDo(pool, ids.dp), await avisosDeEmpregadosDo(pool, ids.admin)]).toEqual(avisosAntes);
  expect((await tentativaDeEmpregados(pool, principal.tentativaId))?.reutilizada_por_idempotencia).toBe(true);
  expect((await eventosDaTentativa(pool, principal.tentativaId)).at(-1)?.acao).toBe('REUTILIZACAO');

  // Mesmos bytes, outro mapeamento (o nome vem de "Centro Custo"): é outra tentativa sobre o mesmo
  // original, validada do zero. Fica cancelada para não restar prévia aberta.
  const outroMapeamento = await enviarEmpregadosPelaApi(
    dp,
    empresa.alfa,
    { nome: 'empregados-legado.csv', conteudo: bytesDe('empregados-legado.csv') },
    { ...MAPEAMENTO_DO_LEGADO, nome: 'Centro Custo' },
  );
  expect(outroMapeamento.status).toBe(202);
  const idDoOutro = String(campoDe(outroMapeamento.corpo, 'tentativaId'));
  expect(idDoOutro).not.toBe(principal.tentativaId);
  await esperarEstadoDosEmpregados(pool, idDoOutro, 'AGUARDANDO_CONFIRMACAO');
  expect((await tentativaDeEmpregados(pool, idDoOutro))?.arquivo_chave).toBe(
    (await tentativaDeEmpregados(pool, principal.tentativaId))?.arquivo_chave,
  );
  const cancelado = await pelaApi(dp, `/empresas/${empresa.alfa}/empregados/importacoes/${idDoOutro}/cancelar`, { metodo: 'POST' });
  expect(campoDe(cancelado.corpo, 'estado')).toBe('CANCELADA');
  expect(await empregadosDa(pool, empresa.alfa)).toEqual(baseAntes);
});

test('notificação: o iniciador e a administradora com a empresa na carteira; contador, auditora e administrador sem carteira não recebem', async () => {
  expect(ordenados(await destinatariosDosEmpregados(pool, principal.tentativaId))).toEqual(ordenados([ids.dp, ids.admin]));
  for (const usuario of [ids.contador, ids.auditor, ids.adminSemCarteira]) {
    expect(await avisosDeEmpregadosDo(pool, usuario)).toBe(0);
  }

  await dp.goto('/empresas');
  await dp.getByRole('button', { name: 'Notificações' }).click();
  const painel = dp.getByRole('dialog', { name: 'Painel de notificações' });
  const aviso = painel.getByText('Importação de empregados concluída com rejeições');

  await expect(aviso).toBeVisible();
  await aviso.click();
  await expect(dp).toHaveURL(new RegExp(`/empresas/${empresa.alfa}\\?aba=empregados&tentativa=${principal.tentativaId}`, 'u'));

  // O contador consulta a mesma empresa, mas não é destinatário: nada no banco e nada no sino dele.
  expect(await avisosDeEmpregadosDo(pool, ids.contador)).toBe(0);
  await contador.goto('/empresas');
  await contador.getByRole('button', { name: 'Notificações' }).click();
  const painelDoContador = contador.getByRole('dialog', { name: 'Painel de notificações' });
  await expect(
    painelDoContador.getByRole('heading', { name: 'Sem notificações' }).or(painelDoContador.getByRole('listitem').first()),
  ).toBeVisible({ timeout: 20_000 });
  await expect(painelDoContador.getByText(/Importação de empregados/u)).toHaveCount(0);
  await contador.keyboard.press('Escape');
});

// -- Papéis, cancelamento e escopo (Beta) --------------------------------------------------------

test('contador e auditora consultam e baixam, mas não importam nem confirmam; auxiliar não acessa: a tela esconde e a API nega', async () => {
  const envio = await enviarEmpregadosPelaApi(dp, empresa.beta, { nome: 'empregados-bom.csv', conteudo: bytesDe('empregados-bom.csv') });
  expect(envio.status).toBe(202);
  previaDaBeta = String(campoDe(envio.corpo, 'tentativaId'));
  await esperarEstadoDosEmpregados(pool, previaDaBeta, 'AGUARDANDO_CONFIRMACAO');

  await abrirAbaDeEmpregados(contador, empresa.beta);
  const semImportar = 'Seu papel pode consultar os empregados, mas não tem permissão para importar.';
  await expect(contador.getByText(semImportar)).toBeVisible();
  await expect(contador.getByLabel(ROTULO_DO_ARQUIVO)).toHaveCount(0);
  await provar(contador, 'permissao-insuficiente', { recarregar: true, pronto: (page) => page.getByText(semImportar) });

  await contador.getByRole('button', { name: 'Abrir importação' }).click();
  await expect(contador.getByText(/Todas as 3 linhas lidas são válidas/u)).toBeVisible();
  await expect(contador.getByRole('button', { name: 'Confirmar importação' })).toHaveCount(0);
  await expect(contador.getByRole('button', { name: 'Cancelar importação' })).toHaveCount(0);
  await expect(contador.getByText(/feito por quem tem a permissão Confirmar importação/u)).toBeVisible();
  expect((await baixarPeloBotao(contador, 'Baixar relatório CSV')).bytes.toString('utf8')).toContain('Karina Modelo');

  const base = `/empresas/${empresa.beta}/empregados`;
  for (const [quem, page] of [
    ['contador', contador],
    ['auditora', auditor],
  ] as const) {
    const negado = await enviarEmpregadosPelaApi(page, empresa.beta, { nome: 'x.csv', conteudo: bytesDe('empregados-bom.csv') });
    expect([negado.status, codigoDo(negado)], `${quem} importa`).toEqual([403, 'SEM_AUTORIZACAO']);
    for (const acao of ['confirmar', 'cancelar']) {
      const negada = await pelaApi(page, `${base}/importacoes/${previaDaBeta}/${acao}`, {
        metodo: 'POST',
        corpo: acao === 'confirmar' ? { versaoDaPrevia: 0 } : {},
      });
      expect(negada.status, `${quem} ${acao}`).toBe(403);
    }
    for (const consulta of ['', '/importacoes', `/importacoes/${previaDaBeta}`, `/importacoes/${previaDaBeta}/rejeicoes`, '/modelo', `/importacoes/${previaDaBeta}/relatorio`]) {
      expect((await pelaApi(page, `${base}${consulta}`)).status, `${quem} consulta ${consulta}`).toBe(200);
    }
  }

  // Auxiliar (papel padrão sem nenhuma ação de Empregados): nada na API e a aba nem aparece.
  for (const consulta of ['', '/importacoes', `/importacoes/${previaDaBeta}`, '/modelo']) {
    const negada = await pelaApi(auxiliar, `/empresas/${empresa.alfa}/empregados${consulta}`);
    expect([negada.status, codigoDo(negada)], `auxiliar ${consulta}`).toEqual([403, 'SEM_AUTORIZACAO']);
    expect(negada.texto).not.toContain('Ana Atualizada');
  }
  await auxiliar.goto(`/empresas/${empresa.alfa}`);
  await expect(auxiliar.getByRole('tablist', { name: 'Seções da empresa' })).toBeVisible({ timeout: 30_000 });
  await expect(auxiliar.getByRole('tab', { name: 'Empregados' })).toHaveCount(0);

  expect((await tentativaDeEmpregados(pool, previaDaBeta))?.estado).toBe('AGUARDANDO_CONFIRMACAO');
});

test('cancelar preserva tentativa, arquivo, relatório e trilha, sem alterar a base', async () => {
  const antes = await empregadosDa(pool, empresa.beta);

  await abrirAbaDeEmpregados(dp, empresa.beta, `&tentativa=${previaDaBeta}`);
  await dp.getByRole('button', { name: 'Cancelar importação' }).click();
  await dp.getByRole('alertdialog').getByRole('button', { name: 'Cancelar importação' }).click();
  await expect(dp.getByRole('heading', { name: 'Importação cancelada' })).toBeVisible();
  await provar(dp, 'cancelada', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'Importação cancelada' }),
  });

  expect(await empregadosDa(pool, empresa.beta)).toEqual(antes);
  expect(await tentativaDeEmpregados(pool, previaDaBeta)).toMatchObject({ estado: 'CANCELADA', usuario_cancelador_id: ids.dp });
  expect((await eventosDaTentativa(pool, previaDaBeta)).at(-1)?.acao).toBe('CANCELAR');

  expect((await baixarPeloBotao(dp, 'Baixar relatório CSV')).bytes.toString('utf8')).toContain('Lucas Modelo');
  expect((await baixarPeloBotao(dp, 'Baixar arquivo enviado')).bytes.equals(bytesDe('empregados-bom.csv'))).toBe(true);

  // Terminal não volta: cancelar de novo é recusado.
  const deNovo = await pelaApi(dp, `/empresas/${empresa.beta}/empregados/importacoes/${previaDaBeta}/cancelar`, { metodo: 'POST' });
  expect([deNovo.status, codigoDo(deNovo)]).toEqual([409, 'ESTADO_INVALIDO_PARA_ACAO']);
});

test('confirmação repetida, em sequência e em paralelo: uma aplica, a outra 409 ESTADO_INVALIDO_PARA_ACAO, sem empregado nem aviso duplicado', async () => {
  const confirmar = (id: string, versaoDaPrevia: unknown) =>
    pelaApi(dp, `/empresas/${empresa.beta}/empregados/importacoes/${id}/confirmar`, { metodo: 'POST', corpo: { versaoDaPrevia } });
  const aguardarPrevia = async (nome: string, conteudo: Buffer): Promise<{ id: string; versao: unknown }> => {
    const envio = await enviarEmpregadosPelaApi(dp, empresa.beta, { nome, conteudo });
    expect(envio.status, envio.texto.slice(0, 300)).toBe(202);
    const id = String(campoDe(envio.corpo, 'tentativaId'));

    await esperarEstadoDosEmpregados(pool, id, 'AGUARDANDO_CONFIRMACAO');

    return { id, versao: campoDe(await previaDaApi(dp, empresa.beta, id), 'versaoDaPrevia') };
  };
  const aplicacoes = async (id: string): Promise<number> =>
    (await eventosDaTentativa(pool, id)).filter((evento) => evento.acao.startsWith('APLICACAO_')).length;

  // Em sequência: a segunda chega com a tentativa já concluída.
  const primeira = await aguardarPrevia('empregados-bom.csv', bytesDe('empregados-bom.csv'));
  const aplicada = await confirmar(primeira.id, primeira.versao);
  expect([aplicada.status, campoDe(aplicada.corpo, 'estado')]).toEqual([200, 'CONCLUIDA']);
  const repetida = await confirmar(primeira.id, primeira.versao);
  expect([repetida.status, codigoDo(repetida)]).toEqual([409, 'ESTADO_INVALIDO_PARA_ACAO']);
  expect((await empregadosDa(pool, empresa.beta)).size).toBe(3);
  expect(await aplicacoes(primeira.id)).toBe(1);
  expect(ordenados(await destinatariosDosEmpregados(pool, primeira.id))).toEqual(ordenados([ids.dp, ids.admin]));

  // Em paralelo: as duas disputam a mesma prévia; só uma aplica.
  const segunda = await aguardarPrevia(basename(arquivos.variante), readFileSync(arquivos.variante));
  const respostas = await Promise.all([confirmar(segunda.id, segunda.versao), confirmar(segunda.id, segunda.versao)]);
  expect(respostas.map((resposta) => resposta.status).sort()).toEqual([200, 409]);
  expect(respostas.find((resposta) => resposta.status === 409)?.corpo).toMatchObject({ code: 'ESTADO_INVALIDO_PARA_ACAO' });
  expect((await tentativaDeEmpregados(pool, segunda.id))?.estado).toBe('CONCLUIDA');
  const base = await empregadosDa(pool, empresa.beta);
  expect(base.size).toBe(4);
  expect(new Set([...base.keys()]).size).toBe(4);
  expect(await aplicacoes(segunda.id)).toBe(1);
  expect(ordenados(await destinatariosDosEmpregados(pool, segunda.id))).toEqual(ordenados([ids.dp, ids.admin]));
});

test('fora da carteira: 403 EMPRESA_FORA_DA_CARTEIRA; outro escritório: 404; tentativa de outra empresa: 404; nenhum dado revelado', async () => {
  const base = `/empresas/${empresa.alfa}/empregados`;
  const rotas = ['', '/importacoes', `/importacoes/${principal.tentativaId}`, `/importacoes/${principal.tentativaId}/relatorio`, `/importacoes/${principal.tentativaId}/arquivo`];

  for (const rota of rotas) {
    const fora = await pelaApi(deFora, `${base}${rota}`);
    expect([fora.status, codigoDo(fora)], `fora da carteira ${rota}`).toEqual([403, 'EMPRESA_FORA_DA_CARTEIRA']);
    expect(fora.texto).not.toContain('Ana Atualizada');

    const outro = await pelaApi(outroAdmin, `${base}${rota}`);
    expect([outro.status, codigoDo(outro)], `outro escritório ${rota}`).toEqual([404, 'EMPRESA_NAO_ENCONTRADA']);
    expect(outro.texto).not.toContain('Ana Atualizada');
  }
  // A contadora não tem `importar`: a permissão é negada antes mesmo da carteira, sem tentativa.
  const tentativasDaAlfa = (await tentativasDeEmpregadosDa(pool, empresa.alfa)).map((t) => t.id);
  const envio = await enviarEmpregadosPelaApi(deFora, empresa.alfa, { nome: 'fora.csv', conteudo: bytesDe('empregados-bom.csv') });
  expect([envio.status, codigoDo(envio)]).toEqual([403, 'SEM_AUTORIZACAO']);
  expect((await tentativasDeEmpregadosDa(pool, empresa.alfa)).map((t) => t.id)).toEqual(tentativasDaAlfa);

  // A tentativa da Alfa pedida pela rota da Beta (empresa a que o DP tem acesso): não existe ali.
  const cruzada = await pelaApi(dp, `/empresas/${empresa.beta}/empregados/importacoes/${principal.tentativaId}`);
  expect([cruzada.status, codigoDo(cruzada)]).toEqual([404, 'TENTATIVA_NAO_ENCONTRADA']);

  await deFora.goto(`/empresas/${empresa.alfa}?aba=empregados`);
  await expect(deFora.getByText(/não está na sua carteira/u).first()).toBeVisible({ timeout: 20_000 });
  await expect(deFora.getByText('Ana Atualizada da Silva')).toHaveCount(0);
  await provar(deFora, 'fora-da-carteira', {
    recarregar: true,
    pronto: (page) => page.getByText(/não está na sua carteira/u),
  });
});

// -- Conflito concorrente (Gama) -----------------------------------------------------------------

test('conflito concorrente: a base muda entre a prévia e a confirmação → 409, painel e nova validação', async () => {
  await abrirAbaDeEmpregados(admin, empresa.gama);
  await admin.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-bom.csv'));
  // Cabeçalho do modelo: os cinco campos vêm escolhidos.
  await expect(admin.getByRole('combobox', { name: /^Data de admissão/u })).toContainText('data_admissao');
  const a = await validarEmpregadosPelaTela(admin);
  await expect(admin.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 60_000 });

  // Outra importação da mesma empresa é validada e confirmada pela API enquanto a prévia A está na tela.
  await importarPelaApi(admin, empresa.gama, basename(arquivos.variante), readFileSync(arquivos.variante));
  const baseDeB = await empregadosDa(pool, empresa.gama);
  expect(baseDeB.size).toBe(4);

  const [conflito] = await Promise.all([
    admin.waitForResponse((r) => r.url().endsWith(`/importacoes/${a.tentativaId}/confirmar`)),
    confirmarPelaTela(admin),
  ]);
  expect(conflito.status()).toBe(409);
  expect(((await conflito.json()) as { code: string }).code).toBe('CONFLITO_DE_VERSAO');
  const painel = admin.getByRole('alert').filter({ hasText: 'A base de empregados mudou depois desta validação' });
  await expect(painel).toContainText('Nenhum empregado foi alterado.');
  expect(await empregadosDa(pool, empresa.gama)).toEqual(baseDeB);
  expect((await tentativaDeEmpregados(pool, a.tentativaId))?.estado).toBe('AGUARDANDO_CONFIRMACAO');

  await provar(admin, 'conflito-409', {
    recarregar: true,
    preparar: async (page) => {
      await expect(page.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 30_000 });
      await confirmarPelaTela(page);
    },
    pronto: (page) => page.getByText('A base de empregados mudou depois desta validação'),
  });

  // "Cancelar e validar novamente": cancela A e volta ao envio; o mesmo arquivo vira nova tentativa.
  await admin.getByRole('button', { name: 'Cancelar e validar novamente' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Cancelar prévia' }).click();
  await expect(admin.getByText('Arraste o CSV dos empregados aqui')).toBeVisible();
  expect((await tentativaDeEmpregados(pool, a.tentativaId))?.estado).toBe('CANCELADA');

  await admin.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-bom.csv'));
  const nova = await validarEmpregadosPelaTela(admin);
  expect(nova.tentativaId).not.toBe(a.tentativaId);
  await expect(admin.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 60_000 });
  await expect(totalNaTela(admin, 'Atualizadas')).toHaveText('3');
  await confirmarPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
  expect((await empregadosDa(pool, empresa.gama)).size).toBe(4);
});

// -- Falha do worker (Delta) ---------------------------------------------------------------------

/**
 * Mesma indução da SPEC-013: a fila de validação dos EMPREGADOS é pausada (o job espera sem
 * consumidor) e a chave do original desta tentativa passa a apontar para um objeto que o MinIO
 * recusa servir (nome acima de 1.024 bytes). Retomada a fila, o worker lê, o armazenamento recusa
 * com erro transitório e o BullMQ repete com backoff até o teto (5 tentativas): FALHA. A fila do
 * plano de contas, o Signer e os contêineres seguem de pé.
 */
test('falha do worker: sem consumidor a tentativa espera; o armazenamento recusa até esgotar o retry → FALHA acionável com correlationId; o reenvio cria nova tentativa', async () => {
  test.setTimeout(420_000);

  await pausarAValidacao(FILA);
  await abrirAbaDeEmpregados(dp, empresa.delta);
  await dp.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-bom.csv'));
  const enviado = await validarEmpregadosPelaTela(dp);

  await expect(dp.getByText('Validando o arquivo inteiro')).toBeVisible();
  expect((await tentativaDeEmpregados(pool, enviado.tentativaId))?.estado).toBe('RECEBIDA');
  expect(dadosDoJob(enviado.tentativaId, FILA)).toEqual({
    tenantId,
    empresaId: empresa.delta,
    tentativaId: enviado.tentativaId,
    correlationId: enviado.correlationId,
  });
  await provar(dp, 'validando', { recarregar: true, pronto: (page) => page.getByText('Validando o arquivo inteiro') });

  const chaveOriginal = (await tentativaDeEmpregados(pool, enviado.tentativaId))?.arquivo_chave ?? '';
  expect(chaveOriginal).toMatch(new RegExp(`^${tenantId}/${empresa.delta}/empregados/[0-9a-f]{64}\\.csv$`, 'u'));
  const chaveRecusada = `${chaveOriginal}/${'x'.repeat(1_100)}`;

  expect(await erroAoLerNoArmazenamento(chaveOriginal), 'o original da tentativa está no MinIO').toBeNull();
  const erroDaChaveRecusada = await erroAoLerNoArmazenamento(chaveRecusada);
  expect(
    erroDaChaveRecusada !== null && !['NoSuchKey', 'NotFound'].includes(erroDaChaveRecusada),
    `indução inválida neste MinIO: a chave acima de 1.024 bytes deu "${erroDaChaveRecusada ?? 'leitura com sucesso'}"`,
  ).toBe(true);

  await pool.query('update app.importacao_empregados set arquivo_chave = $2 where id = $1', [enviado.tentativaId, chaveRecusada]);
  await retomarAValidacao(FILA);
  await esperarEstadoDosEmpregados(pool, enviado.tentativaId, 'FALHA', 240_000);

  const falha = (await eventosDaTentativa(pool, enviado.tentativaId)).find((evento) => evento.acao === 'FALHA_TECNICA');
  expect(falha).toMatchObject({ codigo: 'ARMAZENAMENTO_INDISPONIVEL', correlation_id: enviado.correlationId });
  await expect
    .poll(() => jobsMortosDa(enviado.tentativaId, FILA), { timeout: 15_000, intervals: [500] })
    .toEqual([
      expect.objectContaining({
        tentativaId: enviado.tentativaId,
        correlationId: enviado.correlationId,
        motivo: 'ARMAZENAMENTO_INDISPONIVEL',
        tentativas: 5,
      }),
    ]);
  expect(ordenados(await destinatariosDosEmpregados(pool, enviado.tentativaId))).toEqual(ordenados([ids.dp, ids.admin]));
  expect(await empregadosDa(pool, empresa.delta)).toEqual(new Map());

  const diagnostico = campoDe(await previaDaApi(dp, empresa.delta, enviado.tentativaId), 'diagnostico') as {
    codigo: string;
    mensagem: string;
  } | null;
  expect(diagnostico?.codigo).toBe('ARMAZENAMENTO_INDISPONIVEL');

  await expect(dp.getByRole('heading', { name: 'A importação falhou por um problema técnico' })).toBeVisible({ timeout: 30_000 });
  await expect(dp.getByText(diagnostico?.mensagem ?? '—')).toBeVisible();
  await expect(dp.locator('code').filter({ hasText: enviado.correlationId })).toBeVisible();

  await provar(dp, 'falha-tecnica', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'A importação falhou por um problema técnico' }),
  });

  await dp.getByRole('button', { name: 'Enviar nova tentativa' }).click();
  await dp.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-bom.csv'));
  const nova = await validarEmpregadosPelaTela(dp);
  expect(nova.tentativaId).not.toBe(enviado.tentativaId);
  await expect(dp.getByRole('button', { name: 'Confirmar importação' })).toBeVisible({ timeout: 90_000 });

  const historico = dp.getByRole('region', { name: 'Histórico de importações' });
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

test('onboarding: depois do plano de contas, a etapa opcional "Empregados"; continuar sem importar deixa a pendência na Central', async () => {
  const criacao = await pelaApi(admin, '/empresas', { metodo: 'POST', corpo: { cnpj: CNPJ_DO_ONBOARDING } });
  expect(criacao.status, criacao.texto.slice(0, 300)).toBe(201);
  empresa.onboarding = String(campoDe(criacao.corpo, 'id'));

  await admin.goto(`/empresas/${empresa.onboarding}`);
  await expect(admin.getByRole('navigation', { name: 'Etapas do cadastro' })).toBeVisible({ timeout: 30_000 });
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

  // Primeiro a etapa do plano de contas (F13), que anuncia a de empregados como próxima.
  await expect(admin.getByRole('heading', { level: 2, name: 'Plano de contas' })).toBeVisible({ timeout: 30_000 });
  await expect(admin.getByText('Empregados (opcional)').first()).toBeVisible();
  await admin.getByRole('button', { name: 'Continuar sem importar' }).click();

  // A etapa de empregados aparece na mesma página, com o foco no título.
  const titulo = admin.getByRole('heading', { level: 2, name: 'Empregados' });
  await expect(titulo).toBeVisible({ timeout: 30_000 });
  await expect(titulo).toBeFocused();
  await expect(admin.getByText('Etapa opcional').first()).toBeVisible();
  await expect(admin.getByText(/a pendência Empregados não importados continua visível/u)).toBeVisible();
  await expect(admin.getByLabel(ROTULO_DO_ARQUIVO)).toBeVisible();
  expect(await pendenciaDosEmpregados(pool, empresa.onboarding)).toEqual(['ABERTA']);

  await provar(admin, 'onboarding-empregados', {
    recarregar: false,
    semToasts: true,
    pronto: (page) => page.getByText('Etapa opcional'),
  });

  await admin.getByRole('button', { name: 'Continuar sem importar' }).click();
  await admin.waitForURL(/\/empresas$/u);
  expect(
    (await pool.query<{ status: string }>('select status from app.empresa where id = $1', [empresa.onboarding])).rows[0]?.status,
  ).toBe('ATIVA');

  await admin.goto(`/pendencias?empresaId=${empresa.onboarding}`);
  await expect(admin.getByRole('row').filter({ hasText: 'Empregados não importados' }).first()).toBeVisible({ timeout: 20_000 });
});

test('zero linhas válidas: REJEITADA, a pendência persiste; o primeiro empregado confirmado a resolve', async () => {
  await admin.goto(`/pendencias?empresaId=${empresa.onboarding}`);
  await admin.getByRole('link', { name: /Abrir aba Empregados de/u }).first().click();
  await expect(admin).toHaveURL(new RegExp(`/empresas/${empresa.onboarding}\\?aba=empregados`, 'u'));
  await expect(admin.getByRole('heading', { level: 2, name: 'Empregados' })).toBeVisible();

  await admin.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-sem-linhas-validas.csv'));
  const rejeitada = await validarEmpregadosPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Nenhuma linha foi aplicada' })).toBeVisible({ timeout: 60_000 });
  expect((await tentativaDeEmpregados(pool, rejeitada.tentativaId))?.estado).toBe('REJEITADA');
  expect(await pendenciaDosEmpregados(pool, empresa.onboarding)).toEqual(['ABERTA']);
  expect(await empregadosDa(pool, empresa.onboarding)).toEqual(new Map());
  // A administradora iniciou e também tem a empresa na carteira: um aviso só.
  await expect.poll(() => destinatariosDosEmpregados(pool, rejeitada.tentativaId), { timeout: 15_000 }).toEqual([ids.admin]);
  await provar(admin, 'zero-validas', {
    recarregar: true,
    pronto: (page) => page.getByRole('heading', { name: 'Nenhuma linha foi aplicada' }),
  });

  await admin.getByRole('button', { name: 'Nova importação' }).click();
  await admin.getByLabel(ROTULO_DO_ARQUIVO).setInputFiles(caminhoDe('empregados-bom.csv'));
  await validarEmpregadosPelaTela(admin);
  await expect(admin.getByText(/Todas as 3 linhas lidas são válidas/u)).toBeVisible({ timeout: 60_000 });
  await provar(admin, 'previa-sem-rejeicoes', {
    recarregar: true,
    pronto: (page) => page.getByText(/Todas as 3 linhas lidas são válidas/u),
  });

  await confirmarPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
  expect(await pendenciaDosEmpregados(pool, empresa.onboarding)).toEqual(['RESOLVIDA']);

  await admin.goto(`/pendencias?empresaId=${empresa.onboarding}&estado=ABERTA`);
  await expect(admin.getByRole('row').filter({ hasText: 'Certificado ausente' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(admin.getByRole('row').filter({ hasText: 'Empregados não importados' })).toHaveCount(0);
});

// -- Segredo, dado pessoal, referência e acessibilidade ------------------------------------------

test('nenhum segredo nem caminho de storage nas respostas ao navegador; nenhum segredo, chave ou dado pessoal do CSV nos logs da API e dos workers', async () => {
  const chaves = (
    await pool.query<{ arquivo_chave: string }>(
      `select arquivo_chave from app.importacao_empregados where tenant_id = $1 and arquivo_chave not like 'e2e/%'`,
      [tenantId],
    )
  ).rows.map((linha) => linha.arquivo_chave);
  expect(chaves.length).toBeGreaterThan(0);

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

  // Os logs não guardam segredo, nem a chave do original, nem CPF ou nome do CSV (§11, PII).
  const dadosPessoais = ['Débora Conceição', 'Ana Atualizada da Silva', 'Fábio Repetido', CPF.debora, '143.143.143-54', '145.145.145-86', 'Karina Modelo'];
  for (const servico of ['api', 'workers']) {
    const logs = logsDe(servico);

    for (const termo of [...segredos, ...chaves, ...dadosPessoais]) {
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

test('referência do protótipo: o code.html de importação de legados é renderizado e capturado para a comparação', async ({ browser }) => {
  // `screen.png` desse diretório é um placeholder quebrado (28 bytes): a referência é o code.html.
  const referencia = resolve('docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/code.html');
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await contexto.newPage();

  try {
    await page.goto(pathToFileURL(referencia).href, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(PASTA_DAS_PROVAS, 'referencia-code-html-1440.png'), fullPage: true });
    await expect(page.locator('body')).toContainText(/Departamento Pessoal/u);
  } finally {
    await contexto.close();
  }
});

test('provas visuais: os estados-chave capturados, sem violação do axe (WCAG 2.1 A/AA) e sem rolagem horizontal', () => {
  expect(Object.keys(achados).sort()).toEqual(
    [
      'arquivo-rejeitado-antes-do-envio',
      'arquivo-selecionado',
      'base-vazia',
      'cancelada',
      'concluida-com-rejeicoes',
      'concluida-sem-rejeicoes',
      'confirmacao',
      'conflito-409',
      'falha-tecnica',
      'fora-da-carteira',
      'historico',
      'historico-vazio',
      'mapeamento-incompleto',
      'onboarding-empregados',
      'permissao-insuficiente',
      'previa-parcial',
      'previa-sem-rejeicoes',
      'rejeicoes',
      'validando',
      'zero-validas',
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
