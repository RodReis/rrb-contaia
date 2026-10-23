export { canonicalizarEnvelopeDeAuditoria, hashDoEnvelopeDeAuditoria, redigirPayloadDeAuditoria, sha256DeAuditoria } from './auditoria.js';
export type { ValorCanonico } from './auditoria.js';
export {
  autorizarOperacaoRfb,
  CATALOGO_DE_PODERES_RFB,
  estadoDaProcuracao,
  marcosDeAlertaDaProcuracao,
  periodosSobrepostos,
  validarPoderesRfb,
  VERSAO_DO_CATALOGO_RFB,
} from './procuracoes/procuracoes.js';
export type {
  EstadoDaProcuracao,
  MarcoDaProcuracao,
  PoderRfb,
  ProcuracaoParaAutorizacao,
} from './procuracoes/procuracoes.js';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type EmpresaId = Brand<string, 'EmpresaId'>;

export { projetarSaudeEmpresa, FONTES_DA_SAUDE } from './dashboard/saude-empresa.js';
export type { CorDaSaude, EntradaDaProjecao, FonteDaSaude, MotivoDeSaude, ResultadoDaSaude, SinalDeSaude } from './dashboard/saude-empresa.js';
export { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, ErroDeValidacao } from './erros.js';
export type { CampoInvalido, CodigoDeErro } from './erros.js';
export { calculateIcmsStReturnReversal } from './tax-resolution/calculate-icms-st-return-reversal.js';
export type { IcmsStReturnReversalInput, IcmsStReturnReversalResult } from './tax-resolution/calculate-icms-st-return-reversal.js';
export { renderIcmsStC002 } from './tax-resolution/render-icms-st-c002.js';
export type { IcmsStC002Input } from './tax-resolution/render-icms-st-c002.js';
export { buildHistoricalIcmsStPackage } from './tax-resolution/build-icms-st-history.js';
export type {
  HistoricalIcmsStApprovedReversal,
  HistoricalIcmsStExcludedCompetence,
  HistoricalIcmsStLineMemory,
  HistoricalIcmsStPackage,
  HistoricalIcmsStPackageInput,
  HistoricalIcmsStPackageLine,
  HistoricalIcmsStPackageStatus,
  HistoricalIcmsStRegime,
  HistoricalIcmsStRegimeOutput,
  HistoricalIcmsStSourceLine,
  HistoricalIcmsStSourceSnapshot,
  HistoricalIcmsStUnresolvedEvidence,
} from './tax-resolution/build-icms-st-history.js';

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
export { DFE_CAPTURE_STATES, DFE_DOCUMENT_KINDS } from './dfe-capture/model.js';
export type {
  DfeBatchItem,
  DfeCaptureErrorCode,
  DfeCaptureFailureKind,
  DfeCaptureState,
  DfeDocumentKind,
} from './dfe-capture/model.js';
export {
  classifyCaptureFailure,
  decideCaptureEligibility,
  evaluateBatch,
  nextAllowedAt,
} from './dfe-capture/policy.js';
export type { CaptureEligibility } from './dfe-capture/policy.js';
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

export { podeTransicionar, type EstadoDaImportacao, type EventoDaImportacao } from './plano-contas/estados.js';

export {
  LIMITE_DE_LINHAS,
  LIMITE_DE_BYTES,
  CAMPOS_DO_CONTRATO,
  MODELO_CSV,
  decodificarCsv,
  validarMapeamento,
  pendenciasDoMapeamento,
  indicesDasColunasDe,
  normalizarLinhas,
  type CampoDoContrato,
  type Mapeamento,
  type Delimitador,
  type MotivoDePendenciaDoMapeamento,
  type PendenciaDoMapeamento,
  type PendenciaDoMapeamentoDe,
  type RegistroDoCsv,
} from './plano-contas/csv.js';

export {
  gerarRelatorioCsv,
  gerarRelatorioCsvDe,
  type LinhaDoRelatorio,
  type ValorDeCelula,
} from './plano-contas/relatorio.js';

export { lerDataCivil, type DataCivil } from './datas/data-civil.js';

export { decimalDeclaradoParaCentavos, statusRetencaoIcmsDeclarada, validateIcmsStDeclaredEvidence, type IcmsStDeclaredCheck, type IcmsStEvidence } from './tax-resolution/validate-icms-st-evidence.js';

