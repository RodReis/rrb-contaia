/**
 * Validação de CNPJ numérico e alfanumérico.
 *
 * A partir de 2026 a raiz e a ordem do CNPJ aceitam letras (ADR-006); os dois
 * dígitos verificadores continuam numéricos. O cálculo do DV usa o valor ASCII
 * do caractere menos 48, o que preserva o resultado dos CNPJs só com dígitos.
 */

const TAMANHO = 14;
const PESOS_PRIMEIRO_DV = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_SEGUNDO_DV = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const ASCII_ZERO = 48;

export const normalizarCnpj = (entrada: string): string =>
  entrada.toUpperCase().replace(/[^0-9A-Z]/g, '');

const calcularDigito = (base: string, pesos: readonly number[]): number => {
  const soma = pesos.reduce((acumulado, peso, indice) => {
    const caractere = base.charCodeAt(indice) - ASCII_ZERO;

    return acumulado + caractere * peso;
  }, 0);

  const resto = soma % 11;

  return resto < 2 ? 0 : 11 - resto;
};

export const ehCnpjValido = (entrada: string): boolean => {
  const cnpj = normalizarCnpj(entrada);

  if (cnpj.length !== TAMANHO) {
    return false;
  }

  // Sequência de caracteres repetidos passa no cálculo do DV, mas não é CNPJ real.
  if (/^(.)\1{13}$/.test(cnpj)) {
    return false;
  }

  const raizEOrdem = cnpj.slice(0, 12);
  const digitos = cnpj.slice(12);

  if (!/^\d{2}$/.test(digitos)) {
    return false;
  }

  const primeiro = calcularDigito(raizEOrdem, PESOS_PRIMEIRO_DV);
  const segundo = calcularDigito(`${raizEOrdem}${primeiro}`, PESOS_SEGUNDO_DV);

  return digitos === `${primeiro}${segundo}`;
};

export const formatarCnpj = (entrada: string): string => {
  const cnpj = normalizarCnpj(entrada);

  if (cnpj.length !== TAMANHO) {
    return cnpj;
  }

  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
};
