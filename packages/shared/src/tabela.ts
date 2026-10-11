import {
  CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA,
  ehLetraDeColuna,
  type AbaDaPlanilha,
  type CelulaDaTabela,
  type ConfiguracaoDePlanilha,
  type IntervaloMesclado,
  type LeituraDaAba,
  type LinhaDaTabela,
  type TipoNativoDeCelula,
} from '@contaia/domain';
import { z } from 'zod';

/**
 * Contrato tabular e de planilha (SPEC-015). Os tipos da leitura moram no `@contaia/domain` (que
 * não depende do shared) e são reexportados daqui; este módulo acrescenta os schemas `.strict()`
 * para o canal do leitor, a inspeção, a configuração de aba/cabeçalho e os campos aditivos de
 * prévia e histórico. Sem Node: o web importa este módulo.
 */
export type {
  AbaDaPlanilha,
  CelulaDaTabela,
  ConfiguracaoDePlanilha,
  IntervaloMesclado,
  LeituraDaAba,
  LinhaDaTabela,
  TipoNativoDeCelula,
};

export const FORMATOS_DE_ARQUIVO = ['CSV', 'XLSX', 'ODS'] as const;
export type FormatoDeArquivo = (typeof FORMATOS_DE_ARQUIVO)[number];
export const FORMATOS_DE_PLANILHA = ['XLSX', 'ODS'] as const;

export const FormatoDeArquivoSchema = z.enum(FORMATOS_DE_ARQUIVO);
const FormatoDePlanilhaSchema = z.enum(FORMATOS_DE_PLANILHA);

const LIMITE_DE_LINHAS_DA_PLANILHA = 1_048_576;
const posicao = z.number().int().min(1).max(LIMITE_DE_LINHAS_DA_PLANILHA);
const contagem = z.number().int().min(0);

/** Letra de coluna no formato em que o mapeamento a guarda: maiúsculas, de `A` a `XFD`. */
export const LetraDeColunaSchema = z.string().refine(ehLetraDeColuna, 'Letra de coluna fora de A..XFD.');

const TIPOS_NATIVOS = ['texto', 'numero', 'data', 'booleano', 'vazio', 'erro'] as const satisfies readonly TipoNativoDeCelula[];

export const CelulaDaTabelaSchema = z.strictObject({
  valorExibido: z.string(),
  tipoNativo: z.enum(TIPOS_NATIVOS),
  formula: z.boolean(),
  mesclada: z.boolean(),
  dataCivil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
});

export const LinhaDaTabelaSchema = z.strictObject({
  numero: posicao,
  oculta: z.boolean(),
  celulas: z.record(LetraDeColunaSchema, CelulaDaTabelaSchema),
});

export const AbaDaPlanilhaSchema = z.strictObject({
  nome: z.string().min(1).max(255),
  posicao: posicao,
  utilizavel: z.boolean(),
});

export const IntervaloMescladoSchema = z.strictObject({
  de: z.string().regex(/^[A-Z]{1,3}[0-9]{1,7}$/u),
  ate: z.string().regex(/^[A-Z]{1,3}[0-9]{1,7}$/u),
});

/** Saída do leitor de uma aba (a validação estrita do que volta do processo filho). */
export const LeituraDaAbaSchema = z.strictObject({
  formato: FormatoDePlanilhaSchema,
  aba: AbaDaPlanilhaSchema,
  linhas: z.array(LinhaDaTabelaSchema),
  mesclas: z.array(IntervaloMescladoSchema),
  totalDeLinhasOcultas: contagem,
}) satisfies z.ZodType<LeituraDaAba>; // amarra o schema ao tipo do domínio: divergência quebra o typecheck

/** Escolha da aba (posição, base 1) e da linha de cabeçalho: parte da identidade idempotente. */
export const ConfiguracaoDePlanilhaSchema = z.strictObject({
  abaPosicao: posicao,
  linhaCabecalho: posicao,
}) satisfies z.ZodType<ConfiguracaoDePlanilha>;

/**
 * Campos de planilha do envio (`POST importacoes`), repetidos com o arquivo no multipart: tudo chega
 * como texto, daí a coerção. Obrigatórios para XLSX/ODS; o CSV não os envia.
 */