export {
  evaluateTaxRule,
  selectApplicableRule,
  type ExactFraction,
  type TaxCalculationMemory,
  type TaxEvaluationInput,
  type TaxRuleCriteria,
} from './tax-rules/evaluate-tax-rule.js';
export {
  FULL_BASIS_POINTS,
  TAX_REGIMES,
  TAX_RULE_STATUSES,
  TAX_TYPES,
  isBasisPoints,
  isValidOperation,
  type TaxRegime,
  type TaxRule,
  type TaxRuleIdentity,
  type TaxRuleOperation,
  type TaxRuleStatus,
  type TaxType,
} from './tax-rules/model.js';
export { validateTaxPackage, taxPackageCoversDate, hashTaxPackage } from './tax-resolution/package.js';
export type { CuratedTaxPackage, TaxPackageSource, PackageValidation } from './tax-resolution/package.js';
export { resolveEntryTax, statusSubstituicaoTributariaComEvidencia } from './tax-resolution/resolve-entry.js';
export type { EntryTaxFacts, EntryTaxDecision } from './tax-resolution/resolve-entry.js';
export { HISTORICAL_CUTOFF_SOURCE_ID, resolveHistoricalIcms } from './tax-resolution/resolve-historical-icms.js';
export type {
  HistoricalIcmsFacts,
  HistoricalIcmsMemory,
  HistoricalIcmsObligation,
  HistoricalIcmsResolution,
  HistoricalIcmsRule,
  HistoricalTaxLiabilityKind,
} from './tax-resolution/resolve-historical-icms.js';
export { calculateIcmsStOutputTax, resolveIcmsStSettlement } from './tax-resolution/resolve-icms-st-settlement.js';
export type {
  IcmsStDifferenceKind,
  IcmsStInputEntry,
  IcmsStMonthlySettlement,
  IcmsStOutputLine,
  IcmsStRecoveryOrigin,
  IcmsStSettlementInput,
  IcmsStSettlementFixture,
  IcmsStSettlementLine,
  IcmsStSettlementRule,
  IcmsStSettlementStatus,
} from './tax-resolution/resolve-icms-st-settlement.js';

export {
  CAMPOS_DE_EMPREGADO,
  CODIGOS_DE_ERRO_DE_EMPREGADO,
  CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO,
  type CampoDeEmpregado,
  type CodigoDeErroDeEmpregado,
  type MapeamentoDeEmpregados,
} from './empregados/campos.js';
export {
  validarMapeamentoDeEmpregados,
  type PendenciaDoMapeamentoDeEmpregados,
  type ResultadoDoMapeamentoDeEmpregados,
} from './empregados/mapeamento.js';
export { normalizarLinhasDeEmpregados } from './empregados/normalizacao.js';
export {
  validarLinhasDeEmpregados,
  type DefeitoDeEstruturaDeEmpregado,
  type EmpregadoVigente,
  type LinhaBrutaDeEmpregado,
  type LinhaDeStagingDeEmpregado,
} from './empregados/validacao.js';
export { CHAVE_DE_PENDENCIA_DE_EMPREGADOS, causasDeEmpregados } from './empregados/pendencias.js';
export { MODELO_CSV_DE_EMPREGADOS } from './empregados/modelo.js';
export {
  gerarRelatorioCsvDeEmpregados,
  type LinhaDoRelatorioDeEmpregados,
} from './empregados/relatorio.js';

// Planilhas XLSX/ODS (SPEC-015): contrato tabular e regras de célula/cabeçalho.
export { ULTIMA_COLUNA, colunaParaLetra, ehLetraDeColuna, letraParaColuna } from './planilhas/colunas.js';
export {
  cabecalhoEstaMesclado,
  celulaTemConteudo,
  conferirCabecalho,
  amostraDaAba,
  linhaTemConteudo,
  resumoDaAba,
  rotulosDasColunas,
  sugerirLinhaDeCabecalho,
  type CabecalhoConferido,
  type CodigoDeCabecalhoInutilizavel,
  type LinhaDeAmostra,
  type ResumoDaAba,
} from './planilhas/cabecalho.js';
export { tabelaParaRegistros } from './planilhas/tabela-para-registros.js';
export { LIMITE_DE_TEXTO_DA_INSPECAO, LIMITE_DO_ROTULO_DA_COLUNA, truncarTexto } from './planilhas/texto.js';
export {
  CODIGOS_DE_REJEICAO_ESTRUTURAL,
  MENSAGEM_DA_REJEICAO_ESTRUTURAL,
  type RejeicaoEstruturalDaLinha,
} from './planilhas/rejeicao-estrutural.js';
export {
  CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA,
  diagnosticosDaTabela,
  type CodigoDeDiagnosticoDePlanilha,
  type DiagnosticoDeLeitura,
} from './planilhas/diagnosticos.js';
export type {
  AbaDaPlanilha,
  CelulaDaTabela,
  CodigoDeRejeicaoEstrutural,
  ConfiguracaoDePlanilha,
  IntervaloMesclado,
  LeituraDaAba,
  LinhaDaTabela,
  OpcoesDaTabela,
  RejeicaoEstruturalDeCelula,
  ResultadoTabular,
  RotuloDaColuna,
  TipoNativoDeCelula,
} from './planilhas/tipos.js';

export { FAIXAS_DE_CONFIANCA, classificarFaixaDeConfianca, decidirPropostaDeManifestacao, valorMonetarioParaCentavos } from './fiscal-risk/policy.js';
export type { DecisaoDaMatrizFiscal, EntradaDaMatrizFiscal, EvidenciaConclusivaDeOperacao, FaixaDeConfianca } from './fiscal-risk/policy.js';
export { TIPOS_MANIFESTACAO_CONCLUSIVA, MOTIVOS_REJEICAO_MANIFESTACAO, validarJustificativaManifestacao, chaveIdempotenteManifestacao, hashPayloadManifestacao, ordenarInboxManifestacao, elegivelManifestacao } from './fiscal-manifestations.js';
export type { TipoManifestacaoConclusiva, MotivoRejeicaoManifestacao } from './fiscal-manifestations.js';
export * from './obligations.js';
