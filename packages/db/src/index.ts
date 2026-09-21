export { criarDb, criarPool, obterUrlDoBanco } from './client.js';
export { aplicarMigrations, listarMigrations } from './migrate.js';
export { verificarRoleDaAplicacao, verificarSaudeDoBanco } from './health.js';
export type { RoleDaAplicacao, SaudeDoBanco } from './health.js';
export { comContextoDeTenant, semContexto } from './contexto.js';
export {
  arquivarArquivo,
  carregarCadastro,
  cnpjEmUsoPorOutroTenant,
  definirLogo,
  listarArquivos,
  listarEnderecos,
  marcarComoAtivo,
  registrarArquivo,
  salvarEnderecoPrincipal,
  salvarIdentificacao,
  salvarResponsavel,
} from './repositorios/escritorio.js';
export type { ArquivoDoEscritorio, EnderecoPersistido } from './repositorios/escritorio.js';
export {
  carregarEmpresa,
  criarEmpresa,
  empresaComCnpj,
  listarEmpresas,
  marcarEmpresaComoAtiva,
  salvarDadosFiscais,
  salvarEnderecoDaEmpresa,
  salvarIdentificacaoDaEmpresa,
} from './repositorios/empresa.js';
export { FILTROS_DA_LISTA } from './repositorios/empresa.js';
export type {
  EmpresaNaLista,
  EmpresaPersistida,
  FiltroDaLista,
  FiltroDeStatus,
  PaginaDeEmpresas,
} from './repositorios/empresa.js';
export {
  aplicarTrocaDeFinalidade,
  arquivarEndereco,
  atualizarEndereco,
  camposComHistorico,
  carregarEndereco,
  definirSituacaoDaEmpresa,
  inserirEndereco,
  listarEnderecosDaEmpresa,
  listarHistorico,
  registrarEventos,
  situacaoDaEmpresa,
} from './repositorios/manutencao-empresa.js';
export type {
  EnderecoDaEmpresaPersistido,
  EventoNaLista,
  EventoParaRegistrar,
  FiltroDoHistorico,
  PaginaDoHistorico,
} from './repositorios/manutencao-empresa.js';
export { resolverIdentidade } from './repositorios/identidade.js';
export type { IdentidadeResolvida } from './repositorios/identidade.js';
export {
  ACOES_DOCUMENTAIS,
  arquivarVersaoVigente,
  carregarExigencia,
  carregarVersao,
  carregarVersaoVigente,
  definirAplicabilidade,
  definirEstadoDaExigencia,
  inserirExigencia,
  inserirVersao,
  listarExigencias,
  listarHistoricoDocumental,
  listarVersoes,
  registrarEventosDocumentais,
} from './repositorios/documentos-empresa.js';
export type {
  AcaoDocumental,
  EventoDocumentalNaLista,
  EventoDocumentalParaRegistrar,
  ExigenciaPersistida,
  NovaExigencia,
  NovaVersao,
  VersaoPersistida,
} from './repositorios/documentos-empresa.js';
