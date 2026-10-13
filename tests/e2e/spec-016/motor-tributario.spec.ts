/**
 * E2E SPEC-016 (F16): motor tributário base versionado, pela pilha real: Keycloak, PostgreSQL (RLS),
 * API e Web. Nada é dublado no caminho do catálogo nem do cálculo; o motor é determinístico, sem LLM,
 * e as regras do catálogo são fixtures de teste NÃO OFICIAIS.
 *
 * Jornada (§9): a administradora da plataforma (`super_admin` do Keycloak, sem linha em
 * `app.usuario`) cria, publica e arquiva versões → simula manualmente → uma regra futura não altera o
 * passado → a contadora do escritório simula uma NF-e de teste, o motor calcula por item e no total e
 * compara com o valor declarado → o XML não fica em nenhuma tabela.
 *
 * Contrafactuais: publicar com vigência sobreposta é recusado e a versão continua rascunho; versão
 * arquivada deixa de ser aplicável (sem regra, sem cálculo improvisado); escritório não escreve no
 * catálogo (403 `PLATFORM_ADMIN_REQUIRED`); o auxiliar não tem acesso ao motor.
 *
 * Isolamento: a identidade de regra `COFINS · Lucro Real · Compra de insumo` é só desta spec (o seed
 * local cobre ICMS, CBS e IBS de "Venda de mercadoria"); escritório e usuários próprios
 * (`e2e-f16-*`, CNPJ `1616…`). A limpeza apaga só o que é desta spec.
 *
 * Depende de: o seed local (`pnpm db:seed`, que publica o catálogo de teste) e do realm importado
 * (usuário `super.admin`). Provas visuais em `test-results/<escopo>/e2e/provas/`.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

import {
  cnpjValido,
  criarEscritorio,
  criarIdentidade,
  criarUsuario,
  entrarComo,
  limparEscritorios,
  removerIdentidadesComPrefixo,
  type Pessoa,
} from '../fixtures/ambiente';
import { codigoDo, pelaApi, provarVisualmente, type AchadosVisuais } from '../fixtures/plano-contas';

const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';
const PASTA_DAS_PROVAS = resolve(
  ESCOPO === 'SPEC-016' ? `test-results/${ESCOPO}/e2e/provas` : `test-results/${ESCOPO}/e2e/provas/spec-016`,
);
const CAMINHO_DO_MOTOR = '/fiscal/motor-tributario';
const XML_DE_TESTE = resolve('apps/api/src/nfe/fixtures/nfe-rtc-valida.xml');

const CNPJ_DO_ESCRITORIO = cnpjValido('161616160001');
const ADMINISTRADORA: Pessoa = { usuario: 'super.admin', senha: 'super_admin_local_123', nome: 'Administrador' };
const pessoa = (papel: string, nome: string): Pessoa => ({
  usuario: `e2e-f16-${papel}`,
  senha: `senha-${papel}-f16-123456`,
  nome,
});
const CONTADORA = pessoa('contador', 'Contadora do Motor');
const AUXILIAR = pessoa('auxiliar', 'Auxiliar do Motor');

/** Identidade da regra desta spec: nenhuma outra spec nem o seed a usa. */
const REGRA = { tributo: 'COFINS', regime: 'Lucro Real', operacao: 'Compra de insumo' } as const;
const NOME_DA_REGRA = `${REGRA.tributo} · ${REGRA.regime} · ${REGRA.operacao}`;
const FONTE = 'E2E F16: fixture de teste não oficial';
const FILTRO_ICMS = 'tributo=ICMS&regime=LUCRO_PRESUMIDO&operacao=VENDA_MERCADORIA';
const FILTRO_CBS = 'tributo=CBS&regime=SIMPLES_NACIONAL&operacao=VENDA_MERCADORIA';
const FILTRO_DA_REGRA = 'tributo=COFINS&regime=LUCRO_REAL&operacao=COMPRA_INSUMO';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

test.describe.configure({ mode: 'serial', timeout: 180_000 });

// O login preenche senha no Keycloak: trace, vídeo e captura automática a gravariam.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

let administradora: Page;
let contadora: Page;
let auxiliar: Page;
const contextos: BrowserContext[] = [];
const achados: Record<string, AchadosVisuais> = {};

const provar = async (page: Page, estado: string, opcoes: Parameters<typeof provarVisualmente>[3]): Promise<void> => {
  achados[estado] = await provarVisualmente(page, PASTA_DAS_PROVAS, estado, opcoes);
};

