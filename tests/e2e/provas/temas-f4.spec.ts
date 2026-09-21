/**
 * Prova visual da aba Documentos nos temas CLARO e ESCURO (FRONTEND.md §20).
 *
 * Não é prova de comportamento — isso é da suíte da SPEC-004. Aqui só se
 * capturam as telas que a PR precisa anexar, nos dois temas e em 1440 e 768.
 */
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ??
    'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

/** CNPJ próprio: a prova visual não depende da ordem entre suítes. */
const CNPJ = '27865757000102';

let empresaId = '';

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

  // A empresa é criada aqui, e não reaproveitada da suíte da SPEC-004: o
  // Playwright roda os arquivos em paralelo e não garante ordem entre eles.
  //
  // Os quatro testes deste arquivo também rodam em paralelo e executam este
  // mesmo `beforeAll`, então o insert é idempotente: `on conflict` sobre o
  // índice de CNPJ por tenant faz o segundo a chegar reaproveitar a linha do
  // primeiro em vez de estourar unicidade.
  const empresa = await pool.query<{ id: string }>(
    `with nova as (
       insert into app.empresa
         (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
          enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
          inscricao_municipal_situacao, situacao_cadastral_externa,
          validado_por_fonte_externa)
       values ($1, 'ATIVA', $2, 'Provas Visuais LTDA', 'Provas Visuais',
               'SIMPLES_NACIONAL', 'NAO_MEI', '4712100', 'POSSUI', 'NAO_SE_APLICA',
               'Ativa', true)
       on conflict do nothing
       returning id
     )
     select id from nova
     union all
     select id from app.empresa where tenant_id = $1 and cnpj = $2
     limit 1`,
    [tenantId, CNPJ],
  );

  empresaId = empresa.rows[0]?.id ?? '';

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero,
        bairro, municipio, uf)
     select $1, $2, 'FISCAL', true, '74000000', 'Rua Um', '10', 'Centro',
            'Goiania', 'GO'
      where not exists (
        select 1 from app.empresa_endereco
         where empresa_id = $2 and finalidade = 'FISCAL' and situacao = 'ativo'
      )`,
    [tenantId, empresaId],
  );
});

test.afterAll(async () => {
  await pool.end();
});

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

for (const tema of ['light', 'dark'] as const) {
  for (const largura of [1440, 768]) {
    test(`aba Documentos no tema ${tema} em ${largura}px`, async ({ page }) => {
      expect(empresaId).not.toBe('');

      await page.setViewportSize({ width: largura, height: 1200 });
      await entrar(page);

      await page.goto(`/empresas/${empresaId}`);
      await page.evaluate((valor) => {
        try {
          localStorage.setItem('contaia-theme', valor);
        } catch {
          // Janela privada pode lançar; o atributo abaixo já basta.
        }
        document.documentElement.setAttribute('data-theme', valor);
      }, tema);

      await page.getByRole('tab', { name: 'Documentos' }).click();
      await page.getByRole('heading', { name: 'Cartão CNPJ' }).waitFor();

      // O histórico entra na prova: é metade da tela da fatia. A empresa desta
      // suíte tem só os eventos de criação do checklist, que já exercitam a
      // tabela, a paginação e o badge de estado.
      await page.getByRole('button', { name: /histórico documental/iu }).click();
      await page.getByRole('table', { name: /eventos documentais/iu }).waitFor();

      await expect(page.locator('html')).toHaveAttribute('data-theme', tema);

      await page.screenshot({
        path: `test-results/provas/f4-documentos-${tema}-${largura}.png`,
        fullPage: true,
      });
    });
  }
}
