import { describe, expect, it } from 'vitest';

import { inspecionarPlanilha } from './inspecionar.ts';
import { lerAba } from './ler-aba.ts';
import { gerarModelo } from './modelos.ts';
import { detectarFormato } from './sniff.ts';
import { abrirZip } from './zip.ts';

const CABECALHOS = ['cpf', 'nome', 'matricula', 'data_admissao', 'R&D <"x">'];
const EXEMPLO = ['529.982.247-25', 'Maria da Silva', '00123', '15/03/2023', "a & b < c > 'd'"];

describe.each(['XLSX', 'ODS'] as const)('gerarModelo %s', (formato) => {
  const bytes = gerarModelo(formato, CABECALHOS, EXEMPLO);

  it('é reconhecido pelo conteúdo com a extensão certa', () => {
    expect(detectarFormato(bytes, formato === 'XLSX' ? '.xlsx' : '.ods')).toEqual({ formato });
  });

  it('ida e volta no leitor: uma aba utilizável, cabeçalho e exemplo como texto, zeros preservados', () => {
    expect(inspecionarPlanilha(bytes)).toEqual({ formato, abas: [{ nome: 'Modelo', posicao: 1, utilizavel: true }] });
    const leitura = lerAba(bytes, 1);
    const linhas = leitura.linhas.map((l) => Object.entries(l.celulas).map(([letra, c]) => [letra, c.valorExibido, c.tipoNativo]));
    expect(linhas).toEqual([
      CABECALHOS.map((v, i) => [String.fromCharCode(65 + i), v, 'texto']),
      EXEMPLO.map((v, i) => [String.fromCharCode(65 + i), v, 'texto']),
    ]);
    expect(leitura.mesclas).toEqual([]);
    expect(leitura.totalDeLinhasOcultas).toBe(0);
  });

  it('é determinístico', () => {
    expect(gerarModelo(formato, CABECALHOS, EXEMPLO)).toEqual(bytes);
  });

  it('exemplo mais curto que o cabeçalho deixa as demais células vazias', () => {
    const leitura = lerAba(gerarModelo(formato, ['a', 'b'], ['1']), 1);
    expect(Object.keys(leitura.linhas[1]?.celulas ?? {})).toEqual(['A']);
  });

  it('recusa cabeçalho vazio, exemplo maior que o cabeçalho e caractere inválido em XML', () => {
    expect(() => gerarModelo(formato, [], [])).toThrow(RangeError);
    expect(() => gerarModelo(formato, ['a'], ['1', '2'])).toThrow(RangeError);
    expect(() => gerarModelo(formato, ['a\u0001'], [])).toThrow(RangeError);
  });
});

describe('gerarModelo — estrutura do pacote', () => {
  it('ODS: mimetype é a primeira entrada, armazenada, e há manifest', () => {
    const zip = abrirZip(gerarModelo('ODS', ['a'], ['b']));
    expect(zip.nomes[0]).toBe('mimetype');
    expect(zip.metodo('mimetype')).toBe(0);
    expect(zip.nomes).toContain('META-INF/manifest.xml');
  });

  it('XLSX: partes mínimas do OOXML', () => {
    const zip = abrirZip(gerarModelo('XLSX', ['a'], ['b']));
    expect(zip.nomes).toEqual(
      expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']),
    );
  });
});
