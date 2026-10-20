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
  criarEmpresa,
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
const CONTADORA: Pessoa = {
  ...pessoa('contador', 'Contadora do Motor'),
  usuario: `e2e-f26-contador-${randomUUID()}`,
};
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
let empresaFiscalId = '';
let tenantFiscalId = '';
let usuarioContadoraId = '';
let documentoFiscalId = '';

const semearDocumentoFiscal = async (tenantId: string, usuarioId: string): Promise<void> => {
  const cnpj = cnpjValido('262626260001');
  tenantFiscalId = tenantId;
  usuarioContadoraId = usuarioId;
  empresaFiscalId = await criarEmpresa(pool, tenantFiscalId, cnpj, 'Comércio sintético F26');
  await pool.query(
    `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id)
     values ($1,$2,$3)`,
    [tenantFiscalId, usuarioContadoraId, empresaFiscalId],
  );
  await pool.query(
    `insert into app.empresa_evento_de_historico
       (tenant_id,empresa_id,aba,acao,campo,valor_novo,vigencia,usuario_id)
     values ($1,$2,'DADOS_FISCAIS','ALTERACAO','regimeTributario','SIMPLES_NACIONAL','2026-01-01',$3)`,
    [tenantFiscalId, empresaFiscalId, usuarioContadoraId],
  );

  const correlationId = `e2e-f26-${randomUUID()}`;
  const criadoEm = new Date('2026-10-19T12:00:00.000Z');
  await pool.query('begin');
  try {
    await pool.query(`select set_config('app.tenant_id',$1,true), set_config('app.usuario_id',$2,true),
      set_config('app.finalidade','COMUM',true), set_config('app.origem','HUMANA',true),
      set_config('app.correlation_id',$3,true)`, [tenantFiscalId, usuarioContadoraId, correlationId]);
    const state = await pool.query<{ id: string }>(
      `insert into app.dfe_capture_state(tenant_id,empresa_id,cnpj) values($1,$2,$3) returning id`,
      [tenantFiscalId, empresaFiscalId, cnpj],
    );
    const stateId = state.rows[0]!.id;
    const run = await pool.query<{ id: string }>(
      `insert into app.dfe_capture_run(tenant_id,empresa_id,estado_id,cnpj,origem,usuario_originador_id,
         chave_idempotente,correlation_id,estado,tentativa,ult_nsu_entrada,ult_nsu_retorno,max_nsu_retorno,
         quantidade_recebida,quantidade_criada,quantidade_deduplicada,iniciado_em,finalizado_em)
       values($1,$2,$3,$4,'MANUAL',$5,$6,$7,'SUCCEEDED',1,'0','1','1',1,1,0,$8,$8) returning id`,
      [tenantFiscalId, empresaFiscalId, stateId, cnpj, usuarioContadoraId, randomUUID(), correlationId, criadoEm],
    );
    const runId = run.rows[0]!.id;
    await pool.query(
      `update app.dfe_capture_state set ult_nsu='1',max_nsu='1',tempo_medio_ms=60000,
        proximo_instante_permitido=$1,estado='WAITING',ultimo_sucesso_em=$1,atualizado_em=$1 where id=$2`,
      [criadoEm, stateId],
    );
    const staging = await pool.query<{ id: string }>(
      `insert into app.dfe_capture_staging
        (tenant_id,empresa_id,run_id,cnpj,nsu,especie,conteudo_bruto,capturado_em,correlation_id)
       values($1,$2,$3,$4,'1','NFE_55',convert_to('<nfeProc>fixture-sintetica-f26</nfeProc>','UTF8'),$5,$6)
       returning id`,
      [tenantFiscalId, empresaFiscalId, runId, cnpj, criadoEm, correlationId],
    );
    const stagingId = staging.rows[0]!.id;
    documentoFiscalId = randomUUID();
    const hash = 'c'.repeat(64);
    const parser = 'f18-e2e-f26';
    await pool.query(
      `insert into app.fiscal_document
        (id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,
        modelo,versao_layout,protocolo,emitido_em,emitente,total,estado,parser_version)
       values($1,$2,$3,$4,'NFE_55','26262626000100000000000000000000000000000001',$5,$6,42,'55','4.00','135260000000001',
         '2026-06-15',$7,'10.00','PROCESSADO',$8)`,
      [documentoFiscalId, tenantFiscalId, empresaFiscalId, stagingId, hash,
        `${tenantFiscalId}/${empresaFiscalId}/fiscal-original/${hash}.xml`, cnpj, parser],
    );
    await pool.query(
      `insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome,uf)
       values($1,$2,$3,$4,'EMITENTE',$5,'Fornecedor sintético F26','GO')`,
      [tenantFiscalId, empresaFiscalId, documentoFiscalId, parser, '12121212000199'],
    );
    await pool.query(
      `insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome,uf)
       values($1,$2,$3,$4,'DESTINATARIO',$5,'Comércio sintético F26','GO')`,
      [tenantFiscalId, empresaFiscalId, documentoFiscalId, parser, cnpj],
    );
    await pool.query(
      `insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,quantidade,unidade,valor)
       values($1,$2,$3,$4,1,'ITEM','F26-1','Mercadoria sintética para teste',1,'UN',10)`,
      [tenantFiscalId, empresaFiscalId, documentoFiscalId, parser],
    );
    await pool.query(
      `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
       values($1,$2,$3,$4,$5,'1',$6,$7)`,
      [tenantFiscalId, empresaFiscalId, documentoFiscalId, stagingId, cnpj, correlationId, criadoEm],
    );
    await pool.query(
      `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,parser_version,hash_sha256,correlation_id,ocorrido_em)
       values($1,$2,$3,$4,'PROCESSADO',$5,$6,$7,$8)`,
      [tenantFiscalId, empresaFiscalId, documentoFiscalId, stagingId, parser, hash, correlationId, criadoEm],
    );
    const stagingSaida = await pool.query<{ id: string }>(
      `insert into app.dfe_capture_staging
        (tenant_id,empresa_id,run_id,cnpj,nsu,especie,conteudo_bruto,capturado_em,correlation_id)
       values($1,$2,$3,$4,'2','NFE_55',convert_to('<nfeProc>fixture-sintetica-f26-saida</nfeProc>','UTF8'),$5,$6)
       returning id`,
      [tenantFiscalId, empresaFiscalId, runId, cnpj, criadoEm, correlationId],
    );
    const stagingSaidaId = stagingSaida.rows[0]!.id;
    const documentoSaidaId = randomUUID();
    const hashSaida = 'd'.repeat(64);
    await pool.query(
      `insert into app.fiscal_document
        (id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,
         modelo,versao_layout,emitido_em,emitente,total,estado,parser_version)
       values($1,$2,$3,$4,'NFE_55','26262626000100000000000000000000000000000002',$5,$6,42,'55','4.00',
         '2026-06-15','Emitente sintético de saída','10.00','PROCESSADO',$7)`,
      [documentoSaidaId, tenantFiscalId, empresaFiscalId, stagingSaidaId, hashSaida,
        `${tenantFiscalId}/${empresaFiscalId}/fiscal-original/${hashSaida}.xml`, parser],
    );
    await pool.query(
      `insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome,uf)
       values($1,$2,$3,$4,'EMITENTE',$5,'Comércio sintético F26','GO'),
             ($1,$2,$3,$4,'DESTINATARIO','12121212000199','Cliente sintético F26','GO')`,
      [tenantFiscalId, empresaFiscalId, documentoSaidaId, parser, cnpj],
    );
    await pool.query(
      `insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,quantidade,unidade,valor)
       values($1,$2,$3,$4,1,'ITEM','F26-2','Mercadoria sintética de saída',1,'UN',10)` ,
      [tenantFiscalId, empresaFiscalId, documentoSaidaId, parser],
    );
    await pool.query(
      `insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
       values($1,$2,$3,$4,$5,'2',$6,$7)`,
      [tenantFiscalId, empresaFiscalId, documentoSaidaId, stagingSaidaId, cnpj, correlationId, criadoEm],
    );
    await pool.query(
      `insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,parser_version,hash_sha256,correlation_id,ocorrido_em)
       values($1,$2,$3,$4,'PROCESSADO',$5,$6,$7,$8)`,
      [tenantFiscalId, empresaFiscalId, documentoSaidaId, stagingSaidaId, parser, hashSaida, correlationId, criadoEm],
    );
    await pool.query('commit');
  } catch (error) {
    await pool.query('rollback');
    throw error;
  }
};

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

  const apenasF26 = process.env['E2E_F26_ONLY'] === '1';
  if (!apenasF26) {
    await limparORegistroDaSpec();
    await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO]);
    await removerIdentidadesComPrefixo('e2e-f16-');
  }
  mkdirSync(PASTA_DAS_PROVAS, { recursive: true });
  for (const nome of readdirSync(PASTA_DAS_PROVAS)) {
    if (nome.endsWith('.png')) {
      rmSync(join(PASTA_DAS_PROVAS, nome), { force: true });
    }
  }

  if (apenasF26) {
    await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO]);
    await removerIdentidadesComPrefixo('e2e-f26-contador-');
    const tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F26');
    const usuarioId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADORA), CONTADORA, 'contador');
    await semearDocumentoFiscal(tenantId, usuarioId);
    contadora = await novaPagina(browser, CONTADORA);
  } else {
    const tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F16');
    const usuarioId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADORA), CONTADORA, 'contador');
    await criarUsuario(pool, tenantId, await criarIdentidade(AUXILIAR), AUXILIAR, 'auxiliar');
    await semearDocumentoFiscal(tenantId, usuarioId);
    administradora = await novaPagina(browser, ADMINISTRADORA);
    contadora = await novaPagina(browser, CONTADORA);
    auxiliar = await novaPagina(browser, AUXILIAR);
  }
});

