/**
 * Planilhas reais do LibreOffice (fixtures/LEIAME no relatório da Task 2): geradas uma vez de
 * `fixtures/libreoffice.csv` com
 *   soffice --headless --infilter="CSV:59,34,76,1,1/2/2/2/3/2/4/4/5/1,1046" --convert-to xlsx|ods|xls
 * (colunas 1–3 como texto, 4 como data DMY, idioma pt-BR). A CI só lê os bytes; não precisa do LibreOffice.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { detectarFormato } from './sniff.ts';
import { esperarErro } from './testes/esperar.ts';

const fixture = (nome: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../fixtures/${nome}`, import.meta.url)));

const valores = (bytes: Uint8Array): string[][] =>
  lerAba(bytes, 1).linhas.map((l) => ['A', 'B', 'C', 'D', 'E'].map((letra) => l.celulas[letra]?.valorExibido ?? ''));

describe('planilhas reais do LibreOffice', () => {
  it('XLSX: abas, texto com zeros, CPF em texto, data nativa (formato dd/mm/yy do LibreOffice) e número', () => {
    const bytes = fixture('libreoffice.xlsx');
    expect(detectarFormato(bytes, '.xlsx')).toEqual({ formato: 'XLSX' });
    expect(inspecionarPlanilha(bytes)).toEqual({ formato: 'XLSX', abas: [{ nome: 'libreoffice', posicao: 1, utilizavel: true }] });
    expect(valores(bytes)).toEqual([
      ['codigo', 'cpf', 'nome', 'data_admissao', 'valor'],
      ['00123', '529.982.247-25', 'Maria da Silva', '15/03/23', '10'],
      ['00456', '111.444.777-35', 'João Souza', '01/02/20', '20.5'],
    ]);
    const datas = lerAba(bytes, 1).linhas.slice(1).map((l) => l.celulas['D']);
    expect(datas.map((c) => [c?.tipoNativo, c?.dataCivil])).toEqual([
      ['data', '2023-03-15'],
      ['data', '2020-02-01'],
    ]);
  });

  it('ODS: o mesmo conteúdo, valor exibido do próprio arquivo (pt-BR)', () => {
    const bytes = fixture('libreoffice.ods');
    expect(detectarFormato(bytes, '.ods')).toEqual({ formato: 'ODS' });
    expect(inspecionarPlanilha(bytes)).toEqual({ formato: 'ODS', abas: [{ nome: 'libreoffice', posicao: 1, utilizavel: true }] });
    expect(valores(bytes)).toEqual([
      ['codigo', 'cpf', 'nome', 'data_admissao', 'valor'],
      ['00123', '529.982.247-25', 'Maria da Silva', '15/03/23', '10'],
      ['00456', '111.444.777-35', 'João Souza', '01/02/20', '20,5'],
    ]);
    expect(lerAba(bytes, 1).linhas[1]?.celulas['D']).toMatchObject({ tipoNativo: 'data', dataCivil: '2023-03-15' });
  });

  it('XLS real (BIFF8) → FORMATO_XLS_NAO_SUPORTADO, inclusive renomeado para .xlsx', () => {
    const bytes = fixture('libreoffice.xls');
    esperarErro(() => detectarFormato(bytes, '.xls'), 'FORMATO_XLS_NAO_SUPORTADO');
    esperarErro(() => detectarFormato(bytes, '.xlsx'), 'FORMATO_XLS_NAO_SUPORTADO');
    esperarErro(() => inspecionarPlanilha(bytes), 'FORMATO_XLS_NAO_SUPORTADO');
  });

  it('CSV de origem segue como CSV', () => {
    expect(detectarFormato(fixture('libreoffice.csv'), '.csv')).toEqual({ formato: 'CSV' });
  });
});
