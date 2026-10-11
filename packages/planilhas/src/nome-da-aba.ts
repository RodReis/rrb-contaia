import { truncarTexto } from '@contaia/domain';

const MAIOR_NOME = 255;

/** Nome da aba dentro do contrato (1..255): vazio vira `Aba <posição>`; longo é truncado. */
export const nomeDaAba = (nome: string, posicao: number): string =>
  nome.trim() === '' ? `Aba ${posicao}` : truncarTexto(nome, MAIOR_NOME);
