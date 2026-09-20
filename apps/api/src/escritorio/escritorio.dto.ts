/**
 * Entrada da API. Dado externo chega como `unknown` e só vira tipo depois do
 * schema — DTO nunca é entidade de persistência.
 */
import { z } from 'zod';

import { CODIGOS_DE_ERRO, ErroDeValidacao } from '@contaia/domain';
import type { CampoInvalido } from '@contaia/domain';

/**
 * Todo campo de texto tem teto. As colunas são `text` sem limite no banco:
 * sem isto uma requisição autenticada grava megabytes num campo de razão
 * social e infla linha e índice sem precisar repetir a chamada.
 */
const texto = (maximo: number) => z.string().min(1).max(maximo);

export const identificacaoSchema = z.object({
  // 14 caracteres, com ou sem máscara.
  cnpj: texto(20),
  razaoSocial: texto(200),
});

export const responsavelSchema = z.object({
  nomeCompleto: texto(200),
  cpf: texto(14),
  crc: texto(40),
  email: texto(254),
  telefone: texto(20),
});

export const enderecoSchema = z.object({
  cep: texto(10),
  logradouro: texto(200),
  numero: texto(20),
  complemento: z
    .string()
    .max(100)
    .nullish()
    .transform((valor) => valor ?? null),
  bairro: texto(100),
  municipio: texto(100),
  uf: texto(2),
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
