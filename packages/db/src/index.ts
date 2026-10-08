export {
  criarDb,
  criarPool,
  criarPoolDaAplicacao,
  obterUrlDaAplicacao,
  obterUrlDoBanco,
} from './client.js';
export { aplicarMigrations, listarMigrations } from './migrate.js';
export { verificarRoleDaAplicacao, verificarSaudeDoBanco } from './health.js';
export type { RoleDaAplicacao, SaudeDoBanco } from './health.js';
export {
  comContexto,
  comContextoHumano,
  comContextoTecnico,
  comEmpresaEmCriacao,
  comFinalidade,
  semContexto,
} from './contexto.js';
export type { ExecutarNaTransacao } from './contexto.js';
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
export {
  atualizarDados as atualizarDadosDoUsuario,
  atualizarEstado as atualizarEstadoDoUsuario,
  carregarUsuario,
  consumirConvite,
  conviteVigenteDoUsuario,
  criarConvite,
  criarUsuario,
  invalidarConvitesVigentes,
  listarEventosDeUsuario,
  listarUsuarios,
  marcarEnvioFalhou,
  reconciliarConvitesExpirados,
  registrarEventoDeUsuario,
  resolverConvite,
  substituirPapeis,
  travarAdminsAtivos,
  usuarioComEmailNoTenant,
} from './repositorios/usuarios.js';
export type {
  ConviteResolvido,
  ConviteVigente,
  EventoDeUsuarioNaLista,
  EventoDeUsuarioParaRegistrar,
  FiltroDeEventosDeUsuario,
  FiltroDeUsuarios,
  NovoUsuario,
  PaginaDeEventosDeUsuario,
  PaginaDeUsuarios,
  PapelPersonalizadoDoUsuario,
  TipoDeEventoDeUsuario,
  UsuarioNaLista,
  UsuarioPersistido,
} from './repositorios/usuarios.js';
export {
  carregarPapel,
  carregarPapeisParaAtribuir,
  contarVinculosDoPapel,
  criarPapel,
  gravarNovaRevisao,
  listarPapeis,
  listarUsuariosVinculados,
  papelComNome,
  substituirPapeisPersonalizados,
} from './repositorios/papeis-personalizados.js';
export type {
  FiltroDePapeis,
  NovaRevisaoDoPapel,
  NovoPapel,
  PaginaDePapeis,
  PapelNaLista,
  PapelPersistido,
  UsuarioVinculadoAoPapel,
} from './repositorios/papeis-personalizados.js';
export { identidadeDoUsuario, resolverIdentidade } from './repositorios/identidade.js';
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
export {
  contarAbertasPorEmpresa,
  dispensar,
  listarAbertasDaEmpresa,
  listarCentral,
  reconciliar,
} from './repositorios/pendencias.js';
export type {
  CausaParaReconciliar,
  FiltroDaCentral,
  PaginaDePendencias,
  PendenciaComEmpresa,
  PendenciaPersistida,
} from './repositorios/pendencias.js';
export {
  contarNaoLidas,
  criarNotificacoes,
  listarHistorico as listarHistoricoDeNotificacoes,
  listarPainel,
  marcarComoLida,
  marcarVariasComoLidas,
} from './repositorios/notificacoes.js';
export type {
  EmpresaDaNotificacaoDeCarteira,
  NotificacaoPersistida,
  PaginaDeNotificacoes,
} from './repositorios/notificacoes.js';
export {
  acessoAEmpresa,
  aplicarEfeitos,
  autoatribuirEmpresa,
  carregarColaborador,
  carregarEmpresasDaOperacao,
  carregarUsuariosDaOperacao,
  criarNotificacoesDeCarteira,
  empresasDaCarteira,
  encerrarVinculosDaEmpresa,
  encerrarVinculosDoUsuario,
  listarColaboradores,
  listarColaboradoresDaEmpresa,
  listarEmpresasParaAtribuicao,
  listarEmpresasDaCarteira,
  listarEventosDeCarteira,
  registrarEventoDeCarteira,
  resumoDaEmpresa,
  vinculoAtivo,
} from './repositorios/carteira.js';
export type {
  AcessoAEmpresa,
  AfetadoDoEvento,
  ColaboradorDaEmpresa,
  ColaboradorNaCentral,
  EfeitoParaAplicar,
  EmpresaDaOperacao,
  EmpresaParaAtribuicao,
  EmpresaResumida,
  EventoDeCarteiraNaLista,
  EventoDeCarteiraParaRegistrar,
  FiltroDeColaboradores,
  FiltroDeEmpresasParaAtribuicao,
  FiltroDeEventosDeCarteira,
  MotivoDeEncerramento,
  NotificacaoDeCarteiraPersistida,
  OrigemDoEventoDeCarteira,
  PaginaDeColaboradores,
  PaginaDeEmpresasParaAtribuicao,
  PaginaDeEventosDeCarteira,
  SituacaoDaCarteira,
  UsuarioDaOperacao,
} from './repositorios/carteira.js';
export {
  ativacaoDoTicket,
  ativarVersao,
  carregarVersaoDoCertificado,
  carregarVigente,
  consumirTicketDeIngestao,
  desativarVigente,
  emitirTicketDeIngestao,
  listarHistoricoDeCertificados,
  listarVersoesDoCertificado,
  registrarEventoDeCertificado,
  travarCofreDaEmpresa,
  trocarResponsavel,
  vincularTicketAoCertificado,
} from './repositorios/certificados.js';
export type {
  AcaoDoEventoDeCertificado,
  AtivacaoDeVersao,
  DadosDoCertificado,
  EstadoDaVersao,
  EventoDeCertificadoParaRegistrar,
  EventoNaLista as EventoDeCertificadoNaLista,
  FiltroDoHistoricoDeCertificados,
  TicketEmitido,
  TicketParaConsumir,
  TrocaDeResponsavel,
  VersaoAtivada,
  VersaoDoCertificado,
} from './repositorios/certificados.js';
export {
  carregarItemDoCofre,
  listarCofre,
  listarResponsaveisElegiveis,
  reconciliarCofre,
  registrarAlerta,
  situacoesDeResponsaveis,
} from './repositorios/certificados-cofre.js';
export type {
  EntradaDaReconciliacao,
  FiltroDeEstadoDoCofre,
  FiltroDoCofre,
  ItemDoCofreBruto,
  OrdenacaoDoCofre,
  ResponsavelElegivelPersistido,
  ResultadoDaReconciliacao,
  ResumoDoCofreBruto,
} from './repositorios/certificados-cofre.js';

export {
  buscarCertificadoParaUso,
  buscarOperacaoPorChave,
  criarOperacao,
  empresaVisivel,
  finalizarOperacao,
  reabrirOperacao,
  registrarEventoDoSigner,
} from './repositorios/signer.js';
export type {
  CertificadoParaUso,
  DesfechoDaOperacao,
  EstadoDaOperacaoPersistida,
  EventoDoSigner,
  FinalidadeDoSigner,
  NovaOperacao,
  OperacaoDoSigner,
  TipoDeOperacao,
} from './repositorios/signer.js';
export {
  abrirIncidente,
  encerrarIncidente,
  estadoDoMonitor,
  notificarIncidente,
  registrarVerificacao,
} from './repositorios/signer-monitor.js';
export type { EstadoDoMonitorNoBanco } from './repositorios/signer-monitor.js';
export {
  ITENS_POR_PAGINA,
  estadoDoServicoParaPainel,
  historicoDoSigner,
  ultimosEventosDasFinalidades,
} from './repositorios/signer-consultas.js';
export type {
  EstadoGlobalDoServico,
  FiltroDaTrilhaDoSigner,
  ItemDaTrilhaDoSigner,
  PaginaDaTrilhaDoSigner,
  UltimoEventoDaFinalidade,
} from './repositorios/signer-consultas.js';

export {
  aplicarLinhasNoPlano,
  buscarTentativaPorChave,
  buscarTentativaPorId,
  cancelarPrevia,
  criarNotificacaoConclusao,
  criarTentativa,
  empresaTemContaValida,
  finalizarAplicacao,
  finalizarValidacao,
  inserirLinhasStaging,
  listarHistorico as listarHistoricoDeImportacaoPlanoContas,
  listarLinhasStaging,
  listarPlanoVigente,
  listarRejeicoesPaginadas,
  marcarReutilizada,
  registrarEvento,
  salvarMapeamento,
  iniciarValidacao,
  confirmarImportacao,
} from './repositorios/plano-contas.js';
export type {
  ContaContabil,
  EventoDaImportacao,
  LinhaDeStaging,
  NotificacaoDeConclusao,
  NovaTentativa,
  PaginaDeHistorico,
  TentativaDeImportacao,
  EstadoDaTentativa,
} from './repositorios/plano-contas.js';
