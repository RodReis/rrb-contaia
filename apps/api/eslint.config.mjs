import base from '@contaia/config/eslint';

export default [
  ...base,
  {
    rules: {
      // Decorator do Nest depende de metadata em runtime; `import type` apaga a emissão.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
