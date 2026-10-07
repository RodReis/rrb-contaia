import { criarConfigVitest } from '@contaia/config/vitest';

// `*.integration.test.ts` exige PostgreSQL e roda em `test:banco`, nunca aqui.
export default criarConfigVitest({
  categoria: 'regras',
  escopo: 'signer',
  exclude: ['src/**/*.integration.test.ts'],
});
