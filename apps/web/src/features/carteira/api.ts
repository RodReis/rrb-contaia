/** Chamadas ao backend de carteiras (SPEC-009). */
import type { EstadoDoUsuario, PapelPadrao } from '@contaia/domain';

import { requisitar } from '@/lib/http';

export type EmpresaResumida = Readonly<{ id: string; nome: string; cnpj: string }>;

export type SituacaoDaCarteira = 'COM_EMPRESAS' | 'SEM_EMPRESAS';

export type ColaboradorNaCentral = Readonly<{
  id: string;
  nome: string;
  email: string;
  estado: EstadoDoUsuario;
  papeis: readonly PapelPadrao[];
  papeisPersonalizados: readonly string[];
  empresas: number;
  /** Devolvida na alteração: a API recusa com 409 se a carteira mudou depois. */
  revisaoCarteira: number;
}>;

export type PaginaDeColaboradores = Readonly<{
  colaboradores: readonly ColaboradorNaCentral[];
  total: number;
}>;

export type FiltroDeColaboradores = Readonly<{
  busca: string | null;
  estado: EstadoDoUsuario;
  papel: PapelPadrao | null;
  carteira: SituacaoDaCarteira | null;
  limite: number;
  deslocamento: number;
}>;

export type EmpresaParaAtribuicao = EmpresaResumida &
  Readonly<{
    status: 'CADASTRO_INCOMPLETO' | 'ATIVA';
    situacao: 'ativo' | 'arquivado';
    atribuida: boolean;
  }>;

export type PaginaDeEmpresasParaAtribuicao = Readonly<{
  empresas: readonly EmpresaParaAtribuicao[];
  total: number;
}>;

export type FiltroDeEmpresas = Readonly<{
  busca: string | null;
  situacao: 'ATRIBUIDAS' | 'DISPONIVEIS' | null;
  limite: number;
  deslocamento: number;
}>;

export type ColaboradorDaEmpresa = Readonly<{
  id: string;
  nome: string;
  email: string;
  estado: EstadoDoUsuario;
  papeis: readonly PapelPadrao[];
  revisaoCarteira: number;
  desde: string;
}>;

export type OrigemDoEvento =
  | 'INDIVIDUAL'
  | 'LOTE'
  | 'AUTOATRIBUICAO'
  | 'ARQUIVAMENTO_USUARIO'
  | 'ARQUIVAMENTO_EMPRESA';

export type AfetadoDoEvento = Readonly<{
  usuarioId: string;
  usuarioNome: string;
  adicionadas: readonly EmpresaResumida[];
  removidas: readonly EmpresaResumida[];
  revisaoAnterior: number;
  revisaoNova: number;
}>;

export type EventoDeCarteira = Readonly<{
  id: string;
  ocorridoEm: string;
  origem: OrigemDoEvento;
  autorId: string | null;
  autorNome: string | null;
  afetados: readonly AfetadoDoEvento[];
}>;

export type PaginaDeEventosDeCarteira = Readonly<{
  eventos: readonly EventoDeCarteira[];
  total: number;
}>;

export type FiltroDeEventosDeCarteira = Readonly<{
  usuarioAfetadoId: string | null;
  empresaId: string | null;
  origem: OrigemDoEvento | null;
  de: string | null;
  ate: string | null;
  limite: number;
  deslocamento: number;
}>;

export type AlteracaoDeCarteira = Readonly<{
  origem: 'INDIVIDUAL' | 'LOTE';
  usuarios: readonly Readonly<{ id: string; revisao: number }>[];
  adicionar: readonly string[];
  remover: readonly string[];
}>;

export type ResultadoDaAlteracao = Readonly<{
  aplicado: boolean;
  afetados: readonly Readonly<{ usuarioId: string; revisaoNova: number }>[];
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

export const listarColaboradores = (filtro: FiltroDeColaboradores): Promise<PaginaDeColaboradores> =>
  requisitar(
    `/carteiras/colaboradores?${consulta({
      busca: filtro.busca,
      estado: filtro.estado,
      papel: filtro.papel,
      carteira: filtro.carteira,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );

export const obterColaborador = (usuarioId: string): Promise<ColaboradorNaCentral> =>
  requisitar(`/carteiras/colaboradores/${usuarioId}`);

export const listarEmpresasParaAtribuicao = (
  usuarioId: string,
  filtro: FiltroDeEmpresas,
): Promise<PaginaDeEmpresasParaAtribuicao> =>
  requisitar(
    `/carteiras/colaboradores/${usuarioId}/empresas?${consulta({
      busca: filtro.busca,
      situacao: filtro.situacao,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );

export const listarColaboradoresDaEmpresa = (
  empresaId: string,
): Promise<Readonly<{ colaboradores: readonly ColaboradorDaEmpresa[] }>> =>
  requisitar(`/carteiras/empresas/${empresaId}/colaboradores`);

export const obterMinhaCarteira = (): Promise<
  Readonly<{ empresas: readonly EmpresaParaAtribuicao[] }>
> => requisitar('/carteiras/minha');

export const alterarCarteira = (alteracao: AlteracaoDeCarteira): Promise<ResultadoDaAlteracao> =>
  requisitar('/carteiras/alteracoes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(alteracao),
  });

export const consultarHistoricoDeCarteiras = (
  filtro: FiltroDeEventosDeCarteira,
): Promise<PaginaDeEventosDeCarteira> =>
  requisitar(
    `/historico/carteiras?${consulta({
      usuarioAfetadoId: filtro.usuarioAfetadoId,
      empresaId: filtro.empresaId,
      origem: filtro.origem,
      de: filtro.de,
      ate: filtro.ate,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );
