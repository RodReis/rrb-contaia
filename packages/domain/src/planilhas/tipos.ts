/**
 * Contrato tabular comum (SPEC-015 §3.5 e §6.1): o que o leitor de XLSX/ODS entrega ao domínio.
 *
 * Os tipos moram aqui (e não em `@contaia/shared`) porque o domínio não depende do shared; o shared
 * os reexporta e acrescenta os schemas zod. Nada neste módulo conhece formato de arquivo: o leitor
 * (`@contaia/planilhas`) interpreta o arquivo, e o domínio decide só o que as células significam.
 */
import type { RegistroDoCsv } from '../plano-contas/csv.js';

export type TipoNativoDeCelula = 'texto' | 'numero' | 'data' | 'booleano' | 'vazio' | 'erro';

export interface CelulaDaTabela {
  /** O que a planilha MOSTRA (máscara e zeros visíveis incluídos); alimenta a normalização. */
  readonly valorExibido: string;
  readonly tipoNativo: TipoNativoDeCelula;
  /** A célula contém fórmula. Nenhuma fórmula é executada; o resultado salvo não é confiável. */
  readonly formula: boolean;
  /** A célula faz parte de um intervalo mesclado (inclusive a primeira). */
  readonly mesclada: boolean;
  /** Data civil `aaaa-mm-dd`, sem fuso, quando a célula é uma data nativa. */
  readonly dataCivil?: string | undefined;
}

export interface LinhaDaTabela {
  /** Número original da linha na aba (1 = primeira linha da planilha). */
  readonly numero: number;
  readonly oculta: boolean;
  /** Chave = letra da coluna (`A`..`XFD`). Só as células materializadas pelo leitor. */
  readonly celulas: Readonly<Record<string, CelulaDaTabela>>;
}

export interface AbaDaPlanilha {
  readonly nome: string;
  /** Posição na pasta de trabalho, a partir de 1. */
  readonly posicao: number;
  readonly utilizavel: boolean;
}

export interface IntervaloMesclado {
  /** Célula inicial (ex.: `B2`). */
  readonly de: string;
  /** Célula final (ex.: `B4`). */
  readonly ate: string;
}

export interface LeituraDaAba {
  readonly formato: 'XLSX' | 'ODS';
  readonly aba: AbaDaPlanilha;
  /** Só as linhas com algum conteúdo, em qualquer ordem. */
  readonly linhas: readonly LinhaDaTabela[];
  readonly mesclas: readonly IntervaloMesclado[];
  readonly totalDeLinhasOcultas: number;
}

export interface ConfiguracaoDePlanilha {
  readonly abaPosicao: number;
  readonly linhaCabecalho: number;
}

export interface RotuloDaColuna {
  readonly letra: string;
  /** Nome no cabeçalho, aparado; `null` quando a célula está em branco. */
  readonly nome: string | null;
  /** Identificação inequívoca para a interface: `Coluna C — Nome` ou `Coluna D (sem nome)`. */
  readonly rotulo: string;
}

export type CodigoDeRejeicaoEstrutural = 'CELULA_COM_FORMULA' | 'CELULA_MESCLADA';

/** Célula de coluna mapeada que torna a linha inconfiável: a linha é rejeitada, só ela. */
export interface RejeicaoEstruturalDeCelula {
  readonly codigo: CodigoDeRejeicaoEstrutural;
  /** Letra da coluna afetada (a mais à esquerda; fórmula antes de mescla na mesma coluna). */
  readonly letra: string;
}

export interface OpcoesDaTabela {
  /**
   * Letras mapeadas para campos de data. Nelas, uma célula de data nativa alimenta a data civil
   * (`aaaa-mm-dd`); nas demais vale sempre o valor exibido.
   */
  readonly letrasDeData?: readonly string[];
}

export interface ResultadoTabular {
  /** Letras das colunas mapeadas, em ordem de coluna, sem repetição: o "cabeçalho" do domínio. */
  readonly cabecalho: readonly string[];
  /** Linhas de dados na largura de `cabecalho`; `numeroDaLinha` é o número original na aba. */
  readonly registros: readonly RegistroDoCsv[];
  /** Linhas com conteúdo acima do cabeçalho, descartadas e fora do limite de linhas. */
  readonly ignoradasAntesDoCabecalho: number;
  /** Linhas ocultas entre as linhas de dados: foram processadas normalmente. */
  readonly ocultas: number;
  /** Célula mesclada no cabeçalho: bloqueia o mapeamento (`registros` vem vazio). */
  readonly cabecalhoMesclado: boolean;
  /** Número da linha → rejeição por fórmula/mescla em coluna mapeada. */
  readonly rejeicoesEstruturaisPorLinha: ReadonlyMap<number, RejeicaoEstruturalDeCelula>;
}
