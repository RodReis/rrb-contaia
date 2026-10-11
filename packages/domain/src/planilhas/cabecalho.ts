/**
 * Cabeçalho de uma aba (SPEC-015 §3.4): sugestão da linha, identificação inequívoca das colunas e
 * bloqueio por célula mesclada.
 */
import { colunaParaLetra, letraParaColuna } from './colunas.js';
import { areaDaMescla } from './intervalos.js';
import type { CelulaDaTabela, LeituraDaAba, LinhaDaTabela, RotuloDaColuna } from './tipos.js';

/** Fórmula conta como conteúdo mesmo com resultado em branco: a célula não está vazia. */
export const celulaTemConteudo = (celula: CelulaDaTabela): boolean => celula.formula || celula.valorExibido.trim() !== '';

export const linhaTemConteudo = (linha: LinhaDaTabela): boolean => Object.values(linha.celulas).some(celulaTemConteudo);

/** Primeira linha com conteúdo da aba; `null` se a aba não tem nenhuma. */
export const sugerirLinhaDeCabecalho = (leitura: LeituraDaAba): number | null => {
  let menor: number | null = null;
  for (const linha of leitura.linhas) {
    if ((menor === null || linha.numero < menor) && linhaTemConteudo(linha)) {
      menor = linha.numero;
    }
  }
  return menor;
};

const nomeDaCelula = (celula: CelulaDaTabela | undefined): string | null => {
  const nome = celula?.valorExibido.trim() ?? '';
  return nome === '' ? null : nome;
};

/**
 * Colunas da linha de cabeçalho, de A até a última preenchida. O rótulo sempre leva a letra, o que
 * basta para distinguir nomes repetidos (inclusive só na caixa) e colunas sem nome. Linha
 * inexistente ou em branco não tem colunas.
 */
export const rotulosDasColunas = (leitura: LeituraDaAba, linhaCabecalho: number): readonly RotuloDaColuna[] => {
  const linha = leitura.linhas.find((candidata) => candidata.numero === linhaCabecalho);
  if (linha === undefined) {
    return [];
  }

  let ultima = 0;
  for (const [letra, celula] of Object.entries(linha.celulas)) {
    if (celulaTemConteudo(celula)) {
      ultima = Math.max(ultima, letraParaColuna(letra));
    }
  }

  return Array.from({ length: ultima }, (_, indice): RotuloDaColuna => {
    const letra = colunaParaLetra(indice + 1);
    const nome = nomeDaCelula(linha.celulas[letra]);
    return { letra, nome, rotulo: nome === null ? `Coluna ${letra} (sem nome)` : `Coluna ${letra} — ${nome}` };
  });
};

/** Alguma célula do cabeçalho faz parte de um intervalo mesclado (mapeada ou não). */
export const cabecalhoEstaMesclado = (leitura: LeituraDaAba, linhaCabecalho: number): boolean => {
  const linha = leitura.linhas.find((candidata) => candidata.numero === linhaCabecalho);
  if (linha !== undefined && Object.values(linha.celulas).some((celula) => celula.mesclada)) {
    return true;
  }

  return leitura.mesclas.some((mescla) => {
    const area = areaDaMescla(mescla);
    return area !== null && area.linhaInicial <= linhaCabecalho && linhaCabecalho <= area.linhaFinal;
  });
};

export interface ResumoDaAba {
  readonly ignoradasAntesDoCabecalho: number;
  /** Linhas com conteúdo depois do cabeçalho: as que contam para o limite de 10.000. */
  readonly linhasDeDados: number;
  /** Entre as linhas de dados. */
  readonly ocultas: number;
  readonly cabecalhoMesclado: boolean;
}

/** O que a inspeção mostra antes de haver mapeamento; as mesmas contagens que `tabelaParaRegistros` devolve. */
export const resumoDaAba = (leitura: LeituraDaAba, linhaCabecalho: number): ResumoDaAba => {
  const comConteudo = leitura.linhas.filter(linhaTemConteudo);
  const dados = comConteudo.filter((linha) => linha.numero > linhaCabecalho);
  return {
    ignoradasAntesDoCabecalho: comConteudo.filter((linha) => linha.numero < linhaCabecalho).length,
    linhasDeDados: dados.length,
    ocultas: dados.filter((linha) => linha.oculta).length,
    cabecalhoMesclado: cabecalhoEstaMesclado(leitura, linhaCabecalho),
  };
};

export interface LinhaDeAmostra {
  readonly numero: number;
  readonly oculta: boolean;
  /** Só as células preenchidas, em valor exibido. */
  readonly celulas: Readonly<Record<string, string>>;
}

/** As primeiras linhas com conteúdo da aba, a partir do topo: é entre elas que o usuário escolhe o cabeçalho. */
export const amostraDaAba = (leitura: LeituraDaAba, limite = 30): readonly LinhaDeAmostra[] =>
  leitura.linhas
    .filter(linhaTemConteudo)
    .sort((a, b) => a.numero - b.numero)
    .slice(0, limite)
    .map((linha) => ({
      numero: linha.numero,
      oculta: linha.oculta,
      celulas: Object.fromEntries(
        Object.entries(linha.celulas)
          .filter(([, celula]) => celula.valorExibido.trim() !== '')
          .map(([letra, celula]) => [letra, celula.valorExibido]),
      ),
    }));
