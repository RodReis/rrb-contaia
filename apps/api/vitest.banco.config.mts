import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Casos de uso da API contra o PostgreSQL real (papel `contaia_app`, RLS valendo): as provas de
// concorrência entre transações que o dublê de banco das `*.spec.ts` não alcança.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    root: './',
    pool: 'threads',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: 'test-results/banco/api-junit.xml',
    },
  },
});
