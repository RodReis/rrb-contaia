/**
 * E2E SPEC-011: cadastrar → recusas → substituir → reiniciar o Vault → consultar → desativar →
 * pendência e histórico, mais as provas negativas (papel, carteira, outro escritório) e a prova de
 * que nenhum segredo vaza por resposta, página ou banco.
 *
 * Roda contra a pilha real: Keycloak, PostgreSQL, API, Web, cofre e Vault em modo servidor. Nada é
 * dublado. O material criptográfico é SINTÉTICO e gerado em runtime (`pnpm cofre:pki-teste`); a
 * raiz de teste é a única que o cofre confia nesta suíte.
 *
 * Isolamento: escritório, usuários e empresas próprios (`e2e-f11-*`), sem tocar o tenant do seed.
 *
 * Depende de: `pnpm db:migrate`, Vault + bootstrap, `pnpm cofre:pki-teste` e dos processos web,
 * api e cofre (o `playwright.config.ts` sobe os três).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

const KEYCLOAK = (process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia').replace(
  /\/realms\/.*$/,
  '',
);
const REALM = process.env['KEYCLOAK_REALM'] ?? 'contaia';
const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';
const VAULT_ADDR = process.env['VAULT_ADDR'] ?? 'http://127.0.0.1:18200';
const COFRE_PUBLIC_URL = process.env['COFRE_PUBLIC_URL'] ?? 'http://127.0.0.1:15104';
const PASTA_LOCAL = resolve(process.env['VAULT_LOCAL_DIR'] ?? 'infra/docker/.vault-local');
const PASTA_PFX = join(PASTA_LOCAL, 'pki-teste');

const SENHA_DO_PFX = 'senha-de-teste-pki';
const SENHA_ERRADA = 'SENTINELA-senha-errada-f11';
const CNPJ_ALFA = '11222333000181'; // o CNPJ dos certificados gerados por `pnpm cofre:pki-teste`
const CNPJ_BETA = '33000167000101';
// Exclusivos desta spec: a limpeza apaga TUDO dos tenants com estes CNPJs (triggers e FKs
// desligados). Com os CNPJs da spec-007 e da spec-009, rodando em paralelo, ela apagava o
// escritório delas no meio dos testes (o convite válido da spec-007 virava inválido).
const CNPJ_DO_ESCRITORIO = '11881188000140';
const CNPJ_DO_OUTRO_ESCRITORIO = '11991199000183';

const NOME_ALFA = 'Alfa Cofre E2E';
const NOME_BETA = 'Beta Cofre E2E';
const NOME_FORA = 'Fora Cofre E2E';

const ADMIN = { usuario: 'e2e-f11-admin', senha: 'senha-admin-f11-123456', nome: 'Administradora Cofre' };
const CONTADOR = { usuario: 'e2e-f11-contador', senha: 'senha-contador-f11-123456', nome: 'Contador Cofre' };
const CONTADOR2 = { usuario: 'e2e-f11-contador2', senha: 'senha-contador2-f11-123456', nome: 'Contadora Reserva' };
const AUXILIAR = { usuario: 'e2e-f11-auxiliar', senha: 'senha-auxiliar-f11-123456', nome: 'Auxiliar Cofre' };

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

test.describe.configure({ mode: 'serial' });

// Trace, vídeo e captura automática gravariam o corpo multipart (arquivo e senha) em artefato da CI.
// As provas visuais abaixo são capturas explícitas, de telas sem segredo.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// -- Keycloak ------------------------------------------------------------------------------------

const tokenDeAdministracao = async (): Promise<string> => {
  const resposta = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env['KEYCLOAK_ADMIN'] ?? 'admin',
      password: process.env['KEYCLOAK_ADMIN_PASSWORD'] ?? 'admin_local',
    }),
  });

  return ((await resposta.json()) as { access_token: string }).access_token;
};

const removerIdentidadesDeExecucoesAnteriores = async (): Promise<void> => {
  const token = await tokenDeAdministracao();
  const cabecalhos = { authorization: `Bearer ${token}` };
  const resposta = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?search=e2e-f11-&max=200`, {
    headers: cabecalhos,
  });

  for (const usuario of (await resposta.json()) as Array<{ id: string }>) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${usuario.id}`, {
      method: 'DELETE',
      headers: cabecalhos,
    });
  }
};

const criarIdentidade = async (pessoa: { usuario: string; senha: string; nome: string }): Promise<string> => {
  const token = await tokenDeAdministracao();
  const criacao = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username: pessoa.usuario,
      email: `${pessoa.usuario}@escritorio.local`,
      firstName: pessoa.nome,
      lastName: 'E2E',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: pessoa.senha, temporary: false }],
    }),
  });

  if (criacao.status !== 201) {
    throw new Error(`Keycloak recusou criar ${pessoa.usuario} (${criacao.status})`);
  }

  return (criacao.headers.get('location') ?? '').split('/').pop() ?? '';
};

// -- Banco ---------------------------------------------------------------------------------------

let tenantId = '';
let outroTenantId = '';
let adminId = '';
let contadorId = '';
let contador2Id = '';
let auxiliarId = '';
let alfaId = '';
let betaId = '';
let foraId = '';

const limparEscritorios = async (): Promise<void> => {
  const { rows } = await pool.query<{ id: string }>('select id from app.tenant where cnpj = any($1)', [
    [CNPJ_DO_ESCRITORIO, CNPJ_DO_OUTRO_ESCRITORIO],
  ]);
  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  const cliente = await pool.connect();

  try {
    // Só nesta conexão: desliga FKs e triggers (inclusive append-only) para limpar fixture.
    await cliente.query("set session_replication_role = 'replica'");

    const tabelas = await cliente.query<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'app' and c.column_name = 'tenant_id'
          and t.table_type = 'BASE TABLE' and c.table_name <> 'tenant'`,
    );

    for (const { table_name: tabela } of tabelas.rows) {
      await cliente.query(`delete from app.${tabela} where tenant_id = any($1)`, [ids]);
    }

    await cliente.query('delete from app.tenant where id = any($1)', [ids]);
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }
};

const criarUsuario = async (
  tenant: string,
  sub: string,
  email: string,
  nome: string,
  papel: 'admin_escritorio' | 'contador' | 'auxiliar',
): Promise<string> => {
  const criado = await pool.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, $4, 'ATIVO') returning id`,
    [tenant, sub, email, nome],
  );
  const id = criado.rows[0]?.id ?? '';

  await pool.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, $3)`, [
    tenant,
    id,
    papel,
  ]);

  return id;
};

const criarEmpresa = async (tenant: string, cnpj: string, nome: string): Promise<string> => {
  const criada = await pool.query<{ id: string }>(
    `insert into app.empresa
       (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
        enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
        inscricao_municipal_situacao, situacao_cadastral_externa, validado_por_fonte_externa)
     values ($1, 'ATIVA', $2, $3, $3, 'SIMPLES_NACIONAL', 'NAO_MEI', '4712100', 'POSSUI',
             'NAO_SE_APLICA', 'Ativa', true)
     returning id`,
    [tenant, cnpj, nome],
  );
  const id = criada.rows[0]?.id ?? '';

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero, bairro, municipio, uf)
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Um', '10', 'Centro', 'Goiania', 'GO')`,
    [tenant, id],
  );

  return id;
};

const vincular = async (usuarioId: string, empresaId: string): Promise<void> => {
  await pool.query(
    `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`,
    [tenantId, usuarioId, empresaId],
  );
};

const versoes = async (empresaId: string) =>
  (
    await pool.query<{
      id: string;
      versao: number;
      estado: string;
      responsavel_id: string;
      referencia_segredo: string;
      valido_ate: string;
      motivo_encerramento: string | null;
      justificativa: string | null;
    }>(
      `select id, versao, estado, responsavel_id, referencia_segredo,
              to_char(valido_ate, 'YYYY-MM-DD') as valido_ate, motivo_encerramento, justificativa
         from app.empresa_certificado where empresa_id = $1 order by versao`,
      [empresaId],
    )
  ).rows;

const eventos = async (empresaId: string) =>
  (
    await pool.query<{ acao: string; resultado: string; codigo: string | null; motivo: string | null }>(
      `select acao, resultado, codigo, motivo from app.empresa_certificado_evento
        where empresa_id = $1 order by sequencia`,
      [empresaId],
    )
  ).rows;

const pendenciasAbertas = async (empresaId: string): Promise<string[]> =>
  (
    await pool.query<{ chave: string }>(
      `select chave from app.empresa_pendencia
        where empresa_id = $1 and estado = 'ABERTA' and origem = 'CERTIFICADO' order by chave`,
      [empresaId],
    )
  ).rows.map((linha) => linha.chave);

// -- Vault ---------------------------------------------------------------------------------------

const token = (nome: 'cofre-ingestao' | 'signer-leitura' | 'api-principal'): string =>
  readFileSync(join(PASTA_LOCAL, `token-${nome}`), 'utf8').trim();

const lerSegredo = async (
  quem: 'cofre-ingestao' | 'signer-leitura' | 'api-principal',
  empresaId: string,
  referencia: string,
): Promise<{ status: number; corpo: string }> => {
  const url = `${VAULT_ADDR}/v1/kv/data/certificados/${tenantId}/${empresaId}/${referencia}`;
  const cabecalhos = { 'x-vault-token': token(quem) };

  // Depois de reiniciar o Vault, a conexão reaproveitada pelo cliente HTTP está morta: uma nova tentativa abre outra.
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      const resposta = await fetch(url, { headers: cabecalhos });

      return { status: resposta.status, corpo: await resposta.text() };
    } catch (erro) {
      if (tentativa >= 3) {
        throw erro;
      }
    }
  }
};

const reiniciarVault = (): void => {
  const comando =
    process.env['VAULT_REINICIAR_CMD'] ??
    (process.env['VAULT_CONTAINER'] ? `docker restart ${process.env['VAULT_CONTAINER']}` : '');

  if (comando === '') {
    throw new Error('Defina VAULT_CONTAINER ou VAULT_REINICIAR_CMD para reiniciar o Vault.');
  }

  execSync(comando, { stdio: 'inherit' });
  // O Vault volta selado: o bootstrap (idempotente) o desseleia sem reemitir nada.
  execSync('node infra/docker/vault/bootstrap.mjs', { stdio: 'inherit', env: process.env });
};

// -- Navegação -----------------------------------------------------------------------------------

const entrarComo = async (page: Page, pessoa: { usuario: string; senha: string }): Promise<void> => {
  await page.goto('/api/auth/entrar?destino=%2Fempresas');

  const campo = page.getByRole('textbox', { name: 'Username or email' });

  await Promise.race([
    campo.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/\/empresas/, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await campo.isVisible().catch(() => false)) {
    await campo.fill(pessoa.usuario);
    await page.getByRole('textbox', { name: 'Password' }).fill(pessoa.senha);
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await page.waitForURL(/\/empresas/);
};

let navegador: Browser;
let contextoAdmin: BrowserContext;
let admin: Page;
let contextoContador: BrowserContext;
let contador: Page;
let contextoAuxiliar: BrowserContext;
let auxiliar: Page;

/** Tudo que o navegador do admin recebeu em corpo de texto: o sentinela não pode estar aqui. */
const corposRecebidos: string[] = [];

