/**
 * Validação dos formulários do motor tributário (FRONTEND.md §8). O contrato é o do pacote
 * compartilhado: o formulário valida com o MESMO schema que a API usa e só traduz cada falha para
 * uma mensagem em PT-BR no campo certo. O estado guarda inteiros (centavos, centésimos de ponto
 * percentual) e datas civis `aaaa-mm-dd`; texto vazio e `null` significam "não informado".
 */
import {
  CreateTaxRuleSchema,
  ManualTaxSimulationSchema,
  NfeComplementSchema,
  UpdateTaxRuleSchema,
  type CreateTaxRule,
  type ManualTaxSimulation,
  type NfeComplement,
  type UpdateTaxRule,
} from '@contaia/shared';
import type { z } from 'zod';

export type Erros = Readonly<Record<string, string>>;

export type ResultadoDaValidacao<T> = Readonly<{ ok: true; dados: T }> | Readonly<{ ok: false; erros: Erros }>;

type Mensagens = Readonly<Record<string, Readonly<{ obrigatorio: string; invalido: string }>>>;

const igual = (mensagem: string) => ({ obrigatorio: mensagem, invalido: mensagem });

const MENSAGENS_DA_SIMULACAO: Mensagens = {
  factDate: { obrigatorio: 'Informe a data do fato gerador', invalido: 'Informe uma data válida' },
  regime: igual('Selecione o regime'),
  taxType: igual('Selecione o tributo'),
  operationType: igual('Selecione o tipo de operação'),
  baseCents: igual('Informe a base de cálculo'),
};

const MENSAGENS_DA_REGRA: Mensagens = {
  taxType: igual('Selecione o tributo'),
  regime: igual('Selecione o regime'),
  operationType: igual('Selecione o tipo de operação'),
  validFrom: { obrigatorio: 'Informe o início da vigência', invalido: 'Informe uma data válida' },
  validUntil: { obrigatorio: 'Informe uma data válida', invalido: 'Informe uma data válida' },
  baseReductionBasisPoints: igual('Informe a redução entre 0 e 100%'),
  rateBasisPoints: { obrigatorio: 'Informe a alíquota', invalido: 'Informe uma alíquota entre 0 e 100%' },
  source: igual('Informe a fonte da regra, com até 500 caracteres'),
  fixtureNote: igual('O aviso aceita até 500 caracteres'),
  expectedVersion: igual('A versão da regra é inválida. Recarregue a página.'),
};

const ORDEM_DA_VIGENCIA = 'A vigência final não pode ser anterior à inicial';

const estaVazio = (valor: unknown): boolean => valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');

const validar = <T>(
  schema: z.ZodType<T>,
  valores: Readonly<Record<string, unknown>>,
  mensagens: Mensagens,
): ResultadoDaValidacao<T> => {
  const resultado = schema.safeParse(valores);

  if (resultado.success) {
    return { ok: true, dados: resultado.data };
  }

  const erros: Record<string, string> = {};

  for (const problema of resultado.error.issues) {
    const campo = String(problema.path[0] ?? 'corpo');

    if (erros[campo] !== undefined) {
      continue;
    }

    const doCampo = mensagens[campo];
    const ordemDaVigencia =
      campo === 'validUntil' && problema.code === 'custom' && !estaVazio(valores['validUntil']) && !estaVazio(valores['validFrom']);

    erros[campo] = ordemDaVigencia
      ? ORDEM_DA_VIGENCIA
      : doCampo === undefined
        ? 'Valor inválido'
        : estaVazio(valores[campo])
          ? doCampo.obrigatorio
          : doCampo.invalido;
  }

  return { ok: false, erros };
};

export const validarSimulacaoManual = (valores: Readonly<Record<string, unknown>>): ResultadoDaValidacao<ManualTaxSimulation> =>
  validar(ManualTaxSimulationSchema, valores, MENSAGENS_DA_SIMULACAO);

/** Vigência final em branco é intervalo aberto: vai para a API como `null`. */
const comVigenciaAberta = (valores: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  ...valores,
  validUntil: estaVazio(valores['validUntil']) ? null : valores['validUntil'],
});

export const validarRegra = (valores: Readonly<Record<string, unknown>>): ResultadoDaValidacao<CreateTaxRule> =>
  validar(CreateTaxRuleSchema, comVigenciaAberta(valores), MENSAGENS_DA_REGRA);

export type ValoresDoComplemento = Readonly<{
  operationType: string;
  regime: string;
  itemBases: Readonly<Record<string, number | null>>;
}>;

const PREFIXO_DA_BASE = 'itemBases.';

/**
 * Complemento da simulação por NF-e (SPEC-016 §3.6): só entra no corpo o que a ANÁLISE pediu
 * (`pendencias`). O que o XML já informa não é reenviado, e o servidor recusaria se fosse.
 */
export const validarComplementoDaNfe = (
  valores: ValoresDoComplemento,
  pendencias: readonly Readonly<{ field: string }>[],
): ResultadoDaValidacao<NfeComplement> => {
  const campos = pendencias.map((pendencia) => pendencia.field);
  const erros: Record<string, string> = {};
  const bases: Record<string, number> = {};
  const corpo: Record<string, unknown> = { operationType: valores.operationType };

  if (campos.includes('regime')) {
    corpo['regime'] = valores.regime;
  }

  for (const campo of campos.filter((candidato) => candidato.startsWith(PREFIXO_DA_BASE))) {
    const item = campo.slice(PREFIXO_DA_BASE.length);
    const base = valores.itemBases[item];

    if (base === null || base === undefined) {
      erros[campo] = `Informe a base de cálculo do item ${item}`;
    } else {
      bases[item] = base;
    }
  }

  if (Object.keys(bases).length > 0 || campos.some((campo) => campo.startsWith(PREFIXO_DA_BASE))) {
    corpo['itemBases'] = bases;
  }

  const resultado = NfeComplementSchema.safeParse(corpo);

  if (!resultado.success) {
    for (const problema of resultado.error.issues) {
      const campo = String(problema.path[0] ?? 'corpo');

      if (campo === 'operationType') {
        erros['operationType'] = 'Selecione o tipo de operação';
      } else if (campo === 'regime') {
        erros['regime'] = 'Selecione o regime';
      }
    }
  }

  return Object.keys(erros).length > 0 || !resultado.success ? { ok: false, erros } : { ok: true, dados: resultado.data };
};

/** A identidade (tributo, regime, operação) é fixa depois da criação; a edição leva só o resto. */
export const validarEdicaoDaRegra = (valores: Readonly<Record<string, unknown>>): ResultadoDaValidacao<UpdateTaxRule> =>
  validar(UpdateTaxRuleSchema, comVigenciaAberta(valores), MENSAGENS_DA_REGRA);
