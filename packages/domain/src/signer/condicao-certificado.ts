/**
 * Condição do certificado para uso pelo Signer (SPEC-012 §3.5).
 *
 * Datas civis `YYYY-MM-DD` de `America/Sao_Paulo` (I-11); o "hoje" entra por
 * parâmetro. O responsável da F11 NÃO entra na decisão: certificado vigente
 * segue utilizável com responsável inválido, e o alerta/pendência da F11 fica.
 */

export type VersaoDoCertificado = Readonly<{
  estado: 'VIGENTE' | 'SUBSTITUIDO' | 'DESATIVADO';
  validoDe: string;
  validoAte: string;
  /** Informativo: nunca bloqueia o uso. */
  responsavelValido?: boolean;
}>;

export type CodigoDeBloqueioDoCertificado =
  | 'SIGNER_CERTIFICADO_AUSENTE'
  | 'SIGNER_CERTIFICADO_DESATIVADO'
  | 'SIGNER_CERTIFICADO_VENCIDO'
  | 'SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE';

export type CondicaoDoCertificado =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; codigo: CodigoDeBloqueioDoCertificado }>;

export const certificadoUtilizavel = (
  versao: VersaoDoCertificado | null,
  hojeCivil: string,
): CondicaoDoCertificado => {
  if (versao === null || versao.estado === 'SUBSTITUIDO') {
    return { ok: false, codigo: 'SIGNER_CERTIFICADO_AUSENTE' };
  }
  if (versao.estado === 'DESATIVADO') {
    return { ok: false, codigo: 'SIGNER_CERTIFICADO_DESATIVADO' };
  }
  if (versao.validoAte < hojeCivil) {
    return { ok: false, codigo: 'SIGNER_CERTIFICADO_VENCIDO' };
  }
  if (versao.validoDe > hojeCivil) {
    return { ok: false, codigo: 'SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE' };
  }

  return { ok: true };
};
