import { defineConfig } from 'vitest/config';

/**
 * @param {{ categoria: 'regras' | 'banco' | 'tela', escopo: string, include?: string[], setupFiles?: string[], environment?: string }} options
 */
export const criarConfigVitest = ({
  categoria,
  escopo,
  include,
  setupFiles = [],
  environment = 'node',
}) =>
  defineConfig({
    test: {
      environment,
      include: include ?? [`src/**/*.${categoria === 'banco' ? 'integration.test' : 'test'}.ts`],
      setupFiles,
      pool: 'threads',
      reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
      outputFile: {
        junit: `../../test-results/${process.env['PROVA_ESCOPO'] ?? 'local'}/${categoria}/${escopo}-junit.xml`,
      },
      coverage: {
        provider: 'v8',
        reportsDirectory: `coverage/${categoria}`,
        reporter: ['text-summary', 'json-summary', 'lcov'],
      },
    },
  });

export default criarConfigVitest;