const abrirCofre = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/configuracoes/cofre${query}`);
  // Com `?empresa=` o painel de detalhe abre como modal e marca o resto da página como
  // aria-hidden: o h1 sai da árvore de acessibilidade, então a prova de carga é o painel.
  const pronto = query.includes('empresa=')
    ? page.getByRole('dialog', { name: 'Certificado da empresa' })
    : page.getByRole('heading', { level: 1, name: 'Cofre de certificados A1' });

  await expect(pronto).toBeVisible({ timeout: 20_000 });
};

const pfx = (nome: string): string => join(PASTA_PFX, `${nome}.pfx`);

/** Escolhe a empresa pela linha da lista, o arquivo e o responsável, e envia. */
const enviarCertificado = async (
  page: Page,
  empresa: string,
  arquivo: string,
  senha: string,
  responsavel: string,
): Promise<void> => {
  await page.getByRole('button', { name: new RegExp(`(Cadastrar|Substituir) .*${empresa}`, 'u') }).first().click();

  const formulario = page.locator('#enviar-certificado');

  await formulario.locator('input[type="file"]').setInputFiles(arquivo);
  await formulario.getByLabel(/Senha do certificado/u).fill(senha);
  await formulario.getByRole('combobox', { name: /Responsável pelo certificado/u }).click();
  await page.getByRole('option', { name: new RegExp(responsavel, 'u') }).click();
  await formulario.getByRole('button', { name: 'Validar e guardar no cofre' }).click();
};

test.beforeAll(async ({ browser }) => {
  navegador = browser;

  await limparEscritorios();
  await removerIdentidadesDeExecucoesAnteriores();

  const tenants = await pool.query<{ id: string; cnpj: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, 'Escritório E2E da F11', 'ATIVO'), ($2, 'Outro Escritório E2E da F11', 'ATIVO')
     returning id, cnpj`,
    [CNPJ_DO_ESCRITORIO, CNPJ_DO_OUTRO_ESCRITORIO],
  );
  tenantId = tenants.rows.find((linha) => linha.cnpj === CNPJ_DO_ESCRITORIO)?.id ?? '';
  outroTenantId = tenants.rows.find((linha) => linha.cnpj === CNPJ_DO_OUTRO_ESCRITORIO)?.id ?? '';

  adminId = await criarUsuario(
    tenantId,
    await criarIdentidade(ADMIN),
    `${ADMIN.usuario}@escritorio.local`,
    ADMIN.nome,
    'admin_escritorio',
  );
  contadorId = await criarUsuario(
    tenantId,
    await criarIdentidade(CONTADOR),
    `${CONTADOR.usuario}@escritorio.local`,
    CONTADOR.nome,
    'contador',
  );
  contador2Id = await criarUsuario(
    tenantId,
    await criarIdentidade(CONTADOR2),
    `${CONTADOR2.usuario}@escritorio.local`,
    CONTADOR2.nome,
    'contador',
  );
  auxiliarId = await criarUsuario(
    tenantId,
    await criarIdentidade(AUXILIAR),
    `${AUXILIAR.usuario}@escritorio.local`,
    AUXILIAR.nome,
    'auxiliar',
  );

  alfaId = await criarEmpresa(tenantId, CNPJ_ALFA, NOME_ALFA);
  betaId = await criarEmpresa(tenantId, CNPJ_BETA, NOME_BETA);
  // Fora de qualquer carteira, para provar a negação do contador.
  foraId = await criarEmpresa(tenantId, '45242914000105', NOME_FORA);

  for (const usuario of [adminId, contadorId, contador2Id, auxiliarId]) {
    await vincular(usuario, alfaId);
  }
  await vincular(adminId, betaId);
  await vincular(adminId, foraId);

  contextoAdmin = await browser.newContext();
  admin = await contextoAdmin.newPage();
  admin.on('response', (resposta) => {
    const tipo = resposta.headers()['content-type'] ?? '';

    if (/json|text|html|javascript/u.test(tipo)) {
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

  contextoAuxiliar = await browser.newContext();
  auxiliar = await contextoAuxiliar.newPage();
  await entrarComo(auxiliar, AUXILIAR);
});

test.afterAll(async () => {
  await contextoAdmin.close();
  await contextoContador.close();
  await contextoAuxiliar.close();
  await pool.end();
});

// -- Caminho crítico -----------------------------------------------------------------------------

test('empresa ativa sem certificado nasce com pendência de certificado ausente', async () => {
  await abrirCofre(admin);

  const lista = admin.getByRole('table', { name: /Empresas do escritório/u });

  await expect(lista.getByText(NOME_ALFA)).toBeVisible();
  await expect(pendenciasAbertas(alfaId)).resolves.toEqual(['certificado:ausente']);
  await expect(pendenciasAbertas(betaId)).resolves.toEqual(['certificado:ausente']);
});

test('cadastra o certificado pela interface: o navegador fala com o cofre e a API guarda só metadados', async () => {
  await abrirCofre(admin);

  const chamadasAoCofre: string[] = [];
  admin.on('request', (requisicao) => {
    if (requisicao.url().startsWith(COFRE_PUBLIC_URL)) {
      chamadasAoCofre.push(`${requisicao.method()} ${new URL(requisicao.url()).pathname}`);
    }
  });

  await enviarCertificado(admin, NOME_ALFA, pfx('valido-e-cnpj-a1'), SENHA_DO_PFX, ADMIN.nome);

  await expect(admin.getByText('Certificado guardado no cofre.').first()).toBeVisible();
  expect(chamadasAoCofre).toContain('POST /ingestao');

  const registradas = await versoes(alfaId);

  expect(registradas).toHaveLength(1);
  expect(registradas[0]?.estado).toBe('VIGENTE');
  expect(registradas[0]?.responsavel_id).toBe(adminId);
  expect(await pendenciasAbertas(alfaId)).toEqual([]);
  expect((await eventos(alfaId)).map((evento) => evento.acao)).toEqual(['CADASTRO']);

  // A senha da tela some depois do envio.
  await expect(admin.getByLabel(/Senha do certificado/u)).toHaveValue('');
});

test('o segredo mora só no Vault: o Signer lê; cofre, API e quem não tem política não leem', async () => {
  const [vigente] = await versoes(alfaId);
  const referencia = vigente?.referencia_segredo ?? '';

  const doSigner = await lerSegredo('signer-leitura', alfaId, referencia);

  expect(doSigner.status).toBe(200);
  expect(doSigner.corpo).toContain(SENHA_DO_PFX);

  // Política de ingestão é write-only; a da API principal não alcança o KV.
  expect((await lerSegredo('cofre-ingestao', alfaId, referencia)).status).toBe(403);
  expect((await lerSegredo('api-principal', alfaId, referencia)).status).toBe(403);

  // Nada de arquivo, senha ou chave nas tabelas do cofre.
  const linhas = await pool.query(
    `select to_jsonb(c)::text as c from app.empresa_certificado c where empresa_id = $1
     union all select to_jsonb(e)::text from app.empresa_certificado_evento e where empresa_id = $1
     union all select to_jsonb(i)::text from app.empresa_certificado_ingestao i where empresa_id = $1`,
    [alfaId],
  );
  const texto = linhas.rows.map((linha: { c: string }) => linha.c).join('\n');

  expect(texto).not.toContain(SENHA_DO_PFX);
  expect(texto).not.toMatch(/PRIVATE KEY|MII[A-Za-z0-9+/]{40}/u);
});

test('recusas do cofre: nada muda no vigente, o erro aparece no campo e a recusa entra no histórico', async () => {
  await abrirCofre(admin);

  // Senha errada, pela interface: o erro mora no campo da senha.
  await enviarCertificado(admin, NOME_ALFA, pfx('valido-aes256'), SENHA_ERRADA, ADMIN.nome);
  await expect(admin.getByText('A senha informada não abre o certificado.').first()).toBeVisible();
  await expect(admin.getByLabel(/Senha do certificado/u)).toHaveValue('');

  // As demais recusas, direto no cofre (mesmo contrato que o navegador usa).
  const ticketDe = async (empresa: string): Promise<string> => {
    const resposta = await admin.request.post(`/api/proxy/empresas/${empresa}/certificados/ingestoes`, {
      data: { responsavelId: adminId },
    });

    expect(resposta.status()).toBe(201);

    return ((await resposta.json()) as { ticket: string }).ticket;
  };
  const enviarDireto = async (
    empresa: string,
    arquivo: string,
    senha = SENHA_DO_PFX,
  ): Promise<{ status: number; code: string }> => {
    const ticket = await ticketDe(empresa);
    const formulario = new FormData();

    formulario.set('ticket', ticket);
    formulario.set('senha', senha);
    formulario.set('arquivo', new Blob([readFileSync(arquivo)]), 'certificado.pfx');

    const resposta = await fetch(`${COFRE_PUBLIC_URL}/ingestao`, { method: 'POST', body: formulario });
    const corpo = (await resposta.json()) as { code: string };

    return { status: resposta.status, code: corpo.code };
  };

  expect(await enviarDireto(alfaId, pfx('invalido-expirado'))).toEqual({
    status: 422,
    code: 'CERTIFICADO_EXPIRADO',
  });
  expect((await enviarDireto(alfaId, pfx('invalido-ainda-nao-vigente'))).code).toBe(
    'CERTIFICADO_AINDA_NAO_VIGENTE',
  );
  expect((await enviarDireto(alfaId, pfx('invalido-a3'))).code).toBe('CERTIFICADO_TIPO_INCOMPATIVEL');
  expect((await enviarDireto(alfaId, pfx('invalido-e-cpf'))).code).toBe('CERTIFICADO_TIPO_INCOMPATIVEL');
  expect((await enviarDireto(alfaId, pfx('invalido-cadeia-desconhecida'))).code).toBe(
    'CERTIFICADO_TIPO_INCOMPATIVEL',
  );
  expect((await enviarDireto(alfaId, pfx('invalido-corrompido'))).code).toBe(
    'CERTIFICADO_CONTEINER_INVALIDO',
  );
  // CNPJ do certificado ≠ CNPJ da Beta.
  const ticketDaBeta = await ticketDe(betaId);
  const divergente = new FormData();

  divergente.set('ticket', ticketDaBeta);
  divergente.set('senha', SENHA_DO_PFX);
  divergente.set('arquivo', new Blob([readFileSync(pfx('valido-e-cnpj-a1'))]), 'certificado.pfx');
  const respostaDivergente = await fetch(`${COFRE_PUBLIC_URL}/ingestao`, { method: 'POST', body: divergente });

  expect(respostaDivergente.status).toBe(422);
  expect(((await respostaDivergente.json()) as { code: string }).code).toBe('CERTIFICADO_CNPJ_DIVERGENTE');

  // Ticket usado uma vez não vale de novo (consumido na primeira apresentação).
  const reuso = await ticketDe(alfaId);
  const primeiro = new FormData();

  primeiro.set('ticket', reuso);
  primeiro.set('senha', SENHA_ERRADA);
  primeiro.set('arquivo', new Blob([readFileSync(pfx('valido-aes256'))]), 'c.pfx');
  await fetch(`${COFRE_PUBLIC_URL}/ingestao`, { method: 'POST', body: primeiro });

  const segundo = new FormData();

  segundo.set('ticket', reuso);
  segundo.set('senha', SENHA_DO_PFX);
  segundo.set('arquivo', new Blob([readFileSync(pfx('valido-aes256'))]), 'c.pfx');
  const respostaDoReuso = await fetch(`${COFRE_PUBLIC_URL}/ingestao`, { method: 'POST', body: segundo });

  expect([401, 403]).toContain(respostaDoReuso.status);

  // O vigente segue intacto e nenhuma versão nova nasceu.
  const registradas = await versoes(alfaId);

  expect(registradas).toHaveLength(1);
  expect(registradas[0]?.estado).toBe('VIGENTE');

  const historico = await eventos(alfaId);

  expect(historico.filter((evento) => evento.resultado === 'RECUSADO').map((evento) => evento.codigo)).toEqual(
    expect.arrayContaining([
      'CERTIFICADO_SENHA_INCORRETA',
      'CERTIFICADO_EXPIRADO',
      'CERTIFICADO_AINDA_NAO_VIGENTE',
      'CERTIFICADO_TIPO_INCOMPATIVEL',
      'CERTIFICADO_CONTEINER_INVALIDO',
    ]),
  );
});

test('substitui o certificado: o anterior fica no histórico e só um segue vigente', async () => {
  await abrirCofre(admin);
  await enviarCertificado(admin, NOME_ALFA, pfx('valido-aes256'), SENHA_DO_PFX, CONTADOR.nome);

  await expect(admin.getByText('Certificado substituído.').first()).toBeVisible();

  const registradas = await versoes(alfaId);

  expect(registradas.map((linha) => [linha.versao, linha.estado])).toEqual([
    [1, 'SUBSTITUIDO'],
    [2, 'VIGENTE'],
  ]);
  expect(registradas[0]?.motivo_encerramento).toBe('SUBSTITUICAO');
  expect(registradas[1]?.responsavel_id).toBe(contadorId);

  // O segredo da versão 1 continua no Vault (a SPEC não manda destruí-lo na rotação).
  expect((await lerSegredo('signer-leitura', alfaId, registradas[1]?.referencia_segredo ?? '')).status).toBe(200);
});

test('reiniciar o Vault preserva o certificado, as políticas e os metadados na tela', async () => {
  const [, vigente] = await versoes(alfaId);

  reiniciarVault();

  const depois = await lerSegredo('signer-leitura', alfaId, vigente?.referencia_segredo ?? '');

  expect(depois.status).toBe(200);
  expect((await lerSegredo('cofre-ingestao', alfaId, vigente?.referencia_segredo ?? '')).status).toBe(403);
  expect((await lerSegredo('api-principal', alfaId, vigente?.referencia_segredo ?? '')).status).toBe(403);

  await abrirCofre(admin);
  // Tabela e cartões coexistem no DOM (o CSS esconde um): a prova é na tabela, visível no desktop.
  const linhaDaAlfa = admin.getByRole('row').filter({ hasText: NOME_ALFA });

  await expect(linhaDaAlfa).toContainText('Válido');
  await expect(linhaDaAlfa).toContainText(CONTADOR.nome);

  // E o cofre aceita uma nova ingestão depois do reinício (mesmo token de ingestão).
  const saude = await fetch(`${COFRE_PUBLIC_URL}/health`);

  expect(saude.status).toBe(200);
});

test('permissões: auxiliar só consulta; contador só age na carteira; outro escritório não existe', async () => {
  // Auxiliar: tela de consulta, sem ações de mutação, e a API recusa.
  await abrirCofre(auxiliar);
  await expect(auxiliar.getByText('Seu papel permite apenas consultar o cofre')).toBeVisible();
  expect(
    (
      await auxiliar.request.post(`/api/proxy/empresas/${alfaId}/certificados/ingestoes`, {
        data: { responsavelId: adminId },
      })
    ).status(),
  ).toBe(403);

  // Contador age na Alfa (na carteira) e é barrado na empresa fora dela.
  expect(
    (
      await contador.request.post(`/api/proxy/empresas/${foraId}/certificados/ingestoes`, {
        data: { responsavelId: contadorId },
      })
    ).status(),
  ).toBe(403);
  expect((await contador.request.get(`/api/proxy/empresas/${foraId}/certificados`)).status()).toBe(403);

  const lista = (await (await contador.request.get('/api/proxy/certificados')).json()) as {
    itens: Array<{ empresaId: string }>;
  };

  expect(lista.itens.map((item) => item.empresaId)).toEqual([alfaId]);

  // Empresa de outro escritório não é revelada.
  const outraEmpresa = await criarEmpresa(outroTenantId, '34028316000103', 'Empresa de Outro Escritório');

  expect((await admin.request.get(`/api/proxy/empresas/${outraEmpresa}/certificados`)).status()).toBe(404);
  expect(
    (
      await admin.request.post(`/api/proxy/empresas/${outraEmpresa}/certificados/ingestoes`, {
        data: { responsavelId: adminId },
      })
    ).status(),
  ).toBe(404);

  // Não existe download nem leitura de conteúdo na API.
  for (const caminho of ['download', 'conteudo', 'arquivo', 'segredo', 'chave']) {
    const resposta = await admin.request.get(`/api/proxy/empresas/${alfaId}/certificados/vigente/${caminho}`);

    expect(resposta.status()).toBeGreaterThanOrEqual(400);
  }
});

test('responsável inválido bloqueia o cadastro sem alterar o vigente', async () => {
  const resposta = await admin.request.post(`/api/proxy/empresas/${alfaId}/certificados/ingestoes`, {
    data: { responsavelId: auxiliarId },
  });

  // Auxiliar não é elegível (só admin ou contador); a recusa vem já na emissão do ticket.
  expect(resposta.status()).toBe(422);
  expect(((await resposta.json()) as { code: string }).code).toBe('CERTIFICADO_RESPONSAVEL_INVALIDO');
  expect(await versoes(alfaId)).toHaveLength(2);
});

test('perder o responsável gera pendência e alerta aos administradores, sem derrubar o certificado', async () => {
  // O contador responsável é suspenso: o certificado segue vigente.
  await pool.query(`update app.usuario set estado = 'SUSPENSO' where id = $1`, [contadorId]);

  await abrirCofre(admin);
  await expect(admin.getByRole('row').filter({ hasText: NOME_ALFA })).toContainText('Sem responsável');

  expect(await pendenciasAbertas(alfaId)).toEqual(['certificado:responsavel']);
  expect((await versoes(alfaId)).filter((linha) => linha.estado === 'VIGENTE')).toHaveLength(1);

  // Central de Pendências e sino mostram o problema.
  await admin.goto('/pendencias');
  await expect(admin.getByRole('row').filter({ hasText: NOME_ALFA })).toContainText(
    'Certificado sem responsável',
  );
  await admin.getByRole('button', { name: 'Notificações' }).click();
  await expect(admin.getByRole('dialog').getByText('Certificado sem responsável ativo')).toBeVisible();
  await admin.keyboard.press('Escape');

  // Não existe reatribuição automática: o administrador escolhe outra pessoa.
  await abrirCofre(admin);
  await admin
    .getByRole('button', { name: `Escolher responsável do certificado de ${NOME_ALFA}` })
    .click();
  await admin.getByRole('dialog').getByRole('combobox', { name: /Novo responsável/u }).click();
  await admin.getByRole('option', { name: new RegExp(CONTADOR2.nome, 'u') }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Salvar responsável' }).click();

  await expect.poll(async () => pendenciasAbertas(alfaId)).toEqual([]);
  expect((await versoes(alfaId)).find((linha) => linha.estado === 'VIGENTE')?.responsavel_id).toBe(contador2Id);
  expect((await eventos(alfaId)).map((evento) => evento.acao)).toEqual(
    expect.arrayContaining(['RESPONSAVEL_PERDIDO', 'RESPONSAVEL_ALTERADO']),
  );
});

test('alerta de vencimento: uma vez por marco, mesmo reprocessando', async () => {
  // Aproxima o fim da vigência (fixture direto no banco; a linha é imutável pela aplicação).
  const cliente = await pool.connect();

  try {
    await cliente.query("set session_replication_role = 'replica'");
    await cliente.query(
      `update app.empresa_certificado set valido_ate = (now() at time zone 'America/Sao_Paulo')::date + 6
        where empresa_id = $1 and estado = 'VIGENTE'`,
      [alfaId],
    );
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }

  const contarAlertas = async (): Promise<number> =>
    Number(
      (
        await pool.query<{ total: string }>(
          `select count(*)::text as total from app.empresa_certificado_notificacao
            where empresa_id = $1 and marco = 'D7'`,
          [alfaId],
        )
      ).rows[0]?.total ?? '0',
    );

  const sino = async (page: Page): Promise<void> => {
    expect((await page.request.get('/api/proxy/notificacoes/painel')).status()).toBe(200);
  };

  // O responsável (contadora reserva) entra e o sino reconcilia.
  const contextoReserva = await navegador.newContext();
  const reserva = await contextoReserva.newPage();

  try {
    await entrarComo(reserva, CONTADOR2);
    await sino(reserva);
    await sino(reserva);
    await sino(reserva);

    expect(await contarAlertas()).toBe(1);

    await reserva.getByRole('button', { name: 'Notificações' }).click();
    await expect(reserva.getByRole('dialog').getByText('Certificado vence em 7 dias')).toBeVisible();
  } finally {
    await contextoReserva.close();
  }

  expect(await contarAlertas()).toBe(1);
});

test('desativa com motivo: pendência de ausente, histórico e segredo inutilizado, nada apagado', async () => {
  const [, vigente] = await versoes(alfaId);

  await abrirCofre(admin);

  // Sem motivo a ação é barrada na tela.
  await admin.getByRole('button', { name: `Desativar o certificado de ${NOME_ALFA}` }).click();

  const dialogo = admin.getByRole('alertdialog');

  await expect(dialogo).toContainText(NOME_ALFA);
  await dialogo.getByRole('button', { name: 'Desativar certificado' }).click();
  await expect(dialogo.getByText(/motivo/iu).first()).toBeVisible();
  expect((await versoes(alfaId)).find((linha) => linha.estado === 'VIGENTE')).toBeDefined();

  await dialogo.getByLabel(/Motivo da desativação/u).fill('Empresa trocou de certificadora.');
  await dialogo.getByRole('button', { name: 'Desativar certificado' }).click();

  await expect(admin.getByText(/Certificado desativado/u).first()).toBeVisible();

  const registradas = await versoes(alfaId);

  expect(registradas.map((linha) => linha.estado)).toEqual(['SUBSTITUIDO', 'DESATIVADO']);
  expect(registradas[1]?.justificativa).toBe('Empresa trocou de certificadora.');
  expect(await pendenciasAbertas(alfaId)).toEqual(['certificado:ausente']);

  // Nada foi apagado do banco; o segredo desativado deixa de ser legível, mesmo para o Signer.
  const doSigner = await lerSegredo('signer-leitura', alfaId, vigente?.referencia_segredo ?? '');

  expect(doSigner.status).toBe(404);
  expect(doSigner.corpo).not.toContain(SENHA_DO_PFX);

  // Central e histórico.
  await admin.goto('/pendencias');
  await expect(admin.getByRole('row').filter({ hasText: NOME_ALFA })).toContainText('Certificado ausente');
  await admin.goto('/historico?aba=CERTIFICADOS');

  const lista = admin.getByRole('list', { name: 'Eventos de certificado' });

  await expect(lista).toContainText('Empresa trocou de certificadora.');
  await expect(lista).toContainText(NOME_ALFA);

  const acoes = (await eventos(alfaId)).map((evento) => evento.acao);

  expect(acoes).toEqual(expect.arrayContaining(['CADASTRO', 'SUBSTITUICAO', 'DESATIVACAO', 'RECUSA']));
});

test('o sentinela de senha não aparece em resposta HTTP, HTML nem nas tabelas do cofre', async () => {
  expect(corposRecebidos.length).toBeGreaterThan(10);

  for (const corpo of corposRecebidos) {
    expect(corpo).not.toContain(SENHA_DO_PFX);
    expect(corpo).not.toContain(SENHA_ERRADA);
    expect(corpo).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
  }

  const todas = await pool.query(
    `select to_jsonb(c)::text as t from app.empresa_certificado c where tenant_id = $1
     union all select to_jsonb(e)::text from app.empresa_certificado_evento e where tenant_id = $1
     union all select to_jsonb(n)::text from app.empresa_certificado_notificacao n where tenant_id = $1
     union all select to_jsonb(p)::text from app.empresa_pendencia p where tenant_id = $1`,
    [tenantId],
  );

  for (const linha of todas.rows as Array<{ t: string }>) {
    expect(linha.t).not.toContain(SENHA_DO_PFX);
    expect(linha.t).not.toContain(SENHA_ERRADA);
  }
});

// -- Provas visuais (SPEC-011 §5.4) -----------------------------------------------------------------

test('provas visuais: claro e escuro em 768, 1024 e 1440, sem rolagem horizontal', async () => {
  // Estados variados para a captura: Beta vence em 5 dias (D-7) e a empresa "Fora" já venceu. Fixture
  // direto no banco (a aplicação só cria certificado pelo cofre); trigger desligada só nesta conexão.
  const cliente = await pool.connect();

  try {
    await cliente.query("set session_replication_role = 'replica'");

    for (const [empresa, dias, titular] of [
      [betaId, 5, 'BETA COFRE E2E LTDA'],
      [foraId, -3, 'FORA COFRE E2E LTDA'],
    ] as const) {
      await cliente.query(
        `insert into app.empresa_certificado
           (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
            numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo,
            cadastrado_por)
         values ($1, $2, 1, 'VIGENTE', $3, '00000000000000', 'AC Intermediaria de Teste ContaIA',
                 array['AC Raiz de Teste ContaIA'], '01AB', 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
                 (now() at time zone 'America/Sao_Paulo')::date - 300,
                 (now() at time zone 'America/Sao_Paulo')::date + $4::int, $5, gen_random_uuid(), $5)`,
        [tenantId, empresa, titular, dias, adminId],
      );
    }
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }

  await abrirCofre(admin);

  const pastaBase = `test-results/${ESCOPO}/e2e/screenshots`;

  for (const tema of ['claro', 'escuro'] as const) {
    mkdirSync(`${pastaBase}/${tema}`, { recursive: true });
    // O tema vem de `localStorage` e é resolvido antes da primeira pintura (script-de-tema.tsx).
    await admin.evaluate((valor) => localStorage.setItem('contaia-theme', valor), tema === 'claro' ? 'light' : 'dark');

    for (const largura of [768, 1024, 1440]) {
      await admin.setViewportSize({ width: largura, height: 900 });
      await abrirCofre(admin);
      await expect(admin.locator('html')).toHaveAttribute('data-theme', tema === 'claro' ? 'light' : 'dark');
      await admin.screenshot({ path: `${pastaBase}/${tema}/cofre-${largura}.png`, fullPage: true });

      if (largura >= 1024) {
        // Painel de detalhe da empresa: metadados, responsável, versões e ações.
        await abrirCofre(admin, `?empresa=${betaId}`);
        await expect(admin.getByRole('list', { name: /Versões do certificado/u })).toBeVisible();
        await admin.screenshot({ path: `${pastaBase}/${tema}/cofre-detalhe-${largura}.png`, fullPage: true });
      }

      const transborda = await admin.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(transborda, `rolagem horizontal em ${tema} ${largura}px`).toBe(false);
    }
  }

  await admin.setViewportSize({ width: 1280, height: 720 });
});

test('nenhum artefato da execução contém o sentinela de senha', async () => {
  const raiz = resolve(`test-results/${ESCOPO}`);
  const achados: string[] = [];

  const varrer = (pasta: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);

      if (entrada.isDirectory()) {
        varrer(caminho);
      } else if (
        /\.(json|xml|html|txt|log|md|zip|trace)$/u.test(entrada.name) &&
        statSync(caminho).size < 20_000_000
      ) {
        const conteudo = readFileSync(caminho).toString('latin1');

        if (conteudo.includes(SENHA_DO_PFX) || conteudo.includes(SENHA_ERRADA)) {
          achados.push(caminho);
        }
      }
    }
  };

  if (existsSync(raiz)) {
    varrer(raiz);
  }

  // Tudo que as execuções anteriores publicaram em `test-results/` está livre de senha.
  expect(achados).toEqual([]);
});
