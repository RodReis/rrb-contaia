/**
 * Moeda e percentual na borda da interface (FRONTEND.md §9, I-3): o estado guarda centavos inteiros
 * e centésimos de ponto percentual (`1550` = 15,50%); o texto formatado só existe na exibição.
 * Nada aqui usa ponto flutuante nem `parseFloat`: a conversão é feita sobre os dígitos.
 */
const MAXIMO_EM_CENTAVOS = BigInt(Number.MAX_SAFE_INTEGER);

const formatadorDeInteiro = new Intl.NumberFormat('pt-BR');

const exigirInteiroSeguro = (valor: number, nome: string): void => {
  if (!Number.isSafeInteger(valor)) {
    throw new RangeError(`${nome} deve ser um inteiro seguro: ${String(valor)}`);
  }
};

/** `123456` → `R$ 1.234,56`; a diferença negativa mantém o sinal (`-R$ 0,05`). */
export const formatarCentavos = (centavos: number): string => {
  exigirInteiroSeguro(centavos, 'centavos');

  const absoluto = BigInt(Math.abs(centavos));
  const reais = formatadorDeInteiro.format(absoluto / 100n);
  const resto = String(absoluto % 100n).padStart(2, '0');

  return `${centavos < 0 ? '-' : ''}R$ ${reais},${resto}`;
};

const VALOR_MASCARADO = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/u;

/**
 * Texto digitado ou colado em reais → centavos inteiros. Aceita `12.345,67`, `R$ 12.345,67`, `100` e
 * `100,5`; recusa o que não é inequívoco (`12.34`, `1,234`, negativo, notação científica).
 */
export const paraCentavos = (texto: string): number | null => {
  const limpo = texto.trim().replace(/^R\$\s*/u, '');
  const partes = VALOR_MASCARADO.exec(limpo);
  if (partes === null) {
    return null;
  }

  const total = BigInt((partes[1] ?? '').replaceAll('.', '')) * 100n + BigInt((partes[2] ?? '').padEnd(2, '0') || '0');

  return total > MAXIMO_EM_CENTAVOS ? null : Number(total);
};

const MAXIMO_EM_CENTESIMOS = 10_000;

/** `1550` → `15,50%`. */
export const formatarCentesimosDePercentual = (centesimos: number): string => {
  exigirInteiroSeguro(centesimos, 'centésimos de ponto percentual');

  return `${Math.trunc(centesimos / 100)},${String(centesimos % 100).padStart(2, '0')}%`;
};

const PERCENTUAL_DIGITADO = /^(\d{1,3})(?:,(\d{1,2}))?$/u;

/** `15,5` ou `15,50%` → `1550`; de 0 a 100% e com no máximo duas casas, senão `null`. */
export const paraCentesimosDePercentual = (texto: string): number | null => {
  const partes = PERCENTUAL_DIGITADO.exec(texto.trim().replace(/\s*%$/u, ''));
  if (partes === null) {
    return null;
  }

  const centesimos = Number(partes[1]) * 100 + Number((partes[2] ?? '').padEnd(2, '0') || '0');

  return centesimos > MAXIMO_EM_CENTESIMOS ? null : centesimos;
};
