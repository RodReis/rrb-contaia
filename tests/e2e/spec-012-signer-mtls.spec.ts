/**
 * E2E SPEC-012: Signer isolado e assinatura/mTLS simulada, pela pilha real da composição Docker:
 * Keycloak, PostgreSQL, Redis/BullMQ, Vault, Signer na rede privada, dublês mTLS de DF-e e eSocial,
 * API e workers em contêiner, mais Web e cofre. Nada é dublado no caminho do Signer.
 *
 * Jornada: cartão geral → cadastro do A1 → diagnósticos automáticos (fila → worker → Signer → dublê)
 * → painel e teste manual → papéis e carteira → falha acionável de uma finalidade → certificado
 * desativado → incidente e recuperação do Signer (alerta uma vez, só ao administrador) → provas
 * visuais nos dois temas e nos três viewports → varredura de segredo.
 *
 * O material criptográfico é SINTÉTICO (`pnpm cofre:pki-teste` e `pnpm signer:segredos`).
 * Isolamento: escritório, usuários e empresas próprios (`e2e-f12-*`).
 *
 * Depende de: composição no ar (`pnpm docker:up`), `pnpm db:migrate`, `pnpm cofre:pki-teste` e dos
 * processos web e cofre (o `playwright.config.ts` os sobe). `MONITOR_INTERVALO_MS` curto (5000) faz
 * o incidente abrir em segundos; com o padrão de 1 minuto a prova esperaria mais de 3 minutos.
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';
const PROJETO = process.env['COMPOSE_PROJECT_NAME'] ?? 'contaia';
const PASTA_LOCAL = resolve(process.env['VAULT_LOCAL_DIR'] ?? 'infra/docker/.vault-local');
const PASTA_PFX = join(PASTA_LOCAL, 'pki-teste');
const SENHA_DO_PFX = 'senha-de-teste-pki';
const CNPJ_DO_A1 = '11222333000181'; // o CNPJ que `pnpm cofre:pki-teste` põe no certificado
const CNPJ_DA_BETA = '33000167000101';

const CNPJ_DO_ESCRITORIO = cnpjValido('117711770001');
const CNPJ_DO_OUTRO_ESCRITORIO = cnpjValido('119911990002');

const NOME_ALFA = 'Alfa Signer E2E';
const NOME_BETA = 'Beta Signer E2E';

const pessoa = (papel: string, nome: string): Pessoa => ({
  usuario: `e2e-f12-${papel}`,
  senha: `senha-${papel}-f12-123456`,
  nome,
});
const ADMIN = pessoa('admin', 'Administradora Signer');
const CONTADOR = pessoa('contador', 'Contador Signer');
const CONTADOR_DE_FORA = pessoa('contador-fora', 'Contadora de Fora');
const AUXILIAR = pessoa('auxiliar', 'Auxiliar Signer');
const OUTRO_ADMIN = pessoa('outro-admin', 'Administrador de Outro Escritório');

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

// A jornada espera fila, workers, incidente e recuperação: cada passo tem folga própria.
test.describe.configure({ mode: 'serial', timeout: 180_000 });

// O envio do certificado é multipart (arquivo e senha): trace, vídeo e captura automática os gravariam.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// -- Estado da prova -----------------------------------------------------------------------------

let tenantId = '';
let outroTenantId = '';
let adminId = '';
let contadorId = '';
let outroAdminId = '';
let alfaId = '';
let betaId = '';
let empresaDoOutroEscritorioId = '';

let contextoAdmin: BrowserContext;
let admin: Page;
let contextoContador: BrowserContext;
let contador: Page;
let contextoDeFora: BrowserContext;
let deFora: Page;
let contextoAuxiliar: BrowserContext;
let auxiliar: Page;

/** Tudo que o navegador do administrador recebeu em texto: nenhum segredo pode estar aqui. */
const corposRecebidos: string[] = [];

// -- Docker --------------------------------------------------------------------------------------

