import { defineConfig, devices } from '@playwright/test';

const escopo = process.env['PROVA_ESCOPO'] ?? 'local';
const portaWeb = process.env['WEB_PORT'] ?? '15100';
const portaApi = process.env['API_PORT'] ?? '15101';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: `test-results/${escopo}/e2e/report`, open: 'never' }],
    ['junit', { outputFile: `test-results/${escopo}/e2e/junit.xml` }],
  ],
  outputDir: `test-results/${escopo}/e2e/artefatos`,
  use: {
    baseURL: `http://127.0.0.1:${portaWeb}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @contaia/web start',
      url: `http://127.0.0.1:${portaWeb}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: { PORT: portaWeb },
    },
    {
      command: 'pnpm --filter @contaia/api start',
      url: `http://127.0.0.1:${portaApi}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: { API_PORT: portaApi },
    },
  ],
});
