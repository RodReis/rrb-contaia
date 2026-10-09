export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type EmpresaId = Brand<string, 'EmpresaId'>;

export { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, ErroDeValidacao } from './erros.js';
export type { CampoInvalido, CodigoDeErro } from './erros.js';

export { PAPEIS_PADRAO, ehPapelPadrao } from './usuarios/papeis.js';
export type { PapelPadrao } from './usuarios/papeis.js';
export {
  AREA_EXCLUSIVA,
  CATALOGO,
  CHAVES_DO_CATALOGO,
  CHAVES_EXCLUSIVAS,
  ROTULO_DA_ACAO,
  chavesDoModulo,
  consultaImplicada,
  dependentesDeConsulta,
  ehChaveDoCatalogo,
  ehChaveExclusiva,
  moduloDa,
} from './papeis/catalogo.js';
export type {
  AcaoDoCatalogo,
  ChaveDePermissao,
  ChaveDoCatalogo,
  ChaveExclusiva,
} from './papeis/catalogo.js';
export {
  concederPermissao,
  diferencaDeMatriz,
  ehReducao,
  matrizParaRevisao,
  moduloVisivel,
  normalizarMatriz,
  ocultarModulo,
  revogarPermissao,
} from './papeis/matriz.js';
export type {
  DiferencaDeMatriz,
  MatrizParaRevisao,
  ResultadoDeOcultacao,
} from './papeis/matriz.js';
export {
  moldeDoPapelPadrao,
  permissoesDoPapelPadrao,
  permissoesDosPapeisPadrao,
  uniaoDePermissoes,
} from './papeis/papeis-padrao.js';
export {
  TAMANHO_MAXIMO_DA_DESCRICAO,
  TAMANHO_MAXIMO_DO_NOME,
  garantirPapelSemVinculos,
  normalizarNomeDoPapel,
  transicionarPapel,
  validarDadosDoPapel,
} from './papeis/papel-personalizado.js';
export type { DadosDoPapel, EstadoDoPapel, TransicaoDoPapel } from './papeis/papel-personalizado.js';
export {
  podePerderAdministracao,
  situacaoApresentada,
  transicionar,
  validarPapeis,
  validarPapeisDoUsuario,
} from './usuarios/ciclo-de-vida.js';
export type {
  EstadoDoUsuario,
  PapeisDoUsuario,
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

export {
  decidirAcessoEmpresarial,
  empresaAceitaVinculo,
  planejarAlteracao,
  planejarOperacao,
  usuarioPodeReceberCarteira,
} from './carteira/carteira.js';
export type {
  DecisaoDeAcesso,
  EfeitoNoUsuario,
  EmpresaParaCarteira,
  OperacaoDeCarteira,
  PlanoDeCarteira,
  UsuarioParaCarteira,
} from './carteira/carteira.js';

export {
  FINALIDADES_ADMINISTRATIVAS,
  FINALIDADES_DE_SERVICO,
  FINALIDADES_HUMANAS,
  FINALIDADES_TECNICAS,
  contextoDeServico,
  contextoHumano,
  contextoTecnico,
  parametrosDeSessao,
  trocarFinalidade,
} from './acesso/contexto-de-acesso.js';
export type {
  ContextoDeAcesso,
  ContextoDeServico,
  ContextoHumano,
  ContextoTecnico,
  EntradaDoContextoDeServico,
  EntradaDoContextoHumano,
  EntradaDoContextoTecnico,
  FinalidadeAdministrativa,
  FinalidadeDeServico,
  FinalidadeHumana,
  FinalidadeTecnica,
  ParametrosDeSessao,
} from './acesso/contexto-de-acesso.js';

export {
  CODIGOS_DE_RECUSA_DA_INGESTAO,
  PREFIXO_DA_POLITICA_A1,
  avaliarCertificado,
} from './certificados/avaliacao.js';
export type {
  CertificadoExtraido,
  CodigoDeRecusaDaIngestao,
  ResultadoDaAvaliacao,
} from './certificados/avaliacao.js';

export {
  MARCOS_DE_VENCIMENTO,
  diasParaVencer,
  estadoDeValidade,
  estadoNoCofre,
  marcoDeVencimentoAtual,
} from './certificados/estado.js';
export type { EstadoNoCofre, MarcoDeVencimento } from './certificados/estado.js';
export {
  acoesDoCofre,
  ehResponsavelElegivel,
  podeMutarCofre,
  situacaoDoResponsavel,
} from './certificados/autorizacao.js';
export type { AcaoDoCofre, SituacaoDoResponsavel } from './certificados/autorizacao.js';
export {
  TAMANHO_MAXIMO_DO_MOTIVO,
  avaliarMetadadosDoCertificado,
  planejarAtivacao,
  planejarCadastro,
  planejarDesativacao,
  planejarSubstituicao,
  planejarTrocaDeResponsavel,
} from './certificados/transicoes.js';
export type {
  OperacaoDeIngestao,
  PlanoDeAtivacao,
  PlanoDeDesativacao,
  PlanoDeTrocaDeResponsavel,
  VersaoVigente,
} from './certificados/transicoes.js';
export {
  CHAVES_DE_PENDENCIA_DO_CERTIFICADO,
  causasDeCertificado,
} from './certificados/pendencias.js';
export {
  CHAVE_DE_PENDENCIA_DO_PLANO_DE_CONTAS,
  causasDoPlanoDeContas,
} from './plano-contas/pendencias.js';

export { FINALIDADES, ehFinalidade } from './signer/finalidades.js';
export type { Finalidade } from './signer/finalidades.js';
export { certificadoUtilizavel } from './signer/condicao-certificado.js';
export type {
  CodigoDeBloqueioDoCertificado,
  CondicaoDoCertificado,
  VersaoDoCertificado,
} from './signer/condicao-certificado.js';
export { PRAZO_DE_EM_ANDAMENTO_MS, decidirIdempotencia } from './signer/idempotencia.js';
export type {
  DecisaoDeIdempotencia,
  EstadoDaOperacao,
  OperacaoExistente,
  PedidoIdempotente,
} from './signer/idempotencia.js';
export { ESTADOS_DA_FINALIDADE, estadoDaFinalidade, piorEstado } from './signer/estado.js';
export { LIMITE_DE_DESATUALIZACAO_MS, estadoDoServico } from './signer/servico.js';
export type { EntradaDoEstadoDoServico, EstadoDoServicoSigner } from './signer/servico.js';
export type { EstadoDaFinalidade } from './signer/estado.js';
export {
  LIMITE_DE_FALHAS_PARA_INCIDENTE,
  MONITOR_INICIAL,
  avancarIncidente,
} from './signer/incidente.js';
export type { EfeitoDoMonitor, EstadoDoMonitor, TransicaoDoMonitor } from './signer/incidente.js';

export {
  CODIGOS_DE_ERRO_DA_LINHA,
  LIMITE_DO_CODIGO_DA_CONTA,
  LIMITE_DO_NOME_DA_CONTA,
  validarLinhasDoPlano,
  type LinhaDeEntrada,
  type LinhaBrutaDeEntrada,
  type DefeitoDeEstrutura,
  type ContaVigente,
  type LinhaAceita,
  type LinhaRejeitada,
  type ResultadoDaValidacao,
  type TipoDaConta,
  type NaturezaDaConta,
  type CodigoDeErroDaLinha,
} from './plano-contas/validacao.js';

export {
  decidirIdempotenciaDaImportacao,
  type TentativaExistente,
  type PedidoDeImportacao,
  type DecisaoDeIdempotenciaDaImportacao,
  type EstadoDaTentativa,
} from './plano-contas/idempotencia.js';

export {
  proximoEstado,
  ehEstadoTerminal,
  podeTransicionar,
  type EstadoDaImportacao,
  type EventoDaImportacao,
  type TransicaoInvalida,
} from './plano-contas/estados.js';

export {
  LIMITE_DE_LINHAS,
  LIMITE_DE_BYTES,
  CAMPOS_DO_CONTRATO,
  MODELO_CSV,
  decodificarCsv,
  validarMapeamento,
  normalizarLinhas,
  type CampoDoContrato,
  type Mapeamento,
  type Delimitador,
  type PendenciaDoMapeamento,
  type RegistroDoCsv,
} from './plano-contas/csv.js';

export { gerarRelatorioCsv, type LinhaDoRelatorio } from './plano-contas/relatorio.js';
