import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: 'test-results/tela/web-junit.xml',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/tela',
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
