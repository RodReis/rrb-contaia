import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: './',
    pool: 'threads',
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: 'test-results/regras/api-junit.xml',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/regras',
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
