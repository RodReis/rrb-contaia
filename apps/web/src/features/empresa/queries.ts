'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { avisarFalha } from '../escritorio/queries';
import {
  ativarEmpresa,
  consultarCnpj,
  criarEmpresa,
  listarEmpresas,
  obterEmpresa,
  salvarDadosFiscais,
  salvarEnderecoDaEmpresa,
  salvarIdentificacaoDaEmpresa,
  type FiltroDaLista,
  type VisaoDaEmpresa,
} from './api';

/**
 * Chaves de cache. A da lista carrega o filtro inteiro: mudar busca, status ou
 * página é outra consulta, não a mesma com dado velho.
 */
export const CHAVE_DAS_EMPRESAS = ['empresas'] as const;

export const chaveDaLista = (filtro: FiltroDaLista): readonly unknown[] => [
  ...CHAVE_DAS_EMPRESAS,
  'lista',
  filtro.busca,
  filtro.status,
  filtro.limite,
  filtro.deslocamento,
];

export const chaveDaEmpresa = (empresaId: string): readonly unknown[] => [
  ...CHAVE_DAS_EMPRESAS,
  'empresa',
  empresaId,
];

export const useListaDeEmpresas = (filtro: FiltroDaLista) =>
  useQuery({
    queryKey: chaveDaLista(filtro),
    queryFn: () => listarEmpresas(filtro),
    // A listagem é conferida: manter a página anterior visível enquanto a nova
    // carrega evita a tabela sumir a cada tecla da busca. `keepPreviousData` é
    // o helper oficial da v5 — a função inline equivalente existe, mas o helper
    // é o caminho que a documentação garante.
    placeholderData: keepPreviousData,
  });

export const useEmpresa = (empresaId: string) =>
  useQuery({
    queryKey: chaveDaEmpresa(empresaId),
    queryFn: () => obterEmpresa(empresaId),
  });

const useMutacaoDaEmpresa = <Entrada>(
  executar: (entrada: Entrada) => Promise<VisaoDaEmpresa>,
  aoConcluir?: (visao: VisaoDaEmpresa) => void,
) => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: (visao) => {
      clienteDeQuery.setQueryData(chaveDaEmpresa(visao.id), visao);
      // A listagem muda a cada etapa salva (nome fantasia, regime, status):
      // invalidar o ramo inteiro é mais honesto do que adivinhar qual filtro
      // ainda bate com a empresa alterada.
      void clienteDeQuery.invalidateQueries({ queryKey: CHAVE_DAS_EMPRESAS });
      aoConcluir?.(visao);
    },
    onError: avisarFalha,
  });
};

export const useConsultarCnpj = () =>
  useMutation({
    mutationFn: consultarCnpj,
    // A falha da consulta externa não é erro de operação: vira estado na tela,
    // com preenchimento manual disponível. Só erro de validação/rede avisa.
    onError: avisarFalha,
  });

export const useCriarEmpresa = (aoConcluir?: (visao: VisaoDaEmpresa) => void) =>
  useMutacaoDaEmpresa(criarEmpresa, (visao) => {
    toast.success('Cadastro iniciado.');
    aoConcluir?.(visao);
  });

export const useSalvarIdentificacaoDaEmpresa = (
  empresaId: string,
  aoConcluir?: () => void,
) =>
  useMutacaoDaEmpresa(
    (dados: Parameters<typeof salvarIdentificacaoDaEmpresa>[1]) =>
      salvarIdentificacaoDaEmpresa(empresaId, dados),
    () => {
      toast.success('Identificação salva.');
      aoConcluir?.();
    },
  );

export const useSalvarDadosFiscais = (empresaId: string, aoConcluir?: () => void) =>
  useMutacaoDaEmpresa(
    (dados: Parameters<typeof salvarDadosFiscais>[1]) => salvarDadosFiscais(empresaId, dados),
    () => {
      toast.success('Dados fiscais salvos.');
      aoConcluir?.();
    },
  );

export const useSalvarEnderecoDaEmpresa = (empresaId: string, aoConcluir?: () => void) =>
  useMutacaoDaEmpresa(
    (dados: Parameters<typeof salvarEnderecoDaEmpresa>[1]) =>
      salvarEnderecoDaEmpresa(empresaId, dados),
    () => {
      toast.success('Endereço salvo.');
      aoConcluir?.();
    },
  );

export const useAtivarEmpresa = (empresaId: string, aoConcluir?: () => void) =>
  useMutacaoDaEmpresa(
    (situacaoExternaConfirmada: boolean) =>
      ativarEmpresa(empresaId, situacaoExternaConfirmada),
    (visao) => {
      if (visao.cadastro.status === 'ATIVA') {
        toast.success('Empresa ativada.');
        aoConcluir?.();
      }
    },
  );
