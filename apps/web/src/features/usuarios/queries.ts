'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { avisarFalha } from '../escritorio/queries';
import {
  arquivarUsuario,
  consultarConvite,
  consultarHistoricoDeUsuarios,
  convidarUsuario,
  editarUsuario,
  iniciarNovoConvite,
  listarUsuarios,
  obterPapeis,
  obterSessao,
  obterUsuario,
  reativarUsuario,
  reenviarConvite,
  suspenderUsuario,
  type DadosDeEdicao,
  type DadosDeNovoConvite,
  type DadosDoConvite,
  type FiltroDeEventosDeUsuario,
  type FiltroDeUsuarios,
  type VisaoDeUsuario,
} from './api';

/**
 * Chaves de cache. O `QueryClient` nasce por montagem do shell autenticado e a
 * sessão não troca de escritório sem recarregar a página, então dado de um
 * escritório não alcança outro por este cache.
 */
export const CHAVE_DOS_USUARIOS = ['usuarios'] as const;
export const CHAVE_DA_SESSAO = ['sessao', 'eu'] as const;

export const useSessao = () =>
  useQuery({ queryKey: CHAVE_DA_SESSAO, queryFn: obterSessao, staleTime: 60_000 });

export const usePapeis = () =>
  useQuery({ queryKey: [...CHAVE_DOS_USUARIOS, 'papeis'], queryFn: obterPapeis });

export const useListaDeUsuarios = (filtro: FiltroDeUsuarios) =>
  useQuery({
    queryKey: [
      ...CHAVE_DOS_USUARIOS,
      'lista',
      filtro.busca,
      filtro.estado,
      filtro.papel,
      filtro.limite,
      filtro.deslocamento,
    ],
    queryFn: () => listarUsuarios(filtro),
    // A lista é conferida: manter a página anterior evita a tabela sumir a cada tecla da busca.
    placeholderData: keepPreviousData,
  });

export const useUsuario = (usuarioId: string) =>
  useQuery({
    queryKey: [...CHAVE_DOS_USUARIOS, 'usuario', usuarioId],
    queryFn: () => obterUsuario(usuarioId),
  });

export const useHistoricoDeUsuarios = (filtro: FiltroDeEventosDeUsuario, habilitado = true) =>
  useQuery({
    queryKey: [
      'historico-de-usuarios',
      filtro.usuarioAfetadoId,
      filtro.autorId,
      filtro.tipo,
      filtro.de,
      filtro.ate,
      filtro.limite,
      filtro.deslocamento,
    ],
    queryFn: () => consultarHistoricoDeUsuarios(filtro),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });

/** Sem retry: o convite é de uso único e a falha (inválido) não melhora tentando de novo. */
export const useConvite = (token: string) =>
  useQuery({
    queryKey: ['convite', token],
    queryFn: () => consultarConvite(token),
    retry: false,
    staleTime: Infinity,
  });

/**
 * O bloqueio do último administrador é explicado pelo próprio `AlertDialog`
 * (SPEC-007 §5.1); publicar também um toast duplicaria a mesma mensagem.
 */
const avisarFalhaDeUsuarios = (erro: unknown): void => {
  if (erro instanceof ErroDaApi && erro.problema.code === 'ULTIMO_ADMIN') {
    return;
  }

  avisarFalha(erro);
};

const useMutacaoDeUsuario = <Entrada>(
  executar: (entrada: Entrada) => Promise<VisaoDeUsuario>,
  sucesso: (usuario: VisaoDeUsuario) => string,
) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: async (usuario) => {
      // A mutação só termina depois de a lista refletir o novo estado: o
      // diálogo fecha com a linha já atualizada.
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CHAVE_DOS_USUARIOS }),
        cliente.invalidateQueries({ queryKey: ['historico-de-usuarios'] }),
        // Mudar os próprios papéis muda o que a navegação mostra.
        cliente.invalidateQueries({ queryKey: CHAVE_DA_SESSAO }),
      ]);

      toast.success(sucesso(usuario));
    },
    onError: avisarFalhaDeUsuarios,
  });
};

export const useConvidarUsuario = () =>
  useMutacaoDeUsuario(
    (dados: DadosDoConvite) => convidarUsuario(dados),
    (usuario) =>
      usuario.envioFalhou
        ? 'Usuário cadastrado, mas o e-mail do convite não saiu. Use “Reenviar convite”.'
        : `Convite enviado para ${usuario.email}.`,
  );

export const useEditarUsuario = (usuarioId: string) =>
  useMutacaoDeUsuario(
    (dados: DadosDeEdicao) => editarUsuario(usuarioId, dados),
    () => 'Usuário atualizado.',
  );

export const useAcaoDeUsuario = () =>
  useMutacaoDeUsuario(
    ({ acao, usuarioId }: { acao: 'reenviar' | 'suspender' | 'reativar' | 'arquivar'; usuarioId: string }) =>
      ({ reenviar: reenviarConvite, suspender: suspenderUsuario, reativar: reativarUsuario, arquivar: arquivarUsuario })[
        acao
      ](usuarioId),
    (usuario) => `Ação concluída para ${usuario.nome}.`,
  );

export const useNovoConvite = (usuarioId: string) =>
  useMutacaoDeUsuario(
    (dados: DadosDeNovoConvite) => iniciarNovoConvite(usuarioId, dados),
    (usuario) => `Novo convite enviado para ${usuario.email}.`,
  );
