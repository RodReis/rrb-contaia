/**
 * Fonte única das regras de arquivo do escritório (SPEC-001 §3.2).
 *
 * Formato e tamanho são decisão técnica do Code, mas precisam valer igual na
 * interface e na API — por isso moram aqui e não duplicados nos dois lados.
 */

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

export type TipoDeArquivo = 'LOGO' | 'DOCUMENTO' | 'DOCUMENTO_DA_EMPRESA';

/**
 * Arquivo do cadastro do escritório (SPEC-001). Tipo próprio para o
 * compilador recusar o documento da empresa nesse caminho: a coluna `tipo` de
 * `escritorio_arquivo` só admite estes dois, e alargar `TipoDeArquivo` sem
 * estreitar aqui deixaria o erro chegar ao banco.
 */
export type TipoDeArquivoDoEscritorio = Extract<TipoDeArquivo, 'LOGO' | 'DOCUMENTO'>;

export type RegraDeArquivo = Readonly<{
  limiteBytes: number;
  tiposAceitos: readonly string[];
  extensoesAceitas: readonly string[];
}>;

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
};

export type FalhaDeArquivo =
  | 'TIPO_NAO_ACEITO'
  | 'TAMANHO_EXCEDIDO'
  | 'ARQUIVO_VAZIO'
  | 'CONTEUDO_NAO_CONFERE';

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

/** Devolve a falha ou `null` quando o arquivo é aceitável. */
export const validarArquivo = (
  tipo: TipoDeArquivo,
  arquivo: Readonly<{ tipoConteudo: string; tamanhoBytes: number }>,
): FalhaDeArquivo | null => {
  const regra = REGRAS_DE_ARQUIVO[tipo];

  if (arquivo.tamanhoBytes <= 0) {
    return 'ARQUIVO_VAZIO';
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
  }
};
