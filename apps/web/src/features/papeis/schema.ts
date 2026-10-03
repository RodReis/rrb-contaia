/**
 * Formulário de identificação do papel (SPEC-008 §3.1): nome obrigatório e
 * descrição opcional, com os mesmos tetos que a API e o banco impõem. A unicidade
 * do nome é do servidor (sem diferenciar caixa); a matriz mínima é regra dos dois lados.
 */
import { TAMANHO_MAXIMO_DA_DESCRICAO, TAMANHO_MAXIMO_DO_NOME } from '@contaia/domain';
import { z } from 'zod';

export const ERRO_DE_MATRIZ = 'Marque ao menos uma permissão.';

export const dadosDoPapelFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome do papel')
    .max(TAMANHO_MAXIMO_DO_NOME, `Use no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres`),
  descricao: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DA_DESCRICAO, `Use no máximo ${TAMANHO_MAXIMO_DA_DESCRICAO} caracteres`),
});

export type DadosDoPapelForm = z.infer<typeof dadosDoPapelFormSchema>;

export const descricaoOuNula = (descricao: string): string | null => {
  const aparada = descricao.trim();

  return aparada === '' ? null : aparada;
};

export const erroDaMatriz = (matriz: readonly unknown[]): string | undefined =>
  matriz.length === 0 ? ERRO_DE_MATRIZ : undefined;
