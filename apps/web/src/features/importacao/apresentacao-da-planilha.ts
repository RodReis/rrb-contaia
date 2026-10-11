/**
 * Textos e traduções puras da importação por planilha (SPEC-015 §3.3–3.5, §3.9), comuns aos dois
 * domínios. Sem React e sem rede: a tela só compõe o que sai daqui.
 */
import type { DiagnosticoDeLeituraDaPlanilha, FormatoDeArquivo } from '@contaia/shared';

import { plural } from './apresentacao';
import type { RascunhoDoMapeamento } from './dominio';

export type FormatoDoModelo = 'csv' | 'xlsx' | 'ods';

export const FORMATOS_DO_MODELO: readonly FormatoDoModelo[] = ['csv', 'xlsx', 'ods'];

export const ehPlanilha = (formato: FormatoDeArquivo | undefined): formato is 'XLSX' | 'ODS' =>
  formato === 'XLSX' || formato === 'ODS';

export const rotuloDaAba = (aba: Readonly<{ nome: string; posicao: number }>): string =>
  `${aba.nome} (posição ${aba.posicao})`;

export const resumoDasLinhas = (ignoradas: number, ocultas: number): string =>
  `${plural(ignoradas, 'linha anterior ignorada', 'linhas anteriores ignoradas')} · ${plural(
    ocultas,
    'linha oculta processada',
    'linhas ocultas processadas',
  )}`;

type ColunaComNome = Readonly<{ letra: string; nome: string | null }>;

/**
 * A sugestão do domínio é por nome (o do modelo do ContaIA); na planilha o mapeamento vai por letra.
 * Só vira letra o nome que aparece uma vez: com duas colunas iguais, nada é escolhido em silêncio.
 */
export const sugestaoPorLetra = (
  sugerir: (cabecalho: readonly string[]) => RascunhoDoMapeamento,
  colunas: readonly ColunaComNome[],
): RascunhoDoMapeamento => {
  const porNome = sugerir(colunas.map((coluna) => coluna.nome ?? ''));
  const sugestao: Partial<Record<string, string>> = {};

  for (const [campo, nome] of Object.entries(porNome)) {
    const iguais = colunas.filter((coluna) => nome !== undefined && nome !== '' && coluna.nome === nome);
    const unica = iguais.length === 1 ? iguais[0] : undefined;

    if (unica !== undefined) {
      sugestao[campo] = unica.letra;
    }
  }

  return sugestao;
};

/** `A`=1, `Z`=26, `AA`=27: ordem de coluna da planilha, não alfabética. */
const posicaoDaLetra = (letra: string): number =>
  [...letra].reduce((total, caractere) => total * 26 + (caractere.charCodeAt(0) - 64), 0);

/** Letras presentes em alguma linha da amostra, na ordem das colunas. */
export const letrasDasColunas = (linhas: readonly Readonly<Record<string, string>>[]): readonly string[] =>
  [...new Set(linhas.flatMap((celulas) => Object.keys(celulas)))].sort((a, b) => posicaoDaLetra(a) - posicaoDaLetra(b));

/** Coluna usada no mapeamento: na planilha é a letra ("Coluna C"); no CSV, o nome do cabeçalho. */
export const colunaDoMapeamento = (formato: FormatoDeArquivo | undefined, valor: string | undefined): string => {
  if (valor === undefined || valor === '') {
    return '—';
  }

  return ehPlanilha(formato) ? `Coluna ${valor}` : valor;
};

const DIAGNOSTICOS: Readonly<Record<DiagnosticoDeLeituraDaPlanilha['codigo'], readonly [string, string]>> = {
  LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS: [
    'linha anterior ao cabeçalho ignorada',
    'linhas anteriores ao cabeçalho ignoradas',
  ],
  LINHAS_OCULTAS_PROCESSADAS: ['linha oculta processada', 'linhas ocultas processadas'],
  LINHAS_COM_FORMULA_REJEITADAS: ['linha rejeitada por fórmula', 'linhas rejeitadas por fórmula'],
  LINHAS_COM_CELULA_MESCLADA_REJEITADAS: ['linha rejeitada por célula mesclada', 'linhas rejeitadas por célula mesclada'],
};

/** Texto fixo pelo código (a mensagem do servidor fica de fora: a tela não ecoa texto livre). */
export const descricaoDoDiagnostico = (diagnostico: DiagnosticoDeLeituraDaPlanilha): string => {
  const [singular, varios] = DIAGNOSTICOS[diagnostico.codigo];

  return plural(diagnostico.quantidade, singular, varios);
};

/** Quantidade de um diagnóstico estrutural (0 quando a leitura não o registrou). */
export const quantidadeDoDiagnostico = (
  diagnosticos: readonly DiagnosticoDeLeituraDaPlanilha[] | undefined,
  codigo: DiagnosticoDeLeituraDaPlanilha['codigo'],
): number => diagnosticos?.find((diagnostico) => diagnostico.codigo === codigo)?.quantidade ?? 0;

/** O relatório é sempre CSV (SPEC-015 §3.9), qualquer que seja o formato do original. */
export const nomeDoRelatorio = (nomeDoArquivo: string): string =>
  `relatorio-${nomeDoArquivo.replace(/\.(csv|xlsx|ods)$/iu, '')}.csv`;

export const nomeDoModelo = (nomeDoModeloCsv: string, formato: FormatoDoModelo): string =>
  nomeDoModeloCsv.replace(/\.csv$/u, `.${formato}`);
