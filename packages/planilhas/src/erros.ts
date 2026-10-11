import type { CodigoDeErro } from '@contaia/domain';

/** Códigos públicos (fixados na SPEC-015) que o leitor pode lançar. */
export const CODIGOS_DO_LEITOR = [
  'ARQUIVO_VAZIO',
  'ARQUIVO_ACIMA_DO_LIMITE',
  'FORMATO_XLS_NAO_SUPORTADO',
  'FORMATO_XLSM_NAO_SUPORTADO',
  'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO',
  'ARQUIVO_CORROMPIDO',
  'EXTENSAO_DIFERENTE_DO_CONTEUDO',
  'ABA_INEXISTENTE',
  'LIMITE_DE_PROCESSAMENTO_EXCEDIDO',
] as const satisfies readonly CodigoDeErro[];

export type CodigoDoLeitor = (typeof CODIGOS_DO_LEITOR)[number];

/**
 * Motivo interno, só para log e teste: nunca contém nome de aba, de parte, texto de célula ou
 * qualquer conteúdo do arquivo.
 */
export const DETALHES_DO_ERRO = [
  'VAZIO',
  'TAMANHO',
  'XLS',
  'XLSM',
  'CFB_CIFRADO',
  'ODS_CIFRADO',
  'ENTRADA_CIFRADA',
  'NAO_E_PLANILHA',
  'EXTENSAO_NAO_ACEITA',
  'ZIP_TRUNCADO',
  'ZIP_INVALIDO',
  'ZIP64',
  'METODO_DE_COMPRESSAO',
  'DEFLATE_INVALIDO',
  'CRC_OU_TAMANHO',
  'PARTE_AUSENTE',
  'XML_INVALIDO',
  'DTD_PROIBIDO',
  'CODIFICACAO',
  'REFERENCIA_INVALIDA',
  'ZIP_BOMBA',
  'ENTRADAS',
  'COLUNAS',
  'LINHAS',
  'CELULAS',
  'TEXTOS_COMPARTILHADOS',
  'TEXTO_DA_CELULA',
  'ESTILOS',
  'ABAS',
  'MESCLAS',
  'SAIDA',
  'TEMPO',
  'MEMORIA',
  'ABA',
] as const;

export type DetalheDoErro = (typeof DETALHES_DO_ERRO)[number];

/** Arquivo ou configuração inválida: rejeição estrutural com código estável (nunca HTTP 500). */
export class ErroDePlanilha extends Error {
  readonly codigo: CodigoDoLeitor;
  readonly detalhe: DetalheDoErro | undefined;

  constructor(codigo: CodigoDoLeitor, detalhe?: DetalheDoErro) {
    super(detalhe === undefined ? codigo : `${codigo} (${detalhe})`);
    this.name = 'ErroDePlanilha';
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** Falha técnica do isolamento (subir o processo, canal quebrado): a tentativa pode ser repetida. */
export class ErroDeInfraestrutura extends Error {
  constructor(mensagem: string, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'ErroDeInfraestrutura';
  }
}

export const corrompido = (detalhe: DetalheDoErro): ErroDePlanilha => new ErroDePlanilha('ARQUIVO_CORROMPIDO', detalhe);

export const excedido = (detalhe: DetalheDoErro): ErroDePlanilha =>
  new ErroDePlanilha('LIMITE_DE_PROCESSAMENTO_EXCEDIDO', detalhe);
