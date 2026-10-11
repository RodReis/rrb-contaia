import type { CelulaDaTabela, LeituraDaAba } from '@contaia/domain';
import { LeituraDaAbaSchema } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { celulaOds as sc, conteudoOds, ods, tabelaOds } from './testes/construtores.ts';
import { esperarErro } from './testes/esperar.ts';

const DADOS =
  `<table:table-row>${['codigo', 'cpf', 'data', 'formula', 'mesclado'].map((t) => sc(t)).join('')}</table:table-row>` +
  `<table:table-row>${sc('00123')}${sc('529.982.247-25')}<table:table-cell office:value-type="date" office:date-value="2023-03-15"><text:p>15/03/2023</text:p></table:table-cell><table:table-cell table:formula="of:=1+1" office:value-type="float" office:value="2"><text:p>2</text:p></table:table-cell><table:table-cell table:number-columns-spanned="2" table:number-rows-spanned="1" office:value-type="string"><text:p>M</text:p></table:table-cell><table:covered-table-cell/></table:table-row>` +
  `<table:table-row table:visibility="collapsed">${sc('00456')}<table:table-cell office:value-type="float" office:value="52998224725"><text:p>529.982.247-25</text:p></table:table-cell><table:table-cell office:value-type="date" office:date-value="2023-03-15T18:00:00"><text:p>15/03/2023 18:00</text:p></table:table-cell><table:table-cell table:formula="of:=&quot;x&quot;&amp;&quot;y&quot;" office:value-type="string" office:string-value="xy"><text:p>xy</text:p></table:table-cell>${sc('coberta')}</table:table-row>` +
  `<table:table-row><table:table-cell office:value-type="float" office:value="123"><text:p>00123</text:p></table:table-cell><table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>VERDADEIRO</text:p></table:table-cell><table:table-cell table:formula="of:=1/0" office:value-type="float" office:value="0" calcext:value-type="error"><text:p>#DIV/0!</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>a<text:s text:c="3"/>b<text:tab/>c<text:line-break/>d <text:span>e</text:span></text:p><text:p>segunda</text:p><office:annotation><text:p>comentário</text:p></office:annotation></table:table-cell><table:table-cell office:value-type="float" office:value="7"/></table:table-row>` +
  `<table:table-row table:number-rows-repeated="2" table:visibility="filter">${sc('repetida')}<table:table-cell table:number-columns-repeated="3"/>${sc('fim')}</table:table-row>` +
  `<table:table-row table:number-rows-repeated="3"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>` +
  `<table:table-row><table:table-cell table:number-columns-repeated="2" office:value-type="string"><text:p>dup</text:p></table:table-cell><table:table-cell table:number-rows-spanned="2" office:value-type="string"><text:p>V</text:p></table:table-cell></table:table-row>` +
  `<table:table-row><table:table-cell table:number-columns-repeated="2"/><table:covered-table-cell/></table:table-row>` +
  `<table:table-row table:number-rows-repeated="1048560"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>`;

const PASTA = ods(
  conteudoOds(
    tabelaOds('Dados', DADOS, ' table:protected="true" table:protection-key="AAAA"') +
      tabelaOds('Vazia', '<table:table-row><table:table-cell/></table:table-row>') +
      tabelaOds('Fórmula só', '<table:table-row><table:table-cell table:formula="of:=A1"/></table:table-row>'),
  ),
);

const celula = (leitura: LeituraDaAba, ref: string): CelulaDaTabela | undefined => {
  const [, letra = '', numero = ''] = /^([A-Z]+)(\d+)$/u.exec(ref) ?? [];
  return leitura.linhas.find((l) => l.numero === Number(numero))?.celulas[letra];
};

describe('ODS — inspeção', () => {
  it('lista abas com posição e utilizável (fórmula conta como conteúdo)', () => {
    expect(inspecionarPlanilha(PASTA)).toEqual({
      formato: 'ODS',
      abas: [
        { nome: 'Dados', posicao: 1, utilizavel: true },
        { nome: 'Vazia', posicao: 2, utilizavel: false },
        { nome: 'Fórmula só', posicao: 3, utilizavel: true },
      ],
    });
  });
});

