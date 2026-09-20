import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: ['dist/**', '.next/**', 'coverage/**', 'test-results/**', 'node_modules/**', '.turbo/**'],
};

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
];

export default base;
