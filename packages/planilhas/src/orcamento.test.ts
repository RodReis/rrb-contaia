/**
 * Revisão de segurança da Task 2: o trabalho total não pode crescer com referências repetidas à
 * mesma parte (orçamento de inflate por arquivo + partes distintas por papel).
 */
import { describe, expect, it } from 'vitest';

import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { LIMITES } from './limites.ts';
import { NS, entradaCrua, entradaXmlGrande, xlsx, xlsxCru } from './testes/construtores.ts';
import { esperarErro } from './testes/esperar.ts';
import { abrirZip } from './zip.ts';
import { escreverZip } from './zip-escrita.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const ABA = 'xl/worksheets/sheet1.xml';

const abaGrande = (mib: number) =>
  entradaXmlGrande(ABA, `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>`, ' ', mib, '</sheetData></worksheet>');

const pasta = (abas: number, idDaAba: (indice: number) => string = () => 'rId1'): string =>
  `<workbook xmlns="${NS}" xmlns:r="${R}"><sheets>${Array.from({ length: abas }, (_, i) => `<sheet name="A${i}" sheetId="${i + 1}" r:id="${idDaAba(i)}"/>`).join('')}</sheets></workbook>`;

const relacoes = (alvos: Record<string, [string, string]>): string =>
  `<Relationships xmlns="${PR}">${Object.entries(alvos)
    .map(([id, [tipo, alvo]]) => `<Relationship Id="${id}" Type="${R}/${tipo}" Target="${alvo}"/>`)
    .join('')}</Relationships>`;

const cronometrar = (fn: () => unknown): number => {
  const inicio = performance.now();
  try {
    fn();
  } catch {
    // o código é conferido à parte
  }
  return performance.now() - inicio;
};

describe('referências repetidas à mesma parte', () => {
  it('2.000 <sheet> com o mesmo r:id → código estável em < 2 s (não reinfla/reparseia a parte por aba)', () => {
    const bytes = xlsxCru([
      entradaCrua('xl/workbook.xml', pasta(2_000)),
      entradaCrua('xl/_rels/workbook.xml.rels', relacoes({ rId1: ['worksheet', 'worksheets/sheet1.xml'] })),
      abaGrande(120),
    ]);
    expect(bytes.length).toBeLessThan(400 * 1024);
    esperarErro(() => inspecionarPlanilha(bytes), 'ARQUIVO_CORROMPIDO', 'REFERENCIA_INVALIDA');
    expect(cronometrar(() => inspecionarPlanilha(bytes))).toBeLessThan(2_000);
  });

  it('duas abas com r:id diferentes que resolvem à mesma parte → ARQUIVO_CORROMPIDO', () => {
    const bytes = xlsxCru([
      entradaCrua('xl/workbook.xml', pasta(2, (i) => `rId${i + 1}`)),
      entradaCrua('xl/_rels/workbook.xml.rels', relacoes({ rId1: ['worksheet', 'worksheets/sheet1.xml'], rId2: ['worksheet', '/xl/worksheets/sheet1.xml'] })),
    ]);
    esperarErro(() => inspecionarPlanilha(bytes), 'ARQUIVO_CORROMPIDO', 'REFERENCIA_INVALIDA');
    esperarErro(() => lerAba(bytes, 2), 'ARQUIVO_CORROMPIDO', 'REFERENCIA_INVALIDA');
  });

  it('sharedStrings, styles e aba apontando para a mesma parte de 120 MiB → código estável em < 2 s', () => {
    const bytes = xlsxCru([
      entradaCrua('xl/workbook.xml', pasta(1)),
      entradaCrua(
        'xl/_rels/workbook.xml.rels',
        relacoes({ rId1: ['worksheet', 'worksheets/sheet1.xml'], rIdS: ['styles', 'worksheets/sheet1.xml'], rIdT: ['sharedStrings', 'worksheets/sheet1.xml'] }),
      ),
      abaGrande(120),
    ]);
    esperarErro(() => lerAba(bytes, 1), 'ARQUIVO_CORROMPIDO', 'REFERENCIA_INVALIDA');
    expect(cronometrar(() => lerAba(bytes, 1))).toBeLessThan(2_000);
  });

  it('arquivo legítimo com várias abas segue igual', () => {
    const aba = (t: string) => `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${t}</t></is></c></row></sheetData></worksheet>`;
    const bytes = xlsx({ abas: [{ nome: 'Um', xml: aba('1') }, { nome: 'Dois', xml: aba('2') }] });
    expect(inspecionarPlanilha(bytes).abas.map((a) => a.utilizavel)).toEqual([true, true]);
    expect(lerAba(bytes, 2).linhas[0]?.celulas['A']?.valorExibido).toBe('2');
  });
});

describe('orçamento de inflate por arquivo', () => {
  it('ler a mesma parte de novo conta no teto total: passou de 256 MiB → LIMITE (ZIP_BOMBA)', () => {
    const zip = abrirZip(escreverZip([{ nome: 'a', dados: 'x' }]));
    expect(zip.ler('a')?.toString()).toBe('x');
    const grande = abrirZip(xlsxCru([abaGrande(100)]));
    grande.ler(ABA);
    grande.ler(ABA);
    esperarErro(() => grande.ler(ABA), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ZIP_BOMBA');
  });

  it('o teto vem dos limites recebidos', () => {
    const zip = abrirZip(escreverZip([{ nome: 'a', dados: 'x'.repeat(100) }]), { ...LIMITES, bytesNoTotal: 250 });
    zip.ler('a');
    zip.ler('a');
    esperarErro(() => zip.ler('a'), 'LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ZIP_BOMBA');
  });
});
