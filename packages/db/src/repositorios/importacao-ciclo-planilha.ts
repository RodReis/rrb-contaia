/**
 * Colunas de planilha da tentativa de importação (SPEC-015 §3.9, migração 0018): lista de seleção,
 * conversão para o contrato compartilhado e a gravação do que a leitura da planilha apurou.
 *
 * Mesmas regras do ciclo (`importacao-ciclo.ts`, que reexporta o que é público daqui): o descritor
 * chega já conferido contra a allowlist, nomes de tabela só vêm dele e valores são parâmetros; roda na
 * transação do chamador e filtra sempre pela `empresa_id` recebida, além da RLS.
 */
import { DiagnosticoDeLeituraSchema } from '@contaia/shared';
import type { DetalhesDePlanilha, DiagnosticoDeLeituraDaPlanilha, FormatoDeArquivo } from '@contaia/shared';
import type { PoolClient } from 'pg';

import type { DescritorDaImportacao } from './importacao-ciclo.js';

/** Colunas de planilha da tentativa (0018), como o `pg` as devolve. */
export type ColunasDePlanilha = {
  formato: FormatoDeArquivo;
  aba_nome: string | null;
  aba_posicao: number;
  linha_cabecalho: number;
  linhas_ignoradas_antes_do_cabecalho: number;
  linhas_ocultas: number;
  diagnosticos: DiagnosticoDeLeituraDaPlanilha[];
};

/** O que o worker apurou ao ler a planilha (SPEC-015 §3.9); a repetição do job sobrescreve. */
export type LeituraDaPlanilhaParaRegistrar = Readonly<{
  empresaId: string;
  tentativaId: string;
  linhasIgnoradasAntesDoCabecalho: number;
  linhasOcultas: number;
  diagnosticos: readonly DiagnosticoDeLeituraDaPlanilha[];
}>;

const NOMES_DAS_COLUNAS_DE_PLANILHA = [
  'formato',
  'aba_nome',
  'aba_posicao',
  'linha_cabecalho',
  'linhas_ignoradas_antes_do_cabecalho',
  'linhas_ocultas',
  'diagnosticos',
] as const;

/**
 * Lista de seleção das `ColunasDePlanilha`. Em consulta com junção, passar o alias da tentativa
 * (constante do chamador, nunca entrada externa): nome homônimo em outra tabela não fica ambíguo.
 */
export const colunasDePlanilhaSql = (alias?: 't'): string =>
  NOMES_DAS_COLUNAS_DE_PLANILHA.map((coluna) => (alias === undefined ? coluna : `${alias}.${coluna}`)).join(', ');

/** Colunas de planilha → contrato compartilhado (`aba` nula no CSV). */
export const paraDetalhesDePlanilha = (linha: ColunasDePlanilha): DetalhesDePlanilha => ({
  formato: linha.formato,
  aba: linha.aba_nome === null ? null : { nome: linha.aba_nome, posicao: linha.aba_posicao },
  linhaCabecalho: linha.linha_cabecalho,
  linhasIgnoradasAntesDoCabecalho: linha.linhas_ignoradas_antes_do_cabecalho,
  linhasOcultas: linha.linhas_ocultas,
  diagnosticosDaPlanilha: linha.diagnosticos,
});

/** Teto do contrato compartilhado (`camposDePlanilhaDaTentativa`): o histórico e a prévia o validam. */
const DiagnosticosDaLeituraSchema = DiagnosticoDeLeituraSchema.array().max(20);

/**
 * Grava linhas ignoradas antes do cabeçalho, ocultas e diagnósticos, só com a tentativa em RECEBIDA
 * ou VALIDANDO; a repetição do job sobrescreve (nunca acumula). Diagnóstico fora do contrato
 * compartilhado é recusado antes do banco. Devolve se gravou: o ciclo explica a recusa
 * (`registrarLeituraDaPlanilha`). `d` já passou por `exigirDescritor`.
 */
export const gravarLeituraDaPlanilha = async (
  cliente: PoolClient,
  d: DescritorDaImportacao,
  leitura: LeituraDaPlanilhaParaRegistrar,
): Promise<boolean> => {
  const diagnosticos = DiagnosticosDaLeituraSchema.parse(leitura.diagnosticos);
  const { rowCount } = await cliente.query(
    `update app.${d.tabela}
        set linhas_ignoradas_antes_do_cabecalho = $3, linhas_ocultas = $4, diagnosticos = $5::jsonb
      where id = $1 and empresa_id = $2 and estado in ('RECEBIDA', 'VALIDANDO')`,
    [
      leitura.tentativaId,
      leitura.empresaId,
      leitura.linhasIgnoradasAntesDoCabecalho,
      leitura.linhasOcultas,
      JSON.stringify(diagnosticos),
    ],
  );

  return rowCount === 1;
};
