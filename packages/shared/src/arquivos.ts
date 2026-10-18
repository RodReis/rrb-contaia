/**
 * Fonte única das regras de arquivo do escritório (SPEC-001 §3.2).
 *
 * Formato e tamanho são decisão técnica do Code, mas precisam valer igual na
 * interface e na API — por isso moram aqui e não duplicados nos dois lados.
 */
import { MENSAGEM_DO_ERRO_DE_PLANILHA, type FormatoDeArquivo } from './tabela.js';

export const LIMITE_DE_LOGO_BYTES = 2 * 1024 * 1024;
export const LIMITE_DE_DOCUMENTO_BYTES = 10 * 1024 * 1024;
/** Documento cadastral da empresa cliente (SPEC-004 §2.3). */
export const LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES = 20 * 1024 * 1024;

export const TIPOS_DE_LOGO = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const;
export const TIPOS_DE_DOCUMENTO = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/**
 * O documento da empresa aceita menos formatos que o do escritório: a SPEC-004
 * §2.3 fixa PDF, JPG e PNG, porque todos precisam ser visualizáveis no
 * navegador — `.docx` não é.
 */
export const TIPOS_DE_DOCUMENTO_DA_EMPRESA = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

/**
 * CSV de importação do plano de contas (SPEC-013 §3.2). O mesmo limite do parser do domínio
 * (`LIMITE_DE_BYTES`), repetido aqui porque este módulo também vai para o navegador; um teste
 * garante que os dois valores não divergem.
 */
export const LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES = 10 * 1024 * 1024;
/** CSV de importação de empregados (SPEC-014 §3.2): mesmo limite e mesmo parser da F13. */
export const LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES = 10 * 1024 * 1024;

/**
 * Tipos que navegadores e sistemas operacionais anunciam para `.csv`: o Windows com Excel
 * instalado envia `application/vnd.ms-excel`, e `text/plain` aparece em vários clientes.
 */
export const TIPOS_DE_IMPORTACAO_DO_PLANO = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
] as const;

/** XLSX e ODS (SPEC-015): o tipo de conteúdo canônico de cada um. */
export const TIPO_DE_CONTEUDO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TIPO_DE_CONTEUDO_ODS = 'application/vnd.oasis.opendocument.spreadsheet';
export const TIPOS_DE_PLANILHA = [TIPO_DE_CONTEUDO_XLSX, TIPO_DE_CONTEUDO_ODS] as const;

/** Importação tabular: CSV (os tipos que os navegadores anunciam para ele) mais XLSX e ODS. */
export const TIPOS_DE_IMPORTACAO_TABULAR = [...TIPOS_DE_IMPORTACAO_DO_PLANO, ...TIPOS_DE_PLANILHA] as const;

export type TipoDeArquivo =
  | 'LOGO'
  | 'DOCUMENTO'
  | 'DOCUMENTO_DA_EMPRESA'
  | 'PROCURACAO_RFB'
  | 'IMPORTACAO_PLANO_CONTAS'
  | 'IMPORTACAO_EMPREGADOS';

/**
 * Arquivo do cadastro do escritório (SPEC-001). Tipo próprio para o
 * compilador recusar o documento da empresa nesse caminho: a coluna `tipo` de
 * `escritorio_arquivo` só admite estes dois, e alargar `TipoDeArquivo` sem
 * estreitar aqui deixaria o erro chegar ao banco.
 */
export type TipoDeArquivoDoEscritorio = Extract<TipoDeArquivo, 'LOGO' | 'DOCUMENTO'>;

/** Falhas que a extensão do nome, sozinha, decide (`.xls` e `.xlsm` nunca são lidos). */
export type FalhaPorExtensao = 'FORMATO_XLS_NAO_SUPORTADO' | 'FORMATO_XLSM_NAO_SUPORTADO';

export type RegraDeArquivo = Readonly<{
  limiteBytes: number;
  tiposAceitos: readonly string[];
  extensoesAceitas: readonly string[];
  /** Extensão (minúscula, com ponto) → falha. Só conferida quando `validarArquivo` recebe o `nome`. */
  extensoesRecusadas?: Readonly<Record<string, FalhaPorExtensao>>;
}>;

const EXTENSOES_RECUSADAS_NA_IMPORTACAO: Readonly<Record<string, FalhaPorExtensao>> = {
  '.xls': 'FORMATO_XLS_NAO_SUPORTADO',
  '.xlsm': 'FORMATO_XLSM_NAO_SUPORTADO',
};

