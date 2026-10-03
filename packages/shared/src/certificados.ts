import type { CodigoDeRecusaDaIngestao } from '@contaia/domain';

/**
 * Contrato do cofre local de certificados A1 (SPEC-011 / F11).
 *
 * Fonte única dos formatos que cruzam fronteira: API principal ↔ web, API
 * principal ↔ cofre e navegador ↔ cofre. Nada aqui carrega arquivo, senha ou
 * chave privada em resposta — esses três só existem no corpo da ingestão
 * (navegador → cofre) e dentro do Vault (SPEC-011 §6.2).
 */

/** `.pfx`/`.p12` de até 10 MB (SPEC-011 §3.1). */
export const LIMITE_DO_CERTIFICADO_BYTES = 10 * 1024 * 1024;
export const EXTENSOES_DO_CERTIFICADO = ['.pfx', '.p12'] as const;

/** Validade do ticket de ingestão, em segundos: cobre o upload, não uma sessão de trabalho. */
export const VALIDADE_DO_TICKET_SEGUNDOS = 300;

/** Marcos de alerta de vencimento, em dias corridos antes do fim da vigência (SPEC-011 §3.6). */
export const MARCOS_DE_VENCIMENTO = ['D30', 'D15', 'D7', 'VENCIDO'] as const;
export type MarcoDeVencimento = (typeof MARCOS_DE_VENCIMENTO)[number];

/** Estado de uma versão do certificado no histórico da empresa. */
export type EstadoDaVersao = 'VIGENTE' | 'SUBSTITUIDO' | 'DESATIVADO';

/**
 * Estado apresentado de uma empresa no cofre. `VIGENCIA_*` vem da data civil
 * de `America/Sao_Paulo` (I-11); `SEM_RESPONSAVEL` é derivado e convive com os
 * demais (ver `semResponsavel` em `ItemDoCofre`).
 */
export type EstadoNoCofre =
  | 'SEM_CERTIFICADO'
  | 'VALIDO'
  | 'VENCE_D30'
  | 'VENCE_D15'
  | 'VENCE_D7'
  | 'VENCIDO'
  | 'DESATIVADO';

export const ESTADOS_NO_COFRE: readonly EstadoNoCofre[] = [
  'SEM_CERTIFICADO',
  'VALIDO',
  'VENCE_D30',
  'VENCE_D15',
  'VENCE_D7',
  'VENCIDO',
  'DESATIVADO',
];

/** Filtro da lista: os estados acima mais `SEM_RESPONSAVEL`. */
export type FiltroDeEstadoDoCofre = EstadoNoCofre | 'SEM_RESPONSAVEL';

export type OrdenacaoDoCofre = 'EMPRESA' | 'VENCIMENTO' | 'ESTADO';

export type AcaoDoCofre = 'CADASTRAR' | 'SUBSTITUIR' | 'TROCAR_RESPONSAVEL' | 'DESATIVAR';

/** Metadados de uma versão. Nunca contém arquivo, senha, chave privada ou caminho do Vault. */
export type CertificadoMetadados = Readonly<{
  id: string;
  /** Contador funcional por empresa: 1, 2, 3… */
  versao: number;
  estado: EstadoDaVersao;
  titular: string;
  cnpjTitular: string;
  autoridadeCertificadora: string;
  /** SHA-256 em hexadecimal maiúsculo, sem separadores; a tela trunca. */
  impressaoDigital: string;
  numeroSerie: string;
  /** Data civil `YYYY-MM-DD` em America/Sao_Paulo (I-11). */
  validoDe: string;
  validoAte: string;
  responsavelId: string | null;
  cadastradoEm: string;
  cadastradoPorId: string;
  /** Preenchidos quando a versão deixa de ser vigente. */
  encerradoEm: string | null;
  encerradoPorId: string | null;
  motivoDoEncerramento: 'SUBSTITUICAO' | 'DESATIVACAO' | null;
  /** Texto livre informado na desativação; nulo na substituição. */
  justificativa: string | null;
  substituidoPorId: string | null;
}>;

export type SituacaoDoResponsavel = 'ATIVO' | 'INATIVO' | 'FORA_DA_CARTEIRA';

