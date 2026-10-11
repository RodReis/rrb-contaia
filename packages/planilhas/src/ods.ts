import type { AbaDaPlanilha, LeituraDaAba, TipoNativoDeCelula } from '@contaia/domain';

import { Coletor, ULTIMA_LINHA, temConteudo, type CelulaLida } from './coletor.ts';
import { ErroDePlanilha, corrompido, excedido } from './erros.ts';
import { dataCivilDoIso } from './formatos-de-numero.ts';
import type { Limites } from './limites.ts';
import { nomeDaAba } from './nome-da-aba.ts';
import { ParadaAntecipada, percorrerXml, type Elemento } from './xml.ts';
import type { ZipAberto } from './zip.ts';

/**
 * ODS: `content.xml` num único passe SAX. Os nomes com prefixo são os do ODF (`table:`, `office:`,
 * `text:`, `calcext:`) — o LibreOffice e os demais geradores usam sempre esses prefixos. Linhas e
 * colunas repetidas são contadores: só as preenchidas são materializadas (e contam nos tetos). Uma
 * repetição sem conteúdo não conta em teto nenhum, então nunca é iterada: célula repetida sem conteúdo
 * só avança a coluna, e linha repetida sem conteúdo nem mescla só avança a linha.
 */
const TIPOS: ReadonlyMap<string, TipoNativoDeCelula> = new Map([
  ['float', 'numero'],
  ['percentage', 'numero'],
  ['currency', 'numero'],
  ['time', 'numero'],
  ['date', 'data'],
  ['boolean', 'booleano'],
  ['string', 'texto'],
]);