describe('ODS — células', () => {
  const leitura = lerAba(PASTA, 1);

  it('passa no schema estrito e identifica formato e aba', () => {
    expect(() => LeituraDaAbaSchema.parse(leitura)).not.toThrow();
    expect(leitura.formato).toBe('ODS');
    expect(leitura.aba).toEqual({ nome: 'Dados', posicao: 1, utilizavel: true });
  });

  it('valor exibido = text:p (máscara e zeros visíveis), tipo pelo office:value-type', () => {
    expect(celula(leitura, 'A2')).toEqual({ valorExibido: '00123', tipoNativo: 'texto', formula: false, mesclada: false });
    expect(celula(leitura, 'B3')).toEqual({ valorExibido: '529.982.247-25', tipoNativo: 'numero', formula: false, mesclada: false });
    expect(celula(leitura, 'A4')).toEqual({ valorExibido: '00123', tipoNativo: 'numero', formula: false, mesclada: false });
    expect(celula(leitura, 'B4')).toEqual({ valorExibido: 'VERDADEIRO', tipoNativo: 'booleano', formula: false, mesclada: false });
  });

  it('data nativa → data civil pelo office:date-value (com ou sem hora)', () => {
    expect(celula(leitura, 'C2')).toEqual({ valorExibido: '15/03/2023', tipoNativo: 'data', formula: false, mesclada: false, dataCivil: '2023-03-15' });
    expect(celula(leitura, 'C3')).toMatchObject({ valorExibido: '15/03/2023 18:00', dataCivil: '2023-03-15' });
  });

  it('fórmula detectada por table:formula, com o resultado salvo como exibido; erro calculado', () => {
    expect(celula(leitura, 'D2')).toEqual({ valorExibido: '2', tipoNativo: 'numero', formula: true, mesclada: false });
    expect(celula(leitura, 'D3')).toMatchObject({ valorExibido: 'xy', formula: true });
    expect(celula(leitura, 'C4')).toEqual({ valorExibido: '#DIV/0!', tipoNativo: 'erro', formula: true, mesclada: false });
  });

  it('text:s limitado, text:tab, text:line-break, spans e vários parágrafos; comentário fica de fora', () => {
    expect(celula(leitura, 'D4')?.valorExibido).toBe('a   b\tc\nd e\nsegunda');
  });

  it('célula tipada sem text:p usa o valor guardado', () => {
    expect(celula(leitura, 'E4')?.valorExibido).toBe('7');
  });

  it('mescla por number-columns/rows-spanned e covered-table-cell', () => {
    expect(leitura.mesclas).toEqual([
      { de: 'E2', ate: 'F2' },
      { de: 'C10', ate: 'C11' },
    ]);
    expect(celula(leitura, 'E2')?.mesclada).toBe(true);
    expect(celula(leitura, 'E3')).toMatchObject({ valorExibido: 'coberta', mesclada: false });
    expect(celula(leitura, 'C10')).toMatchObject({ valorExibido: 'V', mesclada: true });
  });

  it('linha oculta (collapsed e filter, inclusive repetida) é lida e contada', () => {
    const ocultas = leitura.linhas.filter((l) => l.oculta).map((l) => l.numero);
    expect(ocultas).toEqual([3, 5, 6]);
    expect(leitura.totalDeLinhasOcultas).toBe(3);
  });

  it('linhas e colunas repetidas legítimas: preenchidas são materializadas, vazias só avançam o contador', () => {
    expect(celula(leitura, 'A5')?.valorExibido).toBe('repetida');
    expect(celula(leitura, 'E6')?.valorExibido).toBe('fim');
    expect(celula(leitura, 'A10')?.valorExibido).toBe('dup');
    expect(celula(leitura, 'B10')?.valorExibido).toBe('dup');
    expect(leitura.linhas.map((l) => l.numero)).toEqual([1, 2, 3, 4, 5, 6, 10]);
  });

  it('proteção de aba sem criptografia não rejeita', () => {
    expect(leitura.linhas.length).toBeGreaterThan(0);
  });

  it('aba vazia é lida sem linhas; aba inexistente → ABA_INEXISTENTE', () => {
    expect(lerAba(PASTA, 2).linhas).toEqual([]);
    esperarErro(() => lerAba(PASTA, 4), 'ABA_INEXISTENTE');
  });
});
