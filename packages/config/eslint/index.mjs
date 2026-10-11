import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: ['dist/**', '.next/**', 'coverage/**', 'test-results/**', 'node_modules/**', '.turbo/**'],
};

/**
 * `@contaia/planilhas/testes` (construtores de fixture, inclusive bombas de ZIP) é subpath público só
 * porque os testes dos outros pacotes precisam dele; código de produção nunca o importa.
 */
export const semImportarConstrutoresDeTeste = [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@contaia/planilhas/testes', '@contaia/planilhas/testes/*'],
              message: '@contaia/planilhas/testes é só para testes (*.spec.ts, *.test.ts, planilhas-de-teste.ts, tests/e2e).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}', '**/planilhas-de-teste.ts', 'tests/e2e/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export const base = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Script de operação (seed, migração, CI) roda no Node puro: sem isto o
    // `no-undef` acusa `process`, `fetch` e `URL` como indefinidos.
    files: ['**/*.mjs', '**/*.cjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  ...semImportarConstrutoresDeTeste,
];

export default base;
