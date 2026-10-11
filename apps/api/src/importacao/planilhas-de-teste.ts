/**
 * Planilhas pequenas para os testes da API (fora do build, como `banco-em-memoria.ts`): montadas com
 * os construtores do próprio pacote leitor (`@contaia/planilhas/testes`), lidas pelo leitor REAL.
 */
import { colunaParaLetra } from '@contaia/domain';
import { abaXml, conteudoOds, ods, tabelaOds, xlsx } from '@contaia/planilhas/testes';

export type LinhaDeTeste = Readonly<{
  numero: number;
  valores: readonly string[];
  oculta?: boolean;
  /** Letra da coluna cuja célula é fórmula (o resultado salvo é o valor da posição). */
  formulaEm?: string;
}>;

export type AbaDeTeste = Readonly<{ nome: string; linhas: readonly LinhaDeTeste[]; mesclas?: readonly string[] }>;

const escapar = (texto: string): string => texto.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const celulaXlsx = (referencia: string, valor: string, formula: boolean): string =>
  formula
    ? `<c r="${referencia}" t="str"><f>1+1</f><v>${escapar(valor)}</v></c>`
    : `<c r="${referencia}" t="inlineStr"><is><t>${escapar(valor)}</t></is></c>`;

const abaXlsx = (aba: AbaDeTeste): string => {
  const linhas = [...aba.linhas]
    .sort((a, b) => a.numero - b.numero)
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

const celulaOds = (valor: string, formula: boolean): string =>
  valor === ''
    ? '<table:table-cell/>'
    : `<table:table-cell office:value-type="string"${formula ? ' table:formula="of:=1+1"' : ''}><text:p>${escapar(valor)}</text:p></table:table-cell>`;

/** ODS não tem número de linha: as lacunas viram linhas vazias repetidas. Mescla não é suportada aqui. */
const tabela = (aba: AbaDeTeste): string => {
  let proxima = 1;
  let xml = '';
  for (const linha of [...aba.linhas].sort((a, b) => a.numero - b.numero)) {
    if (linha.numero > proxima) {
      xml += `<table:table-row table:number-rows-repeated="${linha.numero - proxima}"><table:table-cell/></table:table-row>`;
    }
    const celulas = linha.valores.map((valor, i) => celulaOds(valor, linha.formulaEm === colunaParaLetra(i + 1))).join('');
    xml += `<table:table-row${linha.oculta === true ? ' table:visibility="collapsed"' : ''}>${celulas}</table:table-row>`;
    proxima = linha.numero + 1;
  }
  return tabelaOds(aba.nome, xml);
};

export const planilhaOds = (...abas: readonly AbaDeTeste[]): Buffer => Buffer.from(ods(conteudoOds(abas.map(tabela).join(''))));
