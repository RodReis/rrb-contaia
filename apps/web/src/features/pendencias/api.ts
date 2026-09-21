/**
 * Chamadas ao backend da central de pendências (SPEC-005).
 *
 * Shape completo da pendência e filtros da Central (Task 9) — o placeholder
 * `readonly unknown[]` da Task 8 fica para trás.
 */
import { requisitar } from '@/lib/http';

export type OrigemDaPendencia = 'CADASTRAL' | 'DOCUMENTAL';
export type TipoDaPendencia =
  | 'CAMPO_AUSENTE'
  | 'CAMPO_INVALIDO'
  | 'DOCUMENTO_AUSENTE'
  | 'DOCUMENTO_REJEITADO'
  | 'DOCUMENTO_VENCIDO'
  | 'EXIGENCIA_ESPECIFICA';
export type EstadoDaPendencia = 'ABERTA' | 'RESOLVIDA';

export type Pendencia = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  origem: OrigemDaPendencia;
  tipo: TipoDaPendencia;
  chave: string;
  estado: EstadoDaPendencia;
  dataLimite: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
}>;

export type PaginaDePendencias = Readonly<{
  pendencias: readonly Pendencia[];
  total: number;
}>;

export type FiltroDePendencias = Readonly<{
  empresaId: string | null;
  origem: OrigemDaPendencia | null;
  tipo: TipoDaPendencia | null;
  estado: EstadoDaPendencia | null;
  vencimento: 'VENCIDAS' | 'PROXIMAS' | null;
  limite: number;
  deslocamento: number;
}>;

const comJson = (corpo: unknown, method: 'PUT' | 'POST' = 'PUT'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const buscarPendencias = (filtro: FiltroDePendencias): Promise<PaginaDePendencias> => {
  const parametros = new URLSearchParams();

  if (filtro.empresaId !== null) {
    parametros.set('empresaId', filtro.empresaId);
  }

  if (filtro.origem !== null) {
    parametros.set('origem', filtro.origem);
  }

  if (filtro.tipo !== null) {
    parametros.set('tipo', filtro.tipo);
  }

  if (filtro.estado !== null) {
    parametros.set('estado', filtro.estado);
  }

  if (filtro.vencimento !== null) {
    parametros.set('vencimento', filtro.vencimento);
  }

  parametros.set('limite', String(filtro.limite));
  parametros.set('deslocamento', String(filtro.deslocamento));

  return requisitar(`/pendencias?${parametros.toString()}`);
};

export const dispensarPendencia = (
  empresaId: string,
  pendenciaId: string,
  justificativa: string,
): Promise<Pendencia> =>
  requisitar(
    `/empresas/${empresaId}/pendencias/${pendenciaId}/dispensa`,
    comJson({ justificativa }),
  );
