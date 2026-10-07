import { criarConfigVitest } from '@contaia/config/vitest';

// Monitor e filas contra PostgreSQL e Redis reais (papel `contaia_app`, RLS valendo).
export default criarConfigVitest({ categoria: 'banco', escopo: 'workers' });
