'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { avisarFalha } from '../escritorio/queries';
import { CHAVE_DA_SESSAO, CHAVE_DOS_USUARIOS } from '../usuarios/queries';
import {
  arquivarPapel,
  criarPapel,
  editarPapel,
  listarPapeis,
  obterCatalogo,
  obterPapel,
  reativarPapel,
  type DadosDeEdicaoDePapel,
  type DadosDeNovoPapel,
  type DadosDeReativacao,
  type DetalheDePapel,
  type FiltroDePapeis,
} from './api';

export const CHAVE_DOS_PAPEIS = ['papeis'] as const;

/** O catálogo só cresce com o produto: cacheia por bastante tempo. */
export const useCatalogo = () =>
  useQuery({
    queryKey: [...CHAVE_DOS_PAPEIS, 'catalogo'],
    queryFn: obterCatalogo,
    staleTime: 5 * 60_000,
  });

export const useListaDePapeis = (filtro: FiltroDePapeis, habilitado = true) =>
  useQuery({
    queryKey: [
      ...CHAVE_DOS_PAPEIS,
      'lista',
      filtro.busca,
      filtro.estado,
      filtro.limite,
      filtro.deslocamento,
    ],
    queryFn: () => listarPapeis(filtro),
    enabled: habilitado,
    // A lista é conferida: manter a página anterior evita a tabela sumir a cada tecla da busca.
    placeholderData: keepPreviousData,
  });

export const usePapel = (papelId: string) =>
  useQuery({
    queryKey: [...CHAVE_DOS_PAPEIS, 'papel', papelId],
    queryFn: () => obterPapel(papelId),
  });

/**
 * Os códigos que a própria tela explica (confirmação de redução, papel em uso,
 * revisão de reativação, nome repetido no campo) não ganham toast: duplicaria a
 * mensagem que o diálogo ou o campo já mostram.
 */
const CODIGOS_EXPLICADOS_NA_TELA: ReadonlySet<string> = new Set([
  'REDUCAO_NAO_CONFIRMADA',
  'PAPEL_EM_USO',
  'REVISAO_NAO_CONFIRMADA',
  'PAPEL_NOME_DUPLICADO',
]);

const avisarFalhaDePapel = (erro: unknown): void => {
  if (erro instanceof ErroDaApi && CODIGOS_EXPLICADOS_NA_TELA.has(erro.problema.code)) {
    return;
  }

  avisarFalha(erro);
};

const useMutacaoDePapel = <Entrada>(
  executar: (entrada: Entrada) => Promise<DetalheDePapel>,
  sucesso: (papel: DetalheDePapel) => string,
) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: async (papel) => {
      // A mutação só termina depois de as telas refletirem o novo estado.
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CHAVE_DOS_PAPEIS }),
        // Papel muda o que os usuários vinculados podem; a lista de usuários e o
        // histórico da aba "Usuários e acessos" também.
        cliente.invalidateQueries({ queryKey: CHAVE_DOS_USUARIOS }),
        cliente.invalidateQueries({ queryKey: ['historico-de-usuarios'] }),
        cliente.invalidateQueries({ queryKey: CHAVE_DA_SESSAO }),
      ]);

      toast.success(sucesso(papel));
    },
    onError: avisarFalhaDePapel,
  });
};

export const useCriarPapel = () =>
  useMutacaoDePapel(
    (dados: DadosDeNovoPapel) => criarPapel(dados),
    (papel) => `Papel “${papel.nome}” criado.`,
  );

export const useEditarPapel = (papelId: string) =>
  useMutacaoDePapel(
    (dados: DadosDeEdicaoDePapel) => editarPapel(papelId, dados),
    () => 'Papel atualizado. A mudança vale na próxima requisição dos usuários vinculados.',
  );

export const useArquivarPapel = (papelId: string) =>
  useMutacaoDePapel(
    (revisaoEsperada: number) => arquivarPapel(papelId, revisaoEsperada),
    (papel) => `Papel “${papel.nome}” arquivado.`,
  );

export const useReativarPapel = (papelId: string) =>
  useMutacaoDePapel(
    (dados: DadosDeReativacao) => reativarPapel(papelId, dados),
    (papel) => `Papel “${papel.nome}” reativado. Nenhum vínculo anterior foi restaurado.`,
  );
