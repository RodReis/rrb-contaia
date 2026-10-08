/**
 * O nome original vem do usuário e vai para um cabeçalho HTTP (`Content-Disposition`): aspas,
 * quebra de linha e caractere de controle nele permitiriam injetar cabeçalho. Só o que é seguro
 * sobrevive, e o nome nunca é usado como caminho.
 */
export const nomeSeguro = (nome: string, padrao = 'documento'): string =>
  nome.replace(/[^\w.\- ]+/gu, '_').slice(0, 120) || padrao;
