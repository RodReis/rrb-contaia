/**
 * E2E SPEC-015: XLSX e ODS como entrada do plano de contas (F13) e dos empregados (F14), pela pilha
 * real da composição Docker: Keycloak, PostgreSQL (RLS), Redis/BullMQ, MinIO, API e workers em
 * contêiner (o leitor de planilha roda num processo filho dentro deles), Web no host. Nada é dublado no
 * caminho da importação.
 *
 * Jornadas (§9, §10), uma XLSX e uma ODS por domínio, com planilhas regravadas pelo LibreOffice:
 * escolha do arquivo → leitura → aba (única ou escolhida entre várias, com a vazia recusada) →
 * cabeçalho sugerido e alterado (título acima ignorado) → mapeamento por letra → validação parcial
 * (fórmula e mescla em coluna mapeada rejeitam só a linha; fora das mapeadas, nada; linha oculta
 * processada e contada) → prévia → confirmação → base atualizada → relatório CSV → histórico com
 * formato, aba e cabeçalho. Modelos oficiais XLSX/ODS baixados pela tela e importados de volta.
 * Equivalência: o mesmo conteúdo em CSV, XLSX e ODS dá os mesmos totais, rejeições e base aplicada,
 * nos dois domínios (data nativa e CPF numérico com máscara incluídos).
 *
 * Contrafactuais: várias abas, aba vazia, cabeçalho mesclado (bloqueia o mapeamento), `.xls`, `.xlsm`,
 * criptografado, corrompido, extensão trocada, acima de 10 MB e de 10.000 linhas, bomba de ZIP,
 * reenvio idêntico (reuso sem aviso novo), troca de aba, de cabeçalho e de mapeamento (nova tentativa
 * sobre o mesmo original), permissões por papel, carteira e tenant nos dois domínios, serviço de
 * leitura ocupado (503 com Retry-After) e falha do worker (fila sem consumidor e armazenamento que
 * recusa o original até esgotar o retry → FALHA). Provas visuais nos dois temas e nos três viewports,
 * axe e rolagem horizontal; varredura de dado pessoal nos logs.
 *
 * Isolamento: escritório, usuários e empresas próprios (`e2e-f15-*`, CNPJs `1515…`). Nenhum contêiner
 * é derrubado; a falha do worker pausa só a fila de validação do plano de contas pelo mínimo de tempo
 * (o `afterAll` a retoma), porque na CI as specs 013 e 014 rodam em paralelo nos mesmos workers.
 *
 * Depende de: composição no ar (`pnpm docker:up`) com API e workers, `pnpm db:migrate`, `pnpm build`
 * (o `dist` de `@contaia/planilhas` traz os construtores) e dos processos que o `playwright.config.ts` sobe.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { MAPEAMENTO_DO_LEGADO, bytesDe, empregadosDa } from './fixtures/empregados';
import {
  CAMPOS_DOS_EMPREGADOS,
  CAMPOS_DO_PLANO,
  abaDeTexto,
  arquivosHostis,
  caminhoDaPlanilha,
  csvDe,
  enviarPlanilhaPelaApi,
  inspecionarPelaApi,
  linhasDoCsv,
  mapeamentoPorLetra,
  odsDeTexto,
  planilhaReal,
  xlsxComCelulas,
  xlsxDeTexto,
  type Arquivo,
  type ArquivosHostis,
  type Celula,
} from './fixtures/planilhas';
import {
  MAPEAMENTO_DO_MODELO,
  baixarPeloBotao,
  bytesDa,
  campoDe,
  codigoDo,
  confirmarPelaTela,
  contasDa,
  dadosDoJob,
  destinatariosDaNotificacao,
  enviarPelaApi,
  erroAoLerNoArmazenamento,
  esperarEstado,
  eventosDa,
  jobsMortosDa,
  logsDe,
  pausarAValidacao,
  pelaApi,
  provarVisualmente,
  retomarAValidacao,
  tentativa,
  tentativasDa,
  totalNaTela,
  validarPelaTela,
  type AchadosVisuais,
  type Recurso,
  type TabelaDaImportacao,
} from './fixtures/plano-contas';

const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';
// Subpasta própria fora do escopo SPEC-015 (como a spec-013 e a spec-014): as capturas e a limpeza
// desta spec não tocam as das outras quando rodam juntas.
const PASTA_DAS_PROVAS = resolve(
  ESCOPO === 'SPEC-015' ? `test-results/${ESCOPO}/e2e/provas` : `test-results/${ESCOPO}/e2e/provas/spec-015`,
);
const FILA_DO_PLANO = 'plano-contas-validacao';
const PLANO: Recurso = 'plano-contas';
const EMPREGADOS: Recurso = 'empregados';
const TABELA_DO_PLANO: TabelaDaImportacao = 'importacao_plano_contas';
const TABELA_DOS_EMPREGADOS: TabelaDaImportacao = 'importacao_empregados';

const CNPJ_DO_ESCRITORIO = cnpjValido('151515150001');
const CNPJ_DO_OUTRO_ESCRITORIO = cnpjValido('159915990002');
const cnpjDaEmpresa = (sequencial: number): string => cnpjValido(`1515${String(sequencial).padStart(4, '0')}0001`);

const pessoa = (papel: string, nome: string): Pessoa => ({
  usuario: `e2e-f15-${papel}`,
  senha: `senha-${papel}-f15-123456`,
  nome,
});
const ADMIN = pessoa('admin', 'Administradora Planilhas');
const CONTADOR = pessoa('contador', 'Contador Planilhas');
const AUDITOR = pessoa('auditor', 'Auditora Planilhas');
const AUXILIAR = pessoa('auxiliar', 'Auxiliar Planilhas');
const DE_FORA = pessoa('contador-fora', 'Contadora de Fora Planilhas');
const OUTRO_ADMIN = pessoa('outro-admin', 'Administrador de Outro Escritório Planilhas');
const PESSOAS = [ADMIN, CONTADOR, AUDITOR, AUXILIAR, DE_FORA, OUTRO_ADMIN];

const ROTULO_DA_PLANILHA_DO_PLANO = 'Planilha XLSX ou ODS do plano de contas';
const ROTULO_DA_PLANILHA_DOS_EMPREGADOS = 'Planilha XLSX ou ODS dos empregados';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

test.describe.configure({ mode: 'serial', timeout: 240_000 });
// O login preenche senha no Keycloak: trace, vídeo e captura automática a gravariam.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// -- Estado da prova -----------------------------------------------------------------------------

let tenantId = '';
const ids = { admin: '', contador: '', auditor: '', auxiliar: '' };
const empresa = {
  limites: '',
  modelos: '',
  planoXlsx: '',
  planoOds: '',
  empregadosXlsx: '',
  empregadosOds: '',
  falha: '',
  eqPlano: ['', '', ''],
  eqEmpregados: ['', '', ''],
};

const contextos: BrowserContext[] = [];
let admin: Page;
let contador: Page;
let auditor: Page;
let auxiliar: Page;
let deFora: Page;
let outroAdmin: Page;

let hostisDoPlano: ArquivosHostis;
let hostisDosEmpregados: ArquivosHostis;

/** Tentativas das jornadas pela tela. */
const jornada = { planoXlsx: '', planoOds: '', empregadosXlsx: '', empregadosOds: '' };

const achados: Record<string, AchadosVisuais> = {};
const provar = async (page: Page, estado: string, opcoes: Parameters<typeof provarVisualmente>[3]): Promise<void> => {
  achados[estado] = await provarVisualmente(page, PASTA_DAS_PROVAS, estado, opcoes);
};

const novaPagina = async (browser: Browser, quem: Pessoa): Promise<Page> => {
  // `bypassCSP`: o axe é injetado na página para a checagem de acessibilidade.
  const contexto = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();

  contextos.push(contexto);
  await entrarComo(page, quem);

  return page;
};

const abrir = async (page: Page, recurso: Recurso, empresaId: string, consulta = ''): Promise<void> => {
  const titulo = recurso === PLANO ? 'Plano de contas' : 'Empregados';

  await page.goto(`/empresas/${empresaId}?aba=${recurso}${consulta}`);
  await expect(page.getByRole('heading', { level: 2, name: titulo })).toBeVisible({ timeout: 30_000 });
};

const rotuloDaPlanilha = (recurso: Recurso): string =>
  recurso === PLANO ? ROTULO_DA_PLANILHA_DO_PLANO : ROTULO_DA_PLANILHA_DOS_EMPREGADOS;

const escolherPlanilha = async (page: Page, recurso: Recurso, arquivo: Arquivo | string): Promise<void> => {
  const entrada = page.getByLabel(rotuloDaPlanilha(recurso));

  await (typeof arquivo === 'string'
    ? entrada.setInputFiles(arquivo)
    : entrada.setInputFiles({ name: arquivo.nome, mimeType: arquivo.tipo ?? 'application/octet-stream', buffer: arquivo.conteudo }));
};