const nomeDoContainer = (servico: string): string => `${PROJETO}-${servico}`;
const docker = (...argumentos: string[]): string =>
  execFileSync('docker', argumentos, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Saída e erro padrão do contêiner: o Node escreve `console.warn` no stderr. */
const logsDe = (servico: string): string => {
  const { stdout, stderr } = spawnSync('docker', ['logs', nomeDoContainer(servico)], { encoding: 'utf8' });

  return `${stdout}\n${stderr}`;
};

const efeitosDoDuble = (servico: 'duble-dfe' | 'duble-esocial'): string[] =>
  logsDe(servico)
    .split('\n')
    .filter((linha) => linha.includes('"evento":"efeito"') && linha.includes(`"cnpj":"${CNPJ_DO_A1}"`));

// -- Banco ---------------------------------------------------------------------------------------

type EventoDoSigner = {
  finalidade: string;
  resultado: string;
  codigo: string | null;
  origem_diagnostico: string | null;
  identidade_tecnica: string;
  usuario_originador_id: string | null;
  reutilizado: boolean;
};

const eventosDoSigner = async (empresaId: string): Promise<EventoDoSigner[]> =>
  (
    await pool.query<EventoDoSigner>(
      `select finalidade, resultado, codigo, origem_diagnostico, identidade_tecnica,
              usuario_originador_id, reutilizado
         from app.signer_evento where empresa_id = $1 order by sequencia`,
      [empresaId],
    )
  ).rows;

const notificacoesDoSigner = async (usuarioId: string): Promise<Array<{ tipo: string; duracao_ms: string | null }>> =>
  (
    await pool.query<{ tipo: string; duracao_ms: string | null }>(
      `select tipo, duracao_ms from app.signer_notificacao where usuario_id = $1 order by sequencia`,
      [usuarioId],
    )
  ).rows;

const pendenciasAbertas = async (): Promise<number> =>
  Number(
    (
      await pool.query<{ total: string }>(
        `select count(*) as total from app.empresa_pendencia where tenant_id = $1 and estado = 'ABERTA'`,
        [tenantId],
      )
    ).rows[0]?.total ?? 0,
  );

// -- Navegação -----------------------------------------------------------------------------------

const abrirCofre = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/configuracoes/cofre${query}`);
  const pronto = query.includes('empresa=')
    ? page.getByRole('dialog', { name: 'Certificado da empresa' })
    : page.getByRole('heading', { level: 1, name: 'Cofre de certificados A1' });

  await expect(pronto).toBeVisible({ timeout: 20_000 });
};

const cartaoDoSigner = (page: Page): Locator => page.locator('section[aria-labelledby="titulo-signer"]');
const linhaDa = (page: Page, empresa: string): Locator =>
  page.getByRole('table').getByRole('row', { name: new RegExp(empresa, 'u') });
const resumoDaLinha = (page: Page, empresa: string): Locator =>
  linhaDa(page, empresa).getByRole('group', { name: 'Resumo do Signer mTLS' });

/** Recarrega a página até a condição valer: a tela atualiza a cada minuto, a prova não espera tanto. */
const recarregarAte = async (page: Page, query: string, condicao: () => Locator, timeout = 60_000): Promise<void> => {
  try {
    await expect
      .poll(
        async () => {
          await abrirCofre(page, query);
          // A página abre com esqueletos: só vale olhar depois que as leituras (lista, cartão e
          // coluna do Signer) responderam, senão cada volta recarregaria antes de ver o dado.
          await page.getByText(/^Carregando (o estado do Signer|os certificados)/u).first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);

          return condicao().count();
        },
        { timeout, intervals: [1_500] },
      )
      .toBeGreaterThan(0);
  } catch (erro) {
    // Sem captura automática (o envio do certificado é multipart): o texto da tela explica o porquê.
    const tela = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/gu, ' ').slice(0, 1_200);

    throw new Error(`${String(erro)}\nTela no momento da falha: ${tela}`);
  }
};

const abrirPainelDa = async (page: Page, empresaId: string): Promise<Locator> => {
  await abrirCofre(page, `?empresa=${empresaId}`);
  const dialogo = page.getByRole('dialog', { name: 'Certificado da empresa' });

  await expect(dialogo.getByRole('heading', { name: 'Signer mTLS' })).toBeVisible();

  return dialogo;
};

const enviarCertificado = async (page: Page, empresa: string, arquivo: string, responsavel: string): Promise<void> => {
  await page.getByRole('button', { name: new RegExp(`(Cadastrar|Substituir) .*${empresa}`, 'u') }).first().click();

  const formulario = page.locator('#enviar-certificado');

  await formulario.locator('input[type="file"]').setInputFiles(arquivo);
  await formulario.getByLabel(/Senha do certificado/u).fill(SENHA_DO_PFX);
  await formulario.getByRole('combobox', { name: /Responsável pelo certificado/u }).click();
  await page.getByRole('option', { name: new RegExp(responsavel, 'u') }).click();
  await formulario.getByRole('button', { name: 'Validar e guardar no cofre' }).click();
};

const pelaApi = async (page: Page, caminho: string, opcoes?: { metodo?: 'GET' | 'POST'; corpo?: unknown }) => {
  const resposta = await page.request.fetch(`/api/proxy${caminho}`, {
    method: opcoes?.metodo ?? 'GET',
    ...(opcoes?.corpo === undefined ? {} : { data: opcoes.corpo, headers: { 'content-type': 'application/json' } }),
  });

  return { status: resposta.status(), corpo: (await resposta.json().catch(() => null)) as unknown };
};

// -- Preparação ----------------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);

  await limparEscritorios(pool, [CNPJ_DO_ESCRITORIO, CNPJ_DO_OUTRO_ESCRITORIO]);
  await removerIdentidadesComPrefixo('e2e-f12-');

  tenantId = await criarEscritorio(pool, CNPJ_DO_ESCRITORIO, 'Escritório E2E da F12');
  outroTenantId = await criarEscritorio(pool, CNPJ_DO_OUTRO_ESCRITORIO, 'Outro Escritório E2E da F12');

  adminId = await criarUsuario(pool, tenantId, await criarIdentidade(ADMIN), ADMIN, 'admin_escritorio');
  contadorId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR), CONTADOR, 'contador');
  const deForaId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR_DE_FORA), CONTADOR_DE_FORA, 'contador');
  const auxiliarId = await criarUsuario(pool, tenantId, await criarIdentidade(AUXILIAR), AUXILIAR, 'auxiliar');
  outroAdminId = await criarUsuario(pool, outroTenantId, await criarIdentidade(OUTRO_ADMIN), OUTRO_ADMIN, 'admin_escritorio');

  alfaId = await criarEmpresa(pool, tenantId, CNPJ_DO_A1, NOME_ALFA);
  betaId = await criarEmpresa(pool, tenantId, CNPJ_DA_BETA, NOME_BETA);
  empresaDoOutroEscritorioId = await criarEmpresa(pool, outroTenantId, '45242914000105', 'Empresa de Outro Escritório');

  // Alfa: administradora, contador e auxiliar. Beta: só a administradora e o contador de fora.
  for (const usuario of [adminId, contadorId, auxiliarId]) {
    await vincular(pool, tenantId, usuario, alfaId);
  }
  await vincular(pool, tenantId, adminId, betaId);
  await vincular(pool, tenantId, deForaId, betaId);

  contextoAdmin = await browser.newContext();
  admin = await contextoAdmin.newPage();
  admin.on('response', (resposta) => {
    if (/json|text|html|javascript/u.test(resposta.headers()['content-type'] ?? '')) {
      void resposta.text().then(
        (corpo) => corposRecebidos.push(corpo),
        () => undefined,
      );
    }
  });
  await entrarComo(admin, ADMIN);

  contextoContador = await browser.newContext();
  contador = await contextoContador.newPage();
  await entrarComo(contador, CONTADOR);

  contextoDeFora = await browser.newContext();
  deFora = await contextoDeFora.newPage();
  await entrarComo(deFora, CONTADOR_DE_FORA);

  contextoAuxiliar = await browser.newContext();
  auxiliar = await contextoAuxiliar.newPage();
  await entrarComo(auxiliar, AUXILIAR);
});

test.afterAll(async () => {
  // O que a prova derruba volta, mesmo se ela falhar no meio.
  for (const servico of ['signer', 'duble-esocial']) {
    try {
      docker('start', nomeDoContainer(servico));
    } catch {
      // já está de pé
    }
  }
  await Promise.all([contextoAdmin, contextoContador, contextoDeFora, contextoAuxiliar].map((c) => c.close()));
  await pool.end();
});

// -- Cartão geral e coluna -----------------------------------------------------------------------

test('cartão geral do Signer: operacional, com a última verificação em São Paulo e a latência', async () => {
  await abrirCofre(admin);

  const cartao = cartaoDoSigner(admin);

  await expect(cartao.getByRole('heading', { name: 'Microserviço Signer' })).toBeVisible();
  // O monitor dos workers já verificou o serviço desde que a composição subiu.
  await expect(cartao.getByText('Operacional', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(cartao.getByText(/Verificado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/u)).toBeVisible();
  await expect(cartao.getByText(/^\d+ ms$/u)).toBeVisible();
  await expect(cartao.getByText('Desatualizado')).toHaveCount(0);
});

test('antes do certificado: cada empresa mostra DF-e e eSocial como sem certificado, nunca como operacional', async () => {
  await abrirCofre(admin);

  for (const empresa of [NOME_ALFA, NOME_BETA]) {
    await expect(resumoDaLinha(admin, empresa)).toContainText('Sem certificado', { timeout: 30_000 });
  }

  expect(await eventosDoSigner(alfaId)).toEqual([]);
});

// -- Diagnóstico automático depois do cadastro ---------------------------------------------------

test('cadastrar o A1 agenda DF-e e eSocial: fila, worker, Signer e dublês, sem ação manual', async () => {
  await abrirCofre(admin);
  await enviarCertificado(admin, NOME_ALFA, join(PASTA_PFX, 'valido-com-raiz-no-pfx.pfx'), ADMIN.nome);
  await expect(admin.getByText('Certificado guardado no cofre.').first()).toBeVisible();

  await expect
    .poll(async () => (await eventosDoSigner(alfaId)).length, { timeout: 60_000, intervals: [1_000] })
    .toBeGreaterThanOrEqual(2);

  const eventos = await eventosDoSigner(alfaId);

  expect(eventos.map((e) => e.finalidade).sort()).toEqual(['DFE_TESTE', 'ESOCIAL_TESTE']);
  for (const evento of eventos) {
    expect(evento).toMatchObject({
      resultado: 'SUCESSO',
      codigo: null,
      origem_diagnostico: 'AUTOMATICO',
      // O chamador técnico é o worker, com identidade própria, e não há pessoa por trás.
      identidade_tecnica: 'worker',
      usuario_originador_id: null,
    });
  }

  // O efeito chegou de verdade aos dois dublês, pelo mTLS, com o A1 como certificado cliente.
  expect(efeitosDoDuble('duble-dfe').length).toBeGreaterThanOrEqual(1);
  expect(efeitosDoDuble('duble-esocial').length).toBeGreaterThanOrEqual(1);

  await recarregarAte(admin, '', () => resumoDaLinha(admin, NOME_ALFA).filter({ hasText: 'Operacional' }));
});

// -- Painel detalhado e teste manual -------------------------------------------------------------

test('painel da empresa: estado por finalidade e histórico com os dois diagnósticos automáticos', async () => {
  const dialogo = await abrirPainelDa(admin, alfaId);
  const finalidades = dialogo.getByRole('list', { name: 'Finalidades do Signer mTLS' });

  await expect(finalidades.getByText('DF-e')).toBeVisible();
  await expect(finalidades.getByText('eSocial')).toBeVisible();
  await expect(finalidades.getByText('Operacional')).toHaveCount(2);

  const historico = dialogo.getByRole('list', { name: 'Histórico do Signer' });

  await expect(historico.getByRole('listitem')).toHaveCount(2);
  await expect(historico.getByText('Teste automático')).toHaveCount(2);
  await expect(historico.getByText('Sucesso')).toHaveCount(2);
  // O dado sensível não é exibido nem oferecido: nada para expandir, baixar ou copiar.
  await expect(historico.getByRole('button')).toHaveCount(0);
});

test('Testar mTLS (administradora): progresso sem disparo duplicado, resultado com código de suporte e novo histórico', async () => {
  const antes = efeitosDoDuble('duble-dfe').length;
  const dialogo = await abrirPainelDa(admin, alfaId);

  await dialogo.getByRole('button', { name: 'Testar mTLS' }).click();
  // Em andamento: ocupado e desabilitado, então um segundo clique não dispara outro teste.
  const ocupado = dialogo.getByRole('button', { name: /Testando/u });

  await expect(ocupado).toBeDisabled();

  const resultado = dialogo.getByRole('status', { name: 'Resultado do teste mTLS' });

  await expect(resultado.getByText(/DF-e: teste concluído com sucesso/u)).toBeVisible({ timeout: 30_000 });
  await expect(resultado.getByText(/eSocial: teste concluído com sucesso/u)).toBeVisible();
  await expect(resultado.getByText(/Código de suporte:/u)).toBeVisible();

  const manuais = (await eventosDoSigner(alfaId)).filter((e) => e.origem_diagnostico === 'MANUAL');

  expect(manuais).toHaveLength(2);
  for (const evento of manuais) {
    expect(evento).toMatchObject({ resultado: 'SUCESSO', identidade_tecnica: 'api' });
    expect(evento.usuario_originador_id).toBe(adminId);
  }
  expect(efeitosDoDuble('duble-dfe').length).toBeGreaterThan(antes);

  await expect(dialogo.getByRole('list', { name: 'Histórico do Signer' }).getByRole('listitem')).toHaveCount(4, {
    timeout: 20_000,
  });
});

test('o contador da carteira testa; o contador de fora não vê o painel nem a API o atende', async () => {
  const dialogo = await abrirPainelDa(contador, alfaId);

  await expect(dialogo.getByRole('button', { name: 'Testar mTLS' })).toBeEnabled();

  // Fora da carteira: a API recusa a leitura e o teste, para a empresa de outra carteira e a de outro escritório.
  expect((await pelaApi(deFora, `/empresas/${alfaId}/signer`)).status).toBe(403);
  expect((await pelaApi(deFora, `/empresas/${alfaId}/signer/historico`)).status).toBe(403);
  expect((await pelaApi(deFora, `/empresas/${alfaId}/signer/testes`, { metodo: 'POST', corpo: {} })).status).toBe(403);
  expect((await pelaApi(admin, `/empresas/${empresaDoOutroEscritorioId}/signer`)).status).toBeGreaterThanOrEqual(403);
  expect((await pelaApi(admin, `/empresas/${empresaDoOutroEscritorioId}/signer/testes`, { metodo: 'POST', corpo: {} })).status).toBeGreaterThanOrEqual(403);
  expect(
    (await pelaApi(deFora, `/signer/estados?empresaIds=${alfaId},${betaId}`)).status,
    'lote com uma empresa fora da carteira é recusado inteiro',
  ).toBe(403);
});

test('papel só de consulta ao cofre (auxiliar): nenhum traço do Signer na tela e a API nega', async () => {
  await abrirCofre(auxiliar);

  await expect(cartaoDoSigner(auxiliar)).toHaveCount(0);
  await expect(auxiliar.getByRole('columnheader', { name: 'Signer mTLS' })).toHaveCount(0);
  expect((await pelaApi(auxiliar, '/signer/painel')).status).toBe(403);
  expect((await pelaApi(auxiliar, `/empresas/${alfaId}/signer`)).status).toBe(403);
});

test('empresa sem certificado vigente: o teste não é oferecido e a API devolve a recusa acionável', async () => {
  const dialogo = await abrirPainelDa(admin, betaId);

  await expect(dialogo.getByRole('button', { name: 'Testar mTLS' })).toBeDisabled();
  await expect(dialogo.getByText(/não tem certificado A1 vigente/u).first()).toBeVisible();

  const { status, corpo } = await pelaApi(admin, `/empresas/${betaId}/signer/testes`, { metodo: 'POST', corpo: {} });

  expect(status).toBe(200);
  expect(corpo).toEqual(
    expect.arrayContaining([expect.objectContaining({ resultado: 'FALHA', codigo: 'SIGNER_CERTIFICADO_AUSENTE' })]),
  );
});

// -- Falha acionável de uma finalidade -----------------------------------------------------------

test('dublê do eSocial fora do ar: DF-e segue operacional, eSocial falha com mensagem acionável', async () => {
  docker('stop', nomeDoContainer('duble-esocial'));

  const dialogo = await abrirPainelDa(admin, alfaId);

  await dialogo.getByRole('button', { name: 'Testar mTLS' }).click();

  const resultado = dialogo.getByRole('status', { name: 'Resultado do teste mTLS' });

  await expect(resultado.getByText(/DF-e: teste concluído com sucesso/u)).toBeVisible({ timeout: 40_000 });
  await expect(resultado.getByText(/eSocial: falhou/u)).toBeVisible();
  await expect(resultado.getByText(/destino simulado não respondeu/u)).toBeVisible();
  // A falha de UMA finalidade não equivale à indisponibilidade do serviço.
  await expect(cartaoDoSigner(admin).getByText('Indisponível')).toHaveCount(0);

  await recarregarAte(admin, '', () => resumoDaLinha(admin, NOME_ALFA).filter({ hasText: 'Falha' }));

  const proibido = await admin.getByRole('table').textContent();

  expect(proibido).not.toContain('SIGNER_DESTINO_INDISPONIVEL');

  docker('start', nomeDoContainer('duble-esocial'));
});

// -- Incidente e recuperação ---------------------------------------------------------------------

test('Signer parado: o incidente abre uma vez, alerta só a administradora e fica fora da Central de Pendências', async () => {
  const pendenciasAntes = await pendenciasAbertas();

  // A tela já está aberta e com o estado de cada empresa quando o Signer cai.
  await abrirCofre(admin);
  await expect(resumoDaLinha(admin, NOME_ALFA)).toBeVisible({ timeout: 30_000 });

  docker('stop', nomeDoContainer('signer'));

  await expect
    .poll(async () => (await notificacoesDoSigner(adminId)).map((n) => n.tipo), {
      timeout: 150_000,
      intervals: [1_000],
    })
    .toEqual(['INDISPONIBILIDADE']);

  // Mais falhas do MESMO incidente não duplicam o alerta.
  await new Promise((resolver) => setTimeout(resolver, 25_000));
  expect((await notificacoesDoSigner(adminId)).map((n) => n.tipo)).toEqual(['INDISPONIBILIDADE']);

  // Só administrador ativo: contador, auxiliar e o administrador de OUTRO escritório (sem A1 vigente) não recebem.
  expect(await notificacoesDoSigner(contadorId)).toEqual([]);
  expect(await notificacoesDoSigner(outroAdminId)).toEqual([]);

  // Volta o foco à aba: a tela relê o cartão (que vem do banco) e o estado das empresas (que o
  // Signer parado não responde), sem recarregar a página e sem perder o que já mostrava.
  await admin.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(cartaoDoSigner(admin).getByText('Incidente em andamento')).toBeVisible({ timeout: 20_000 });
  await expect(cartaoDoSigner(admin).getByText('Indisponível', { exact: true })).toBeVisible();

  await cartaoDoSigner(admin).getByRole('button', { name: 'Ver detalhe do incidente' }).click();
  await expect(cartaoDoSigner(admin).getByText(/três verificações seguidas sem resposta/u)).toBeVisible();

  await admin.getByRole('button', { name: /notifica/iu }).click();
  const sino = admin.getByRole('dialog');

  await expect(sino.getByText('Microserviço Signer')).toBeVisible();
  await expect(sino.getByText(/Signer indisponível/u)).toBeVisible();
  await admin.keyboard.press('Escape');

  expect(await pendenciasAbertas(), 'a indisponibilidade não cria pendência').toBe(pendenciasAntes);

  // Falha de comunicação com o Signer: o último estado conhecido de cada empresa continua na tela,
  // marcado como desatualizado, em vez de sumir ou de virar "operacional".
  const resumo = resumoDaLinha(admin, NOME_ALFA);

  await expect(resumo).toBeVisible();
  await expect(resumo).toContainText('Desatualizado', { timeout: 20_000 });

  // Uma página nova, sem estado anterior, diz que o estado está indisponível agora (nunca inventa um).
  await abrirCofre(admin);
  await expect(linhaDa(admin, NOME_ALFA).getByText('Estado indisponível agora')).toBeVisible({ timeout: 20_000 });
});

test('Signer de volta: a primeira verificação válida encerra o incidente e avisa a recuperação com a duração', async () => {
  docker('start', nomeDoContainer('signer'));

  await expect
    .poll(async () => (await notificacoesDoSigner(adminId)).map((n) => n.tipo), {
      timeout: 90_000,
      intervals: [1_000],
    })
    .toEqual(['INDISPONIBILIDADE', 'RECUPERACAO']);

  const [, recuperacao] = await notificacoesDoSigner(adminId);

  expect(Number(recuperacao?.duracao_ms)).toBeGreaterThan(0);

  await recarregarAte(admin, '', () => cartaoDoSigner(admin).getByText('Operacional', { exact: true }));
  await expect(cartaoDoSigner(admin).getByText('Incidente em andamento')).toHaveCount(0);

  await admin.getByRole('button', { name: /notifica/iu }).click();
  await expect(admin.getByRole('dialog').getByText(/Signer recuperado/u)).toBeVisible();
  await expect(admin.getByRole('dialog').getByText(/Ficou indisponível por/u)).toBeVisible();
  await admin.keyboard.press('Escape');
});

// -- Certificado desativado ----------------------------------------------------------------------

test('desativar o certificado: o Signer recusa com código específico e o painel deixa de oferecer o teste', async () => {
  const desativacao = await pelaApi(admin, `/empresas/${alfaId}/certificados/vigente/desativacao`, {
    metodo: 'POST',
    corpo: { motivo: 'Prova E2E da F12: certificado desativado' },
  });

  expect(desativacao.status).toBeLessThan(300);

  const { status, corpo } = await pelaApi(admin, `/empresas/${alfaId}/signer/testes`, { metodo: 'POST', corpo: {} });

  expect(status).toBe(200);
  expect(corpo).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resultado: 'FALHA',
        codigo: expect.stringMatching(/^SIGNER_CERTIFICADO_(AUSENTE|DESATIVADO)$/u) as string,
      }),
    ]),
  );

  const dialogo = await abrirPainelDa(admin, alfaId);

  await expect(dialogo.getByRole('button', { name: 'Testar mTLS' })).toBeDisabled();
  // O que já foi feito segue na trilha: a desativação não apaga histórico.
  expect((await eventosDoSigner(alfaId)).filter((e) => e.resultado === 'SUCESSO').length).toBeGreaterThanOrEqual(4);
});

// -- Segredo -------------------------------------------------------------------------------------

test('nenhum segredo nas respostas, nas páginas nem nos eventos do Signer', async () => {
  const tokenDoSigner = readFileSync(join(PASTA_LOCAL, 'token-signer-leitura'), 'utf8').trim();
  const proibidos = [SENHA_DO_PFX, tokenDoSigner, 'BEGIN PRIVATE KEY', 'BEGIN CERTIFICATE', '<Signature', 'kv/data', 'referenciaSegredo'];

  for (const termo of proibidos) {
    expect(
      corposRecebidos.filter((corpo) => corpo.includes(termo)).length,
      `"${termo.slice(0, 12)}…" apareceu em resposta ao navegador`,
    ).toBe(0);
  }

  // Os logs dos serviços tampouco: senha, token e chave não são escritos.
  for (const servico of ['signer', 'api', 'workers', 'duble-dfe', 'duble-esocial']) {
    const logs = logsDe(servico);

    for (const termo of [SENHA_DO_PFX, tokenDoSigner, 'BEGIN PRIVATE KEY']) {
      expect(logs.includes(termo), `"${termo.slice(0, 12)}…" nos logs de ${servico}`).toBe(false);
    }
  }
});

// -- Provas visuais ------------------------------------------------------------------------------

test('provas visuais: cartão, coluna e painel nos dois temas e nos três viewports, sem rolagem horizontal', async () => {
  const pastaBase = `test-results/${ESCOPO}/e2e/screenshots/spec-012`;

  // Estado rico para a captura: A1 vigente de volta na Alfa, com histórico e um estado por finalidade.
  await abrirCofre(admin);
  await enviarCertificado(admin, NOME_ALFA, join(PASTA_PFX, 'valido-aes256.pfx'), ADMIN.nome);
  await expect(admin.getByText('Certificado guardado no cofre.').first()).toBeVisible();
  await recarregarAte(admin, '', () => resumoDaLinha(admin, NOME_ALFA).filter({ hasText: 'Operacional' }), 90_000);

  for (const tema of ['claro', 'escuro'] as const) {
    mkdirSync(`${pastaBase}/${tema}`, { recursive: true });
    await admin.evaluate((valor) => localStorage.setItem('contaia-theme', valor), tema === 'claro' ? 'light' : 'dark');

    for (const largura of [768, 1024, 1440]) {
      await admin.setViewportSize({ width: largura, height: 900 });
      await abrirCofre(admin);
      await expect(admin.locator('html')).toHaveAttribute('data-theme', tema === 'claro' ? 'light' : 'dark');
      await expect(cartaoDoSigner(admin).getByText('Operacional', { exact: true })).toBeVisible();
      // Abaixo de 1024px a tabela vira cartões: o resumo existe nos dois formatos.
      await expect(admin.getByRole('group', { name: 'Resumo do Signer mTLS' }).first()).toBeVisible({ timeout: 20_000 });
      await admin.screenshot({ path: `${pastaBase}/${tema}/cofre-signer-${largura}.png`, fullPage: true });

      const dialogo = await abrirPainelDa(admin, alfaId);

      await expect(dialogo.getByRole('list', { name: 'Histórico do Signer' })).toBeVisible();
      // O painel é fixo na altura da janela e rola por dentro: uma janela alta mostra o histórico.
      await admin.setViewportSize({ width: largura, height: 1600 });
      await admin.screenshot({ path: `${pastaBase}/${tema}/painel-signer-${largura}.png` });
      await admin.setViewportSize({ width: largura, height: 900 });

      expect(
        await admin.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        `rolagem horizontal em ${tema} ${largura}px`,
      ).toBe(false);

      // `Esc` fecha o painel e o foco volta para a tela (o painel prende o foco enquanto aberto).
      await admin.keyboard.press('Escape');
      await expect(admin.getByRole('dialog', { name: 'Certificado da empresa' })).toHaveCount(0);
    }
  }

  await admin.setViewportSize({ width: 1280, height: 720 });
});

test('nenhum artefato da execução contém a senha do certificado nem o token do Vault', async () => {
  const raiz = resolve(`test-results/${ESCOPO}`);
  const tokenDoSigner = readFileSync(join(PASTA_LOCAL, 'token-signer-leitura'), 'utf8').trim();
  const achados: string[] = [];

  const varrer = (pasta: string): void => {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome);

      if (statSync(caminho).isDirectory()) {
        varrer(caminho);
      } else if (/\.(json|xml|txt|log|md|html|svg|yml)$/u.test(nome)) {
        const conteudo = readFileSync(caminho, 'utf8');

        if (conteudo.includes(SENHA_DO_PFX) || conteudo.includes(tokenDoSigner)) {
          achados.push(caminho);
        }
      }
    }
  };

  try {
    varrer(raiz);
  } catch {
    // Sem pasta de resultados ainda: nada a varrer.
  }

  expect(achados).toEqual([]);
});
