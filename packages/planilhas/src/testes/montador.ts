/**
 * Planilhas pequenas por linhas (oculta, fórmula, mescla) para os testes da API e dos workers, lidas
 * pelo leitor REAL. Mesmo conteúdo em XLSX e ODS: é com elas que se prova a equivalência de formato.
 */
import { colunaParaLetra, letraParaColuna } from '@contaia/domain';

import { abaXml, conteudoOds, ods, tabelaOds, xlsx } from './construtores.ts';

export type LinhaDeTeste = Readonly<{
  numero: number;
  valores: readonly string[];
  oculta?: boolean;
  /** Letra da coluna cuja célula é fórmula (o resultado salvo é o valor da posição). */
  formulaEm?: string;
}>;

/** `mesclas`: intervalos como `B5:C6`; as células cobertas (fora a do canto) não levam valor. */
export type AbaDeTeste = Readonly<{ nome: string; linhas: readonly LinhaDeTeste[]; mesclas?: readonly string[] }>;

const escapar = (texto: string): string => texto.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const ordenadas = (aba: AbaDeTeste): readonly LinhaDeTeste[] => [...aba.linhas].sort((a, b) => a.numero - b.numero);

const celulaXlsx = (referencia: string, valor: string, formula: boolean): string =>
  formula
    ? `<c r="${referencia}" t="str"><f>1+1</f><v>${escapar(valor)}</v></c>`
    : `<c r="${referencia}" t="inlineStr"><is><t>${escapar(valor)}</t></is></c>`;

const abaXlsx = (aba: AbaDeTeste): string => {
  const linhas = ordenadas(aba)
    .map((linha) => {
      const celulas = linha.valores
        .map((valor, i) => (valor === '' ? '' : celulaXlsx(`${colunaParaLetra(i + 1)}${linha.numero}`, valor, linha.formulaEm === colunaParaLetra(i + 1))))
        .join('');
      return `<row r="${linha.numero}"${linha.oculta === true ? ' hidden="1"' : ''}>${celulas}</row>`;
    })
    .join('');
  const mesclas = aba.mesclas ?? [];
  const extra = mesclas.length === 0 ? '' : `<mergeCells count="${mesclas.length}">${mesclas.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  return abaXml(linhas, extra);
};

export const planilhaXlsx = (...abas: readonly AbaDeTeste[]): Buffer =>
  Buffer.from(xlsx({ abas: abas.map((aba) => ({ nome: aba.nome, xml: abaXlsx(aba) })) }));

type Area = Readonly<{ coluna: number; linha: number; colunas: number; linhas: number }>;

const area = (intervalo: string): Area => {
  const [de, ate] = intervalo.split(':').map((ref) => {
    const partes = /^([A-Z]+)(\d+)$/u.exec(ref ?? '');
    if (partes === null) throw new RangeError(`intervalo inválido: ${intervalo}`);
    return { coluna: letraParaColuna(partes[1]!), linha: Number(partes[2]) };
  });
  return { coluna: de!.coluna, linha: de!.linha, colunas: ate!.coluna - de!.coluna + 1, linhas: ate!.linha - de!.linha + 1 };
};

/** ODS: a mescla é o canto com `number-*-spanned` e as demais posições como `covered-table-cell`. */
const celulaOds = (valor: string, formula: boolean, mescla: string): string =>
  valor === '' && mescla === ''
    ? '<table:table-cell/>'
    : `<table:table-cell office:value-type="string"${formula ? ' table:formula="of:=1+1"' : ''}${mescla}><text:p>${escapar(valor)}</text:p></table:table-cell>`;

const tabela = (aba: AbaDeTeste): string => {
  const areas = (aba.mesclas ?? []).map(area);
  const dentro = (linha: number, coluna: number): Area | undefined =>
    areas.find((a) => a.linha <= linha && linha < a.linha + a.linhas && a.coluna <= coluna && coluna < a.coluna + a.colunas);
  let proxima = 1;
  let xml = '';
  for (const linha of ordenadas(aba)) {
    // ODS não tem número de linha: as lacunas viram linhas vazias repetidas.
    if (linha.numero > proxima) {
      xml += `<table:table-row table:number-rows-repeated="${linha.numero - proxima}"><table:table-cell/></table:table-row>`;
    }
    const celulas = linha.valores
      .map((valor, i) => {
        const coluna = i + 1;
        const a = dentro(linha.numero, coluna);
        if (a !== undefined && (a.linha !== linha.numero || a.coluna !== coluna)) return '<table:covered-table-cell/>';
        const mescla = a === undefined ? '' : ` table:number-columns-spanned="${a.colunas}" table:number-rows-spanned="${a.linhas}"`;
        return celulaOds(valor, linha.formulaEm === colunaParaLetra(coluna), mescla);
      })
      .join('');
    xml += `<table:table-row${linha.oculta === true ? ' table:visibility="collapse"' : ''}>${celulas}</table:table-row>`;
    proxima = linha.numero + 1;
  }
  return tabelaOds(aba.nome, xml);
};

export const planilhaOds = (...abas: readonly AbaDeTeste[]): Buffer => Buffer.from(ods(conteudoOds(abas.map(tabela).join(''))));
