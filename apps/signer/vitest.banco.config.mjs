import { criarConfigVitest } from '@contaia/config/vitest';

// Caso de uso do Signer contra o PostgreSQL real (papel `contaia_app`, RLS valendo).
export default criarConfigVitest({ categoria: 'banco', escopo: 'signer' });
