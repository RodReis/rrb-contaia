/** Validação de CPF: 11 dígitos, dois verificadores por módulo 11. */

const TAMANHO = 11;

export const normalizarCpf = (entrada: string): string => entrada.replace(/\D/g, '');

const calcularDigito = (base: string, pesoInicial: number): number => {
  const soma = [...base].reduce(
    (acumulado, caractere, indice) => acumulado + Number(caractere) * (pesoInicial - indice),
    0,
  );

  const resto = (soma * 10) % 11;

  return resto === 10 ? 0 : resto;
};

export const ehCpfValido = (entrada: string): boolean => {
  const cpf = normalizarCpf(entrada);

  if (cpf.length !== TAMANHO || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const primeiro = calcularDigito(cpf.slice(0, 9), 10);
  const segundo = calcularDigito(cpf.slice(0, 10), 11);

  return cpf.slice(9) === `${primeiro}${segundo}`;
};

export const formatarCpf = (entrada: string): string => {
  const cpf = normalizarCpf(entrada);

  if (cpf.length !== TAMANHO) {
    return cpf;
  }

  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
};