// -- Preparação ----------------------------------------------------------------------------------

/** Remove só a identidade de regra desta spec (com versões e auditoria); tabelas fechadas: como dono. */
const limparORegistroDaSpec = async (): Promise<void> => {
  const cliente = await pool.connect();

  try {
    await cliente.query("set session_replication_role = 'replica'");
    const alvo = `select id from app.tax_rule where tax_type = 'COFINS' and regime = 'LUCRO_REAL' and operation_type = 'COMPRA_INSUMO'`;

    await cliente.query(
      `delete from app.tax_rule_audit_event where tax_rule_version_id in
         (select id from app.tax_rule_version where tax_rule_id in (${alvo}))`,
    );
    await cliente.query(`delete from app.tax_rule_version where tax_rule_id in (${alvo})`);
    await cliente.query(`delete from app.tax_rule where id in (${alvo})`);
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }
};

const novaPagina = async (browser: Browser, quem: Pessoa): Promise<Page> => {
  const contexto = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contextos.push(contexto);
  const page = await contexto.newPage();

  await entrarComo(page, quem, CAMINHO_DO_MOTOR);

  return page;
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);

  await limparORegistroDaSpec();
  await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO]);
  await removerIdentidadesComPrefixo('e2e-f16-');
  mkdirSync(PASTA_DAS_PROVAS, { recursive: true });
  for (const nome of readdirSync(PASTA_DAS_PROVAS)) {
    if (nome.endsWith('.png')) {
      rmSync(join(PASTA_DAS_PROVAS, nome), { force: true });
    }
  }

  const tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F16');

  await criarUsuario(pool, tenantId, await criarIdentidade(CONTADORA), CONTADORA, 'contador');
  await criarUsuario(pool, tenantId, await criarIdentidade(AUXILIAR), AUXILIAR, 'auxiliar');

  administradora = await novaPagina(browser, ADMINISTRADORA);
  contadora = await novaPagina(browser, CONTADORA);
  auxiliar = await novaPagina(browser, AUXILIAR);
});

test.afterAll(async () => {
  await Promise.all(contextos.map((contexto) => contexto.close()));
  await limparORegistroDaSpec().catch(() => undefined);
  await pool.end();
});

// -- Peças da tela -------------------------------------------------------------------------------

const escolher = async (page: Page, escopo: Locator, rotulo: RegExp, opcao: string): Promise<void> => {
  await escopo.getByRole('combobox', { name: rotulo }).click();
  await page.getByRole('option', { name: opcao, exact: true }).click();
};

const linhaDaVersao = (page: Page, versao: number): Locator =>
  page
    .getByRole('row')
    .filter({ hasText: NOME_DA_REGRA })
    .filter({ has: page.getByRole('cell', { name: `v${versao}`, exact: true }) });

type Rascunho = Readonly<{ inicio: string; fim: string | null; aliquota: string; reducao?: string }>;

const criarRascunho = async (page: Page, dados: Rascunho): Promise<void> => {
  await page.getByRole('button', { name: 'Nova regra' }).first().click();
  const painel = page.getByRole('dialog', { name: 'Nova regra' });

  await escolher(page, painel, /^Tributo/u, REGRA.tributo);
  await escolher(page, painel, /^Regime/u, REGRA.regime);
  await escolher(page, painel, /^Tipo de operação/u, REGRA.operacao);
  await painel.getByLabel(/Início da vigência/u).fill(dados.inicio);
  if (dados.fim !== null) {
    await painel.getByLabel(/Fim da vigência/u).fill(dados.fim);
  }
  await painel.getByLabel(/Alíquota/u).fill(dados.aliquota);
  if (dados.reducao !== undefined) {
    await painel.getByLabel(/Redução de base/u).fill(dados.reducao);
  }
  await painel.getByLabel(/Fonte da regra/u).fill(FONTE);
  await painel.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(painel).toBeHidden({ timeout: 30_000 });
};

