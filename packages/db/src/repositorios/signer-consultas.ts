/**
 * Consultas de leitura do Signer (SPEC-012 §3.11, §5.2–§5.3): estado corrente por finalidade e
 * histórico paginado. Rodam sob contexto da empresa — técnico (Signer) ou humano (carteira) — e a
 * RLS decide o que aparece. A trilha não tem XML nem resposta do destino, então nada disso sai daqui.
 */
import type { PoolClient } from 'pg';

import type { FinalidadeDoSigner } from './signer.js';

export type UltimoEventoDaFinalidade = Readonly<{
  finalidade: FinalidadeDoSigner;
  resultado: 'SUCESSO' | 'FALHA';
  iniciadoEm: Date;
  latenciaMs: number;
  codigo: string | null;
}>;

/**
 * Último SUCESSO/FALHA de cada finalidade (RECUSA é erro do chamador e não altera a saúde). O estado
 * corrente não tem tabela própria: deriva daqui, e DF-e e eSocial nunca se misturam.
 */
export const ultimosEventosDasFinalidades = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<UltimoEventoDaFinalidade[]> => {
  const { rows } = await cliente.query<{
    finalidade: FinalidadeDoSigner;
    resultado: 'SUCESSO' | 'FALHA';
    iniciado_em: Date;
    latencia_ms: number;
    codigo: string | null;
  }>(
    `select distinct on (finalidade) finalidade, resultado, iniciado_em, latencia_ms, codigo
       from app.signer_evento
      where empresa_id = $1 and resultado in ('SUCESSO', 'FALHA')
      order by finalidade, iniciado_em desc, sequencia desc`,
    [empresaId],
  );

  return rows.map((linha) => ({
    finalidade: linha.finalidade,
    resultado: linha.resultado,
    iniciadoEm: linha.iniciado_em,
    latenciaMs: linha.latencia_ms,
    codigo: linha.codigo,
  }));
};

export const ITENS_POR_PAGINA = 15;

export type FiltroDaTrilhaDoSigner = Readonly<{
  empresaId: string;
  /** Base 1. */
  pagina: number;
  finalidade?: FinalidadeDoSigner;
  resultado?: 'SUCESSO' | 'FALHA' | 'RECUSA';
}>;

export type ItemDaTrilhaDoSigner = Readonly<{
  id: string;
  finalidade: FinalidadeDoSigner;
  resultado: 'SUCESSO' | 'FALHA' | 'RECUSA';
  codigo: string | null;
  iniciadoEm: Date;
  latenciaMs: number;
  reutilizado: boolean;
  origemDiagnostico: 'AUTOMATICO' | 'MANUAL' | null;
  identidadeTecnica: string;
  correlationId: string;
  referenciaSegredo: string | null;
}>;

export type PaginaDaTrilhaDoSigner = Readonly<{
  pagina: number;
  total: number;
  itens: readonly ItemDaTrilhaDoSigner[];
}>;

type LinhaDoHistorico = {
  id: string;
  finalidade: FinalidadeDoSigner;
  resultado: 'SUCESSO' | 'FALHA' | 'RECUSA';
  codigo: string | null;
  iniciado_em: Date;
  latencia_ms: number;
  reutilizado: boolean;
  origem_diagnostico: 'AUTOMATICO' | 'MANUAL' | null;
  identidade_tecnica: string;
  correlation_id: string;
  referencia_segredo: string | null;
};

/** 15 por página, do mais recente ao mais antigo. */
export const historicoDoSigner = async (
  cliente: PoolClient,
  filtro: FiltroDaTrilhaDoSigner,
): Promise<PaginaDaTrilhaDoSigner> => {
  const condicoes = ['empresa_id = $1'];
  const parametros: unknown[] = [filtro.empresaId];

  if (filtro.finalidade !== undefined) {
    parametros.push(filtro.finalidade);
    condicoes.push(`finalidade = $${parametros.length}`);
  }
  if (filtro.resultado !== undefined) {
    parametros.push(filtro.resultado);
    condicoes.push(`resultado = $${parametros.length}`);
  }

  const onde = condicoes.join(' and ');
  const deslocamento = (filtro.pagina - 1) * ITENS_POR_PAGINA;

  const { rows: contagem } = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.signer_evento where ${onde}`,
    parametros,
  );
  const { rows } = await cliente.query<LinhaDoHistorico>(
    `select id, finalidade, resultado, codigo, iniciado_em, latencia_ms, reutilizado, origem_diagnostico,
            identidade_tecnica, correlation_id, referencia_segredo
       from app.signer_evento
      where ${onde}
      order by iniciado_em desc, sequencia desc
      limit ${ITENS_POR_PAGINA} offset ${deslocamento}`,
    parametros,
  );

  return {
    pagina: filtro.pagina,
    total: Number(contagem[0]?.total ?? 0),
    itens: rows.map((linha) => ({
      id: linha.id,
      finalidade: linha.finalidade,
      resultado: linha.resultado,
      codigo: linha.codigo,
      iniciadoEm: linha.iniciado_em,
      latenciaMs: linha.latencia_ms,
      reutilizado: linha.reutilizado,
      origemDiagnostico: linha.origem_diagnostico,
      identidadeTecnica: linha.identidade_tecnica,
      correlationId: linha.correlation_id,
      referenciaSegredo: linha.referencia_segredo,
    })),
  };
};
