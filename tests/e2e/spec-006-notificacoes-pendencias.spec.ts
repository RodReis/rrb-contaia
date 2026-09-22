/**
 * E2E SPEC-006: gerar evento → badge → abrir painel → selecionar/marcar →
 * navegar → histórico.
 *
 * Reusa o mesmo setup de fixtures de spec-005-central-pendencias.spec.ts
 * (mesmo gatilho síncrono: abrir a aba Documentos semeia o checklist padrão —
 * o que já gera notificações NOVA_PENDENCIA para os itens não condicionais
 * pendentes — e rejeitar um documento aciona a reconciliação síncrona que
 * cria a pendência DOCUMENTO_REJEITADO E a notificação correspondente).
 *
 * Depende do ambiente local: `pnpm docker:up && pnpm db:migrate && pnpm db:seed`.
 */
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

/** CNPJ exclusivo desta suíte, para não colidir com as outras (ver grep em tests/e2e/). */
const CNPJ = '38251622000107';

let empresaId = '';

// Os testes se encadeiam: o segundo e o terceiro partem do estado que o
// anterior deixou (mesma empresa, mesmas notificações). Em paralelo
// disputariam a mesma linha.
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
    // Por CNPJ, não por id fixo: ambientes locais onde o Keycloak foi
    // recriado sem reset do Postgres acumulam um tenant novo (sub_oidc
    // diferente) associado ao mesmo `admin.escritorio` — o tenant do seed
    // original (`cnpj = '11222333000181'`) fica órfão. Resolver pelo usuário
    // com esse e-mail garante que a ativação alcança o tenant que a sessão
    // OIDC atual realmente usa, sem depender de qual dos dois existe.
    `update app.tenant set status = 'ATIVO'
      where id = (
        select tenant_id from app.usuario where email = 'admin@escritorio.cnt.br' limit 1
      )
      returning id`,
  );

  const tenantId = tenant.rows[0]?.id;

  if (tenantId === undefined) {
    throw new Error('nenhum tenant semeado: rode `pnpm db:seed` antes do E2E');
  }

  // Estado limpo a cada execução. As triggers recusam DELETE até para o dono
  // da tabela, então a limpeza de fixture as desliga explicitamente em vez de
  // enfraquecê-las (mesmo padrão de spec-005-central-pendencias.spec.ts).
  await pool.query(
    'alter table app.empresa_evento_de_notificacao disable trigger empresa_evento_de_notificacao_append_only',
  );
  await pool.query(
    `delete from app.empresa_evento_de_notificacao
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    `delete from app.empresa_notificacao
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    'alter table app.empresa_evento_de_notificacao enable trigger empresa_evento_de_notificacao_append_only',
  );

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

  // `empresa_evento_de_pendencia` também é append-only e tem FK para
  // `empresa_pendencia`: precisa ser desligado e limpo antes.
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
  await pool.query('delete from app.empresa where cnpj = $1', [CNPJ]);

  const empresa = await pool.query<{ id: string }>(
    `insert into app.empresa
       (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
        enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
        inscricao_municipal_situacao, situacao_cadastral_externa,
        validado_por_fonte_externa)
     values ($1, 'ATIVA', $2, 'Notificacoes Comercio LTDA', 'Notificacoes Comercio',
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
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Três', '30', 'Centro',
             'Goiania', 'GO')`,
    [tenantId, empresaId],
  );
});

test.afterAll(async () => {
  await pool.end();
});

