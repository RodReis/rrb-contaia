/**
 * E2E do caminho crítico da SPEC-004 (§7).
 *
 * Criar exigência → enviar → rejeitar → substituir → aprovar → consultar
 * histórico, com os contrafactuais de formato proibido, segunda versão vigente
 * e ausência de exclusão.
 *
 * A empresa ativa de partida é criada direto no banco no `beforeAll`: passar
 * pelo wizard aqui provaria de novo a SPEC-002 e tornaria este arquivo
 * dependente da ordem entre suítes, que a CI não garante.
 *
 * Depende do ambiente local: `pnpm docker:up && pnpm db:migrate && pnpm db:seed`.
 */
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

/** CNPJ exclusivo desta suíte, para não colidir com as outras. */
const CNPJ = '19131243000197';

let empresaId = '';

// Os testes compartilham a mesma empresa e se encadeiam: o segundo parte do
// estado que o primeiro deixou. Em paralelo disputariam a mesma linha.
test.describe.configure({ mode: 'serial' });

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ??
    'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

/** PDF mínimo válido: o servidor confere o tipo declarado, não o conteúdo. */
const pdf = (texto: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${texto}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);

const entrar = async (page: Page): Promise<void> => {
  await page.goto('/api/auth/entrar');

  const usuario = page.getByRole('textbox', { name: 'Username or email' });

  await Promise.race([
    usuario.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/\/(escritorio|painel|empresas)/, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await usuario.isVisible().catch(() => false)) {
    await usuario.fill('admin.escritorio');
    await page.getByRole('textbox', { name: 'Password' }).fill('admin_local_123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await page.waitForURL(/\/(escritorio|painel|empresas)/);
};

const abrirDocumentos = async (page: Page): Promise<void> => {
  await page.goto(`/empresas/${empresaId}`);
  await page.getByRole('tab', { name: 'Documentos' }).click();
};

test.beforeAll(async () => {
  const tenant = await pool.query<{ id: string }>(
    `update app.tenant set status = 'ATIVO'
      where cnpj = '11222333000181'
      returning id`,
  );

  const tenantId = tenant.rows[0]?.id;

  if (tenantId === undefined) {
    throw new Error('nenhum tenant semeado: rode `pnpm db:seed` antes do E2E');
  }

  // Estado limpo a cada execução. As triggers recusam DELETE até para o dono
  // da tabela — é o comportamento que a fatia exige —, então a limpeza de
  // fixture as desliga explicitamente em vez de enfraquecê-las.
  await pool.query(
    'alter table app.empresa_evento_documental disable trigger empresa_evento_documental_append_only',
  );
  await pool.query(
    'alter table app.empresa_documento_versao disable trigger empresa_documento_versao_somente_leitura',
  );

  await pool.query(
    `delete from app.empresa_evento_documental
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    `delete from app.empresa_documento_versao
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );

  await pool.query(
    'alter table app.empresa_evento_documental enable trigger empresa_evento_documental_append_only',
  );
  await pool.query(
    'alter table app.empresa_documento_versao enable trigger empresa_documento_versao_somente_leitura',
  );

  await pool.query(
    `delete from app.empresa_exigencia_documental
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    `delete from app.empresa_endereco
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    `delete from app.empresa_cnae_secundario
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    `delete from app.empresa_evento_de_historico
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query('delete from app.empresa where cnpj = $1', [CNPJ]);

  const empresa = await pool.query<{ id: string }>(
    `insert into app.empresa
       (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
        enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
        inscricao_municipal_situacao, situacao_cadastral_externa,
        validado_por_fonte_externa)
     values ($1, 'ATIVA', $2, 'Documentos Comercio LTDA', 'Documentos Comercio',
             'SIMPLES_NACIONAL', 'NAO_MEI', '4712100', 'POSSUI', 'NAO_SE_APLICA',
             'Ativa', true)
     returning id`,
    [tenantId, CNPJ],
  );

  empresaId = empresa.rows[0]?.id ?? '';

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero,
        bairro, municipio, uf)
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Um', '10', 'Centro',
             'Goiania', 'GO')`,
    [tenantId, empresaId],
  );
});

test.afterAll(async () => {
  await pool.end();
});

test('semeia o checklist e respeita a aplicabilidade das inscrições', async ({ page }) => {
  await entrar(page);
  await abrirDocumentos(page);

  // Checklist padrão criado na primeira abertura (§2.1).
  await expect(
    page.getByRole('heading', { name: 'Contrato social ou requerimento de empresário' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cartão CNPJ' })).toBeVisible();

  // A empresa POSSUI inscrição estadual e NÃO SE APLICA a municipal (§2.2).
  await expect(
    page.getByRole('heading', { name: /não se aplicam a esta empresa/iu }),
  ).toBeVisible();
});

test('envia, rejeita, substitui e aprova, com a versão anterior preservada', async ({
  page,
}) => {
  await entrar(page);
  await abrirDocumentos(page);

  const cartao = page.getByRole('listitem').filter({ hasText: 'Cartão CNPJ' }).first();

  // 1. Envio: entra como Enviado e depende de análise (§2.3).
  await cartao.getByRole('button', { name: /enviar arquivo/iu }).click();

  const dialogo = page.getByRole('dialog');
  await dialogo.locator('input[type="file"]').setInputFiles({
    name: 'cartao-cnpj.pdf',
    mimeType: 'application/pdf',
    buffer: pdf('versao 1'),
  });
  await dialogo.getByRole('button', { name: /^enviar arquivo$/iu }).click();

  await expect(cartao.getByText('Enviado')).toBeVisible();
  await expect(cartao.getByText(/depende de análise/iu)).toBeVisible();

  // 2. Rejeição com justificativa: a exigência segue pendente (§2.4).
  await cartao.getByRole('button', { name: /rejeitar/iu }).click();

  const rejeicao = page.getByRole('dialog');
  await rejeicao.getByRole('textbox').fill('Documento ilegível na versão enviada.');
  await rejeicao.getByRole('button', { name: /rejeitar documento/iu }).click();

  await expect(cartao.getByText('Rejeitado')).toBeVisible();
  await expect(cartao.getByText(/documento ilegível/iu)).toBeVisible();

  // 3. Substituição: nova versão vigente, anterior arquivada (§2.3).
  await cartao.getByRole('button', { name: /substituir/iu }).click();

  const substituicao = page.getByRole('dialog');
  await expect(substituicao.getByText(/será arquivada/iu)).toBeVisible();
  await substituicao.locator('input[type="file"]').setInputFiles({
    name: 'cartao-cnpj-corrigido.pdf',
    mimeType: 'application/pdf',
    buffer: pdf('versao 2'),
  });
  await substituicao.getByRole('button', { name: /substituir arquivo/iu }).click();

  await expect(cartao.getByText('Enviado')).toBeVisible();

  // 4. Aprovação da versão nova (§2.4).
  await cartao.getByRole('button', { name: /aprovar/iu }).click();
  await expect(cartao.getByText('Aprovado')).toBeVisible();

  // A versão anterior continua acessível e somente leitura (§3.2).
  await cartao.getByRole('button', { name: /1 versão anterior/iu }).click();
  await expect(cartao.getByText('cartao-cnpj.pdf')).toBeVisible();
  await expect(cartao.getByRole('button', { name: /excluir/iu })).toHaveCount(0);
});

test('o histórico documental registra a sequência inteira e não aceita escrita', async ({
  page,
}) => {
  await entrar(page);
  await abrirDocumentos(page);

  await page.getByRole('button', { name: /histórico documental/iu }).click();

  const historico = page.getByRole('table', { name: /eventos documentais/iu });

  for (const acao of [
    'Documento aprovado',
    'Arquivo substituído',
    'Documento rejeitado',
    'Arquivo enviado',
    'Exigência criada',
  ]) {
    await expect(historico.getByText(acao).first()).toBeVisible();
  }

  // A justificativa da rejeição fica registrada para sempre (§3.2).
  await expect(historico.getByText(/documento ilegível/iu).first()).toBeVisible();

  // Nenhuma ação de escrita na tela de auditoria.
  await expect(historico.getByRole('button', { name: /excluir|editar/iu })).toHaveCount(0);
});

test('contrafactual: o servidor recusa exclusão de versão e de evento', async () => {
  const versao = await pool.query<{ id: string }>(
    `select v.id from app.empresa_documento_versao v
      where v.empresa_id = $1 limit 1`,
    [empresaId],
  );

  const versaoId = versao.rows[0]?.id;
  expect(versaoId).toBeDefined();

  // Append-only e somente leitura valem no banco, não só na interface (I-6).
  await expect(
    pool.query('delete from app.empresa_documento_versao where id = $1', [versaoId]),
  ).rejects.toThrow();

  await expect(
    pool.query('delete from app.empresa_evento_documental where empresa_id = $1', [empresaId]),
  ).rejects.toThrow();
});

test('a mudança de inscrição na F3 reconcilia o checklist da F4 (§2.2)', async ({ page }) => {
  await entrar(page);

  // Estado de partida: estadual POSSUI (aplicável), municipal NAO_SE_APLICA.
  await abrirDocumentos(page);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Inscrição estadual' }).first(),
  ).toBeVisible();

  // A empresa perde a inscrição estadual na aba Dados fiscais.
  await page.getByRole('tab', { name: 'Dados fiscais' }).click();

  // O Select do catálogo é Radix, não `<select>` nativo (COMPONENTS.md §1.4).
  await page.getByRole('combobox', { name: 'Inscrição estadual' }).click();
  await page.getByRole('option', { name: 'Não se aplica' }).click();

  // O formulário da F3 pede vigência nesta tela; o servidor só a exige quando
  // regime ou CNAE mudam, mas preencher é o caminho real do usuário.
  await page
    .getByRole('textbox', { name: 'Vigência da alteração' })
    .fill(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));

  await page.getByRole('button', { name: /salvar alterações/iu }).click();

  // O salvamento e a reconciliação vivem na mesma transação: esperar o toast
  // garante que o servidor respondeu antes de a aba ser reaberta.
  await expect(page.getByText(/dados fiscais salvos/iu)).toBeVisible();

  // A exigência sai do checklist ativo sem perder o que já existia.
  await page.getByRole('tab', { name: 'Documentos' }).click();

  // A seção de inaplicáveis é a que carrega o próprio título; `hasText` num
  // `section` casaria também com os ancestrais, então a busca parte do título.
  const tituloDosInaplicaveis = page.getByRole('heading', {
    name: /não se aplicam a esta empresa/iu,
  });

  await expect(tituloDosInaplicaveis).toBeVisible();

  const inaplicaveis = page
    .getByRole('listitem')
    .filter({ hasText: 'Inscrição estadual' })
    .filter({ hasText: 'Não se aplica' });

  await expect(inaplicaveis).toHaveCount(1);
});
