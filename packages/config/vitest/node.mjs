import { configDefaults, defineConfig } from 'vitest/config';

/**
 * @param {{ categoria: 'regras' | 'banco' | 'tela', escopo: string, include?: string[], exclude?: string[], setupFiles?: string[], environment?: string }} options
 */
export const criarConfigVitest = ({
  categoria,
  escopo,
  include,
  exclude = [],
  setupFiles = [],
  environment = 'node',
}) =>
  defineConfig({
    test: {
      environment,
      include: include ?? [`src/**/*.${categoria === 'banco' ? 'integration.test' : 'test'}.ts`],
      // Categoria não vaza para a outra: teste de banco (exige PostgreSQL) fica fora de test:regras.
      exclude: [...configDefaults.exclude, ...exclude],
      setupFiles,
      pool: 'threads',
      reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
      // Dentro do pacote: `outputs` do Turbo so captura caminho local, e um cache
      // hit que nao recria o relatorio faria a categoria virar not_run silencioso.
      outputFile: {
        junit: `test-results/${categoria}/${escopo}-junit.xml`,
      },
      coverage: {
        provider: 'v8',
        reportsDirectory: `coverage/${categoria}`,
        reporter: ['text-summary', 'json-summary', 'lcov'],
      },
    },
  });

export default criarConfigVitest;
