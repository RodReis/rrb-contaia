import { criarConfigVitest } from '@contaia/config/vitest';

export default criarConfigVitest({
  categoria: 'banco',
  escopo: 'db',
  include: ['src/**/*.integration.test.ts'],
});
