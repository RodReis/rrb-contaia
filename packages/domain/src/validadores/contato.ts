/** Validadores de contato e endereço brasileiros (FRONTEND.md §9). */

// DDDs em uso no plano nacional. Faixa fechada: DDD inexistente é erro de digitação.
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
  'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

export const normalizarTelefone = (entrada: string): string => entrada.replace(/\D/g, '');

export const ehTelefoneValido = (entrada: string): boolean => {
  const telefone = normalizarTelefone(entrada);

  if (telefone.length !== 10 && telefone.length !== 11) {
    return false;
  }

  if (!DDDS_VALIDOS.has(Number(telefone.slice(0, 2)))) {
    return false;
  }

  // Celular tem 9 dígitos e começa por 9; fixo tem 8 e começa entre 2 e 5.
  const assinante = telefone.slice(2);

  return assinante.length === 9 ? assinante.startsWith('9') : /^[2-5]/.test(assinante);
};

export const formatarTelefone = (entrada: string): string => {
  const telefone = normalizarTelefone(entrada);

  if (telefone.length === 11) {
    return `(${telefone.slice(0, 2)}) ${telefone.slice(2, 7)}-${telefone.slice(7)}`;
  }

  if (telefone.length === 10) {
    return `(${telefone.slice(0, 2)}) ${telefone.slice(2, 6)}-${telefone.slice(6)}`;
  }

  return telefone;
};

export const normalizarCep = (entrada: string): string => entrada.replace(/\D/g, '');

export const ehCepValido = (entrada: string): boolean => normalizarCep(entrada).length === 8;

export const formatarCep = (entrada: string): string => {
  const cep = normalizarCep(entrada);

  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
};

export const normalizarEmail = (entrada: string): string => entrada.trim().toLowerCase();

export const ehEmailValido = (entrada: string): boolean => {
  const email = normalizarEmail(entrada);

  if (email.length === 0 || email.length > 254 || /\s/.test(email)) {
    return false;
  }

  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
};

export const ehUfValida = (entrada: string): boolean => UFS_VALIDAS.has(entrada.trim().toUpperCase());