const escolherAba = async (page: Page, rotulo: string): Promise<void> => {
  await page.getByRole('combobox', { name: /Aba da planilha/u }).click();
  await page.getByRole('option', { name: rotulo, exact: true }).click();
};

const escolherCabecalho = async (page: Page, linha: number, sugerida: number): Promise<void> => {
  await page.getByRole('radio', { name: `Linha ${linha} como cabeçalho` }).check();
  await expect(page.getByText(`Cabeçalho alterado: linha ${linha} (sugerida: linha ${sugerida}).`)).toBeVisible();
};

const tabelaDo = (recurso: Recurso): TabelaDaImportacao => (recurso === PLANO ? TABELA_DO_PLANO : TABELA_DOS_EMPREGADOS);

type Rejeicao = Readonly<{
  numeroDaLinha: number;
  codigo?: string | null;
  cpf?: string | null;
  matricula?: string | null;
  campo: string | null;
  codigoDeErro: string;
}>;

const rejeicoesDa = async (page: Page, recurso: Recurso, empresaId: string, id: string): Promise<Rejeicao[]> =>
  campoDe((await pelaApi(page, `/empresas/${empresaId}/${recurso}/importacoes/${id}/rejeicoes`)).corpo, 'itens') as Rejeicao[];

const previaDa = async (page: Page, recurso: Recurso, empresaId: string, id: string): Promise<unknown> =>
  (await pelaApi(page, `/empresas/${empresaId}/${recurso}/importacoes/${id}`)).corpo;

const confirmarPelaApi = async (page: Page, recurso: Recurso, empresaId: string, id: string): Promise<void> => {
  const confirmacao = await pelaApi(page, `/empresas/${empresaId}/${recurso}/importacoes/${id}/confirmar`, {
    metodo: 'POST',
    corpo: { versaoDaPrevia: campoDe(await previaDa(page, recurso, empresaId, id), 'versaoDaPrevia') },
  });
  expect(confirmacao.status, confirmacao.texto.slice(0, 300)).toBe(200);
};

const cancelarPelaApi = async (page: Page, recurso: Recurso, empresaId: string, id: string): Promise<void> => {
  const cancelada = await pelaApi(page, `/empresas/${empresaId}/${recurso}/importacoes/${id}/cancelar`, { metodo: 'POST' });
  expect(campoDe(cancelada.corpo, 'estado')).toBe('CANCELADA');
};

type LeituraNaTentativa = Readonly<{
  formato: string;
  aba_nome: string | null;
  aba_posicao: number;
  linha_cabecalho: number;
  linhas_ignoradas_antes_do_cabecalho: number;
  linhas_ocultas: number;
  diagnosticos: ReadonlyArray<Readonly<{ codigo: string; quantidade: number }>>;
  arquivo_chave: string;
}>;

const leituraDa = async (tabela: TabelaDaImportacao, id: string): Promise<LeituraNaTentativa | undefined> =>
  (
    await pool.query<LeituraNaTentativa>(
      `select formato, aba_nome, aba_posicao, linha_cabecalho, linhas_ignoradas_antes_do_cabecalho, linhas_ocultas,
              diagnosticos, arquivo_chave
         from app.${tabela} where id = $1`,
      [id],
    )
  ).rows[0];

const notificacoesDa = async (tabela: TabelaDaImportacao, empresaId: string): Promise<number> =>
  Number(
    (
      await pool.query<{ total: string }>(
        `select count(*) as total from app.${tabela}_notificacao n
           join app.${tabela} t on t.id = n.tentativa_id where t.empresa_id = $1`,
        [empresaId],
      )
    ).rows[0]?.total ?? 0,
  );

const linhasDoRelatorio = (bytes: Buffer): string[] => {
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

  return bytes.subarray(3).toString('utf8').split('\r\n').filter((linha) => linha !== '');
};

const semVersao = <T extends { versao: string; atualizado_em: string }>(mapa: Map<string, T>): Record<string, Omit<T, 'versao' | 'atualizado_em'>> =>
  Object.fromEntries(
    [...mapa.entries()].map(([chave, { versao: _versao, atualizado_em: _em, ...resto }]) => [chave, resto]),
  );

// -- Preparação ----------------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);

  // Uma rodada morta no meio da falha do worker deixaria a fila pausada (o Redis é persistente).
  await retomarAValidacao(FILA_DO_PLANO);
  await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO, CNPJ_DO_OUTRO_ESCRITORIO]);
  await removerIdentidadesComPrefixo('e2e-f15-');
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
  hostisDoPlano = arquivosHostis([...CAMPOS_DO_PLANO], ['1', 'Ativo', 'sintetica', 'devedora', '']);
  hostisDosEmpregados = arquivosHostis([...CAMPOS_DOS_EMPREGADOS], ['529.982.247-25', 'Maria Limite', '00001', '15/03/1990', '01/02/2015']);

  tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F15');
  const outroTenantId = await criarEscritorio(pool, CNPJ_DO_OUTRO_ESCRITORIO, 'Outro Escritório E2E da F15');

  const criados: Record<string, string> = {};
  for (const [quem, papel, tenant] of [
    [ADMIN, 'admin_escritorio', tenantId],
    [CONTADOR, 'contador', tenantId],
    [AUDITOR, 'auditor_readonly', tenantId],
    [AUXILIAR, 'auxiliar', tenantId],
    [DE_FORA, 'contador', tenantId],
    [OUTRO_ADMIN, 'admin_escritorio', outroTenantId],
  ] as const) {
    criados[quem.usuario] = await criarUsuario(pool, tenant, await criarIdentidade(quem), quem, papel);
  }
  ids.admin = criados[ADMIN.usuario] ?? '';
  ids.contador = criados[CONTADOR.usuario] ?? '';
  ids.auditor = criados[AUDITOR.usuario] ?? '';
  ids.auxiliar = criados[AUXILIAR.usuario] ?? '';

  let sequencial = 1;
  const nova = (nome: string): Promise<string> => criarEmpresa(pool, tenantId, cnpjDaEmpresa(sequencial++), `${nome} Planilhas E2E`);
  empresa.limites = await nova('Limites');
  empresa.modelos = await nova('Modelos');
  empresa.planoXlsx = await nova('Plano XLSX');
  empresa.planoOds = await nova('Plano ODS');
  empresa.empregadosXlsx = await nova('Empregados XLSX');
  empresa.empregadosOds = await nova('Empregados ODS');
  empresa.falha = await nova('Falha');
  empresa.eqPlano = [await nova('Equivalência Plano CSV'), await nova('Equivalência Plano XLSX'), await nova('Equivalência Plano ODS')];
  empresa.eqEmpregados = [
    await nova('Equivalência Empregados CSV'),
    await nova('Equivalência Empregados XLSX'),
    await nova('Equivalência Empregados ODS'),
  ];

  // Carteira: administradora e contador em todas; auditora e auxiliar nas duas das jornadas XLSX; a
  // contadora de fora em nenhuma.
  const todas = [
    empresa.limites,
    empresa.modelos,
    empresa.planoXlsx,
    empresa.planoOds,
    empresa.empregadosXlsx,
    empresa.empregadosOds,
    empresa.falha,
    ...empresa.eqPlano,
    ...empresa.eqEmpregados,
  ];
  for (const id of todas) {
    await vincular(pool, tenantId, ids.admin, id);
    await vincular(pool, tenantId, ids.contador, id);
  }
  for (const id of [empresa.planoXlsx, empresa.empregadosXlsx]) {
    await vincular(pool, tenantId, ids.auditor, id);
    await vincular(pool, tenantId, ids.auxiliar, id);
  }

  admin = await novaPagina(browser, ADMIN);
  contador = await novaPagina(browser, CONTADOR);
  auditor = await novaPagina(browser, AUDITOR);
  auxiliar = await novaPagina(browser, AUXILIAR);
  deFora = await novaPagina(browser, DE_FORA);
  outroAdmin = await novaPagina(browser, OUTRO_ADMIN);
});

test.afterAll(async () => {
  await retomarAValidacao(FILA_DO_PLANO).catch(() => undefined);
  await Promise.all(contextos.map((contexto) => contexto.close()));
  await pool.end();
});

// -- Arquivos que não podem ser usados -----------------------------------------------------------

