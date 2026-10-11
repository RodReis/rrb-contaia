/**
 * Modelos oficiais de importação (SPEC-015 §3.1): CSV, XLSX e ODS de cada domínio saem da MESMA
 * constante do modelo CSV (`MODELO_CSV`, `MODELO_CSV_DE_EMPREGADOS`): cabeçalho e a 1ª linha de
 * exemplo. Mudou o CSV, mudam os três.
 */
import { gerarModelo } from '@contaia/planilhas';
import { tipoDeConteudoDoFormato } from '@contaia/shared';
import { z } from 'zod';

import { CSV_UTF8, MARCA_DE_ORDEM } from './http';

export const consultaDoModeloSchema = z.object({ formato: z.enum(['csv', 'xlsx', 'ods']).default('csv') });

export type FormatoDoModelo = z.infer<typeof consultaDoModeloSchema>['formato'];

export type ModeloParaDownload = Readonly<{ conteudo: string | Buffer; tipoConteudo: string; extensao: FormatoDoModelo }>;

/** As constantes não têm aspas nem `;` dentro de campo: separar por `;` é exato (há teste com `lerCsv`). */
const celulasDa = (linha: string | undefined): string[] => (linha ?? '').split(';');

export const montarModelo = (modeloCsv: string, formato: FormatoDoModelo): ModeloParaDownload => {
  if (formato === 'csv') {
    // Com BOM, para o Excel abrir em UTF-8 (comportamento das F13/F14).
    return { conteudo: `${MARCA_DE_ORDEM}${modeloCsv}`, tipoConteudo: CSV_UTF8, extensao: 'csv' };
  }

  const [cabecalho, exemplo] = modeloCsv.split('\r\n');
  const planilha = formato === 'xlsx' ? 'XLSX' : 'ODS';

  return {
    conteudo: Buffer.from(gerarModelo(planilha, celulasDa(cabecalho), celulasDa(exemplo))),
    tipoConteudo: tipoDeConteudoDoFormato(planilha),
    extensao: formato,
  };
};
