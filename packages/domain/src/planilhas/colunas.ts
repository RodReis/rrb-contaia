/** Índice de coluna (base 1) ↔ letra, de `A` a `XFD` (16.384 colunas, o teto do XLSX). */

export const ULTIMA_COLUNA = 16_384;

const ALFABETO = 26;
const CODIGO_DE_A = 65;
const FORMA_DA_LETRA = /^[A-Z]{1,3}$/u;

export const colunaParaLetra = (indice: number): string => {
  if (!Number.isInteger(indice) || indice < 1 || indice > ULTIMA_COLUNA) {
    throw new RangeError(`Coluna fora de A..XFD: ${String(indice)}.`);
  }

  let restante = indice;
  let letra = '';
  while (restante > 0) {
    const resto = (restante - 1) % ALFABETO;
    letra = String.fromCharCode(CODIGO_DE_A + resto) + letra;
    restante = Math.floor((restante - 1) / ALFABETO);
  }
  return letra;
};

const indiceDaLetra = (letra: string): number =>
  [...letra].reduce((total, caractere) => total * ALFABETO + (caractere.charCodeAt(0) - CODIGO_DE_A + 1), 0);

/** Só maiúsculas de `A` a `XFD`; é a forma em que a letra é guardada no mapeamento. */
export const ehLetraDeColuna = (letra: string): boolean =>
  FORMA_DA_LETRA.test(letra) && indiceDaLetra(letra) <= ULTIMA_COLUNA;

export const letraParaColuna = (letra: string): number => {
  if (!ehLetraDeColuna(letra)) {
    throw new RangeError(`Letra de coluna fora de A..XFD: ${letra}.`);
  }
  return indiceDaLetra(letra);
};