test('formatos e modelos junto ao envio; .xls, .xlsm e acima de 10 MB recusados no navegador; os hostis recusados pela API com código estável, sem tentativa', async () => {
  await abrir(contador, PLANO, empresa.limites);
  const grupo = contador.getByRole('group', { name: 'Modelos oficiais do plano de contas' });
  await expect(contador.getByText('Formatos aceitos:')).toBeVisible();
  for (const formato of ['CSV', 'XLSX', 'ODS']) {
    await expect(grupo.getByRole('button', { name: `Baixar modelo ${formato}` })).toBeVisible();
  }
  await provar(contador, 'modelos-para-download', {
    recarregar: true,
    pronto: (page) => page.getByRole('group', { name: 'Modelos oficiais do plano de contas' }),
  });

  // O navegador recusa pela extensão e pelo tamanho, sem enviar nada.
  const recusa = contador.getByRole('alert').filter({ hasText: 'Arquivo recusado antes do envio' });
  await escolherPlanilha(contador, PLANO, hostisDoPlano.xls);
  await expect(recusa).toContainText('O formato .xls (Excel 97-2003) não é aceito.');
  await escolherPlanilha(contador, PLANO, hostisDoPlano.comMacro);
  await expect(recusa).toContainText('Planilhas com macro (.xlsm) não são aceitas.');
  await escolherPlanilha(contador, PLANO, hostisDoPlano.acimaDoTamanho);
  await expect(recusa).toContainText('10 MB');

  // A API é a fronteira real: inspeção e envio, nos dois domínios, devolvem o código estável.
  const casos = [
    ['xls', 422, 'FORMATO_XLS_NAO_SUPORTADO'],
    ['xlsRenomeado', 422, 'FORMATO_XLS_NAO_SUPORTADO'],
    ['comMacro', 422, 'FORMATO_XLSM_NAO_SUPORTADO'],
    ['comMacroRenomeado', 422, 'FORMATO_XLSM_NAO_SUPORTADO'],
    ['criptografado', 422, 'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO'],
    ['corrompido', 422, 'ARQUIVO_CORROMPIDO'],
    ['extensaoTrocada', 422, 'EXTENSAO_DIFERENTE_DO_CONTEUDO'],
    ['bomba', 422, 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO'],
    ['acimaDoTamanho', 413, 'ARQUIVO_ACIMA_DO_LIMITE'],
  ] as const;
  for (const [recurso, page, hostis, campos] of [
    [PLANO, contador, hostisDoPlano, CAMPOS_DO_PLANO],
    [EMPREGADOS, admin, hostisDosEmpregados, CAMPOS_DOS_EMPREGADOS],
  ] as const) {
    for (const [nome, status, codigo] of casos) {
      const correlationId = `e2e-f15-${recurso}-${nome}`.toLowerCase();
      const inspecao = await inspecionarPelaApi(page, empresa.limites, recurso, hostis[nome], {}, correlationId);
      expect([inspecao.status, codigoDo(inspecao)], `${recurso} inspeção ${nome}`).toEqual([status, codigo]);
      expect(campoDe(inspecao.corpo, 'correlationId'), `${recurso} ${nome}`).toBe(correlationId);

      const envio = await enviarPlanilhaPelaApi(page, empresa.limites, recurso, hostis[nome], mapeamentoPorLetra(campos), { aba: 1, linhaCabecalho: 1 });
      expect([envio.status, codigoDo(envio)], `${recurso} envio ${nome}`).toEqual([status, codigo]);
    }
    // 10.001 linhas cabem no tamanho: a leitura conta as linhas de dados e recusa no envio (413).
    const linhas = await enviarPlanilhaPelaApi(page, empresa.limites, recurso, hostis.acimaDasLinhas, mapeamentoPorLetra(campos), {
      aba: 1,
      linhaCabecalho: 1,
    });
    expect([linhas.status, codigoDo(linhas)], `${recurso} 10.001 linhas`).toEqual([413, 'ARQUIVO_ACIMA_DO_LIMITE']);
    // Planilha sem aba nem cabeçalho: configuração incompleta, antes de qualquer leitura.
    const incompleta = await enviarPlanilhaPelaApi(page, empresa.limites, recurso, hostis.cabecalhoMesclado, mapeamentoPorLetra(campos), {});
    expect([incompleta.status, codigoDo(incompleta)], `${recurso} sem configuração`).toEqual([400, 'CONFIGURACAO_DE_PLANILHA_INCOMPLETA']);
    // Cabeçalho mesclado: a inspeção avisa, o envio recusa.
    const mesclado = await inspecionarPelaApi(page, empresa.limites, recurso, hostis.cabecalhoMesclado);
    expect([mesclado.status, campoDe(mesclado.corpo, 'cabecalhoMesclado')]).toEqual([200, true]);
    const envioMesclado = await enviarPlanilhaPelaApi(page, empresa.limites, recurso, hostis.cabecalhoMesclado, mapeamentoPorLetra(campos), {
      aba: 1,
      linhaCabecalho: 1,
    });
    expect([envioMesclado.status, codigoDo(envioMesclado)]).toEqual([422, 'CABECALHO_MESCLADO']);
  }

  // Nenhuma recusa criou tentativa nos dois domínios.
  expect(await tentativasDa(pool, empresa.limites, TABELA_DO_PLANO)).toEqual([]);
  expect(await tentativasDa(pool, empresa.limites, TABELA_DOS_EMPREGADOS)).toEqual([]);
});

test('na tela: protegido, corrompido, extensão trocada e acima de 10.000 linhas param com motivo acionável; cabeçalho mesclado bloqueia o mapeamento até outra linha', async () => {
  await abrir(contador, PLANO, empresa.limites);
  const falha = contador.getByRole('alert').filter({ hasText: 'Esta planilha não pode ser usada' });

  for (const [arquivo, estado, frase] of [
    [hostisDoPlano.criptografado, 'arquivo-protegido', 'O arquivo está protegido por senha ou criptografado.'],
    [hostisDoPlano.corrompido, 'arquivo-corrompido', 'ele parece corrompido'],
    [hostisDoPlano.extensaoTrocada, 'extensao-incompativel', 'O conteúdo do arquivo não corresponde à extensão.'],
  ] as const) {
    await escolherPlanilha(contador, PLANO, arquivo);
    await expect(falha).toContainText(frase, { timeout: 60_000 });
    await expect(falha).toContainText('Código de suporte');
    await provar(contador, estado, { recarregar: false, pronto: (page) => page.getByRole('alert').filter({ hasText: frase }) });
    await falha.getByRole('button', { name: 'Escolher outro arquivo' }).click();
    await expect(contador.getByLabel(ROTULO_DA_PLANILHA_DO_PLANO)).toBeAttached();
  }

  // Cabeçalho mesclado: o mapeamento não aparece; a linha 2 (o cabeçalho de verdade) o libera.
  await escolherPlanilha(contador, PLANO, hostisDoPlano.cabecalhoMesclado);
  const bloqueio = contador.getByRole('alert').filter({ hasText: 'O mapeamento está bloqueado' });
  await expect(bloqueio).toContainText('A linha de cabeçalho tem células mescladas.', { timeout: 60_000 });
  await expect(contador.getByRole('combobox', { name: /^Código/u })).toHaveCount(0);
  await provar(contador, 'cabecalho-mesclado', { recarregar: false, pronto: () => bloqueio });
  await escolherCabecalho(contador, 2, 1);
  await expect(bloqueio).toHaveCount(0);
  await expect(contador.getByRole('combobox', { name: /^Código/u })).toContainText('Coluna A — codigo');

  // 10.001 linhas: a leitura mostra a aba; o envio volta 413 e diz o limite.
  await contador.getByRole('button', { name: /Trocar arquivo/u }).click();
  await escolherPlanilha(contador, PLANO, hostisDoPlano.acimaDasLinhas);
  await expect(contador.getByRole('combobox', { name: /^Código/u })).toContainText('Coluna A — codigo', { timeout: 90_000 });
  const [resposta] = await Promise.all([
    contador.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/plano-contas/importacoes')),
    contador.getByRole('button', { name: 'Validar arquivo' }).click(),
  ]);
  expect(resposta.status()).toBe(413);
  const naoAceito = contador.getByRole('alert').filter({ hasText: 'O arquivo não foi aceito para validação' });
  await expect(naoAceito).toContainText('10.000 linhas');
  // O aviso passageiro (toast) não é o estado sob prova: fechado pelo próprio botão antes da captura.
  for (let abertos = await contador.locator('[data-sonner-toast]').count(); abertos > 0; abertos -= 1) {
    await contador.locator('[data-sonner-toast] [data-close-button]').first().click();
  }
  await provar(contador, 'limite-excedido', { recarregar: false, semToasts: true, pronto: () => naoAceito });

  expect(await tentativasDa(pool, empresa.limites, TABELA_DO_PLANO)).toEqual([]);
});

// -- Modelos oficiais ----------------------------------------------------------------------------

test('modelos oficiais XLSX e ODS: baixados pela tela, importados de volta e confirmados, nos dois domínios', async () => {
  const pastaDosModelos = join(PASTA_DAS_PROVAS, 'modelos');
  mkdirSync(pastaDosModelos, { recursive: true });

  for (const [recurso, page, nomeBase, valido] of [
    [PLANO, contador, 'modelo-plano-de-contas', /A única linha lida é válida|Todas as \d+ linhas lidas são válidas/u],
    [EMPREGADOS, admin, 'modelo-empregados', /A única linha lida é válida|Todas as \d+ linhas lidas são válidas/u],
  ] as const) {
    for (const formato of ['XLSX', 'ODS'] as const) {
      await abrir(page, recurso, empresa.modelos);
      const modelo = await baixarPeloBotao(page, `Baixar modelo ${formato}`);
      expect(modelo.nome).toBe(`${nomeBase}.${formato.toLowerCase()}`);
      // Guardado para a conferência no LibreOffice (registro no relatório da tarefa).
      writeFileSync(join(pastaDosModelos, modelo.nome), modelo.bytes);

      await escolherPlanilha(page, recurso, { nome: modelo.nome, conteudo: modelo.bytes });
      await expect(page.getByText(/^Aba única: /u)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Cabeçalho sugerido: linha 1/u)).toBeVisible();
      // O cabeçalho do modelo é o do CSV: os cinco campos vêm associados às letras A..E.
      const ultimo = recurso === PLANO ? /^Conta-pai/u : /^Data de admissão/u;
      await expect(page.getByRole('combobox', { name: ultimo })).toContainText('Coluna E');
      const enviado = await validarPelaTela(page, recurso);
      await expect(page.getByText(valido)).toBeVisible({ timeout: 60_000 });
      await confirmarPelaTela(page);
      await expect(page.getByRole('heading', { name: 'Importação concluída', exact: true })).toBeVisible({ timeout: 30_000 });
      expect(await leituraDa(tabelaDo(recurso), enviado.tentativaId)).toMatchObject({ formato: formato, linha_cabecalho: 1 });
    }
  }
  expect((await contasDa(pool, empresa.modelos)).size).toBeGreaterThan(0);
  expect((await empregadosDa(pool, empresa.modelos)).size).toBeGreaterThan(0);
});

