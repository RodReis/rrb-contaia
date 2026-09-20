import { defineConfig, devices } from '@playwright/test';

const escopo = process.env['PROVA_ESCOPO'] ?? 'local';

/** Só as variáveis definidas: `undefined` não é valor válido para o processo filho. */
const ambiente: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entrada): entrada is [string, string] => typeof entrada[1] === 'string',
  ),
);
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
  // O `env` de um webServer substitui o ambiente herdado em vez de completá-lo:
  // sem repassar o processo, a Web e a API subiriam sem DATABASE_URL,
  // KEYCLOAK_ISSUER_URL nem credencial de storage, e o E2E falharia no login.
  webServer: [
    {
      command: 'pnpm --filter @contaia/web start',
      url: `http://127.0.0.1:${portaWeb}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: { ...ambiente, PORT: portaWeb },
    },
    {
      command: 'pnpm --filter @contaia/api start',
      url: `http://127.0.0.1:${portaApi}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: { ...ambiente, API_PORT: portaApi },
    },
  ],
});
