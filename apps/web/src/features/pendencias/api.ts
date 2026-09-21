/**
 * Chamadas ao backend da central de pendências (SPEC-005).
 *
 * Aqui só o suficiente para o indicador e o alerta (Task 8): o shape completo
 * da pendência e a listagem plena chegam na Task 9.
 */
import { requisitar } from '@/lib/http';

export type PaginaDePendencias = Readonly<{
  pendencias: readonly unknown[];
  total: number;
}>;

export type FiltroDePendencias = Readonly<{
  empresaId: string | null;
  limite: number;
  deslocamento: number;
}>;

export const buscarPendencias = (filtro: FiltroDePendencias): Promise<PaginaDePendencias> => {
  const parametros = new URLSearchParams();

  if (filtro.empresaId !== null) {
    parametros.set('empresaId', filtro.empresaId);
  }

  parametros.set('estado', 'ABERTA');
  parametros.set('limite', String(filtro.limite));
  parametros.set('deslocamento', String(filtro.deslocamento));

  return requisitar(`/pendencias?${parametros.toString()}`);
};