// -- Jornada XLSX do plano de contas -------------------------------------------------------------

/** As seis contas válidas das planilhas do LibreOffice (a linha 6, oculta, incluída). */
const CONTAS_APLICADAS = ['1', '1.1', '1.1.01', '2', '2.1', '2.2'];

test('plano de contas, XLSX do LibreOffice: leitura → aba única → cabeçalho alterado (título ignorado, oculta contada) → prévia parcial com fórmula e mescla → confirmação → relatório → histórico', async () => {
  await abrir(contador, PLANO, empresa.planoXlsx);

  // A leitura fica presa no navegador só pelo tempo da captura do estado "lendo".
  let soltar = (): void => undefined;
  const presa = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await contador.route('**/planilhas/inspecao', async (rota) => {
    await presa;
    await rota.continue();
  });
  await escolherPlanilha(contador, PLANO, caminhoDaPlanilha('plano-contas-libreoffice.xlsx'));
  await expect(contador.getByText('Lendo a planilha', { exact: true })).toBeVisible();
  await provar(contador, 'lendo', { recarregar: false, pronto: (page) => page.getByText('Lendo a planilha', { exact: true }) });
  // Solta: esta e as leituras seguintes passam direto (a rota fica, sem espera).
  soltar();

  await expect(contador.getByText('Aba única: Plano de contas (posição 1)')).toBeVisible({ timeout: 60_000 });
  await expect(contador.getByText(/Cabeçalho sugerido: linha 1, a primeira preenchida/u)).toBeVisible();
  await expect(contador.getByRole('radio', { name: 'Linha 1 como cabeçalho' })).toBeChecked();
  await provar(contador, 'aba-unica', { recarregar: false, pronto: (page) => page.getByText('Aba única: Plano de contas (posição 1)') });

  // O título da linha 1 não é cabeçalho: a linha 3 é. A 1 fica ignorada e a 6, oculta, é processada.
  await escolherCabecalho(contador, 3, 1);
  await expect(contador.getByText('1 linha anterior ignorada · 1 linha oculta processada')).toBeVisible();
  const linhaOculta = contador.getByRole('row').filter({ has: contador.getByRole('radio', { name: 'Linha 6 como cabeçalho' }) });
  await expect(linhaOculta).toContainText('oculta');
  await expect(contador.getByRole('combobox', { name: /^Código/u })).toContainText('Coluna A — codigo');
  await expect(contador.getByRole('combobox', { name: /^Conta-pai/u })).toContainText('Coluna E — conta_pai');
  await provar(contador, 'cabecalho-alterado', { recarregar: false, pronto: (page) => page.getByText(/Cabeçalho alterado: linha 3/u) });
  await provar(contador, 'linhas-ocultas', {
    recarregar: false,
    pronto: (page) => page.getByRole('region', { name: /Amostra da aba/u }),
    recorte: (page) => page.getByRole('region', { name: /Amostra da aba/u }),
  });
  await provar(contador, 'planilha-selecionada', { recarregar: false, pronto: (page) => page.getByRole('button', { name: 'Validar arquivo' }) });

  const enviado = await validarPelaTela(contador, PLANO);
  jornada.planoXlsx = enviado.tentativaId;
  await expect(contador.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 90_000 });
  await expect(totalNaTela(contador, 'Linhas lidas')).toHaveText('9');
  await expect(totalNaTela(contador, 'Novas')).toHaveText('6');
  await expect(totalNaTela(contador, 'Atualizadas')).toHaveText('0');
  await expect(totalNaTela(contador, 'Rejeitadas')).toHaveText('3');

  const lida = contador.getByRole('group', { name: 'Planilha lida' });
  await expect(lida).toContainText('XLSX');
  await expect(lida).toContainText('Plano de contas (posição 1)');
  await expect(lida).toContainText('Linha 3');
  await expect(lida).toContainText('1 linha anterior ignorada · 1 linha oculta processada');
  await expect(lida).toContainText('1 linha rejeitada por fórmula · 1 linha rejeitada por célula mesclada');

  // Só as linhas da fórmula (B7) e da mescla (B8:C8) caem por estrutura, e a órfã pela regra da F13.
  // A fórmula na F10 e a mescla F11:G11 estão fora das colunas mapeadas: nada acontece.
  expect(
    (await rejeicoesDa(contador, PLANO, empresa.planoXlsx, enviado.tentativaId)).map((item) => [
      item.numeroDaLinha,
      item.codigo,
      item.codigoDeErro,
    ]),
  ).toEqual([
    [7, '1.1.02', 'CELULA_COM_FORMULA'],
    [8, '1.1.03', 'CELULA_MESCLADA'],
    [12, '9.1', 'CONTA_PAI_INEXISTENTE'],
  ]);
  expect(await leituraDa(TABELA_DO_PLANO, enviado.tentativaId)).toMatchObject({
    formato: 'XLSX',
    aba_nome: 'Plano de contas',
    aba_posicao: 1,
    linha_cabecalho: 3,
    linhas_ignoradas_antes_do_cabecalho: 1,
    linhas_ocultas: 1,
  });
  expect((await eventosDa(pool, enviado.tentativaId)).map((evento) => evento.acao)).toEqual([
    'CRIACAO',
    'SELECAO_DE_PLANILHA',
    'INICIAR_VALIDACAO',
    'LEITURA_PLANILHA',
    'VALIDACAO_SUCESSO',
  ]);
  expect(await contasDa(pool, empresa.planoXlsx)).toEqual(new Map());

  await provar(contador, 'previa-parcial-com-formula-e-mescla', {
    recarregar: true,
    pronto: (page) => page.getByRole('group', { name: 'Planilha lida' }),
  });

  await confirmarPelaTela(contador);
  await expect(contador.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible({ timeout: 30_000 });
  expect([...(await contasDa(pool, empresa.planoXlsx)).keys()]).toEqual(CONTAS_APLICADAS);
  // A linha oculta entrou como qualquer outra.
  expect((await contasDa(pool, empresa.planoXlsx)).get('1.1.01')).toMatchObject({ nome: 'Caixa', conta_pai: '1.1' });

  const relatorio = await baixarPeloBotao(contador, 'Baixar relatório CSV');
  expect(relatorio.nome).toBe('relatorio-plano-contas-libreoffice.csv');
  const linhas = linhasDoRelatorio(relatorio.bytes);
  expect(linhas[0]).toBe('linha;codigo;nome;tipo;natureza;conta_pai;status;acao;codigo_de_erro;campo;mensagem');
  expect(linhas).toContain('6;1.1.01;Caixa;analitica;devedora;1.1;VALIDA;INCLUIR;;;');
  expect(linhas.find((linha) => linha.startsWith('7;'))).toContain('CELULA_COM_FORMULA');
  expect(linhas.find((linha) => linha.startsWith('8;'))).toContain('CELULA_MESCLADA');
  expect(linhas).toHaveLength(10);
  const original = await baixarPeloBotao(contador, 'Baixar arquivo enviado');
  expect(original.bytes.equals(readFileSync(caminhoDaPlanilha('plano-contas-libreoffice.xlsx')))).toBe(true);

  await abrir(contador, PLANO, empresa.planoXlsx);
  const historico = contador.getByRole('region', { name: 'Histórico de importações' });
  const linha = historico.getByRole('row').filter({ hasText: 'plano-contas-libreoffice.xlsx' });
  await expect(linha).toContainText('XLSX · aba Plano de contas (posição 1) · cabeçalho na linha 3');
  await expect(linha).toContainText('1 ignorada · 1 oculta · 1 com fórmula · 1 com mescla');
  await provar(contador, 'historico-com-planilha', {
    recarregar: true,
    pronto: (page) => page.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').nth(1),
    recorte: (page) => page.getByRole('region', { name: 'Histórico de importações' }),
  });
});

