/**
 * Limite de texto que a inspeção devolve (SPEC-015): uma célula do Excel chega a 32.767 caracteres, e
 * a resposta é validada com schema estrito no web. É a ÚNICA constante: o schema do `@contaia/shared`
 * deriva dela os seus `max`, então domínio e schema não divergem. Medido em unidades UTF-16, como o
 * `.max()` do zod.
 */
export const LIMITE_DE_TEXTO_DA_INSPECAO = 1000;

/** Rótulo = "Coluna XFD — " (13 caracteres) + nome; a folga cobre o prefixo com sobra. */
export const LIMITE_DO_ROTULO_DA_COLUNA = LIMITE_DE_TEXTO_DA_INSPECAO + 100;

const ALTO_SUBSTITUTO_MINIMO = 0xd800;
const ALTO_SUBSTITUTO_MAXIMO = 0xdbff;
const RETICENCIAS = '…';

/**
 * Corta em `limite` unidades UTF-16 no máximo, terminando em `…`. Nunca parte um par substituto
 * (emoji): se o corte cairia entre as duas metades, a metade alta é descartada. Texto que cabe volta
 * inalterado. Determinística.
 */
export const truncarTexto = (texto: string, limite: number): string => {
  if (texto.length <= limite) {
    return texto;
  }

  let fim = Math.max(limite - RETICENCIAS.length, 0);
  const ultima = texto.charCodeAt(fim - 1);
  if (fim > 0 && ultima >= ALTO_SUBSTITUTO_MINIMO && ultima <= ALTO_SUBSTITUTO_MAXIMO) {
    fim -= 1;
  }
  return `${texto.slice(0, fim)}${RETICENCIAS}`;
};
