/**
 * Causas de pendência do cofre de certificados (SPEC-011 §3.4, §3.5 e §3.6).
 *
 * Alimentam a mesma reconciliação da Central (SPEC-005): a chave é estável por
 * causa, então reprocessar não duplica e a causa que some é resolvida.
 *
 * - Sem vigente (nunca cadastrado ou desativado): `certificado:ausente`. A
 *   desativação "cria ou reabre a pendência de certificado ausente" (§3.4).
 * - Vigente com `validoAte` no passado: `certificado:vencido`, com data limite no
 *   fim da validade (a Central a prioriza como atrasada).
 * - Vigente cujo responsável deixou de ser elegível: `certificado:responsavel`.
 *
 * Vencimento próximo (D-30/15/7) é alerta individual, não pendência (§3.6).
 */
import type { CausaDaPendencia } from '../pendencias/pendencias.js';

export const CHAVES_DE_PENDENCIA_DO_CERTIFICADO = {
  ausente: 'certificado:ausente',
  vencido: 'certificado:vencido',
  responsavel: 'certificado:responsavel',
} as const;

export const causasDeCertificado = (
  situacao: Readonly<{
    vigente: Readonly<{ validoAte: string }> | null;
    responsavelInconsistente: boolean;
  }>,
  hoje: string,
): readonly CausaDaPendencia[] => {
  if (situacao.vigente === null) {
    return [
      {
        origem: 'CERTIFICADO',
        tipo: 'CERTIFICADO_AUSENTE',
        chave: CHAVES_DE_PENDENCIA_DO_CERTIFICADO.ausente,
        dataLimite: null,
      },
    ];
  }

  const causas: CausaDaPendencia[] = [];

  if (situacao.vigente.validoAte < hoje) {
    causas.push({
      origem: 'CERTIFICADO',
      tipo: 'CERTIFICADO_VENCIDO',
      chave: CHAVES_DE_PENDENCIA_DO_CERTIFICADO.vencido,
      dataLimite: situacao.vigente.validoAte,
    });
  }

  if (situacao.responsavelInconsistente) {
    causas.push({
      origem: 'CERTIFICADO',
      tipo: 'CERTIFICADO_SEM_RESPONSAVEL',
      chave: CHAVES_DE_PENDENCIA_DO_CERTIFICADO.responsavel,
      dataLimite: null,
    });
  }

  return causas;
};