// -- Jornada ODS do plano de contas --------------------------------------------------------------

test('plano de contas, ODS do LibreOffice com três abas: escolha explícita, aba vazia recusada, cabeçalho sugerido e alterado → prévia → confirmação → relatório → histórico', async () => {
  await abrir(contador, PLANO, empresa.planoOds);
  await escolherPlanilha(contador, PLANO, caminhoDaPlanilha('plano-contas-libreoffice.ods'));

  // Várias abas: nenhuma escolhida em silêncio; nada de cabeçalho nem mapeamento ainda.
  await expect(contador.getByText('A planilha tem 3 abas. Escolha a que tem os dados: só ela é lida.')).toBeVisible({ timeout: 60_000 });
  await expect(contador.getByRole('combobox', { name: /Aba da planilha/u })).toContainText('Escolha a aba');
  await expect(contador.getByRole('radio')).toHaveCount(0);
  await provar(contador, 'varias-abas', { recarregar: false, pronto: (page) => page.getByRole('combobox', { name: /Aba da planilha/u }) });

  await escolherAba(contador, 'Vazia (posição 3) — sem dados');
  await expect(contador.getByText('A aba escolhida está vazia. Escolha outra aba.')).toBeVisible({ timeout: 60_000 });
  await expect(contador.getByRole('radio')).toHaveCount(0);
  await provar(contador, 'aba-sem-dados', { recarregar: false, pronto: (page) => page.getByText('A aba escolhida está vazia. Escolha outra aba.') });

  await escolherAba(contador, 'Plano de contas (posição 2)');
  await expect(contador.getByText(/Cabeçalho sugerido: linha 1, a primeira preenchida/u)).toBeVisible({ timeout: 60_000 });
  await expect(contador.getByText('A aba escolhida está vazia. Escolha outra aba.')).toHaveCount(0);
  await provar(contador, 'cabecalho-sugerido', { recarregar: false, pronto: (page) => page.getByText(/Cabeçalho sugerido: linha 1/u) });

  await escolherCabecalho(contador, 3, 1);
  await expect(contador.getByText('1 linha anterior ignorada · 1 linha oculta processada')).toBeVisible();
  await expect(contador.getByRole('combobox', { name: /^Código/u })).toContainText('Coluna A — codigo');
  const enviado = await validarPelaTela(contador, PLANO);
  jornada.planoOds = enviado.tentativaId;
  await expect(contador.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 90_000 });
  await expect(totalNaTela(contador, 'Linhas lidas')).toHaveText('9');
  await expect(totalNaTela(contador, 'Novas')).toHaveText('6');
  await expect(totalNaTela(contador, 'Rejeitadas')).toHaveText('3');
  await expect(contador.getByRole('group', { name: 'Planilha lida' })).toContainText('Plano de contas (posição 2)');

  // A mesma planilha em XLSX e em ODS: as mesmas rejeições.
  expect(
    (await rejeicoesDa(contador, PLANO, empresa.planoOds, enviado.tentativaId)).map((item) => [item.numeroDaLinha, item.codigo, item.codigoDeErro]),
  ).toEqual([
    [7, '1.1.02', 'CELULA_COM_FORMULA'],
    [8, '1.1.03', 'CELULA_MESCLADA'],
    [12, '9.1', 'CONTA_PAI_INEXISTENTE'],
  ]);
  expect(await leituraDa(TABELA_DO_PLANO, enviado.tentativaId)).toMatchObject({
    formato: 'ODS',
    aba_nome: 'Plano de contas',
    aba_posicao: 2,
    linha_cabecalho: 3,
    linhas_ignoradas_antes_do_cabecalho: 1,
    linhas_ocultas: 1,
  });

  await confirmarPelaTela(contador);
  await expect(contador.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible({ timeout: 30_000 });
  expect([...(await contasDa(pool, empresa.planoOds)).keys()]).toEqual(CONTAS_APLICADAS);

  const relatorio = linhasDoRelatorio((await baixarPeloBotao(contador, 'Baixar relatório CSV')).bytes);
  expect(relatorio).toContain('6;1.1.01;Caixa;analitica;devedora;1.1;VALIDA;INCLUIR;;;');
  expect(relatorio).toHaveLength(10);

  await abrir(contador, PLANO, empresa.planoOds);
  await expect(
    contador.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').filter({ hasText: 'plano-contas-libreoffice.ods' }),
  ).toContainText('ODS · aba Plano de contas (posição 2) · cabeçalho na linha 3');
});

test('reenvio idêntico reaproveita sem aviso novo; outra aba, outro cabeçalho e outro mapeamento viram tentativas novas sobre o mesmo original', async () => {
  const ods = planilhaReal('plano-contas-libreoffice.ods');
  const mapeamento = mapeamentoPorLetra(CAMPOS_DO_PLANO);
  const original = await leituraDa(TABELA_DO_PLANO, jornada.planoOds);
  const avisosAntes = await notificacoesDa(TABELA_DO_PLANO, empresa.planoOds);
  const contasAntes = await contasDa(pool, empresa.planoOds);

  const identico = await enviarPlanilhaPelaApi(contador, empresa.planoOds, PLANO, ods, mapeamento, { aba: 2, linhaCabecalho: 3 });
  expect(identico.status, identico.texto.slice(0, 300)).toBe(202);
  expect(campoDe(identico.corpo, 'tentativaId')).toBe(jornada.planoOds);
  expect((await eventosDa(pool, jornada.planoOds)).at(-1)?.acao).toBe('REUTILIZACAO');
  expect(await notificacoesDa(TABELA_DO_PLANO, empresa.planoOds)).toBe(avisosAntes);
  expect(await contasDa(pool, empresa.planoOds)).toEqual(contasAntes);

  const variantes = [
    ['outra aba', mapeamento, { aba: 1, linhaCabecalho: 1 }],
    ['outro cabeçalho', mapeamento, { aba: 2, linhaCabecalho: 5 }],
    ['outro mapeamento', { ...mapeamento, conta_pai: 'F' }, { aba: 2, linhaCabecalho: 3 }],
  ] as const;
  const novas: string[] = [];
  for (const [motivo, outroMapeamento, configuracao] of variantes) {
    const envio = await enviarPlanilhaPelaApi(contador, empresa.planoOds, PLANO, ods, outroMapeamento, configuracao);
    expect(envio.status, `${motivo}: ${envio.texto.slice(0, 300)}`).toBe(202);
    const id = String(campoDe(envio.corpo, 'tentativaId'));
    expect([jornada.planoOds, ...novas], motivo).not.toContain(id);
    novas.push(id);
    // Validada do zero (a configuração é outra); o resultado depende do que a configuração lê.
    await expect
      .poll(async () => (await tentativa(pool, id))?.estado, { timeout: 90_000, intervals: [500, 1_000] })
      .toMatch(/^(AGUARDANDO_CONFIRMACAO|REJEITADA)$/u);
    const leitura = await leituraDa(TABELA_DO_PLANO, id);
    expect(leitura?.arquivo_chave, motivo).toBe(original?.arquivo_chave);
    expect([leitura?.aba_posicao, leitura?.linha_cabecalho], motivo).toEqual([configuracao.aba, configuracao.linhaCabecalho]);
    expect((await eventosDa(pool, id)).slice(0, 2).map((evento) => evento.acao), motivo).toEqual(['CRIACAO', 'SELECAO_DE_PLANILHA']);
    if ((await tentativa(pool, id))?.estado === 'AGUARDANDO_CONFIRMACAO') {
      await cancelarPelaApi(contador, PLANO, empresa.planoOds, id);
    }
  }
  expect(await contasDa(pool, empresa.planoOds)).toEqual(contasAntes);
  // Um único objeto no armazenamento para as quatro tentativas.
  expect(new Set((await tentativasDa(pool, empresa.planoOds, TABELA_DO_PLANO)).map((t) => t.arquivo_chave)).size).toBe(1);
});

// -- Jornadas dos empregados ---------------------------------------------------------------------

/** Chave CPF|matrícula dos cinco válidos: o CPF numérico com máscara e a matrícula `00000` valem o exibido. */
const EMPREGADOS_APLICADOS = ['15515515510|00123', '15615615680|00124', '15715715741|00125', '16016016039|127', '16216216260|00129'];

const REJEICOES_DOS_EMPREGADOS = [
  [7, '158.158.158-02', '00126', 'CELULA_COM_FORMULA'],
  [8, '159.159.159-73', null, 'CELULA_MESCLADA'],
  [10, '161.161.161-08', '00128', 'DATA_NASCIMENTO_INVALIDA'],
];

