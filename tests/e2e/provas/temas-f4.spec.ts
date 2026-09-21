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

let empresaId = '';

test.beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    "select id from app.empresa where cnpj = '19131243000197'",
  );

  empresaId = rows[0]?.id ?? '';
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
      expect(empresaId, 'rode a suíte da SPEC-004 antes: ela cria a empresa').not.toBe('');

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

      // O histórico entra na prova: é metade da tela da fatia.
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