test.describe('SPEC-006 — Notificações de pendências', () => {
  test('rejeitar documento gera notificação visível no sino e navegável', async ({ page }) => {
    await entrar(page);

    // 1. Abrir a aba Documentos semeia o checklist padrão: os itens não
    // condicionais pendentes já geram notificações NOVA_PENDENCIA de
    // imediato (mesmo comportamento provado em spec-005, §8).
    await abrirDocumentos(page);

    const cartao = page.getByRole('listitem').filter({ hasText: 'Cartão CNPJ' }).first();
    // Espera o checklist renderizar (prova de que o semeamento no servidor já
    // terminou) antes de seguir com envio/rejeição abaixo.
    await expect(cartao).toBeVisible();

    // A notificação NOVA_PENDENCIA do próprio Cartão CNPJ usa a mesma chave
    // (`exigencia:<id>`) que a futura DOCUMENTO_REJEITADO, mas tipo diferente:
    // o índice único de idempotência é (empresa_id, chave, tipo) — não
    // (empresa_id, chave) — então as duas coexistem não lidas sem conflito
    // (0008_notificacoes.sql, fix do achado C1). Não é mais preciso marcar a
    // notificação do checklist como lida antes de prosseguir.

    // 2. Envio do documento.
    await cartao.getByRole('button', { name: /enviar arquivo/iu }).click();

    const dialogoDeEnvio = page.getByRole('dialog');
    await dialogoDeEnvio.locator('input[type="file"]').setInputFiles({
      name: 'cartao-cnpj.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('versao 1'),
    });
    await dialogoDeEnvio.getByRole('button', { name: /^enviar arquivo$/iu }).click();

    await expect(cartao.getByText('Enviado')).toBeVisible();

    // 3. Rejeição: a reconciliação automática cria a pendência
    // DOCUMENTO_REJEITADO E a notificação correspondente, sem ação manual
    // além da rejeição em si (SPEC-006 §2).
    await cartao.getByRole('button', { name: /rejeitar/iu }).click();

    const dialogoDeRejeicao = page.getByRole('dialog');
    await dialogoDeRejeicao.getByRole('textbox').fill('Documento ilegível, reenviar em melhor qualidade.');
    await dialogoDeRejeicao.getByRole('button', { name: /rejeitar documento/iu }).click();

    await expect(cartao.getByText('Rejeitado')).toBeVisible();

    // 4. Dashboard: o sino mostra o total de não lidas (checklist + rejeição).
    await page.goto('/empresas');

    const badge = page.getByTestId('badge-nao-lidas');
    await expect(badge).toBeVisible();
    const totalInicial = Number(await badge.textContent());
    expect(totalInicial).toBeGreaterThanOrEqual(2);

    // 5. Abrir o painel e localizar o item da rejeição.
    await page.getByRole('button', { name: 'Notificações' }).click();

    const painel = page.getByRole('list');
    const itemRejeicao = painel
      .getByRole('listitem')
      .filter({ hasText: /documento rejeitado/iu })
      .first();
    await expect(itemRejeicao).toBeVisible();

    // 6. Clicar no item marca como lida e navega para a pendência filtrada
    // pela empresa.
    await itemRejeicao.getByText(/notificacoes comercio/iu).click();
    await page.waitForURL(/\/pendencias\?empresaId=/u);
    await expect(page).toHaveURL(`/pendencias?empresaId=${empresaId}`);

    // 7. Badge reduz em 1 (a notificação clicada saiu das não lidas; as
    // demais do checklist continuam pendentes de leitura).
    await page.goto('/empresas');
    const badgeApos = page.getByTestId('badge-nao-lidas');
    await expect(badgeApos).toBeVisible();
    await expect(badgeApos).toHaveText(String(totalInicial - 1));

    // 8. Histórico completo preserva o item, marcado "Lida".
    await page.goto('/notificacoes');
    const linhaHistorico = page
      .getByRole('listitem')
      .filter({ hasText: /documento rejeitado/iu })
      .first();
    await expect(linhaHistorico).toBeVisible();
    await expect(linhaHistorico.getByText('Lida')).toBeVisible();
  });

  test('histórico preserva a notificação já lida sem duplicar ao reabrir a página', async ({
    page,
  }) => {
    await entrar(page);

    await page.goto('/empresas');
    const badgeAntes = page.getByTestId('badge-nao-lidas');
    await expect(badgeAntes).toBeVisible();
    const totalAntes = Number(await badgeAntes.textContent());

    // Reenvia e rejeita de novo o mesmo documento (mesma causa/chave
    // `DOCUMENTO_REJEITADO` desta exigência): como a notificação anterior já
    // foi lida, o índice único permite uma notificação NOVA para esta
    // rejeição — mas a rejeição em si não deve gerar duplicata se repetida
    // sem reenvio intermediário. Aqui provamos o caso do brief: reabrir a
    // página (segunda leitura) não duplica nem recria o que já está lido.
    await page.goto('/notificacoes');
    const linhasRejeicao = page.getByRole('listitem').filter({ hasText: /documento rejeitado/iu });
    await expect(linhasRejeicao).toHaveCount(1);

    await page.goto('/empresas');
    const badgeDepois = page.getByTestId('badge-nao-lidas');
    if (totalAntes > 0) {
      await expect(badgeDepois).toHaveText(String(totalAntes));
    } else {
      await expect(badgeDepois).toHaveCount(0);
    }
  });

  test('checkbox Todas marca em lote as notificações visíveis do painel', async ({ page }) => {
    await entrar(page);
    await page.goto('/empresas');

    const badge = page.getByTestId('badge-nao-lidas');
    await expect(badge).toBeVisible();

    await page.getByRole('button', { name: 'Notificações' }).click();

    const painel = page.getByRole('list');
    await expect(painel.getByRole('listitem').first()).toBeVisible();

    const checkboxTodas = page.getByRole('checkbox', { name: 'Todas' });
    await checkboxTodas.check();

    await page.getByRole('button', { name: /marcar como lidas/iu }).click();

    // O painel fecha a seleção e o badge zera: todas as visíveis (até 15,
    // aqui bem menos) foram marcadas como lidas em lote.
    await expect(page.getByTestId('badge-nao-lidas')).toHaveCount(0);

    // Histórico: nenhuma notificação desta empresa continua "Não lida".
    await page.goto('/notificacoes');
    await expect(page.getByText('Não lida')).toHaveCount(0);
  });
});