test('empregados, XLSX do LibreOffice: CPF numérico com máscara, matrícula 00000 e data nativa valem o exibido; serial sem formato de data é rejeitado; fórmula e mescla só na linha → confirmação → relatório → histórico', async () => {
  await abrir(admin, EMPREGADOS, empresa.empregadosXlsx);
  await escolherPlanilha(admin, EMPREGADOS, caminhoDaPlanilha('empregados-libreoffice.xlsx'));
  await expect(admin.getByText('Aba única: Empregados (posição 1)')).toBeVisible({ timeout: 60_000 });
  await escolherCabecalho(admin, 3, 1);
  await expect(admin.getByText('1 linha anterior ignorada · 1 linha oculta processada')).toBeVisible();
  await expect(admin.getByRole('combobox', { name: /^CPF/u })).toContainText('Coluna A — cpf');
  await provar(admin, 'cabecalho-alterado-empregados', { recarregar: false, pronto: (page) => page.getByText(/Cabeçalho alterado: linha 3/u) });

  const enviado = await validarPelaTela(admin, EMPREGADOS);
  jornada.empregadosXlsx = enviado.tentativaId;
  await expect(admin.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 90_000 });
  await expect(totalNaTela(admin, 'Linhas lidas')).toHaveText('8');
  await expect(totalNaTela(admin, 'Novas')).toHaveText('5');
  await expect(totalNaTela(admin, 'Rejeitadas')).toHaveText('3');
  expect(
    (await rejeicoesDa(admin, EMPREGADOS, empresa.empregadosXlsx, enviado.tentativaId)).map((item) => [
      item.numeroDaLinha,
      item.cpf,
      item.matricula,
      item.codigoDeErro,
    ]),
  ).toEqual(REJEICOES_DOS_EMPREGADOS);
  await provar(admin, 'previa-parcial-com-formula-e-mescla-empregados', {
    recarregar: true,
    pronto: (page) => page.getByRole('group', { name: 'Planilha lida' }),
  });

  await confirmarPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible({ timeout: 30_000 });
  const base = await empregadosDa(pool, empresa.empregadosXlsx);
  expect([...base.keys()]).toEqual(EMPREGADOS_APLICADOS);
  // Data nativa vira data civil; o texto dd/mm/aaaa e o ISO seguem o parser da F14.
  expect(base.get('15515515510|00123')).toMatchObject({ nome: 'Ana Planilha', data_nascimento: '1990-03-15', data_admissao: '2015-02-01' });
  expect(base.get('15715715741|00125')).toMatchObject({ nome: 'Carla Oculta', data_nascimento: '1992-07-22' });

  const relatorio = linhasDoRelatorio((await baixarPeloBotao(admin, 'Baixar relatório CSV')).bytes);
  expect(relatorio[0]).toBe('linha;cpf;nome;matricula;data_nascimento;data_admissao;status;acao;codigo_de_erro;campo;mensagem');
  expect(relatorio.find((linha) => linha.startsWith('4;'))).toMatch(/^4;155\.155\.155-10;Ana Planilha;00123;1990-03-15;2015-02-01;VALIDA;INCLUIR/u);
  expect(relatorio.find((linha) => linha.startsWith('10;'))).toContain('DATA_NASCIMENTO_INVALIDA');
  expect(relatorio).toHaveLength(9);

  await abrir(admin, EMPREGADOS, empresa.empregadosXlsx);
  const historico = admin.getByRole('region', { name: 'Histórico de importações' });
  await expect(historico.getByRole('row').filter({ hasText: 'empregados-libreoffice.xlsx' })).toContainText(
    'XLSX · aba Empregados (posição 1) · cabeçalho na linha 3',
  );
  await provar(admin, 'historico-com-planilha-empregados', {
    recarregar: true,
    pronto: (page) => page.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').nth(1),
    recorte: (page) => page.getByRole('region', { name: 'Histórico de importações' }),
  });
});