export type ResponsavelDoCertificado = Readonly<{
  id: string;
  nome: string;
  email: string;
  situacao: SituacaoDoResponsavel;
}>;

export type ItemDoCofre = Readonly<{
  empresaId: string;
  empresaNome: string;
  cnpj: string;
  regime: string | null;
  estado: EstadoNoCofre;
  /** Dias até o fim da vigência (negativo = vencido); nulo sem certificado vigente ou desativado. */
  diasParaVencer: number | null;
  semResponsavel: boolean;
  /** Versão vigente; nula em `SEM_CERTIFICADO`. Em `DESATIVADO` traz a última versão desativada. */
  certificado: CertificadoMetadados | null;
  responsavel: ResponsavelDoCertificado | null;
  /** O que o usuário da sessão pode fazer neste item (permissão, papel e carteira já aplicados). */
  acoes: readonly AcaoDoCofre[];
}>;

export type ResumoDoCofre = Readonly<{
  total: number;
  validos: number;
  vencendo: number;
  vencidos: number;
  semCertificado: number;
  desativados: number;
  semResponsavel: number;
}>;

export type PaginaDoCofre = Readonly<{
  resumo: ResumoDoCofre;
  itens: readonly ItemDoCofre[];
  total: number;
  pagina: number;
  limite: number;
}>;

export type DetalheDoCofre = Readonly<{
  item: ItemDoCofre;
  /** Todas as versões da empresa, da mais recente para a mais antiga. */
  versoes: readonly CertificadoMetadados[];
}>;

export type ResponsavelElegivel = Readonly<{ id: string; nome: string; email: string; papel: string }>;

export type OperacaoDeIngestao = 'CADASTRO' | 'SUBSTITUICAO';

/** Resposta de `POST /empresas/:empresaId/certificados/ingestoes`. */
export type TicketDeIngestao = Readonly<{
  ticket: string;
  /** Origem do cofre para o navegador (ex.: `http://127.0.0.1:15104`). */
  cofreUrl: string;
  operacao: OperacaoDeIngestao;
  expiraEm: string;
}>;

/** Conteúdo (assinado) do ticket. O navegador não o interpreta. */
export type CargaDoTicket = Readonly<{
  jti: string;
  tenantId: string;
  empresaId: string;
  usuarioId: string;
  cnpjDaEmpresa: string;
  responsavelId: string;
  operacao: OperacaoDeIngestao;
  correlationId: string;
  /** Segundos desde a época. */
  exp: number;
}>;

/** Metadados que o cofre extrai do PKCS#12 e entrega à API principal (nunca o conteúdo). */
export type MetadadosExtraidos = Readonly<{
  titular: string;
  cnpjTitular: string;
  autoridadeCertificadora: string;
  /** Cadeia validada até a raiz ICP-Brasil configurada, do titular para a raiz (CNs). */
  cadeia: readonly string[];
  numeroSerie: string;
  impressaoDigital: string;
  /** Instantes ISO; a data civil é derivada no domínio. */
  naoAntes: string;
  naoDepois: string;
}>;

/** `POST /interno/cofre/ativacao` (cofre → API). */
export type PedidoDeAtivacao = Readonly<{
  ticket: string;
  metadados: MetadadosExtraidos;
  /** Referência opaca do segredo no Vault (UUID v4); nunca um caminho. */
  referenciaDoSegredo: string;
}>;

/** `POST /interno/cofre/recusa` (cofre → API). */
export type PedidoDeRecusa = Readonly<{ ticket: string; codigo: string }>;

/** Resposta de `POST {cofre}/ingestao` em caso de sucesso. */
export type RespostaDaIngestao = Readonly<{ certificado: CertificadoMetadados }>;

/**
 * Códigos estáveis de recusa da ingestão (SPEC-011 §3.1 e §7). Moram no domínio
 * (`avaliarCertificado` os devolve) e são reexportados aqui para web e cofre.
 */
export { CODIGOS_DE_RECUSA_DA_INGESTAO } from '@contaia/domain';
export type { CodigoDeRecusaDaIngestao } from '@contaia/domain';

