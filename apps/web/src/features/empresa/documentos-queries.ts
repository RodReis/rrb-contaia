'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { avisarFalha } from '../escritorio/queries';
import {
  aprovarDocumento,
  consultarDocumentos,
  consultarHistoricoDocumental,
  criarExigencia,
  dispensarExigencia,
  enviarArquivo,
  rejeitarDocumento,
  type VisaoDosDocumentos,
} from './documentos-api';

export const CHAVE_DOS_DOCUMENTOS = ['documentos'] as const;

export const chaveDosDocumentos = (empresaId: string): readonly unknown[] => [
  ...CHAVE_DOS_DOCUMENTOS,
  empresaId,
];

export const chaveDoHistoricoDocumental = (
  empresaId: string,
  deslocamento: number,
): readonly unknown[] => [...CHAVE_DOS_DOCUMENTOS, 'historico', empresaId, deslocamento];

export const useDocumentos = (empresaId: string) =>
  useQuery({
    queryKey: chaveDosDocumentos(empresaId),
    queryFn: () => consultarDocumentos(empresaId),
  });

/**
 * Toda ação desta aba gera evento: invalidar o histórico junto com a lista
 * evita que a aba de auditoria mostre o estado anterior à ação que a pessoa
 * acabou de executar.
 */
const useMutacaoDocumental = <Entrada>(
  empresaId: string,
  executar: (entrada: Entrada) => Promise<VisaoDosDocumentos>,
  mensagem: string,
) => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: (visao) => {
      clienteDeQuery.setQueryData(chaveDosDocumentos(empresaId), visao);
      void clienteDeQuery.invalidateQueries({ queryKey: CHAVE_DOS_DOCUMENTOS });
      toast.success(mensagem);
    },
    onError: avisarFalha,
  });
};

export const useCriarExigencia = (empresaId: string) =>
  useMutacaoDocumental(
    empresaId,
    (entrada: Parameters<typeof criarExigencia>[1]) => criarExigencia(empresaId, entrada),
    'Exigência incluída.',
  );

export const useEnviarArquivo = (empresaId: string, exigenciaId: string) =>
  useMutacaoDocumental(
    empresaId,
    (entrada: Parameters<typeof enviarArquivo>[2]) =>
      enviarArquivo(empresaId, exigenciaId, entrada),
    'Arquivo enviado. Ele aguarda análise.',
  );

export const useAprovarDocumento = (empresaId: string, exigenciaId: string) =>
  useMutacaoDocumental(
    empresaId,
    (versao: number) => aprovarDocumento(empresaId, exigenciaId, versao),
    'Documento aprovado.',
  );

export const useRejeitarDocumento = (empresaId: string, exigenciaId: string) =>
  useMutacaoDocumental(
    empresaId,
    (entrada: Parameters<typeof rejeitarDocumento>[2]) =>
      rejeitarDocumento(empresaId, exigenciaId, entrada),
    'Documento rejeitado. A exigência segue pendente de nova versão.',
  );

export const useDispensarExigencia = (empresaId: string, exigenciaId: string) =>
  useMutacaoDocumental(
    empresaId,
    (entrada: Parameters<typeof dispensarExigencia>[2]) =>
      dispensarExigencia(empresaId, exigenciaId, entrada),
    'Exigência dispensada.',
  );

export const LIMITE_DO_HISTORICO = 25;

export const useHistoricoDocumental = (empresaId: string, deslocamento: number) =>
  useQuery({
    queryKey: chaveDoHistoricoDocumental(empresaId, deslocamento),
    queryFn: () =>
      consultarHistoricoDocumental(empresaId, {
        limite: LIMITE_DO_HISTORICO,
        deslocamento,
      }),
    // A paginação troca o conteúdo inteiro; manter o anterior evita o salto de
    // layout entre uma página e a seguinte.
    placeholderData: keepPreviousData,
  });
