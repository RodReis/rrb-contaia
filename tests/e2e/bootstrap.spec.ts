import { expect, test } from '@playwright/test';

const portaApi = process.env['API_PORT'] ?? '15101';
const urlApi = `http://127.0.0.1:${portaApi}`;

test('a Web do ambiente local responde e identifica o produto', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'ContaIA' })).toBeVisible();
  await expect(page.getByText('Ambiente local')).toBeVisible();
});

test('a Web expõe o próprio health check', async ({ request }) => {
  const resposta = await request.get('/api/health');

  expect(resposta.ok()).toBe(true);
  expect(await resposta.json()).toEqual({ service: 'web', status: 'ok' });
});

test('a API responde ao health check', async ({ request }) => {
  const resposta = await request.get(`${urlApi}/health`);

  expect(resposta.ok()).toBe(true);
  expect(await resposta.json()).toEqual({ service: 'api', status: 'ok' });
});

test('a Web aplica o tema escuro pedido antes da primeira pintura', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('contaia-theme', 'dark');
  });

  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
