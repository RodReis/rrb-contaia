/**
 * Tetos do leitor de planilhas (SPEC-015 §3.2). Nenhum é limite funcional novo: um XLSX/ODS legítimo
 * de 10 MB e 10.000 linhas descompacta ~20–26 MB e fica muito abaixo de todos. Servem para barrar
 * arquivo hostil (bomba de ZIP, repetição, contagem forjada) antes de alocar memória.
 */
const MIB = 1024 * 1024;

export const LIMITES = {
  /** Tamanho do arquivo recebido (mesmo teto do upload, `@contaia/shared`). */
  bytesDoArquivo: 10 * MIB,
  entradasDoZip: 2_000,
  /** Tamanho descompactado declarado (e conferido no inflate) de uma parte. */
  bytesPorParte: 128 * MIB,
  /** Soma dos tamanhos descompactados declarados de todas as entradas do ZIP. */
  bytesNoTotal: 256 * MIB,
  /** Partes lidas só para descobrir o formato (`mimetype`, manifest, `[Content_Types].xml`). */
  bytesDeParteDeDeteccao: 1 * MIB,
  colunas: 16_384,
  /** Maior número de linha de uma aba (XLSX e ODS). */
  linhas: 1_048_576,
  celulas: 2_000_000,
  textosCompartilhados: 2_000_000,
  /** Maior texto de uma célula: o teto do Excel (32.767 caracteres). */
  caracteresPorCelula: 32_767,
  caracteresDoFormatoDeNumero: 255,
  /** Excel aceita até 64.000 formatos de célula; acima disso o arquivo é forjado. */
  estilos: 100_000,
  espacosDoTextS: 1_000,
  abas: 2_000,
  mesclas: 100_000,
  /**
   * Linhas com conteúdo materializadas da aba: 10.000 de dados + cabeçalho + 1.000 anteriores ao
   * cabeçalho. Acima disso a aba certamente passa do limite de linhas de dados (o domínio conta).
   */
  linhasComConteudo: 11_001,
  /** Saída do processo filho (JSON da leitura), em bytes. Uma aba de 10 MB legítima gera ~30 MB. */
  bytesDaSaida: 64 * MIB,
  tempoMs: 30_000,
  memoriaMb: 512,
} as const;

export type Limites = { readonly [K in keyof typeof LIMITES]: number };
