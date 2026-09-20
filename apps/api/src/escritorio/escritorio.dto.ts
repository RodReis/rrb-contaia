/**
 * Entrada da API. Dado externo chega como `unknown` e só vira tipo depois do
 * schema — DTO nunca é entidade de persistência.
 */
import { z } from 'zod';

import { CODIGOS_DE_ERRO, ErroDeValidacao } from '@contaia/domain';
import type { CampoInvalido } from '@contaia/domain';

export const identificacaoSchema = z.object({
  cnpj: z.string().min(1),
  razaoSocial: z.string().min(1),
});

export const responsavelSchema = z.object({
  nomeCompleto: z.string().min(1),
  cpf: z.string().min(1),
  crc: z.string().min(1),
  email: z.string().min(1),
  telefone: z.string().min(1),
});

export const enderecoSchema = z.object({
  cep: z.string().min(1),
  logradouro: z.string().min(1),
  numero: z.string().min(1),
  complemento: z.string().nullish().transform((valor) => valor ?? null),
  bairro: z.string().min(1),
  municipio: z.string().min(1),
  uf: z.string().min(1),
});

/**
 * Converte a falha do schema em erro de domínio com campo associado — o 422
 * precisa dizer qual campo falhou (SPEC-001 §6).
 */
export const analisar = <Saida>(schema: z.ZodType<Saida>, entrada: unknown): Saida => {
  const resultado = schema.safeParse(entrada);

  if (resultado.success) {
    return resultado.data;
  }

  const campos: CampoInvalido[] = resultado.error.issues.map((problema) => ({
    campo: problema.path.join('.') || 'corpo',
    codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
  }));

  throw new ErroDeValidacao(campos);
};