test.afterAll(async () => {
  await Promise.all(contextos.map((contexto) => contexto.close()));
  if (process.env['E2E_F26_ONLY'] !== '1') {
    await limparORegistroDaSpec().catch(() => undefined);
  }
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

test('F26: registra snapshots indeterminados, preserva revisões e exibe a decisão na empresa', async () => {
  const inicio = `/empresas/${empresaFiscalId}?aba=captura-dfe`;
  await contadora.goto(inicio);
  await expect(contadora.getByRole('heading', { name: 'Documentos fiscais', exact: true })).toBeVisible({ timeout: 30_000 });
  const filaFiltrada=await pelaApi(contadora,`/companies/${empresaFiscalId}/fiscal-documents/tax-treatment-resolutions/queue?pagina=1&estadoResolucao=SEM_PROCESSAMENTO`);
  expect(filaFiltrada.status).toBe(200);
  expect(filaFiltrada.corpo).toMatchObject({itens:expect.arrayContaining([expect.objectContaining({id:documentoFiscalId,resolution_state:'SEM_PROCESSAMENTO'})])});
  const filaResolucao=contadora.getByRole('table',{name:'Fila paginada de resolução tributária por empresa'});
  const linhaEntrada=filaResolucao.getByRole('row').filter({hasText:'Fornecedor sintético F26'});
  await expect(linhaEntrada).toContainText('Sem processamento');
  await expect(linhaEntrada).toContainText('1');
  await linhaEntrada.getByRole('button', { name: 'Abrir documento' }).click();
  const listaDocumentos = contadora.getByRole('table', { name: 'Documentos fiscais capturados e processados para esta empresa' });
  const documentoAberto = listaDocumentos.getByRole('row').filter({ hasText: '26262626000160' });
  await expect(documentoAberto.getByRole('button', { name: 'Fechar detalhes' })).toBeVisible();
  expect(filaFiltrada.corpo).not.toMatchObject({itens:expect.arrayContaining([expect.objectContaining({emitente:'Emitente sintético de saída'})])});
  const painel = contadora.getByRole('region', { name: 'Tratamento tributário por item' });
  await expect(painel).toBeVisible();

  await contadora.getByRole('button', { name: 'Processar itens' }).click();
  const post = await contadora.waitForResponse((response) => response.url().includes('tax-treatment-resolutions') && response.request().method() === 'POST');
  expect(post.status()).toBe(201);
  const revisaoUm = contadora.getByRole('heading', { name: 'Revisão 1' });
  await expect(revisaoUm).toBeVisible({ timeout: 30_000 });
  await expect(painel).toContainText('Indeterminado');
  await expect(painel).toContainText('Sem pacote curado associado.');
  await expect(painel).toContainText('Aguarde a publicação de pacote compatível');
  const orientacoesDoItem = painel.getByRole('list', { name: 'Dados e próximos passos para item 1' }).first();
  await expect(orientacoesDoItem.getByText('CFOP do item', { exact: true })).toHaveCount(1);

  const declararRevenda = contadora.getByRole('checkbox', { name: 'Declarar item 1 para revenda' });
  await declararRevenda.focus();
  await declararRevenda.press('Space');
  await expect(declararRevenda).toBeChecked();
  await contadora.getByLabel('Motivo do reprocessamento').fill('Nova declaração sintética de finalidade para provar revisão.');
  await contadora.getByRole('button', { name: 'Reprocessar itens' }).click();
  await expect(contadora.getByRole('heading', { name: 'Revisão 2' })).toBeVisible({ timeout: 30_000 });
  await expect(contadora.getByRole('button', { name: 'Comparar revisões 1 → 2' })).toBeVisible();
  await contadora.getByRole('button', { name: 'Comparar revisões 1 → 2' }).click();
  await expect(contadora.getByRole('status').filter({ hasText: 'itens com fatos ou decisões diferentes' })).toContainText('1 de 1');

  const snapshots = await pool.query<{ revision: number; package_sha256: string | null; status: string }>(
    `select s.revision, s.package_sha256, d->>'status' as status
       from app.tax_entry_resolution_snapshot s
       cross join lateral jsonb_array_elements(s.decisions) d
      where s.document_id=$1 order by s.revision`,
    [documentoFiscalId],
  );
  expect(snapshots.rows.length).toBeGreaterThan(1);
  expect(snapshots.rows.every((snapshot) => snapshot.package_sha256 === null)).toBe(true);
  expect(snapshots.rows.some((snapshot) => snapshot.revision === 1 && snapshot.status === 'INDETERMINATE')).toBe(true);

  await provar(contadora, 'f26-resolucao-documento', {
    recarregar: false,
    semToasts: true,
    pronto: (page) => page.getByRole('heading', { name: 'Revisão 2' }),
    recorte: (page) => page.getByRole('region', { name: 'Tratamento tributário por item' }),
  });

  const violacoes = Object.fromEntries(Object.entries(achados['f26-resolucao-documento']?.violacoes ?? {}).filter(([, lista]) => lista.length > 0));
  const rolagens = achados['f26-resolucao-documento']?.rolagens ?? [];
  expect(violacoes, 'violações axe na resolução F26').toEqual({});
  expect(rolagens, 'rolagem horizontal na resolução F26').toEqual([]);
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
      'f26-resolucao-documento',
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
