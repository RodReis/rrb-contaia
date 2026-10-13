'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { avisarFalha } from '../escritorio/queries';
import {
  arquivarRegra,
  criarRegra,
  editarRegra,
  listarRegras,
  obterRegra,
  publicarRegra,
  simularManual,
  simularNfe,
  type FiltroDoCatalogo,
} from './api';

/**
 * O catálogo é GLOBAL (SPEC-016 §3.7): não pertence a tenant nem a empresa, então a chave não
 * carrega escopo de escritório. Toda mutação invalida a raiz, e a lista é a que a API devolve
 * para quem está logado (o escritório só vê o publicado).
 */
export const CHAVE_DO_CATALOGO = ['motor-tributario', 'catalogo'] as const;

export const useCatalogo = (filtro: FiltroDoCatalogo) =>
  useQuery({
    queryKey: [...CHAVE_DO_CATALOGO, 'lista', filtro],
    queryFn: () => listarRegras(filtro),
    // A lista é conferida: a página anterior continua visível enquanto a próxima carrega.
    placeholderData: keepPreviousData,
  });

/**
 * Uma versão pelo id (painel de edição). Sem `staleTime`: quem edita precisa do dado atual, e
 * `lockVersion` desatualizado é exatamente o que gera o conflito de versão.
 */
export const useRegra = (id: string | null) =>
  useQuery({
    queryKey: [...CHAVE_DO_CATALOGO, 'versao', id],
    queryFn: () => obterRegra(id ?? ''),
    enabled: id !== null,
    staleTime: 0,
  });

/** Códigos que o painel explica de forma persistente (SPEC-016 §5.3): toast não substitui estado. */
export const CODIGOS_EXPLICADOS_NO_PAINEL: ReadonlySet<string> = new Set([
  CODIGOS_DE_ERRO.TAX_RULE_VERSION_CONFLICT,
  CODIGOS_DE_ERRO.TAX_RULE_OVERLAPPING_VALIDITY,
  CODIGOS_DE_ERRO.TAX_RULE_IMMUTABLE,
  CODIGOS_DE_ERRO.TAX_RULE_NOT_FOUND,
  CODIGOS_DE_ERRO.PLATFORM_ADMIN_REQUIRED,
]);

const avisarFalhaDoCatalogo = (erro: unknown): void => {
  if (erro instanceof ErroDaApi && CODIGOS_EXPLICADOS_NO_PAINEL.has(erro.problema.code)) {
    return;
  }

  avisarFalha(erro);
};

/**
 * Mutação do catálogo: espera a lista atualizar antes de resolver (o painel fecha com o dado novo)
 * e publica o toast de sucesso. A falha vai ao toast, salvo as que o painel explica por conta própria.
 */
const useMutacaoDoCatalogo = <Entrada, Saida>(executar: (entrada: Entrada) => Promise<Saida>, sucesso: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CHAVE_DO_CATALOGO });
      toast.success(sucesso);
    },
    onError: avisarFalhaDoCatalogo,
    retry: 0,
  });
};

export const useCriarRegra = () => useMutacaoDoCatalogo(criarRegra, 'Rascunho criado.');

export const useEditarRegra = () =>
  useMutacaoDoCatalogo(
    ({ id, corpo }: { id: string; corpo: Parameters<typeof editarRegra>[1] }) => editarRegra(id, corpo),
    'Rascunho salvo.',
  );

export const usePublicarRegra = () =>
  useMutacaoDoCatalogo(
    ({ id, expectedVersion }: { id: string; expectedVersion: number }) => publicarRegra(id, { expectedVersion }),
    'Versão publicada. Ela agora é imutável.',
  );

export const useArquivarRegra = () =>
  useMutacaoDoCatalogo(
    ({ id, expectedVersion }: { id: string; expectedVersion: number }) => arquivarRegra(id, { expectedVersion }),
    'Versão arquivada. O histórico foi preservado.',
  );

/**
 * Simulação não grava nada (SPEC-016 §3.5): sem invalidar cache e sem toast de sucesso, que não
 * traria informação nova; o resultado fica na tela. A falha vai ao estado do formulário.
 */
export const useSimularManual = () => useMutation({ mutationFn: simularManual, retry: 0 });

export const useSimularNfe = () =>
  useMutation({
    mutationFn: ({ arquivo, complemento }: { arquivo: File; complemento: Parameters<typeof simularNfe>[1] }) =>
      simularNfe(arquivo, complemento),
    retry: 0,
  });
