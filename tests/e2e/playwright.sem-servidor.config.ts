import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

/**
 * Mesma suíte, sem subir servidor: serve para provar que o smoke reprova
 * quando um serviço do ambiente está fora (plano do card, tarefa 8, passo 4).
 */
export default defineConfig({
  ...base,
  testDir: '.',
  webServer: undefined,
  reporter: [['list']],
});