export const CamposDePlanilhaDoEnvioSchema = z.strictObject({
  aba: z.coerce.number().pipe(posicao),
  linhaCabecalho: z.coerce.number().pipe(posicao),
});

/** Campos da inspeção sem estado: ambos opcionais (aba única é automática; cabeçalho é sugerido). */
export const PedidoDeInspecaoSchema = z.strictObject({
  aba: z.coerce.number().pipe(posicao).optional(),
  linhaCabecalho: z.coerce.number().pipe(posicao).optional(),
});

/** Diagnóstico de leitura (fórmula, mescla, ocultas, linhas ignoradas): texto fixo e quantidade. */
export const DiagnosticoDeLeituraSchema = z.strictObject({
  codigo: z.enum(CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA),
  mensagem: z.string().min(1).max(500),
  quantidade: contagem,
});
export type DiagnosticoDeLeituraDaPlanilha = z.infer<typeof DiagnosticoDeLeituraSchema>;

export const IdentificacaoDaAbaSchema = z.strictObject({
  nome: z.string().min(1).max(255),
  posicao: posicao,
});

export const ColunaDaPlanilhaSchema = z.strictObject({
  letra: LetraDeColunaSchema,
  nome: z.string().max(1000).nullable(),
  rotulo: z.string().min(1).max(1100),
});

export const LinhaDeAmostraSchema = z.strictObject({
  numero: posicao,
  oculta: z.boolean(),
  celulas: z.record(LetraDeColunaSchema, z.string().max(1000)),
});

/**
 * Resposta da inspeção sem estado (`POST .../planilhas/inspecao`): nada é gravado. Com várias abas
 * utilizáveis e nenhuma escolhida, `abaSelecionada`, o cabeçalho, as colunas e a amostra vêm vazios.
 */
export const InspecaoDePlanilhaSchema = z.strictObject({
  formato: FormatoDePlanilhaSchema,
  abas: z.array(AbaDaPlanilhaSchema).max(1000),
  abaSelecionada: IdentificacaoDaAbaSchema.nullable(),
  linhaCabecalhoSugerida: posicao.nullable(),
  linhaCabecalho: posicao.nullable(),
  colunas: z.array(ColunaDaPlanilhaSchema).max(16_384),
  amostra: z.array(LinhaDeAmostraSchema).max(50),
  linhasIgnoradasAntesDoCabecalho: contagem,
  linhasOcultas: contagem,
  cabecalhoMesclado: z.boolean(),
  diagnosticos: z.array(DiagnosticoDeLeituraSchema).max(20),
});
export type InspecaoDePlanilha = z.infer<typeof InspecaoDePlanilhaSchema>;

/**
 * Campos de planilha que a prévia e o histórico ganham. Todos opcionais: a resposta de antes da F15
 * (e a do CSV, quando a API os omite) continua válida, e o padrão de quem os omite é o CSV
 * (`DETALHES_DE_PLANILHA_DO_CSV`).
 */
export const camposDePlanilhaDaTentativa = {
  formato: FormatoDeArquivoSchema.optional(),
  /** `null` no CSV (não há aba). */
  aba: IdentificacaoDaAbaSchema.nullable().optional(),
  linhaCabecalho: posicao.optional(),
  linhasIgnoradasAntesDoCabecalho: contagem.optional(),
  linhasOcultas: contagem.optional(),
  diagnosticosDaPlanilha: z.array(DiagnosticoDeLeituraSchema).max(20).optional(),
};

export interface DetalhesDePlanilha {
  readonly formato: FormatoDeArquivo;
  readonly aba: Readonly<{ nome: string; posicao: number }> | null;
  readonly linhaCabecalho: number;
  readonly linhasIgnoradasAntesDoCabecalho: number;
  readonly linhasOcultas: number;
  readonly diagnosticosDaPlanilha: readonly DiagnosticoDeLeituraDaPlanilha[];
}

