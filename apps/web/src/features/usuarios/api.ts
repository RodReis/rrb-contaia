/** Chamadas ao backend de usuários, papéis padrão e convite (SPEC-007, SPEC-008). */
import type {
  ChaveDePermissao,
  EstadoDoPapel,
  EstadoDoUsuario,
  PapelPadrao,
  SituacaoApresentada,
} from '@contaia/domain';

import { requisitar, requisitarPublico } from '@/lib/http';

/**
 * Quem sou e o que posso: a interface decide o que mostrar a partir daqui. A
 * permissão efetiva é a união dos papéis padrão e personalizados, resolvida pelo
 * servidor a cada requisição; esconder um botão nunca substitui a recusa da API.
 */
export type Sessao = Readonly<{
  papeis: readonly PapelPadrao[];
  permissoes: readonly ChaveDePermissao[];
  escopoDeEmpresas: 'TODAS' | 'NENHUMA';
}>;

export type PapelPersonalizadoDoUsuario = Readonly<{
  id: string;
  nome: string;
  estado: EstadoDoPapel;
}>;

/** Sem token, link, hash ou identificador da identidade: a API nunca os envia. */
export type VisaoDeUsuario = Readonly<{
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  crc: string | null;
  papeis: readonly PapelPadrao[];
  papeisPersonalizados: readonly PapelPersonalizadoDoUsuario[];
  estado: EstadoDoUsuario;
  situacao: SituacaoApresentada;
  /** `null` para quem só consulta: o prazo do convite é dado técnico. */
  conviteExpiraEm: string | null;
  envioFalhou: boolean;
  versao: number;
}>;

export type PaginaDeUsuarios = Readonly<{ usuarios: readonly VisaoDeUsuario[]; total: number }>;

export type FiltroDeUsuarios = Readonly<{
  busca: string | null;
  estado: EstadoDoUsuario | null;
  papel: PapelPadrao | null;
  limite: number;
  deslocamento: number;
}>;

export type DadosDoConvite = Readonly<{
  nome: string;
  email: string;
  telefone: string | null;
  crc: string | null;
  papeis: readonly PapelPadrao[];
  /** Identificadores de papéis personalizados ativos. */
  papeisPersonalizados: readonly string[];
}>;

export type DadosDeEdicao = Readonly<{
  nome: string;
  telefone: string | null;
  crc: string | null;
  papeis: readonly PapelPadrao[];
  papeisPersonalizados: readonly string[];
  email?: string;
}>;

export type DadosDeNovoConvite = Omit<DadosDeEdicao, 'email'>;

export type EventoDeUsuario = Readonly<{
  id: string;
  ocorridoEm: string;
  tipo: string;
  /** Evento de usuário nomeia o usuário; evento de papel (SPEC-008 §3.6) nomeia o papel e a revisão. */
  usuarioAfetadoId: string | null;
  usuarioAfetadoNome: string | null;
  papelId: string | null;
  papelNome: string | null;
  revisao: number | null;
  autorId: string | null;
  autorNome: string | null;
  antes: Readonly<Record<string, unknown>> | null;
  depois: Readonly<Record<string, unknown>> | null;
}>;

export type PaginaDeEventosDeUsuario = Readonly<{
  eventos: readonly EventoDeUsuario[];
  total: number;
}>;

export type FiltroDeEventosDeUsuario = Readonly<{
  usuarioAfetadoId: string | null;
  autorId: string | null;
  tipo: string | null;
  de: string | null;
  ate: string | null;
  limite: number;
  deslocamento: number;
}>;

export type VisaoDoConvite = Readonly<{
  nome: string;
  emailMascarado: string;
  expiraEm: string;
}>;

const comJson = (corpo: unknown, method: 'PUT' | 'POST' = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

const consulta = (parametros: Readonly<Record<string, string | number | null>>): string => {
  const busca = new URLSearchParams();

  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== '') {
      busca.set(chave, String(valor));
    }
  }

  return busca.toString();
};

export const obterSessao = (): Promise<Sessao> => requisitar('/usuarios/eu');

export const listarUsuarios = (filtro: FiltroDeUsuarios): Promise<PaginaDeUsuarios> =>
  requisitar(
    `/usuarios?${consulta({
      busca: filtro.busca,
      estado: filtro.estado,
      papel: filtro.papel,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );

export const obterUsuario = (usuarioId: string): Promise<VisaoDeUsuario> =>
  requisitar(`/usuarios/${usuarioId}`);

export const convidarUsuario = (dados: DadosDoConvite): Promise<VisaoDeUsuario> =>
  requisitar('/usuarios', comJson(dados));

export const editarUsuario = (usuarioId: string, dados: DadosDeEdicao): Promise<VisaoDeUsuario> =>
  requisitar(`/usuarios/${usuarioId}`, comJson(dados, 'PUT'));

export const reenviarConvite = (usuarioId: string): Promise<VisaoDeUsuario> =>
  requisitar(`/usuarios/${usuarioId}/reenviar-convite`, { method: 'POST' });

export const suspenderUsuario = (usuarioId: string): Promise<VisaoDeUsuario> =>
  requisitar(`/usuarios/${usuarioId}/suspender`, { method: 'POST' });

export const reativarUsuario = (usuarioId: string): Promise<VisaoDeUsuario> =>
  requisitar(`/usuarios/${usuarioId}/reativar`, { method: 'POST' });

export const arquivarUsuario = (usuarioId: string): Promise<VisaoDeUsuario> =>
  requisitar(`/usuarios/${usuarioId}/arquivar`, { method: 'POST' });

export const iniciarNovoConvite = (
  usuarioId: string,
  dados: DadosDeNovoConvite,
): Promise<VisaoDeUsuario> => requisitar(`/usuarios/${usuarioId}/novo-convite`, comJson(dados));

export const consultarHistoricoDeUsuarios = (
  filtro: FiltroDeEventosDeUsuario,
): Promise<PaginaDeEventosDeUsuario> =>
  requisitar(
    `/historico/usuarios?${consulta({
      usuarioAfetadoId: filtro.usuarioAfetadoId,
      autorId: filtro.autorId,
      tipo: filtro.tipo,
      de: filtro.de,
      ate: filtro.ate,
      limite: filtro.limite,
      deslocamento: filtro.deslocamento,
    })}`,
  );

// -- Convite público (sem sessão) --------------------------------------------

export const consultarConvite = (token: string): Promise<VisaoDoConvite> =>
  requisitarPublico(`/convites/${token}`);

export const aceitarConvite = (token: string, senha: string): Promise<void> =>
  requisitarPublico('/convites/aceitar', comJson({ token, senha }));
