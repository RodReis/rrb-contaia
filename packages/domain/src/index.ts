export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type EmpresaId = Brand<string, 'EmpresaId'>;

export { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, ErroDeValidacao } from './erros.js';
export type { CampoInvalido, CodigoDeErro } from './erros.js';

export {
  MATRIZ,
  PAPEIS_PADRAO,
  ehPapelPadrao,
  escopoDeEmpresas,
  podeExecutar,
} from './usuarios/papeis.js';
export type { Acao, Capacidade, PapelPadrao } from './usuarios/papeis.js';
export {
  podePerderAdministracao,
  situacaoApresentada,
  transicionar,
  validarPapeis,
} from './usuarios/ciclo-de-vida.js';
export type {
  EstadoDoUsuario,
  SituacaoApresentada,
  Transicao,
} from './usuarios/ciclo-de-vida.js';
export { VALIDADE_DO_CONVITE_HORAS, conviteVigente, expiraEm } from './usuarios/convite.js';
export { validarDadosDoUsuario } from './usuarios/dados.js';
export type { DadosDoUsuario, DadosDoUsuarioDeEntrada } from './usuarios/dados.js';

export { ehCnpjValido, formatarCnpj, normalizarCnpj } from './validadores/cnpj.js';
export { ehCpfValido, formatarCpf, normalizarCpf } from './validadores/cpf.js';
export {
  ehCepValido,
  ehEmailValido,
  ehTelefoneValido,
  ehUfValida,
  formatarCep,
  formatarTelefone,
  normalizarCep,
  normalizarEmail,
  normalizarTelefone,
} from './validadores/contato.js';

export {
  ETAPAS_DO_CADASTRO,
  ativarCadastro,
  camposInvalidosDaEtapa,
  etapasConcluidas,
  podeAtivar,
  primeiraEtapaIncompleta,
  validarDocumentos,
  validarEndereco,
  validarIdentificacao,
  validarResponsavel,
} from './escritorio/cadastro.js';
export type {
  CadastroDoEscritorio,
  EnderecoDoEscritorio,
  EtapaDoCadastro,
  IdentificacaoDoEscritorio,
  ResponsavelTecnico,
  StatusDoTenant,
} from './escritorio/cadastro.js';

export {
  ENQUADRAMENTOS_DO_SIMPLES,
  ETAPAS_DA_EMPRESA,
  REGIMES_TRIBUTARIOS,
  SITUACOES_DE_INSCRICAO,
  ativarEmpresa,
  camposInvalidosDaEtapaDaEmpresa,
  ehEnquadramentoSimples,
  ehRegimeTributario,
  ehSituacaoDeInscricao,
  etapasConcluidasDaEmpresa,
  exigeConfirmacaoDeSituacaoExterna,
  podeAtivarEmpresa,
  primeiraEtapaIncompletaDaEmpresa,
  validarDadosFiscais,
  validarEnderecoDaEmpresa,
  validarIdentificacaoDaEmpresa,
} from './empresa/cadastro.js';
export type {
  CadastroDaEmpresa,
  DadosFiscaisDaEmpresa,
  EnderecoDaEmpresa,
  EnquadramentoSimples,
  EtapaDaEmpresa,
  IdentificacaoDaEmpresa,
  Inscricao,
  RegimeTributario,
  SituacaoDeInscricao,
  StatusDaEmpresa,
} from './empresa/cadastro.js';

export {
  ABAS_DO_HISTORICO,
  ACOES_DO_HISTORICO,
  FINALIDADES_DE_ENDERECO,
  abaDoCampo,
  arquivarEmpresa,
  camposAlteradosNaIdentificacao,
  camposAlteradosNosDadosFiscais,
  dataCivilEmSaoPaulo,
  diferencasDaFonteExterna,
  ehAbaDoHistorico,
  ehFinalidadeDeEndereco,
  planejarTrocaDeFinalidadeFiscal,
  reativarEmpresa,
  validarEnderecoComFinalidade,
  validarJustificativa,
  validarVigencia,
} from './empresa/manutencao.js';
export type {
  AbaDoHistorico,
  AcaoDoHistorico,
  AtribuicaoDeFinalidade,
  CampoAlterado,
  CamposDaFonteExterna,
  DiferencaExterna,
  EnderecoComFinalidade,
  EnderecoIdentificado,
  EventoDoHistorico,
  FinalidadeDeEndereco,
  SituacaoDeRegistro,
} from './empresa/manutencao.js';
export {
  CHECKLIST_PADRAO,
  CODIGOS_DO_CHECKLIST,
  ESTADOS_DO_DOCUMENTO,
  aprovarVersao,
  dispensarExigencia,
  ehEstadoDoDocumento,
  estadoComVencimento,
  exigenciasDaAplicabilidade,
  registrarEnvio,
  rejeitarVersao,
  validarNomeDaExigencia,
  validarValidade,
} from './empresa/documentos.js';
export type {
  AplicabilidadeDasInscricoes,
  CodigoDoChecklist,
  EstadoDoDocumento,
  ExigenciaCalculada,
  ItemDoChecklist,
  MotivoDaExigencia,
} from './empresa/documentos.js';
export {
  causasCadastrais,
  causasDocumentais,
  prioridadeDaPendencia,
  reconciliarPendencias,
} from './pendencias/pendencias.js';
export type {
  CampoCadastralObrigatorio,
  CausaDaPendencia,
  EstadoDaPendencia,
  ExigenciaParaReconciliar,
  OrigemDaPendencia,
  TipoDaPendencia,
} from './pendencias/pendencias.js';
export { tipoDeNotificacaoParaCausa } from './notificacoes/notificacoes.js';
export type { CausaParaNotificar, TipoDeNotificacao } from './notificacoes/notificacoes.js';
