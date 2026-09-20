export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type EmpresaId = Brand<string, 'EmpresaId'>;

export { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, ErroDeValidacao } from './erros.js';
export type { CampoInvalido, CodigoDeErro } from './erros.js';

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