/** Mensagens ao usuário, acionáveis e sem detalhe criptográfico (SPEC-011 §3.1). */
export const MENSAGEM_DA_RECUSA: Readonly<Record<CodigoDeRecusaDaIngestao, string>> = {
  CERTIFICADO_TICKET_INVALIDO:
    'A autorização para enviar o certificado expirou ou já foi usada. Tente enviar novamente.',
  CERTIFICADO_EXTENSAO_INVALIDA: 'Envie um arquivo de certificado no formato .pfx ou .p12.',
  CERTIFICADO_TAMANHO_EXCEDIDO: 'O arquivo excede o limite de 10 MB.',
  CERTIFICADO_ARQUIVO_VAZIO: 'O arquivo enviado está vazio.',
  CERTIFICADO_CONTEINER_INVALIDO: 'O arquivo não é um certificado digital válido.',
  CERTIFICADO_SENHA_INCORRETA: 'A senha informada não abre o certificado.',
  CERTIFICADO_EXPIRADO: 'O certificado está expirado. Envie um certificado dentro da validade.',
  CERTIFICADO_AINDA_NAO_VIGENTE: 'O certificado ainda não começou a valer.',
  CERTIFICADO_TIPO_INCOMPATIVEL:
    'Só é aceito certificado A1 de e-CNPJ emitido na cadeia ICP-Brasil.',
  CERTIFICADO_CNPJ_DIVERGENTE: 'O CNPJ do certificado não é o CNPJ desta empresa.',
  CERTIFICADO_RESPONSAVEL_INVALIDO:
    'O responsável escolhido não está ativo ou não tem esta empresa na carteira.',
  COFRE_INDISPONIVEL: 'O cofre está indisponível no momento. Nada foi alterado; tente novamente.',
};

/** Cartões do Histórico de Informações → aba Certificados (SPEC-011 §3.7). */
export type AcaoDoHistoricoDeCertificado =
  | 'CADASTRO'
  | 'SUBSTITUICAO'
  | 'DESATIVACAO'
  | 'RESPONSAVEL_ALTERADO'
  | 'RESPONSAVEL_PERDIDO'
  | 'ALERTA_EMITIDO'
  | 'RECUSA';

export type ResultadoDoEventoDeCertificado = 'SUCESSO' | 'RECUSADO';

export type EventoDeCertificado = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  acao: AcaoDoHistoricoDeCertificado;
  resultado: ResultadoDoEventoDeCertificado;
  /** Código estável da recusa ou marco do alerta; nulo nas demais ações. */
  codigo: string | null;
  motivo: string | null;
  usuarioId: string | null;
  usuarioNome: string | null;
  /** Identidade técnica (ex.: `cofre`, `job-de-alertas`) quando não há usuário. */
  identidadeTecnica: string | null;
  correlationId: string;
  ocorridoEm: string;
}>;

/**
 * Alertas do cofre no sino (`GET /notificacoes/*`): `tipo` = `CERTIFICADO_<marco>`, `chave` =
 * `certificado:<certificadoId>:<marco>`, `empresaId` preenchido. Abrem
 * `/configuracoes/cofre?empresa=<empresaId>`, que mostra o estado atual (não o do alerta).
 */
export const TIPOS_DE_NOTIFICACAO_DO_COFRE = [
  'CERTIFICADO_D30',
  'CERTIFICADO_D15',
  'CERTIFICADO_D7',
  'CERTIFICADO_VENCIDO',
  'CERTIFICADO_RESPONSAVEL_INCONSISTENTE',
] as const;
export type TipoDeNotificacaoDoCofre = (typeof TIPOS_DE_NOTIFICACAO_DO_COFRE)[number];

/**
 * Pendências do cofre na Central (`origem = 'CERTIFICADO'`): chaves `certificado:ausente`,
 * `certificado:vencido` (`dataLimite` = fim da validade) e `certificado:responsavel`.
 */
export const TIPOS_DE_PENDENCIA_DO_COFRE = [
  'CERTIFICADO_AUSENTE',
  'CERTIFICADO_VENCIDO',
  'CERTIFICADO_SEM_RESPONSAVEL',
] as const;
export type TipoDePendenciaDoCofre = (typeof TIPOS_DE_PENDENCIA_DO_COFRE)[number];