test('empregados, ODS do LibreOffice com três abas: escolha da aba, cabeçalho alterado → mesmas rejeições e mesma base do XLSX', async () => {
  await abrir(admin, EMPREGADOS, empresa.empregadosOds);
  await escolherPlanilha(admin, EMPREGADOS, caminhoDaPlanilha('empregados-libreoffice.ods'));
  await expect(admin.getByRole('combobox', { name: /Aba da planilha/u })).toContainText('Escolha a aba', { timeout: 60_000 });
  await provar(admin, 'varias-abas-empregados', { recarregar: false, pronto: (page) => page.getByRole('combobox', { name: /Aba da planilha/u }) });
  await escolherAba(admin, 'Empregados (posição 2)');
  await expect(admin.getByText(/Cabeçalho sugerido: linha 1/u)).toBeVisible({ timeout: 60_000 });
  await escolherCabecalho(admin, 3, 1);
  await expect(admin.getByText('1 linha anterior ignorada · 1 linha oculta processada')).toBeVisible();

  const enviado = await validarPelaTela(admin, EMPREGADOS);
  jornada.empregadosOds = enviado.tentativaId;
  await expect(admin.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeVisible({ timeout: 90_000 });
  expect(
    (await rejeicoesDa(admin, EMPREGADOS, empresa.empregadosOds, enviado.tentativaId)).map((item) => [
      item.numeroDaLinha,
      item.cpf,
      item.matricula,
      item.codigoDeErro,
    ]),
  ).toEqual(REJEICOES_DOS_EMPREGADOS);
  expect(await leituraDa(TABELA_DOS_EMPREGADOS, enviado.tentativaId)).toMatchObject({
    formato: 'ODS',
    aba_nome: 'Empregados',
    aba_posicao: 2,
    linha_cabecalho: 3,
    linhas_ignoradas_antes_do_cabecalho: 1,
    linhas_ocultas: 1,
  });

  await confirmarPelaTela(admin);
  await expect(admin.getByRole('heading', { name: 'Importação concluída com rejeições' })).toBeVisible({ timeout: 30_000 });
  const base = await empregadosDa(pool, empresa.empregadosOds);
  expect([...base.keys()]).toEqual(EMPREGADOS_APLICADOS);
  expect(base.get('15515515510|00123')).toMatchObject({ data_nascimento: '1990-03-15', data_admissao: '2015-02-01' });

  await abrir(admin, EMPREGADOS, empresa.empregadosOds);
  await expect(
    admin.getByRole('region', { name: 'Histórico de importações' }).getByRole('row').filter({ hasText: 'empregados-libreoffice.ods' }),
  ).toContainText('ODS · aba Empregados (posição 2) · cabeçalho na linha 3');
});

// -- Equivalência CSV × XLSX × ODS ---------------------------------------------------------------

/** Envia os três formatos (cada um numa empresa vazia), espera a prévia, confirma e devolve o resultado. */
const importarOsTres = async (
  page: Page,
  recurso: Recurso,
  empresas: readonly string[],
  arquivos: readonly (readonly [Arquivo, Readonly<Record<string, string>>, boolean])[],
): Promise<Array<{ totais: unknown; rejeicoes: Rejeicao[]; ocultas: number }>> => {
  const resultados: Array<{ totais: unknown; rejeicoes: Rejeicao[]; ocultas: number }> = [];

  for (const [indice, [arquivo, mapeamento, planilha]] of arquivos.entries()) {
    const empresaId = empresas[indice] ?? '';
    const envio = planilha
      ? await enviarPlanilhaPelaApi(page, empresaId, recurso, arquivo, mapeamento, { aba: 1, linhaCabecalho: 1 })
      : await enviarPelaApi(page, empresaId, arquivo, mapeamento, randomUUID(), recurso);
    expect(envio.status, `${arquivo.nome}: ${envio.texto.slice(0, 300)}`).toBe(202);
    const id = String(campoDe(envio.corpo, 'tentativaId'));

    await esperarEstado(pool, id, 'AGUARDANDO_CONFIRMACAO', 90_000, tabelaDo(recurso));
    resultados.push({
      totais: (await tentativa(pool, id, tabelaDo(recurso)))?.totais,
      rejeicoes: await rejeicoesDa(page, recurso, empresaId, id),
      ocultas: (await leituraDa(tabelaDo(recurso), id))?.linhas_ocultas ?? -1,
    });
    await confirmarPelaApi(page, recurso, empresaId, id);
  }

  return resultados;
};

test('equivalência do plano de contas: o mesmo conteúdo em CSV, XLSX e ODS dá os mesmos totais, rejeições (hierarquia e duplicidade) e base aplicada', async () => {
  const linhas = linhasDoCsv(bytesDa('plano-parcial.csv'));
  const mapeamento = mapeamentoPorLetra(CAMPOS_DO_PLANO);
  const aba = abaDeTexto('Plano', linhas, [4]);
  const [csv, xlsxx, ods] = await importarOsTres(contador, PLANO, empresa.eqPlano, [
    [{ nome: 'equivalencia.csv', conteudo: csvDe(linhas), tipo: 'text/csv' }, MAPEAMENTO_DO_MODELO, false],
    [{ nome: 'equivalencia.xlsx', conteudo: xlsxDeTexto(aba) }, mapeamento, true],
    [{ nome: 'equivalencia.ods', conteudo: odsDeTexto(aba) }, mapeamento, true],
  ]);

  expect(csv?.rejeicoes.length).toBeGreaterThan(3);
  // Hierarquia (ciclo, órfã, pai rejeitado) e duplicidade: as regras da SPEC-013 depois da normalização.
  expect([...new Set(csv?.rejeicoes.map((item) => item.codigoDeErro))]).toEqual(
    expect.arrayContaining(['CICLO_HIERARQUICO', 'CONTA_PAI_INEXISTENTE', 'CODIGO_DUPLICADO_NO_ARQUIVO', 'CONTA_PAI_REJEITADA']),
  );
  for (const outro of [xlsxx, ods]) {
    expect(outro?.totais).toEqual(csv?.totais);
    expect(outro?.rejeicoes).toEqual(csv?.rejeicoes);
  }
  expect([csv?.ocultas, xlsxx?.ocultas, ods?.ocultas]).toEqual([0, 1, 1]);

  const [baseCsv, baseXlsx, baseOds] = await Promise.all(empresa.eqPlano.map(async (id) => semVersao(await contasDa(pool, id))));
  expect(Object.keys(baseCsv ?? {}).length).toBeGreaterThan(0);
  expect(baseXlsx).toEqual(baseCsv);
  expect(baseOds).toEqual(baseCsv);
});

test('equivalência dos empregados: CSV legado × XLSX (CPF numérico com máscara, matrícula 00000, data nativa) × ODS dão os mesmos totais, rejeições (duplicidade incluída) e base', async () => {
  const linhas = linhasDoCsv(bytesDe('empregados-legado.csv'), 'latin1');
  const mapeamento = mapeamentoPorLetra(CAMPOS_DOS_EMPREGADOS);
  // A linha 2 (Ana) com tipos nativos: CPF número com máscara, matrícula número com `00000`, datas
  // nativas; a 3 (Débora) com CPF número sem máscara. O exibido é o mesmo texto do CSV.
  const tipadas: Celula[][] = linhas.map((linha, indice) => {
    if (indice === 1) {
      return [{ numero: 14014014061, estilo: 2 }, linha[1] ?? '', { numero: 100, estilo: 3 }, { data: '1990-03-15' }, { data: '2015-02-01' }, linha[5] ?? ''];
    }
    if (indice === 2) {
      return [{ numero: 14314314354 }, ...linha.slice(1)];
    }

    return linha;
  });
  const [csv, xlsxx, ods] = await importarOsTres(admin, EMPREGADOS, empresa.eqEmpregados, [
    [{ nome: 'equivalencia.csv', conteudo: bytesDe('empregados-legado.csv'), tipo: 'text/csv' }, MAPEAMENTO_DO_LEGADO, false],
    [{ nome: 'equivalencia.xlsx', conteudo: xlsxComCelulas('Empregados', tipadas, [4]) }, mapeamento, true],
    [{ nome: 'equivalencia.ods', conteudo: odsDeTexto(abaDeTexto('Empregados', linhas, [4])) }, mapeamento, true],
  ]);

  expect(csv?.rejeicoes.filter((item) => item.codigoDeErro === 'CHAVE_DUPLICADA_NO_ARQUIVO')).toHaveLength(2);
  for (const outro of [xlsxx, ods]) {
    expect(outro?.totais).toEqual(csv?.totais);
    expect(outro?.rejeicoes).toEqual(csv?.rejeicoes);
  }
  expect([csv?.ocultas, xlsxx?.ocultas, ods?.ocultas]).toEqual([0, 1, 1]);

  const [baseCsv, baseXlsx, baseOds] = await Promise.all(empresa.eqEmpregados.map(async (id) => semVersao(await empregadosDa(pool, id))));
  expect(Object.keys(baseCsv ?? {})).toContain('14014014061|00100');
  expect(baseXlsx).toEqual(baseCsv);
  expect(baseOds).toEqual(baseCsv);
});

// -- Permissões ----------------------------------------------------------------------------------

test('permissões nos dois domínios: quem só consulta baixa os modelos mas não lê nem envia planilha; fora da carteira 403; outro escritório 404', async () => {
  const planilha = planilhaReal('plano-contas-libreoffice.xlsx');
  const deEmpregados = planilhaReal('empregados-libreoffice.xlsx');
  const modelo = (page: Page, recurso: Recurso, empresaId: string, formato: string) =>
    pelaApi(page, `/empresas/${empresaId}/${recurso}/modelo?formato=${formato}`);

  // Plano de contas: contador importa; auxiliar e auditora só consultam e baixam (SPEC-013).
  expect((await inspecionarPelaApi(contador, empresa.planoXlsx, PLANO, planilha)).status).toBe(200);
  for (const [quem, page] of [
    ['auxiliar', auxiliar],
    ['auditora', auditor],
  ] as const) {
    const inspecao = await inspecionarPelaApi(page, empresa.planoXlsx, PLANO, planilha);
    expect([inspecao.status, codigoDo(inspecao)], `${quem} inspeciona plano`).toEqual([403, 'SEM_AUTORIZACAO']);
    const envio = await enviarPlanilhaPelaApi(page, empresa.planoXlsx, PLANO, planilha, mapeamentoPorLetra(CAMPOS_DO_PLANO), { aba: 1, linhaCabecalho: 3 });
    expect([envio.status, codigoDo(envio)], `${quem} envia plano`).toEqual([403, 'SEM_AUTORIZACAO']);
    for (const formato of ['xlsx', 'ods']) {
      expect((await modelo(page, PLANO, empresa.planoXlsx, formato)).status, `${quem} modelo ${formato}`).toBe(200);
    }
  }

  // Empregados: só a administradora importa; contador e auditora consultam; auxiliar nada (SPEC-014).
  expect((await inspecionarPelaApi(admin, empresa.empregadosXlsx, EMPREGADOS, deEmpregados)).status).toBe(200);
  for (const [quem, page] of [
    ['contador', contador],
    ['auditora', auditor],
  ] as const) {
    const inspecao = await inspecionarPelaApi(page, empresa.empregadosXlsx, EMPREGADOS, deEmpregados);
    expect([inspecao.status, codigoDo(inspecao)], `${quem} inspeciona empregados`).toEqual([403, 'SEM_AUTORIZACAO']);
    for (const formato of ['xlsx', 'ods']) {
      expect((await modelo(page, EMPREGADOS, empresa.empregadosXlsx, formato)).status, `${quem} modelo ${formato}`).toBe(200);
    }
  }
  for (const consulta of [modelo(auxiliar, EMPREGADOS, empresa.empregadosXlsx, 'xlsx'), inspecionarPelaApi(auxiliar, empresa.empregadosXlsx, EMPREGADOS, deEmpregados)]) {
    const negada = await consulta;
    expect([negada.status, codigoDo(negada)], 'auxiliar em empregados').toEqual([403, 'SEM_AUTORIZACAO']);
  }

  // Carteira e tenant.
  const fora = await inspecionarPelaApi(deFora, empresa.planoXlsx, PLANO, planilha);
  expect([fora.status, codigoDo(fora)]).toEqual([403, 'EMPRESA_FORA_DA_CARTEIRA']);
  for (const [recurso, arquivo] of [
    [PLANO, planilha],
    [EMPREGADOS, deEmpregados],
  ] as const) {
    const outro = await inspecionarPelaApi(outroAdmin, empresa.planoXlsx, recurso, arquivo);
    expect([outro.status, codigoDo(outro)], `outro escritório ${recurso}`).toEqual([404, 'EMPRESA_NAO_ENCONTRADA']);
    expect(outro.texto).not.toContain('Plano de contas');
    const modeloDeFora = await modelo(outroAdmin, recurso, empresa.planoXlsx, 'xlsx');
    expect([modeloDeFora.status, codigoDo(modeloDeFora)]).toEqual([404, 'EMPRESA_NAO_ENCONTRADA']);
  }

  // A tela de quem só consulta não oferece o envio de planilha.
  await abrir(auxiliar, PLANO, empresa.planoXlsx);
  await expect(auxiliar.getByText(/não tem permissão para importar/u)).toBeVisible();
  await expect(auxiliar.getByLabel(ROTULO_DA_PLANILHA_DO_PLANO)).toHaveCount(0);
  await abrir(contador, EMPREGADOS, empresa.empregadosXlsx);
  await expect(contador.getByText(/não tem permissão para importar/u)).toBeVisible();
  await expect(contador.getByLabel(ROTULO_DA_PLANILHA_DOS_EMPREGADOS)).toHaveCount(0);
});

// -- Serviço de leitura ocupado ------------------------------------------------------------------

test('serviço de leitura ocupado: com as duas vagas da API tomadas por planilhas pesadas, a próxima leitura recebe 503 SERVICO_OCUPADO com Retry-After e a tela espera para liberar a nova tentativa', async () => {
  // Uma aba de 10.900 linhas × 40 colunas: legítima e pesada de ler (cerca de 1 s por leitura no filho).
  const pesada: Arquivo = {
    nome: 'pesada.xlsx',
    conteudo: xlsxDeTexto(
      abaDeTexto(
        'Pesada',
        Array.from({ length: 10_900 }, (_, linha) => Array.from({ length: 40 }, (__, coluna) => `valor ${linha}-${coluna}`)),
      ),
    ),
  };
  const pequena = hostisDoPlano.cabecalhoMesclado;

  // A leitura da tela fica retida no navegador até a API provar, com uma leitura real, que as duas
  // vagas estão tomadas; então segue para a API, que responde 503 de verdade (nada é dublado).
  await abrir(contador, PLANO, empresa.limites);
  let soltar = (): void => undefined;
  const retida = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await contador.route('**/planilhas/inspecao', async (rota) => {
    await retida;
    await rota.continue();
  });
  await escolherPlanilha(contador, PLANO, caminhoDaPlanilha('plano-contas-libreoffice.xlsx'));

  // Duas sequências de leituras pesadas mantêm as vagas ocupadas enquanto a prova acontece.
  let parar = false;
  const manter = async (page: Page, recurso: Recurso): Promise<number[]> => {
    const status: number[] = [];
    while (!parar) {
      const resposta = await inspecionarPelaApi(page, empresa.limites, recurso, pesada);
      status.push(resposta.status);
      if (resposta.status === 503) {
        await new Promise((resolver) => setTimeout(resolver, 100));
      }
    }
    return status;
  };
  const ocupando = [manter(admin, PLANO), manter(admin, EMPREGADOS)];

  try {
    let ocupado = await inspecionarPelaApi(contador, empresa.limites, PLANO, pequena);
    for (let tentativas = 0; ocupado.status !== 503 && tentativas < 50; tentativas += 1) {
      await new Promise((resolver) => setTimeout(resolver, 100));
      ocupado = await inspecionarPelaApi(contador, empresa.limites, PLANO, pequena);
    }
    expect([ocupado.status, codigoDo(ocupado)]).toEqual([503, 'SERVICO_OCUPADO']);
    soltar();

    const aviso = contador.getByRole('alert').filter({ hasText: 'Não foi possível ler a planilha agora' });
    await expect(aviso).toContainText('O serviço de leitura de planilhas está ocupado.', { timeout: 30_000 });
    await expect(aviso.getByRole('button', { name: 'Tentar de novo' })).toBeDisabled();
    await expect(aviso).toContainText(/Disponível em \d+ segundos\./u);
    await expect(aviso).toContainText('Código de suporte');
    parar = true;
    await provar(contador, 'servico-ocupado', { recarregar: false, pronto: () => aviso });
    const leituras = (await Promise.all(ocupando)).flat();
    test.info().annotations.push({ type: 'leituras pesadas (status)', description: leituras.join(' ') });
    expect(leituras).toContain(200);

    await expect(aviso.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled({ timeout: 15_000 });
    await aviso.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(contador.getByText('Aba única: Plano de contas (posição 1)')).toBeVisible({ timeout: 60_000 });
  } finally {
    parar = true;
    soltar();
    await Promise.allSettled(ocupando);
  }
});

// -- Falha do worker -----------------------------------------------------------------------------

/**
 * Mesma indução das SPEC-013/014: a fila de validação do plano de contas fica pausada só enquanto a
 * planilha é enviada e a chave do original desta tentativa passa a apontar para um objeto que o MinIO
 * recusa servir. Retomada a fila, o worker tenta ler, o armazenamento recusa com erro transitório e o
 * BullMQ repete com backoff até o teto (5 tentativas): FALHA, com a correlação na tela.
 */
test('falha do worker com planilha: o armazenamento recusa o original até esgotar o retry → FALHA com correlationId, sem staging nem base alterada', async () => {
  test.setTimeout(420_000);
  const correlationId = `e2e-f15-falha-${randomUUID().slice(0, 8)}`;

  await pausarAValidacao(FILA_DO_PLANO);
  let tentativaId = '';
  try {
    const envio = await enviarPlanilhaPelaApi(
      contador,
      empresa.falha,
      PLANO,
      planilhaReal('plano-contas-libreoffice.xlsx'),
      mapeamentoPorLetra(CAMPOS_DO_PLANO),
      { aba: 1, linhaCabecalho: 3 },
      correlationId,
    );
    expect(envio.status, envio.texto.slice(0, 300)).toBe(202);
    tentativaId = String(campoDe(envio.corpo, 'tentativaId'));
    expect(dadosDoJob(tentativaId, FILA_DO_PLANO)).toEqual({ tenantId, empresaId: empresa.falha, tentativaId, correlationId });

    const chaveOriginal = (await leituraDa(TABELA_DO_PLANO, tentativaId))?.arquivo_chave ?? '';
    expect(chaveOriginal).toMatch(new RegExp(`^${tenantId}/${empresa.falha}/plano-contas/[0-9a-f]{64}\\.xlsx$`, 'u'));
    const chaveRecusada = `${chaveOriginal}/${'x'.repeat(1_100)}`;
    const erro = await erroAoLerNoArmazenamento(chaveRecusada);
    expect(erro !== null && !['NoSuchKey', 'NotFound'].includes(erro), `indução inválida: ${erro ?? 'leitura com sucesso'}`).toBe(true);
    await pool.query('update app.importacao_plano_contas set arquivo_chave = $2 where id = $1', [tentativaId, chaveRecusada]);
  } finally {
    await retomarAValidacao(FILA_DO_PLANO);
  }

  await esperarEstado(pool, tentativaId, 'FALHA', 300_000);
  const falha = (await eventosDa(pool, tentativaId)).find((evento) => evento.acao === 'FALHA_TECNICA');
  expect(falha).toMatchObject({ codigo: 'ARMAZENAMENTO_INDISPONIVEL', correlation_id: correlationId });
  expect((await eventosDa(pool, tentativaId)).map((evento) => evento.acao)).not.toContain('LEITURA_PLANILHA');
  await expect
    .poll(() => jobsMortosDa(tentativaId, FILA_DO_PLANO), { timeout: 15_000, intervals: [500] })
    .toEqual([expect.objectContaining({ tentativaId, correlationId, motivo: 'ARMAZENAMENTO_INDISPONIVEL', tentativas: 5 })]);
  expect(await destinatariosDaNotificacao(pool, tentativaId)).toContain(ids.contador);
  expect(await contasDa(pool, empresa.falha)).toEqual(new Map());

  await abrir(contador, PLANO, empresa.falha, `&tentativa=${tentativaId}`);
  await expect(contador.getByRole('heading', { name: 'A importação falhou por um problema técnico' })).toBeVisible({ timeout: 30_000 });
  await expect(contador.locator('code').filter({ hasText: correlationId })).toBeVisible();
  await expect(contador.getByRole('group', { name: 'Planilha lida' })).toContainText('XLSX');
});

// -- Dado pessoal, referência e acessibilidade ---------------------------------------------------

test('nenhum CPF, nome ou valor de célula das planilhas nos logs da API e dos workers', () => {
  const dadosPessoais = ['Ana Planilha', 'Bruno Texto', 'Carla Oculta', 'Diego Fórmula', '155.155.155-10', '15515515510', '16016016039', 'Aplicações Financeiras'];

  for (const servico of ['api', 'workers']) {
    const logs = logsDe(servico);

    for (const termo of dadosPessoais) {
      expect(logs.includes(termo), `"${termo}" nos logs de ${servico}`).toBe(false);
    }
  }
});

test('referência do protótipo: o code.html de importação de legados é renderizado e capturado para a comparação', async ({ browser }) => {
  // `screen.png` desse diretório é um placeholder quebrado (28 bytes): a referência é o code.html.
  const referencia = resolve('docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/code.html');
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await contexto.newPage();

  try {
    mkdirSync(PASTA_DAS_PROVAS, { recursive: true });
    await page.goto(pathToFileURL(referencia).href, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(PASTA_DAS_PROVAS, 'referencia-code-html-1440.png'), fullPage: true });
    await expect(page.locator('body')).toContainText(/xlsx/iu);
  } finally {
    await contexto.close();
  }
});

test('provas visuais: os estados-chave capturados, sem violação do axe (WCAG 2.1 A/AA) e sem rolagem horizontal', () => {
  expect(Object.keys(achados).sort()).toEqual(
    [
      'aba-sem-dados',
      'aba-unica',
      'arquivo-corrompido',
      'arquivo-protegido',
      'cabecalho-alterado',
      'cabecalho-alterado-empregados',
      'cabecalho-mesclado',
      'cabecalho-sugerido',
      'extensao-incompativel',
      'historico-com-planilha',
      'historico-com-planilha-empregados',
      'lendo',
      'limite-excedido',
      'linhas-ocultas',
      'modelos-para-download',
      'planilha-selecionada',
      'previa-parcial-com-formula-e-mescla',
      'previa-parcial-com-formula-e-mescla-empregados',
      'servico-ocupado',
      'varias-abas',
      'varias-abas-empregados',
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
