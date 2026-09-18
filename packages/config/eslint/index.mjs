import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: ['dist/**', '.next/**', 'coverage/**', 'test-results/**', 'node_modules/**', '.turbo/**'],
};

export const base = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
