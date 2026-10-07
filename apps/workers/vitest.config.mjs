import { criarConfigVitest } from '@contaia/config/vitest';

// `*.integration.test.ts` exige PostgreSQL e Redis e roda em `test:banco`, nunca aqui.
export default criarConfigVitest({
  categoria: 'regras',
  escopo: 'workers',
  exclude: ['src/**/*.integration.test.ts'],
});
