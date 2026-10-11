/** Diagnósticos de leitura de uma planilha (SPEC-015 §3.7): o que a prévia e o histórico mostram. */
import type { ResultadoTabular } from './tipos.js';

export const CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA = [
  'LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS',
  'LINHAS_OCULTAS_PROCESSADAS',
  'LINHAS_COM_FORMULA_REJEITADAS',
  'LINHAS_COM_CELULA_MESCLADA_REJEITADAS',
] as const;
export type CodigoDeDiagnosticoDePlanilha = (typeof CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA)[number];

export interface DiagnosticoDeLeitura {
  readonly codigo: CodigoDeDiagnosticoDePlanilha;
  /** Texto fixo em PT-BR; a quantidade vai separada. */
  readonly mensagem: string;
  readonly quantidade: number;
}

const MENSAGEM: Readonly<Record<CodigoDeDiagnosticoDePlanilha, string>> = {
  LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS: 'Linhas acima do cabeçalho escolhido foram ignoradas.',
  LINHAS_OCULTAS_PROCESSADAS: 'Linhas ocultas foram encontradas e processadas normalmente.',
  LINHAS_COM_FORMULA_REJEITADAS: 'Linhas com fórmula em coluna mapeada foram rejeitadas.',
  LINHAS_COM_CELULA_MESCLADA_REJEITADAS: 'Linhas com célula mesclada em coluna mapeada foram rejeitadas.',
};

/** Só inclui o que de fato ocorreu (quantidade > 0), na ordem de `CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA`. */
export const diagnosticosDaTabela = (resultado: ResultadoTabular): readonly DiagnosticoDeLeitura[] => {
  const rejeicoes = [...resultado.rejeicoesEstruturaisPorLinha.values()];
  const quantidades: Readonly<Record<CodigoDeDiagnosticoDePlanilha, number>> = {
    LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS: resultado.ignoradasAntesDoCabecalho,
    LINHAS_OCULTAS_PROCESSADAS: resultado.ocultas,
    LINHAS_COM_FORMULA_REJEITADAS: rejeicoes.filter((r) => r.codigo === 'CELULA_COM_FORMULA').length,
    LINHAS_COM_CELULA_MESCLADA_REJEITADAS: rejeicoes.filter((r) => r.codigo === 'CELULA_MESCLADA').length,
  };

  return CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA.filter((codigo) => quantidades[codigo] > 0).map((codigo) => ({
    codigo,
    mensagem: MENSAGEM[codigo],
    quantidade: quantidades[codigo],
  }));
};
