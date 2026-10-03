/**
 * E2E do caminho crítico da SPEC-005 (§7): reconciliação automática de
 * pendências ponta a ponta.
 *
 * Envia um documento → rejeita (a reconciliação da Task 6b cria a pendência
 * `DOCUMENTO_REJEITADO` automaticamente, sem ação manual) → confirma o
 * alerta `<AlertaDePendencias>` na página da empresa → navega para a Central
 * pelo link "Ver pendências" e confirma a pendência filtrada por empresa →
 * volta para Documentos, reenvia e aprova → confirma que a reconciliação
 * automática da aprovação (fluxo de F4) resolve a pendência sem ação manual
 * na Central → confere o histórico em `estado=RESOLVIDA`.
 *
 * A ação de dispensa manual já está coberta em teste de tela (Task 9); o
 * valor deste E2E é provar a reconciliação automática integrada (banco real
 * + API real + UI real), que só existe fora de teste unitário.
 *
 * Depende do ambiente local: `pnpm docker:up && pnpm db:migrate && pnpm db:seed`.
 */
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

/** CNPJ exclusivo desta suíte, para não colidir com as outras. */
const CNPJ = '52889417000160';

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
  // da tabela — comportamento que a fatia exige —, então a limpeza de
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

  // `empresa_evento_de_pendencia` também é append-only (mesmo padrão de F4) e
  // tem FK para `empresa_pendencia`: precisa ser desligado e limpo antes.
  await pool.query(
    'alter table app.empresa_evento_de_pendencia disable trigger empresa_evento_de_pendencia_append_only',
  );
  await pool.query(
    `delete from app.empresa_evento_de_pendencia
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    `delete from app.empresa_pendencia
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    'alter table app.empresa_evento_de_pendencia enable trigger empresa_evento_de_pendencia_append_only',
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
  // O vínculo de carteira sai antes da empresa (FK composta, SPEC-009).
  await pool.query(
    `delete from app.carteira_vinculo
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
     values ($1, 'ATIVA', $2, 'Pendencias Comercio LTDA', 'Pendencias Comercio',
             'SIMPLES_NACIONAL', 'NAO_MEI', '4712100', 'POSSUI', 'NAO_SE_APLICA',
             'Ativa', true)
     returning id`,
    [tenantId, CNPJ],
  );

  empresaId = empresa.rows[0]?.id ?? '';

  // A empresa inserida por SQL não passa pela criação que autoatribui o admin: sem vínculo, a
  // alçada por empresa (SPEC-009 §3.5) negaria a própria suíte. O admin do seed entra na carteira.
  await pool.query(
    `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id)
     select tenant_id, id, $2 from app.usuario
      where tenant_id = $1 and email = 'admin@escritorio.cnt.br'`,
    [tenantId, empresaId],
  );

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero,
        bairro, municipio, uf)
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Dois', '20', 'Centro',
             'Goiania', 'GO')`,
    [tenantId, empresaId],
  );
});

test.afterAll(async () => {
  await pool.end();
});

test('rejeitar um documento cria a pendência automaticamente e o alerta aparece na empresa', async ({
  page,
}) => {
  await entrar(page);
  await abrirDocumentos(page);

  const cartao = page.getByRole('listitem').filter({ hasText: 'Cartão CNPJ' }).first();

  // 1. Envio do documento.
  await cartao.getByRole('button', { name: /enviar arquivo/iu }).click();

  const dialogoDeEnvio = page.getByRole('dialog');
  await dialogoDeEnvio.locator('input[type="file"]').setInputFiles({
    name: 'cartao-cnpj.pdf',
    mimeType: 'application/pdf',
    buffer: pdf('versao 1'),
  });
  await dialogoDeEnvio.getByRole('button', { name: /^enviar arquivo$/iu }).click();

  await expect(cartao.getByText('Enviado')).toBeVisible();

  // 2. Rejeição: a reconciliação automática (Task 6b) cria a pendência
  // DOCUMENTO_REJEITADO sem nenhuma ação manual além da rejeição em si.
  await cartao.getByRole('button', { name: /rejeitar/iu }).click();

  const dialogoDeRejeicao = page.getByRole('dialog');
  await dialogoDeRejeicao.getByRole('textbox').fill('Documento ilegível, reenviar em melhor qualidade.');
  await dialogoDeRejeicao.getByRole('button', { name: /rejeitar documento/iu }).click();

  await expect(cartao.getByText('Rejeitado')).toBeVisible();

  // 3. O alerta persistente aparece na página da empresa com total >= 1.
  await page.goto(`/empresas/${empresaId}`);

  const alerta = page.getByRole('status').filter({ hasText: /pendência/iu });
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(/pendência/iu);

  const linkVerPendencias = page.getByRole('link', { name: 'Ver pendências' });
  await expect(linkVerPendencias).toHaveAttribute('href', `/pendencias?empresaId=${empresaId}`);
});

test('a Central lista a pendência aberta e some da vista ABERTA após a aprovação', async ({
  page,
}) => {
  await entrar(page);

  // 4. Navegação até a Central pelo link "Ver pendências" da página da empresa.
  await page.goto(`/empresas/${empresaId}`);
  await page.getByRole('link', { name: 'Ver pendências' }).click();

  await page.waitForURL(`/pendencias?empresaId=${empresaId}`);

  await expect(page.getByRole('heading', { name: 'Central de Pendências' })).toBeVisible();
  // A tabela desktop e os cartões mobile renderizam o mesmo dado ao mesmo
  // tempo (um oculto por CSS conforme a largura, não removido do DOM), então
  // escopar pela tabela (visível na viewport padrão) evita depender de qual
  // dos dois o DOM lista primeiro — mesmo padrão do spec-004 (histórico).
  //
  // O checklist documental completo (F4) também gera pendências
  // DOCUMENTO_AUSENTE para os demais itens não enviados: a linha da
  // rejeição não é a única, por isso a busca é pela linha específica.
  const tabela = page.getByRole('table');
  const linhaRejeitada = tabela.getByRole('row').filter({ hasText: 'Documento rejeitado' });
  await expect(linhaRejeitada).toBeVisible();
  await expect(linhaRejeitada).toContainText('Pendencias Comercio');

  // 5. Volta à aba Documentos da empresa, reenvia e aprova.
  await abrirDocumentos(page);

  const cartao = page.getByRole('listitem').filter({ hasText: 'Cartão CNPJ' }).first();

  await cartao.getByRole('button', { name: /substituir/iu }).click();

  const dialogoDeSubstituicao = page.getByRole('dialog');
  await dialogoDeSubstituicao.locator('input[type="file"]').setInputFiles({
    name: 'cartao-cnpj-corrigido.pdf',
    mimeType: 'application/pdf',
    buffer: pdf('versao 2'),
  });
  await dialogoDeSubstituicao.getByRole('button', { name: /substituir arquivo/iu }).click();

  await expect(cartao.getByText('Enviado')).toBeVisible();

  await cartao.getByRole('button', { name: /aprovar/iu }).click();
  await expect(cartao.getByText('Aprovado')).toBeVisible();

  // 6. A reconciliação automática da aprovação (fluxo de F4) resolve a
  // pendência de documento rejeitado sem nenhuma ação manual na Central. As
  // pendências DOCUMENTO_AUSENTE dos demais itens do checklist continuam
  // abertas — só a causa que a aprovação de fato resolveu deve sumir daqui.
  await page.goto(`/pendencias?empresaId=${empresaId}&estado=ABERTA`);

  await expect(
    page.getByRole('table').getByRole('row').filter({ hasText: 'Documento rejeitado' }),
  ).toHaveCount(0);

  // 7. O histórico é preservado em RESOLVIDA (SPEC-005 §2).
  await page.goto(`/pendencias?empresaId=${empresaId}&estado=RESOLVIDA`);

  const linhaResolvida = page
    .getByRole('table')
    .getByRole('row')
    .filter({ hasText: 'Documento rejeitado' });
  await expect(linhaResolvida).toBeVisible();
  await expect(linhaResolvida).toContainText('Pendencias Comercio');
});
