export { criarDb, criarPool, obterUrlDoBanco } from './client.js';
export { aplicarMigrations, listarMigrations } from './migrate.js';
export { verificarRoleDaAplicacao, verificarSaudeDoBanco } from './health.js';
export type { RoleDaAplicacao, SaudeDoBanco } from './health.js';
