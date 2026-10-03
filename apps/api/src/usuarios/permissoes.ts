/**
 * Visão de leitura da matriz de papéis (SPEC-007 §5.1): o que cada papel — ou a
 * união dos papéis de uma sessão — concede, por capacidade. A interface lê isto
 * do servidor em vez de reimplementar a matriz.
 */
import { PAPEIS_PADRAO, podeExecutar } from '@contaia/domain';
import type { Acao, Capacidade, PapelPadrao } from '@contaia/domain';

const ACOES: readonly Acao[] = ['consultar', 'criar', 'editar', 'arquivar', 'administrar'];

export type PermissoesPorCapacidade = Readonly<Record<Capacidade, readonly Acao[]>>;

export type PapelNoCatalogo = Readonly<{
  papel: PapelPadrao;
  permissoes: PermissoesPorCapacidade;
}>;

// Objeto literal exaustivo: capacidade nova na matriz quebra a compilação aqui.
export const permissoesDe = (papeis: readonly PapelPadrao[]): PermissoesPorCapacidade => {
  const concedidas = (capacidade: Capacidade): readonly Acao[] =>
    ACOES.filter((acao) => podeExecutar(papeis, capacidade, acao));

  return {
    CADASTRO_ESCRITORIO: concedidas('CADASTRO_ESCRITORIO'),
    EMPRESAS: concedidas('EMPRESAS'),
    DOCUMENTOS: concedidas('DOCUMENTOS'),
    PENDENCIAS: concedidas('PENDENCIAS'),
    NOTIFICACOES: concedidas('NOTIFICACOES'),
    HISTORICO: concedidas('HISTORICO'),
    USUARIOS: concedidas('USUARIOS'),
  };
};

export const catalogoDePapeis = (): readonly PapelNoCatalogo[] =>
  PAPEIS_PADRAO.map((papel) => ({ papel, permissoes: permissoesDe([papel]) }));
