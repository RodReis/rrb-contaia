/**
 * Central de Pendências cadastrais (SPEC-005).
 *
 * Regras puras: nada aqui consulta banco ou o relógio do sistema — o "agora"
 * entra por parâmetro (CLAUDE.md, convenção do repositório).
 *
 * A fatia reconcilia duas fontes já existentes (cadastro de F3, documentos de
 * F4) para decidir quais pendências deveriam estar abertas agora, e compara
 * com o que já está aberto no banco para não duplicar (idempotência, §2).
 */
import type { EstadoDoDocumento } from '../empresa/documentos.js';
import { dataCivilEmSaoPaulo } from '../empresa/manutencao.js';

export type OrigemDaPendencia = 'CADASTRAL' | 'DOCUMENTAL' | 'CERTIFICADO';

export type TipoDaPendencia =
  | 'CAMPO_AUSENTE'
  | 'CAMPO_INVALIDO'
  | 'DOCUMENTO_AUSENTE'
  | 'DOCUMENTO_REJEITADO'
  | 'DOCUMENTO_VENCIDO'
  | 'EXIGENCIA_ESPECIFICA'
  // Cofre de certificados A1 (SPEC-011 §3.4–3.6).
  | 'CERTIFICADO_AUSENTE'
  | 'CERTIFICADO_VENCIDO'
  | 'CERTIFICADO_SEM_RESPONSAVEL';

export type EstadoDaPendencia = 'ABERTA' | 'RESOLVIDA';

/**
 * `chave` identifica a causa de forma estável dentro da empresa — é o que
 * permite reconhecer "mesma causa" em execuções repetidas sem depender de já
 * conhecer o id da pendência (§2: "processamento repetido não duplica").
 */
export type CausaDaPendencia = Readonly<{
  origem: OrigemDaPendencia;
  tipo: TipoDaPendencia;
  chave: string;
  dataLimite: string | null;
}>;

export type CampoCadastralObrigatorio = Readonly<{
  chave: string;
  preenchido: boolean;
  valido: boolean;
}>;

/** Campo opcional vazio nunca chega aqui: quem monta a lista já filtrou (§2). */
export const causasCadastrais = (
  campos: readonly CampoCadastralObrigatorio[],
): readonly CausaDaPendencia[] =>
  campos
    .filter((campo) => !campo.preenchido || !campo.valido)
    .map((campo) => ({
      origem: 'CADASTRAL' as const,
      tipo: campo.preenchido ? ('CAMPO_INVALIDO' as const) : ('CAMPO_AUSENTE' as const),
      chave: campo.chave,
      dataLimite: null,
    }));

export type ExigenciaParaReconciliar = Readonly<{
  id: string;
  estado: EstadoDoDocumento;
  dataLimite: string | null;
  validade: string | null;
  codigo: string | null;
}>;

const vencida = (validade: string | null, agora: Date): boolean =>
  validade !== null && validade < dataCivilEmSaoPaulo(agora);

export const causasDocumentais = (
  exigencias: readonly ExigenciaParaReconciliar[],
  agora: Date,
): readonly CausaDaPendencia[] =>
  exigencias.flatMap((exigencia): readonly CausaDaPendencia[] => {
    const chave = `exigencia:${exigencia.id}`;

    if (exigencia.estado === 'PENDENTE') {
      return [
        {
          origem: 'DOCUMENTAL',
          tipo: exigencia.codigo === null ? 'EXIGENCIA_ESPECIFICA' : 'DOCUMENTO_AUSENTE',
          chave,
          dataLimite: exigencia.dataLimite,
        },
      ];
    }

    if (exigencia.estado === 'REJEITADO') {
      return [{ origem: 'DOCUMENTAL', tipo: 'DOCUMENTO_REJEITADO', chave, dataLimite: null }];
    }

    if (exigencia.estado === 'APROVADO' && vencida(exigencia.validade, agora)) {
      return [{ origem: 'DOCUMENTAL', tipo: 'DOCUMENTO_VENCIDO', chave, dataLimite: null }];
    }

    return [];
  });

export const reconciliarPendencias = (
  causasAtuais: readonly CausaDaPendencia[],
  abertasNoBanco: readonly Readonly<{ chave: string }>[],
): Readonly<{ paraAbrir: readonly CausaDaPendencia[]; paraResolver: readonly string[] }> => {
  const chavesAtuais = new Set(causasAtuais.map((causa) => causa.chave));
  const chavesAbertas = new Set(abertasNoBanco.map((pendencia) => pendencia.chave));

  return {
    paraAbrir: causasAtuais.filter((causa) => !chavesAbertas.has(causa.chave)),
    paraResolver: abertasNoBanco
      .map((pendencia) => pendencia.chave)
      .filter((chave) => !chavesAtuais.has(chave)),
  };
};

const diasEntre = (hoje: string, dataLimite: string): number => {
  const umDiaEmMs = 24 * 60 * 60 * 1000;
  const inicio = Date.parse(`${hoje}T00:00:00Z`);
  const fim = Date.parse(`${dataLimite}T00:00:00Z`);

  return Math.round((fim - inicio) / umDiaEmMs);
};

/**
 * Ordem de prioridade da SPEC-005 §4: menor número vence primeiro. Desempate
 * por `criadoEm` (mais antiga primeiro) é responsabilidade da consulta SQL,
 * que ordena por `(prioridade, criado_em)`.
 */
export const prioridadeDaPendencia = (
  pendencia: Readonly<{
    tipo: TipoDaPendencia;
    dataLimite: string | null;
    criadoEm: string;
  }>,
  hoje: string,
): number => {
  if (pendencia.dataLimite !== null && pendencia.dataLimite < hoje) {
    return 0;
  }

  if (pendencia.tipo === 'DOCUMENTO_VENCIDO') {
    return 1;
  }

  if (pendencia.tipo === 'DOCUMENTO_REJEITADO') {
    return 2;
  }

  if (
    pendencia.dataLimite !== null &&
    pendencia.dataLimite >= hoje &&
    diasEntre(hoje, pendencia.dataLimite) <= 3
  ) {
    return 3;
  }

  return 4;
};