export const DETALHES_DE_PLANILHA_DO_CSV: DetalhesDePlanilha = {
  formato: 'CSV',
  aba: null,
  linhaCabecalho: 1,
  linhasIgnoradasAntesDoCabecalho: 0,
  linhasOcultas: 0,
  diagnosticosDaPlanilha: [],
};

/** Preenche com o padrão de CSV o que a resposta não trouxe. */
export const detalhesDePlanilhaComPadraoDoCsv = (detalhes: Partial<DetalhesDePlanilha>): DetalhesDePlanilha => ({
  ...DETALHES_DE_PLANILHA_DO_CSV,
  ...Object.fromEntries(Object.entries(detalhes).filter(([, valor]) => valor !== undefined)),
});

/**
 * Códigos estáveis de rejeição do ARQUIVO ou da configuração da planilha (nunca HTTP 500). O
 * domínio os conhece em `CODIGOS_DE_ERRO`; um teste daqui garante. `CABECALHO_INVALIDO`,
 * `ARQUIVO_VAZIO` e `ARQUIVO_ACIMA_DO_LIMITE` valem para planilha, mas já existiam (F13).
 */
export const CODIGOS_DE_ERRO_DE_PLANILHA = [
  'FORMATO_XLS_NAO_SUPORTADO',
  'FORMATO_XLSM_NAO_SUPORTADO',
  'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO',
  'ARQUIVO_CORROMPIDO',
  'EXTENSAO_DIFERENTE_DO_CONTEUDO',
  'PLANILHA_SEM_ABA_UTILIZAVEL',
  'ABA_INEXISTENTE',
  'ABA_SEM_DADOS',
  'CABECALHO_MESCLADO',
  'CONFIGURACAO_DE_PLANILHA_INCOMPLETA',
  'LIMITE_DE_PROCESSAMENTO_EXCEDIDO',
  'SERVICO_OCUPADO',
] as const;
export type CodigoDeErroDePlanilha = (typeof CODIGOS_DE_ERRO_DE_PLANILHA)[number];

/** Mensagem fixa e acionável de cada código; nunca repete nome de aba, de coluna nem valor de célula. */
export const MENSAGEM_DO_ERRO_DE_PLANILHA: Readonly<Record<CodigoDeErroDePlanilha, string>> = {
  FORMATO_XLS_NAO_SUPORTADO:
    'O formato .xls (Excel 97-2003) não é aceito. Abra o arquivo no Excel ou no LibreOffice e salve como .xlsx, .ods ou .csv.',
  FORMATO_XLSM_NAO_SUPORTADO:
    'Planilhas com macro (.xlsm) não são aceitas. Salve uma cópia sem macros como .xlsx, .ods ou .csv.',
  ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO:
    'O arquivo está protegido por senha ou criptografado. Remova a proteção, salve uma cópia e envie de novo.',
  ARQUIVO_CORROMPIDO:
    'Não foi possível ler o arquivo: ele parece corrompido. Abra-o no Excel ou no LibreOffice, salve uma nova cópia e envie de novo.',
  EXTENSAO_DIFERENTE_DO_CONTEUDO:
    'O conteúdo do arquivo não corresponde à extensão. Salve a planilha no formato correto (.xlsx, .ods ou .csv) e envie de novo.',
  PLANILHA_SEM_ABA_UTILIZAVEL: 'A planilha não tem nenhuma aba com dados utilizáveis.',
  ABA_INEXISTENTE: 'A aba escolhida não existe nesta planilha. Escolha uma das abas listadas.',
  ABA_SEM_DADOS: 'A aba escolhida está vazia. Escolha outra aba.',
  CABECALHO_MESCLADO:
    'A linha de cabeçalho tem células mescladas. Desfaça a mescla ou escolha outra linha de cabeçalho.',
  CONFIGURACAO_DE_PLANILHA_INCOMPLETA: 'Escolha a aba e a linha de cabeçalho antes de continuar.',
  LIMITE_DE_PROCESSAMENTO_EXCEDIDO:
    'O arquivo excede o limite seguro de processamento. Reduza a planilha ou divida em arquivos menores.',
  SERVICO_OCUPADO: 'O serviço de leitura de planilhas está ocupado. Tente novamente em instantes.',
};