const repeticoes = (valor: string | undefined): number => {
  const n = valor === undefined ? 1 : Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

interface CelulaEmLeitura {
  readonly profundidade: number;
  readonly repeticoes: number;
  readonly coberta: boolean;
  readonly atributos: Readonly<Record<string, string>>;
  /** Já houve algum `text:p` (vários parágrafos são unidos por quebra de linha). */
  temParagrafo: boolean;
  texto: string;
  emParagrafo: boolean;
}

interface Selecao {
  /** Posição (base 1) da aba a materializar; `null` só lista as abas. */
  readonly posicao: number | null;
}

interface Resultado {
  readonly abas: AbaDaPlanilha[];
  readonly leitura: LeituraDaAba | null;
}

const montarCelula = (c: CelulaEmLeitura): CelulaLida | null => {
  const a = c.atributos;
  const formula = a['table:formula'] !== undefined;
  const tipoOffice = a['office:value-type'];
  const valorExibido =
    c.temParagrafo
      ? c.texto
      : (a['office:string-value'] ?? a['office:value'] ?? a['office:date-value'] ?? a['office:boolean-value'] ?? a['office:time-value'] ?? '');
  if (valorExibido === '' && !formula && tipoOffice === undefined) return null;

  let tipoNativo: TipoNativoDeCelula = tipoOffice === undefined ? (valorExibido === '' ? 'vazio' : 'texto') : (TIPOS.get(tipoOffice) ?? 'texto');
  if (a['calcext:value-type'] === 'error') tipoNativo = 'erro';
  const dataCivil = tipoNativo === 'data' ? dataCivilDoIso(a['office:date-value'] ?? '') : undefined;
  return {
    valorExibido,
    tipoNativo,
    formula,
    ...(dataCivil === undefined ? {} : { dataCivil }),
    ...(c.coberta ? { coberta: true } : {}),
  };
};

const lerConteudo = (zip: ZipAberto, selecao: Selecao, limites: Limites): Resultado => {
  const dados = zip.ler('content.xml');
  if (dados === undefined) throw corrompido('PARTE_AUSENTE');

  const abas: AbaDaPlanilha[] = [];
  let leitura: LeituraDaAba | null = null;
  let profundidade = 0;
  let profundidadeDaTabela = 0; // > 1: tabela aninhada (ignorada)
  let nomeAtual = '';
  let coletor: Coletor | null = null;
  let utilizavel = false;
  let linha = 1;
  let coluna = 1;
  let repeticoesDaLinha = 1;
  let ocultaAtual = false;
  let celulasDaLinha = new Map<number, CelulaLida>();
  let linhaComConteudo = false;
  let mesclasDaLinha: [number, number, number][] = []; // coluna, colunas, linhas
  let celula: CelulaEmLeitura | null = null;

  const naTabela = (): boolean => profundidadeDaTabela === 1;

  const abrir = (e: Elemento): void => {
    profundidade += 1;
    const nome = e.nome;
    if (nome === 'table:table') {
      profundidadeDaTabela += 1;
      if (profundidadeDaTabela > 1) return;
      if (abas.length >= limites.abas) throw excedido('ABAS');
      nomeAtual = e.atributos['table:name'] ?? '';
      const posicao = abas.length + 1;
      coletor = selecao.posicao === posicao ? new Coletor(limites) : null;
      utilizavel = false;
      linha = 1;
      return;
    }
    if (!naTabela()) return;
    if (nome === 'table:table-row') {
      repeticoesDaLinha = repeticoes(e.atributos['table:number-rows-repeated']);
      // ODF: `visible` (padrão), `collapse` (oculta; o LibreOffice grava esta) ou `filter` (oculta
      // por filtro). Qualquer valor diferente de `visible` é linha oculta.
      const visibilidade = e.atributos['table:visibility'];
      ocultaAtual = visibilidade !== undefined && visibilidade !== 'visible';
      coluna = 1;
      celulasDaLinha = new Map();
      linhaComConteudo = false;
      mesclasDaLinha = [];
    } else if (nome === 'table:table-cell' || nome === 'table:covered-table-cell') {
      celula = {
        profundidade,
        repeticoes: repeticoes(e.atributos['table:number-columns-repeated']),
        coberta: nome === 'table:covered-table-cell',
        atributos: e.atributos,
        temParagrafo: false,
        texto: '',
        emParagrafo: false,
      };
      if (coletor !== null) {
        const colunas = repeticoes(e.atributos['table:number-columns-spanned']);
        const linhas = repeticoes(e.atributos['table:number-rows-spanned']);
        if (colunas > 1 || linhas > 1) {
          const ate = Math.min(celula.repeticoes, limites.colunas);
          for (let k = 0; k < ate; k++) mesclasDaLinha.push([coluna + k, colunas, linhas]);
        }
      }
    } else if (celula !== null) {
      if (nome === 'text:p' && profundidade === celula.profundidade + 1) {
        if (celula.temParagrafo) anexar(celula, '\n');
        celula.temParagrafo = true;
        celula.emParagrafo = true;
      } else if (celula.emParagrafo && nome === 'text:s') {
        const espacos = repeticoes(e.atributos['text:c']);
        if (espacos > limites.espacosDoTextS) throw excedido('TEXTO_DA_CELULA');
        anexar(celula, ' '.repeat(espacos));
      } else if (celula.emParagrafo && nome === 'text:tab') anexar(celula, '\t');
      else if (celula.emParagrafo && nome === 'text:line-break') anexar(celula, '\n');
    }
  };

  const anexar = (c: CelulaEmLeitura, mais: string): void => {
    if (c.texto.length + mais.length > limites.caracteresPorCelula) throw excedido('TEXTO_DA_CELULA');
    c.texto += mais;
  };

  const texto = (t: string): void => {
    if (celula !== null && celula.emParagrafo) anexar(celula, t);
  };

  const fecharCelula = (c: CelulaEmLeitura): void => {
    const pronta = montarCelula(c);
    const comConteudo = pronta !== null && temConteudo(pronta);
    if (comConteudo) {
      utilizavel = true;
      linhaComConteudo = true;
    }
    // Célula sem conteúdo repetida (tipada sem texto, só espaços) não é materializada: até 16.384
    // entradas por elemento, sem nada que conte nos tetos, viram laço quente em linhas repetidas.
    if (pronta !== null && coletor !== null && (comConteudo || c.repeticoes === 1)) {
      for (let k = 0; k < c.repeticoes; k++) {
        if (coluna + k > limites.colunas) throw excedido('COLUNAS');
        celulasDaLinha.set(coluna + k, pronta);
      }
    }
    coluna += c.repeticoes;
  };

  const fecharLinha = (): void => {
    // Sem conteúdo nem mescla, a repetição não produz nada (o Coletor descartaria cada linha depois de
    // varrer as células): só avança o contador. Com conteúdo, cada repetição conta nos tetos.
    if (coletor === null || (!linhaComConteudo && mesclasDaLinha.length === 0)) {
      linha += repeticoesDaLinha;
      return;
    }
    for (let r = 0; r < repeticoesDaLinha; r++) {
      const numero = linha + r;
      if (numero > ULTIMA_LINHA) {
        if (linhaComConteudo) throw corrompido('REFERENCIA_INVALIDA');
        break;
      }
      for (const [col, colunas, linhas] of mesclasDaLinha) coletor.mesclar(col, numero, col + colunas - 1, numero + linhas - 1);
      if (linhaComConteudo) coletor.fecharLinha(numero, ocultaAtual, celulasDaLinha);
    }
    linha += repeticoesDaLinha;
  };

  const fechar = (nome: string): void => {
    profundidade -= 1;
    if (nome === 'table:table') {
      profundidadeDaTabela -= 1;
      if (profundidadeDaTabela > 0) return;
      const posicao = abas.length + 1;
      abas.push({ nome: nomeDaAba(nomeAtual, posicao), posicao, utilizavel });
      if (coletor !== null) {
        leitura = coletor.leitura('ODS', { nome: nomeDaAba(nomeAtual, posicao), posicao });
        throw new ParadaAntecipada();
      }
      return;
    }
    if (!naTabela()) return;
    if (celula !== null && nome === 'text:p' && profundidade === celula.profundidade) {
      celula.emParagrafo = false;
    } else if (celula !== null && (nome === 'table:table-cell' || nome === 'table:covered-table-cell')) {
      fecharCelula(celula);
      celula = null;
    } else if (nome === 'table:table-row') fecharLinha();
  };

  percorrerXml(dados, { abrir, texto, fechar });
  return { abas, leitura };
};

export const inspecionarOds = (zip: ZipAberto, limites: Limites): AbaDaPlanilha[] => lerConteudo(zip, { posicao: null }, limites).abas;

export const lerAbaDoOds = (zip: ZipAberto, posicao: number, limites: Limites): LeituraDaAba => {
  const { leitura } = lerConteudo(zip, { posicao }, limites);
  if (leitura === null) throw new ErroDePlanilha('ABA_INEXISTENTE', 'ABA');
  return leitura;
};
