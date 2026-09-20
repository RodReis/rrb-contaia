/**
 * Entrada da API de empresa cliente. Dado externo chega como `unknown` e só
 * vira tipo depois do schema — DTO nunca é entidade de persistência.
 */
import { z } from 'zod';

import {
  ENQUADRAMENTOS_DO_SIMPLES,
  REGIMES_TRIBUTARIOS,
  SITUACOES_DE_INSCRICAO,
} from '@contaia/domain';

/**
 * Todo campo de texto tem teto. As colunas são `text` sem limite no banco:
 * sem isto uma requisição autenticada grava megabytes num campo de razão
 * social e infla linha e índice sem precisar repetir a chamada.
 */
const texto = (maximo: number) => z.string().min(1).max(maximo);

const opcional = (maximo: number) =>
  z
    .string()
    .max(maximo)
    .nullish()
    .transform((valor) => {
      const limpo = valor?.trim() ?? '';

      return limpo.length > 0 ? limpo : null;
    });

export const criacaoSchema = z.object({
  // 14 caracteres, com ou sem máscara.
  cnpj: texto(20),
});

export const identificacaoDaEmpresaSchema = z.object({
  razaoSocial: texto(200),
  nomeFantasia: texto(200),
  telefone: opcional(20),
  email: opcional(254),
});

const inscricaoSchema = z.object({
  situacao: z.enum(SITUACOES_DE_INSCRICAO),
  numero: opcional(40),
});

export const dadosFiscaisSchema = z.object({
  regimeTributario: z.enum(REGIMES_TRIBUTARIOS),
  enquadramentoSimples: z
    .enum(ENQUADRAMENTOS_DO_SIMPLES)
    .nullish()
    .transform((valor) => valor ?? null),
  cnaePrincipal: texto(10),
  // Teto no número de CNAEs: a lista vem de formulário e não há motivo de
  // negócio para centenas de códigos numa empresa.
  cnaesSecundarios: z.array(texto(10)).max(50).default([]),
  inscricaoEstadual: inscricaoSchema,
  inscricaoMunicipal: inscricaoSchema,
});

export const enderecoDaEmpresaSchema = z.object({
  cep: texto(10),
  logradouro: texto(200),
  numero: texto(20),
  complemento: opcional(100),
  bairro: texto(100),
  municipio: texto(100),
  uf: texto(2),
});

export const ativacaoSchema = z.object({
  /**
   * Confirmação de situação cadastral externa irregular (§4.4). O padrão é
   * `false`: ativar uma empresa baixada exige ato explícito do usuário, não
   * um campo ausente.
   */
  situacaoExternaConfirmada: z
    .boolean()
    .nullish()
    .transform((valor) => valor ?? false),
});

export const filtroDaListaSchema = z.object({
  busca: opcional(200),
  status: z
    .enum(['CADASTRO_INCOMPLETO', 'ATIVA'])
    .nullish()
    .transform((valor) => valor ?? null),
  // Tetos de paginação: `limite` sem máximo permite pedir a base inteira numa
  // requisição e derrubar a resposta (FRONTEND.md §11).
  limite: z.coerce.number().int().min(1).max(100).default(25),
  deslocamento: z.coerce.number().int().min(0).default(0),
});
