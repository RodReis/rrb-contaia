/**
 * Formulário de usuário (SPEC-007 §3.2). O mesmo validador de e-mail e telefone
 * que a API usa roda aqui (FRONTEND.md §8); o papel obrigatório é uma regra do
 * formulário e da API, nunca só de um dos lados.
 */
import { ehEmailValido, ehTelefoneValido, normalizarTelefone } from '@contaia/domain';
import type { PapelPadrao } from '@contaia/domain';
import { z } from 'zod';

import type { DadosDeEdicao, DadosDoConvite } from './api';

export const ERRO_DE_PAPEL = 'Selecione ao menos um papel.';

export const dadosDoUsuarioFormSchema = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo').max(120, 'Use no máximo 120 caracteres'),
  email: z.string().refine(ehEmailValido, 'E-mail inválido'),
  // Opcional: vazio passa; preenchido precisa ser um telefone brasileiro válido.
  telefone: z
    .string()
    .refine((valor) => valor.trim() === '' || ehTelefoneValido(valor), 'Telefone inválido'),
  crc: z.string().trim().max(40, 'Use no máximo 40 caracteres'),
});

export type DadosDoUsuarioForm = z.infer<typeof dadosDoUsuarioFormSchema>;

export const erroDosPapeis = (papeis: readonly PapelPadrao[]): string | undefined =>
  papeis.length === 0 ? ERRO_DE_PAPEL : undefined;

const opcional = (valor: string): string | null => {
  const aparado = valor.trim();

  return aparado === '' ? null : aparado;
};

const base = (dados: DadosDoUsuarioForm) => ({
  nome: dados.nome.trim(),
  telefone: dados.telefone.trim() === '' ? null : normalizarTelefone(dados.telefone),
  crc: opcional(dados.crc),
});

export const paraDadosDoConvite = (
  dados: DadosDoUsuarioForm,
  papeis: readonly PapelPadrao[],
): DadosDoConvite => ({ ...base(dados), email: dados.email.trim(), papeis });

/** O e-mail só viaja quando ele ainda pode ser corrigido (convite não aceito). */
export const paraDadosDeEdicao = (
  dados: DadosDoUsuarioForm,
  papeis: readonly PapelPadrao[],
  emailEditavel: boolean,
): DadosDeEdicao => ({
  ...base(dados),
  papeis,
  ...(emailEditavel ? { email: dados.email.trim() } : {}),
});