export const REGRAS_DE_ARQUIVO: Readonly<Record<TipoDeArquivo, RegraDeArquivo>> = {
  LOGO: {
    limiteBytes: LIMITE_DE_LOGO_BYTES,
    tiposAceitos: TIPOS_DE_LOGO,
    extensoesAceitas: ['.png', '.jpg', '.jpeg', '.svg', '.webp'],
  },
  DOCUMENTO: {
    limiteBytes: LIMITE_DE_DOCUMENTO_BYTES,
    tiposAceitos: TIPOS_DE_DOCUMENTO,
    extensoesAceitas: ['.pdf', '.png', '.jpg', '.jpeg', '.docx'],
  },
  DOCUMENTO_DA_EMPRESA: {
    limiteBytes: LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES,
    tiposAceitos: TIPOS_DE_DOCUMENTO_DA_EMPRESA,
    extensoesAceitas: ['.pdf', '.png', '.jpg', '.jpeg'],
  },
  PROCURACAO_RFB: {
    limiteBytes: LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES,
    tiposAceitos: ['application/pdf'],
    extensoesAceitas: ['.pdf'],
  },
  IMPORTACAO_PLANO_CONTAS: {
    limiteBytes: LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES,
    tiposAceitos: TIPOS_DE_IMPORTACAO_TABULAR,
    extensoesAceitas: ['.csv', '.xlsx', '.ods'],
    extensoesRecusadas: EXTENSOES_RECUSADAS_NA_IMPORTACAO,
  },
  IMPORTACAO_EMPREGADOS: {
    limiteBytes: LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES,
    tiposAceitos: TIPOS_DE_IMPORTACAO_TABULAR,
    extensoesAceitas: ['.csv', '.xlsx', '.ods'],
    extensoesRecusadas: EXTENSOES_RECUSADAS_NA_IMPORTACAO,
  },
};

export type FalhaDeArquivo =
  | 'TIPO_NAO_ACEITO'
  | 'TAMANHO_EXCEDIDO'
  | 'ARQUIVO_VAZIO'
  | 'CONTEUDO_NAO_CONFERE'
  | FalhaPorExtensao;

/**
 * Assinatura dos formatos aceitos, em bytes iniciais.
 *
 * O `Content-Type` do multipart é declarado pelo navegador e um cliente
 * qualquer o escolhe livremente: sem conferir os bytes, o metadado gravado no
 * banco é o que o remetente quis dizer, não o que o arquivo é.
 */
const ASSINATURAS: Readonly<Record<string, readonly (readonly number[])[]>> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
};

const comecaCom = (inicio: Uint8Array, assinatura: readonly number[]): boolean =>
  inicio.length >= assinatura.length && assinatura.every((byte, indice) => inicio[indice] === byte);

/** ZIP (xlsx, ods): registro local, diretório central vazio e arquivo multivolume. */
const ASSINATURAS_ZIP: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];
/** Contêiner CFB/OLE2: `.xls`, `.doc` e o envelope de OOXML criptografado. */
const ASSINATURA_CFB: readonly number[] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Formatos binários que não podem se passar por texto (PDF, zip/xlsx, CFB/xls, PNG, JPEG). */
const ASSINATURAS_BINARIAS: readonly (readonly number[])[] = [
  [0x25, 0x50, 0x44, 0x46],
  ...ASSINATURAS_ZIP,
  ASSINATURA_CFB,
  [0x89, 0x50, 0x4e, 0x47],
  [0xff, 0xd8, 0xff],
];
const MARCAS_UTF16: readonly (readonly number[])[] = [
  [0xff, 0xfe],
  [0xfe, 0xff],
];

/**
 * CSV é texto sem assinatura mágica: confere-se só que não é um binário conhecido nem tem byte
 * nulo (exceto em UTF-16 com BOM, que o Excel grava como "Texto Unicode").
 */
const pareceTexto = (inicio: Uint8Array): boolean => {
  if (ASSINATURAS_BINARIAS.some((assinatura) => comecaCom(inicio, assinatura))) {
    return false;
  }

  return MARCAS_UTF16.some((marca) => comecaCom(inicio, marca)) || !inicio.includes(0x00);
};

const TIPOS_DE_TEXTO: readonly string[] = TIPOS_DE_IMPORTACAO_DO_PLANO;
const TIPOS_DE_PLANILHA_ACEITOS: readonly string[] = TIPOS_DE_PLANILHA;

/**
 * Planilha precisa abrir como ZIP. O CFB também passa: o OOXML criptografado e o `.xls` com extensão
 * trocada têm essa assinatura, e quem decide o formato real é o leitor (que devolve
 * `ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO` ou `EXTENSAO_DIFERENTE_DO_CONTEUDO` em vez de uma recusa genérica).
 */
