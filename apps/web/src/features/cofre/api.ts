/**
 * Chamadas ao backend do cofre de certificados A1 (SPEC-011).
 *
 * Tudo aqui passa pelo proxy da web e devolve só metadados. O arquivo e a senha
 * do certificado NÃO passam por este módulo: seguem do navegador direto ao
 * cofre (`envio.ts`), com um ticket de uso único emitido por
 * `solicitarTicketDeIngestao`.
 */
import type {
  DetalheDoCofre,
  EventoDeCertificado,
  FiltroDeEstadoDoCofre,
  OrdenacaoDoCofre,
  PaginaDoCofre,
  ResponsavelElegivel,
  TicketDeIngestao,
} from '@contaia/shared';

import { requisitar } from '@/lib/http';

/** A API acrescenta `escopoDeEmpresas` quando a carteira está vazia (SPEC-007 §3.1). */
export type PaginaDoCofreNaTela = PaginaDoCofre & Readonly<{ escopoDeEmpresas?: 'NENHUMA' }>;

export type FiltroDoCofre = Readonly<{
  busca: string | null;
  estado: FiltroDeEstadoDoCofre | null;
  ordem: OrdenacaoDoCofre;
  /** Base 1, como `PaginaDoCofre.pagina`. */
  pagina: number;
  limite: number;
}>;

export type FiltroDoHistoricoDeCertificados = Readonly<{
  acao: string | null;
  resultado: string | null;
  empresaId: string | null;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDeEventosDeCertificado = Readonly<{
  eventos: readonly EventoDeCertificado[];
  total: number;
}>;

const consulta = (parametros: Readonly<Record<string, string | number | null>>): string => {
  const busca = new URLSearchParams();

  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== '') {
      busca.set(chave, String(valor));
    }
  }

  return busca.toString();
};

const comJson = (metodo: 'POST' | 'PUT', corpo: unknown): RequestInit => ({
  method: metodo,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const listarCofre = (filtro: FiltroDoCofre): Promise<PaginaDoCofreNaTela> =>
  requisitar(
    `/certificados?${consulta({
      busca: filtro.busca,
      estado: filtro.estado,
      ordem: filtro.ordem,
      pagina: filtro.pagina,
      limite: filtro.limite,
    })}`,
  );

export const obterDetalheDoCofre = (empresaId: string): Promise<DetalheDoCofre> =>
  requisitar(`/empresas/${empresaId}/certificados`);

export const listarResponsaveisElegiveis = (
  empresaId: string,
): Promise<readonly ResponsavelElegivel[]> =>
  requisitar(`/empresas/${empresaId}/certificados/responsaveis`);

/** O ticket autoriza UM envio ao cofre; a API o emite depois de validar permissão, carteira e responsável. */
export const solicitarTicketDeIngestao = (
  empresaId: string,
  responsavelId: string,
): Promise<TicketDeIngestao> =>
  requisitar(`/empresas/${empresaId}/certificados/ingestoes`, comJson('POST', { responsavelId }));

export const trocarResponsavelDoCertificado = (
  empresaId: string,
  responsavelId: string,
): Promise<DetalheDoCofre> =>
  requisitar(
    `/empresas/${empresaId}/certificados/vigente/responsavel`,
    comJson('PUT', { responsavelId }),
  );

export const desativarCertificado = (empresaId: string, motivo: string): Promise<DetalheDoCofre> =>
  requisitar(`/empresas/${empresaId}/certificados/vigente/desativacao`, comJson('POST', { motivo }));

export const consultarHistoricoDeCertificados = (
  filtro: FiltroDoHistoricoDeCertificados,
): Promise<PaginaDeEventosDeCertificado> =>
  requisitar(
    `/historico/certificados?${consulta({
      acao: filtro.acao,
      resultado: filtro.resultado,
      empresaId: filtro.empresaId,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );
