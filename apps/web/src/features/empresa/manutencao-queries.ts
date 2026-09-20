'use client';

import type { AbaDoHistorico } from '@contaia/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { avisarFalha } from '../escritorio/queries';
import type { VisaoDaEmpresa } from './api';
import {
  aplicarDaFonte,
  arquivarEmpresa,
  arquivarEndereco,
  atualizarEndereco,
  camposDoHistorico,
  compararComAFonte,
  consultarHistorico,
  criarEndereco,
  listarEnderecos,
  reativarEmpresa,
  salvarFiscaisMantidos,
  salvarIdentificacaoMantida,
  trocarEnderecoFiscal,
  type EnderecoDaEmpresa,
  type FiltroDoHistorico,
} from './manutencao-api';
import { CHAVE_DAS_EMPRESAS, chaveDaEmpresa } from './queries';

export const chaveDosEnderecos = (empresaId: string): readonly unknown[] => [
  ...CHAVE_DAS_EMPRESAS,
  'enderecos',
  empresaId,
];

export const CHAVE_DO_HISTORICO = ['historico'] as const;

export const chaveDoHistorico = (filtro: FiltroDoHistorico): readonly unknown[] => [
  ...CHAVE_DO_HISTORICO,
  filtro.aba,
  filtro.empresaId,
  filtro.inicio,
  filtro.fim,
  filtro.usuarioId,
  filtro.campo,
  filtro.limite,
  filtro.deslocamento,
];

/**
 * Toda alteração desta fatia gera evento: invalidar o histórico junto com a
 * empresa evita que a aba de auditoria mostre a lista de antes da mudança que
 * o usuário acabou de fazer.
 */
const useMutacaoDeManutencao = <Entrada>(
  executar: (entrada: Entrada) => Promise<VisaoDaEmpresa>,
  aoConcluir?: (visao: VisaoDaEmpresa) => void,
) => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: (visao) => {
      clienteDeQuery.setQueryData(chaveDaEmpresa(visao.id), visao);
      void clienteDeQuery.invalidateQueries({ queryKey: CHAVE_DAS_EMPRESAS });
      void clienteDeQuery.invalidateQueries({ queryKey: CHAVE_DO_HISTORICO });
      aoConcluir?.(visao);
    },
    onError: avisarFalha,
  });
};

const useMutacaoDeEndereco = <Entrada>(
  empresaId: string,
  executar: (entrada: Entrada) => Promise<readonly EnderecoDaEmpresa[]>,
  mensagem: string,
) => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: (enderecos) => {
      clienteDeQuery.setQueryData(chaveDosEnderecos(empresaId), enderecos);
      void clienteDeQuery.invalidateQueries({ queryKey: CHAVE_DO_HISTORICO });
      toast.success(mensagem);
    },
    onError: avisarFalha,
  });
};

export const useSalvarIdentificacaoMantida = (empresaId: string) =>
  useMutacaoDeManutencao(
    (dados: Parameters<typeof salvarIdentificacaoMantida>[1]) =>
      salvarIdentificacaoMantida(empresaId, dados),
    () => toast.success('Identificação salva.'),
  );

export const useSalvarFiscaisMantidos = (empresaId: string) =>
  useMutacaoDeManutencao(
    (entrada: {
      dados: Parameters<typeof salvarFiscaisMantidos>[1];
      vigencia: string;
    }) => salvarFiscaisMantidos(empresaId, entrada.dados, entrada.vigencia),
    () => toast.success('Dados fiscais salvos.'),
  );

export const useEnderecos = (empresaId: string) =>
  useQuery({
    queryKey: chaveDosEnderecos(empresaId),
    queryFn: () => listarEnderecos(empresaId),
  });

export const useCriarEndereco = (empresaId: string) =>
  useMutacaoDeEndereco(
    empresaId,
    (dados: Parameters<typeof criarEndereco>[1]) => criarEndereco(empresaId, dados),
    'Endereço incluído.',
  );

export const useAtualizarEndereco = (empresaId: string) =>
  useMutacaoDeEndereco(
    empresaId,
    (entrada: { enderecoId: string; dados: Parameters<typeof atualizarEndereco>[2] }) =>
      atualizarEndereco(empresaId, entrada.enderecoId, entrada.dados),
    'Endereço salvo.',
  );

export const useTrocarEnderecoFiscal = (empresaId: string) =>
  useMutacaoDeEndereco(
    empresaId,
    (dados: Parameters<typeof trocarEnderecoFiscal>[1]) =>
      trocarEnderecoFiscal(empresaId, dados),
    'Endereço Fiscal transferido.',
  );

export const useArquivarEndereco = (empresaId: string) =>
  useMutacaoDeEndereco(
    empresaId,
    (enderecoId: string) => arquivarEndereco(empresaId, enderecoId),
    'Endereço arquivado.',
  );

export const useArquivarEmpresa = (empresaId: string, aoConcluir?: () => void) =>
  useMutacaoDeManutencao(
    (justificativa: string) => arquivarEmpresa(empresaId, justificativa),
    () => {
      toast.success('Empresa arquivada.');
      aoConcluir?.();
    },
  );

export const useReativarEmpresa = (empresaId: string, aoConcluir?: () => void) =>
  useMutacaoDeManutencao(
    (justificativa: string) => reativarEmpresa(empresaId, justificativa),
    () => {
      toast.success('Empresa reativada.');
      aoConcluir?.();
    },
  );

/**
 * A comparação com a CNPJá é uma mutação, e não uma query, de propósito: ela
 * dispara uma chamada externa e só acontece quando o usuário pede. Como query
 * ela rodaria sozinha ao montar a aba e gastaria cota da fonte externa.
 */
export const useCompararComAFonte = (empresaId: string) =>
  useMutation({
    mutationFn: () => compararComAFonte(empresaId),
    onError: avisarFalha,
  });

export const useAplicarDaFonte = (empresaId: string, aoConcluir?: () => void) =>
  useMutacaoDeManutencao(
    (campos: readonly string[]) => aplicarDaFonte(empresaId, campos),
    () => {
      toast.success('Dados atualizados pela CNPJá.');
      aoConcluir?.();
    },
  );

export const useHistorico = (filtro: FiltroDoHistorico) =>
  useQuery({
    queryKey: chaveDoHistorico(filtro),
    queryFn: () => consultarHistorico(filtro),
    placeholderData: keepPreviousData,
  });

export const useCamposDoHistorico = (aba: AbaDoHistorico | null) =>
  useQuery({
    queryKey: [...CHAVE_DO_HISTORICO, 'campos', aba],
    queryFn: () => camposDoHistorico(aba),
  });
