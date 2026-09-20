export { criarDb, criarPool, obterUrlDoBanco } from './client.js';
export { aplicarMigrations, listarMigrations } from './migrate.js';
export { verificarRoleDaAplicacao, verificarSaudeDoBanco } from './health.js';
export type { RoleDaAplicacao, SaudeDoBanco } from './health.js';
export { comContextoDeTenant, semContexto } from './contexto.js';
export {
  arquivarArquivo,
  carregarCadastro,
  cnpjEmUsoPorOutroTenant,
  listarArquivos,
  listarEnderecos,
  marcarComoAtivo,
  registrarArquivo,
  salvarEnderecoPrincipal,
  salvarIdentificacao,
  salvarResponsavel,
} from './repositorios/escritorio.js';
export type { ArquivoDoEscritorio, EnderecoPersistido } from './repositorios/escritorio.js';
export { resolverIdentidade } from './repositorios/identidade.js';
export type { IdentidadeResolvida } from './repositorios/identidade.js';