const parecePlanilha = (inicio: Uint8Array): boolean =>
  ASSINATURAS_ZIP.some((assinatura) => comecaCom(inicio, assinatura)) || comecaCom(inicio, ASSINATURA_CFB);

/**
 * Confere se os bytes iniciais correspondem ao tipo declarado.
 *
 * Tipo sem assinatura conhecida passa: esta função recusa a divergência, não
 * assume o papel do allowlist — quem decide o que é aceito é `validarArquivo`.
 */
export const conteudoConfereComOTipo = (
  tipoConteudo: string,
  inicio: Uint8Array,
): boolean => {
  if (TIPOS_DE_TEXTO.includes(tipoConteudo)) {
    return pareceTexto(inicio);
  }

  if (TIPOS_DE_PLANILHA_ACEITOS.includes(tipoConteudo)) {
    return parecePlanilha(inicio);
  }

  const assinaturas = ASSINATURAS[tipoConteudo];

  if (assinaturas === undefined) {
    return true;
  }

  return assinaturas.some(
    (assinatura) =>
      inicio.length >= assinatura.length &&
      assinatura.every((byte, indice) => inicio[indice] === byte),
  );
};

export const formatarLimite = (bytes: number): string =>
  `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

const extensaoDoNome = (nome: string): string => {
  const ponto = nome.lastIndexOf('.');
  return ponto <= 0 ? '' : nome.slice(ponto).toLowerCase();
};

/** Formato pela extensão do nome (`.csv`, `.xlsx`, `.ods`); `null` para qualquer outra, `.xls` e `.xlsm` inclusive. */
export const formatoPelaExtensao = (nome: string): FormatoDeArquivo | null => {
  switch (extensaoDoNome(nome)) {
    case '.csv':
      return 'CSV';
    case '.xlsx':
      return 'XLSX';
    case '.ods':
      return 'ODS';
    default:
      return null;
  }
};

/** O tipo de conteúdo que o navegador e o servidor devem usar para o formato (o do multipart é livre). */
export const tipoDeConteudoDoFormato = (formato: FormatoDeArquivo): string =>
  formato === 'XLSX' ? TIPO_DE_CONTEUDO_XLSX : formato === 'ODS' ? TIPO_DE_CONTEUDO_ODS : 'text/csv';

/**
 * Devolve a falha ou `null` quando o arquivo é aceitável. Com o `nome`, a extensão recusada pela
 * regra (`.xls`, `.xlsm` na importação) vence o tipo declarado, que é escolha de quem envia.
 */
export const validarArquivo = (
  tipo: TipoDeArquivo,
  arquivo: Readonly<{ tipoConteudo: string; tamanhoBytes: number; nome?: string }>,
): FalhaDeArquivo | null => {
  const regra = REGRAS_DE_ARQUIVO[tipo];

  if (arquivo.tamanhoBytes <= 0) {
    return 'ARQUIVO_VAZIO';
  }

  const recusadaPelaExtensao =
    arquivo.nome === undefined ? undefined : regra.extensoesRecusadas?.[extensaoDoNome(arquivo.nome)];
  if (recusadaPelaExtensao !== undefined) {
    return recusadaPelaExtensao;
  }

  if (!regra.tiposAceitos.includes(arquivo.tipoConteudo)) {
    return 'TIPO_NAO_ACEITO';
  }

  if (arquivo.tamanhoBytes > regra.limiteBytes) {
    return 'TAMANHO_EXCEDIDO';
  }

  return null;
};

export const mensagemDaFalha = (tipo: TipoDeArquivo, falha: FalhaDeArquivo): string => {
  const regra = REGRAS_DE_ARQUIVO[tipo];

  switch (falha) {
    case 'ARQUIVO_VAZIO':
      return 'O arquivo está vazio.';
    case 'TIPO_NAO_ACEITO':
      return `Formato não aceito. Envie ${regra.extensoesAceitas.join(', ')}.`;
    case 'TAMANHO_EXCEDIDO':
      return `Arquivo acima do limite de ${formatarLimite(regra.limiteBytes)}.`;
    case 'CONTEUDO_NAO_CONFERE':
      return 'O conteúdo do arquivo não corresponde à extensão informada.';
    case 'FORMATO_XLS_NAO_SUPORTADO':
    case 'FORMATO_XLSM_NAO_SUPORTADO':
      return MENSAGEM_DO_ERRO_DE_PLANILHA[falha];
  }
};