const publicar = async (page: Page, versao: number): Promise<void> => {
  await page.getByRole('button', { name: `Publicar versão: ${NOME_DA_REGRA} (versão ${versao})` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publicar versão' }).click();
};

const simularManual = async (page: Page, data: string, base: string): Promise<Locator> => {
  const formulario = page.getByRole('form', { name: 'Simulação manual' });

  await formulario.getByLabel(/Data do fato gerador/u).fill(data);
  await escolher(page, formulario, /^Regime/u, REGRA.regime);
  await escolher(page, formulario, /^Tributo/u, REGRA.tributo);
  await escolher(page, formulario, /^Tipo de operação/u, REGRA.operacao);
  await formulario.getByLabel(/Base de cálculo/u).fill(base);
  await formulario.getByRole('button', { name: 'Simular' }).click();

  return page.getByRole('heading', { name: 'Memória de cálculo determinística' });
};

const memoriaDeCalculo = (page: Page): Locator => page.locator('section[aria-labelledby="titulo-da-memoria"]');

// -- Jornada da administradora -------------------------------------------------------------------

test('a administradora vê o catálogo de teste semeado, com o aviso de dado não oficial', async () => {
  await expect(administradora.getByRole('heading', { name: 'Motor tributário' })).toBeVisible({ timeout: 30_000 });
  await expect(administradora.getByText('Dados de teste não oficiais').first()).toBeVisible();

  const tabela = administradora.getByRole('table', { name: /Regras tributárias/u });
  await expect(tabela).toBeVisible();

  // Seed: regra corrente (ICMS) e a transição IBS/CBS sem sobreposição (2026 → 2027). O filtro vive
  // na URL: a prova não depende de a regra cair na primeira página de um catálogo maior.
  await administradora.goto(`${CAMINHO_DO_MOTOR}?${FILTRO_ICMS}`);
  await expect(tabela.getByRole('row').filter({ hasText: 'ICMS · Lucro Presumido · Venda de mercadoria' })).toContainText('18,00%');

  await administradora.goto(`${CAMINHO_DO_MOTOR}?${FILTRO_CBS}`);
  await expect(tabela.getByRole('row').filter({ hasText: '31/12/2026' })).toContainText('0,90%');
  await expect(tabela.getByRole('row').filter({ hasText: 'a partir de 01/01/2027' })).toContainText('8,80%');

  await provar(administradora, 'catalogo-administradora', {
    recarregar: true,
    pronto: (page) => page.getByRole('table', { name: /Regras tributárias/u }),
  });

  // O resto da jornada trabalha só na identidade desta spec.
  await administradora.goto(`${CAMINHO_DO_MOTOR}?${FILTRO_DA_REGRA}`);
  await expect(administradora.getByText(/Nenhuma regra/u).first()).toBeVisible({ timeout: 30_000 });
});

test('cria, publica e simula: a memória de cálculo mostra regra, versão, base, alíquota e arredondamento', async () => {
  await criarRascunho(administradora, { inicio: '2026-01-01', fim: '2026-12-31', aliquota: '1,65' });
  await expect(linhaDaVersao(administradora, 1)).toContainText('Rascunho');
  await expect(linhaDaVersao(administradora, 1)).toContainText('1,65%');

  await publicar(administradora, 1);
  await expect(linhaDaVersao(administradora, 1)).toContainText('Publicada', { timeout: 30_000 });

  const memoria = await simularManual(administradora, '2026-06-15', '1000,00');
  await expect(memoria).toBeVisible({ timeout: 30_000 });
  const painel = memoriaDeCalculo(administradora);
  await expect(painel).toContainText('R$ 16,50');
  await expect(painel).toContainText(NOME_DA_REGRA);
  await expect(painel).toContainText('versão 1');
  await expect(painel).toContainText('1,65%');
  await expect(painel).toContainText('Dado de teste não oficial');

  await provar(administradora, 'simulacao-manual', {
    recarregar: false,
    semToasts: true,
    pronto: (page) => page.getByRole('heading', { name: 'Memória de cálculo determinística' }),
  });
});

test('regra futura publicada não altera o cálculo do passado', async () => {
  await criarRascunho(administradora, { inicio: '2027-01-01', fim: null, aliquota: '3,00' });
  await publicar(administradora, 2);
  await expect(linhaDaVersao(administradora, 2)).toContainText('Publicada', { timeout: 30_000 });

  // O fato de 2026 continua na versão 1, com o mesmo resultado de antes da publicação.
  await simularManual(administradora, '2026-06-15', '1000,00');
  await expect(memoriaDeCalculo(administradora)).toContainText('versão 1', { timeout: 30_000 });
  await expect(memoriaDeCalculo(administradora)).toContainText('R$ 16,50');

  // O fato de 2027 usa a versão 2, pela data do fato e nunca pela de hoje.
  await simularManual(administradora, '2027-03-10', '1000,00');
  await expect(memoriaDeCalculo(administradora)).toContainText('versão 2', { timeout: 30_000 });
  await expect(memoriaDeCalculo(administradora)).toContainText('R$ 30,00');
});

test('publicar com vigência sobreposta é recusado e a versão continua rascunho', async () => {
  await criarRascunho(administradora, { inicio: '2026-06-01', fim: '2026-09-30', aliquota: '2,00' });
  await publicar(administradora, 3);

  const aviso = administradora.getByRole('alertdialog');
  await expect(aviso).toContainText('vigência sobreposta', { timeout: 30_000 });
  await aviso.getByRole('button', { name: 'Entendi' }).click();
  await expect(linhaDaVersao(administradora, 3)).toContainText('Rascunho');

  const publicadas = await pool.query<{ total: number }>(
    `select count(*)::int as total
       from app.tax_rule_version v join app.tax_rule r on r.id = v.tax_rule_id
      where r.tax_type = 'COFINS' and r.regime = 'LUCRO_REAL' and r.operation_type = 'COMPRA_INSUMO'
        and v.status = 'PUBLISHED'`,
  );
  expect(publicadas.rows[0]?.total).toBe(2);
});

test('versão arquivada deixa de ser aplicável: sem regra, sem cálculo improvisado', async () => {
  await administradora.getByRole('button', { name: `Arquivar versão: ${NOME_DA_REGRA} (versão 2)` }).click();
  await administradora.getByRole('alertdialog').getByRole('button', { name: 'Arquivar versão' }).click();
  await expect(linhaDaVersao(administradora, 2)).toContainText('Arquivada', { timeout: 30_000 });

  await simularManual(administradora, '2027-03-10', '1000,00');
  const alerta = administradora.getByRole('status').filter({ hasText: 'Nenhuma regra publicada vigora' });
  await expect(alerta).toBeVisible({ timeout: 30_000 });
  await expect(administradora.getByRole('heading', { name: 'Memória de cálculo determinística' })).toHaveCount(0);

  await provar(administradora, 'sem-regra-aplicavel', {
    recarregar: false,
    semToasts: true,
    pronto: (page) => page.getByRole('status').filter({ hasText: 'Nenhuma regra publicada vigora' }),
  });
});

test('o ciclo de vida fica na auditoria do catálogo, na ordem em que aconteceu', async () => {
  const eventos = await pool.query<{ action: string; versao: number }>(
    `select e.action, v.version_number as versao
       from app.tax_rule_audit_event e
       join app.tax_rule_version v on v.id = e.tax_rule_version_id
       join app.tax_rule r on r.id = v.tax_rule_id
      where r.tax_type = 'COFINS' and r.regime = 'LUCRO_REAL' and r.operation_type = 'COMPRA_INSUMO'
      order by e.sequence`,
  );

  expect(eventos.rows.map((linha) => `${linha.action}:${linha.versao}`)).toEqual([
    'CREATED:1',
    'PUBLISHED:1',
    'CREATED:2',
    'PUBLISHED:2',
    'CREATED:3',
    'ARCHIVED:2',
  ]);
});

// -- Jornada do escritório -----------------------------------------------------------------------

test('a contadora vê o catálogo só para leitura e não escreve nele', async () => {
  await expect(contadora.getByRole('heading', { name: 'Motor tributário' })).toBeVisible({ timeout: 30_000 });
  await expect(contadora.getByRole('table', { name: /Regras tributárias/u })).toBeVisible();
  await expect(contadora.getByRole('button', { name: 'Nova regra' })).toHaveCount(0);
  await expect(contadora.getByRole('button', { name: /^Publicar versão:/u })).toHaveCount(0);

  const tentativa = await pelaApi(contadora, '/tax-rules', {
    metodo: 'POST',
    corpo: {
      taxType: 'COFINS',
      regime: 'LUCRO_REAL',
      operationType: 'COMPRA_INSUMO',
      validFrom: '2030-01-01',
      validUntil: null,
      baseReductionBasisPoints: null,
      rateBasisPoints: 100,
      source: FONTE,
      fixtureNote: '',
    },
  });
  expect(tentativa.status).toBe(403);
  expect(codigoDo(tentativa)).toBe('PLATFORM_ADMIN_REQUIRED');

  await provar(contadora, 'catalogo-escritorio', {
    recarregar: true,
    pronto: (page) => page.getByRole('table', { name: /Regras tributárias/u }),
  });
});

test('NF-e de teste: calcula por item e no total, compara com o declarado e não guarda o XML', async () => {
  const marcador = `MARCA-${randomUUID()}`;
  const xml = readFileSync(XML_DE_TESTE, 'utf8').replace('EMITENTE DE TESTE NAO OFICIAL', `EMITENTE ${marcador}`);

  await contadora.goto(`${CAMINHO_DO_MOTOR}?simulador=nfe`);
  await contadora.getByLabel('Arquivo XML da NF-e').setInputFiles({
    name: 'nfe-de-teste.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(xml, 'utf8'),
  });

  // 1) A API analisa e devolve o que o XML informa; o que falta é pedido ao usuário.
  const resumo = contadora.getByRole('region', { name: 'O que a NF-e informa' });
  await expect(resumo).toContainText('NT 2025.002', { timeout: 30_000 });
  await expect(resumo).toContainText('Simples Nacional');
  await expect(resumo).toContainText('3 itens');

  // 2) Com o complemento, o motor calcula item a item.
  const complemento = contadora.getByRole('form', { name: 'Complemento da simulação' });
  await escolher(contadora, complemento, /^Tipo de operação/u, 'Venda de mercadoria');
  await complemento.getByRole('button', { name: 'Simular NF-e' }).click();

  const itens = contadora.getByRole('table', { name: 'Cálculo por item da NF-e' });
  await expect(itens).toBeVisible({ timeout: 30_000 });
  const cbsDoItem3 = itens.getByRole('row').filter({ hasText: 'CBS' }).filter({ hasText: 'R$ 0,95' });
  await expect(cbsDoItem3).toContainText('Divergente');
  await expect(cbsDoItem3).toContainText('-R$ 0,05');
  await expect(itens.getByRole('row').filter({ hasText: 'IBS · Estados' }).first()).toContainText('Confere');

  // 3) Totais: IBS confere; CBS calculado (R$ 1,84) difere do declarado (R$ 1,89).
  const totais = contadora.getByRole('region', { name: 'Totais da NF-e' });
  await expect(totais).toContainText('R$ 0,20');
  await expect(totais).toContainText('R$ 1,84');
  await expect(totais).toContainText('R$ 1,89');
  await expect(totais).toContainText('Confere');
  await expect(totais).toContainText('Divergente');
  await expect(contadora.getByText(/não indica qual valor está correto/u)).toBeVisible();

  // 4) A memória do item divergente abre sem recalcular nada no navegador.
  await contadora.getByRole('button', { name: 'Ver memória de cálculo: item 3, CBS' }).click();
  await expect(contadora.getByText('Valor antes do arredondamento').first()).toBeVisible();

  await provar(contadora, 'nfe-resultado', {
    recarregar: false,
    semToasts: true,
    pronto: (page) => page.getByRole('table', { name: 'Cálculo por item da NF-e' }),
  });

  // 5) O XML não está em nenhuma tabela do produto.
  const tabelas = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE'`,
  );
  const comOXml: string[] = [];

  for (const { table_name: tabela } of tabelas.rows) {
    const { rows } = await pool.query<{ total: number }>(`select count(*)::int as total from app."${tabela}" t where t::text like $1`, [
      `%${marcador}%`,
    ]);

    if ((rows[0]?.total ?? 0) > 0) {
      comOXml.push(tabela);
    }
  }
  expect(comOXml, 'tabelas com o conteúdo do XML').toEqual([]);
});

test('o auxiliar não tem acesso ao motor tributário', async () => {
  await auxiliar.goto(CAMINHO_DO_MOTOR);
  await expect(auxiliar.getByText(/Você não tem acesso ao motor tributário/u)).toBeVisible({ timeout: 30_000 });
  await expect(auxiliar.getByRole('table', { name: /Regras tributárias/u })).toHaveCount(0);

  const consulta = await pelaApi(auxiliar, '/tax-rules');
  expect(consulta.status).toBe(403);

  await provar(auxiliar, 'acesso-negado', {
    recarregar: true,
    pronto: (page) => page.getByText(/Você não tem acesso ao motor tributário/u),
  });
});

test('provas visuais: os estados-chave capturados, sem violação do axe (WCAG 2.1 A/AA) e sem rolagem horizontal', () => {
  expect(Object.keys(achados).sort()).toEqual(
    [
      'acesso-negado',
      'catalogo-administradora',
      'catalogo-escritorio',
      'nfe-resultado',
      'sem-regra-aplicavel',
      'simulacao-manual',
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
