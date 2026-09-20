'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import {
  arquivarDocumento,
  concluirCadastro,
  enviarArquivo,
  obterCadastro,
  salvarEndereco,
  salvarIdentificacao,
  salvarResponsavel,
  type VisaoDoCadastro,
} from './api';

export const CHAVE_DO_CADASTRO = ['escritorio', 'cadastro'] as const;

export const useCadastro = () =>
  useQuery({ queryKey: CHAVE_DO_CADASTRO, queryFn: obterCadastro });

/**
 * Toast de erro é persistente e carrega o `correlationId` — é o que o suporte
 * pede (FRONTEND.md §13). Erro de campo não vem por toast: fica no campo.
 */
export const avisarFalha = (erro: unknown): void => {
  if (erro instanceof ErroDaApi) {
    const temCampos = (erro.problema.campos ?? []).length > 0;

    if (temCampos) {
      return;
    }

    toast.error(mensagemDoCodigo(erro.problema.code), {
      duration: Infinity,
      description: `Código de suporte: ${erro.problema.correlationId}`,
    });

    return;
  }

  toast.error('Não foi possível concluir a operação.', { duration: Infinity });
};

const useMutacaoDoCadastro = <Entrada>(
  executar: (entrada: Entrada) => Promise<VisaoDoCadastro>,
  aoConcluir?: (visao: VisaoDoCadastro) => void,
) => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: executar,
    onSuccess: (visao) => {
      clienteDeQuery.setQueryData(CHAVE_DO_CADASTRO, visao);
      aoConcluir?.(visao);
    },
    onError: avisarFalha,
  });
};

export const useSalvarIdentificacao = (aoConcluir?: () => void) =>
  useMutacaoDoCadastro(salvarIdentificacao, () => {
    toast.success('Identificação salva.');
    aoConcluir?.();
  });

export const useSalvarResponsavel = (aoConcluir?: () => void) =>
  useMutacaoDoCadastro(salvarResponsavel, () => {
    toast.success('Responsável técnico salvo.');
    aoConcluir?.();
  });

export const useSalvarEndereco = (aoConcluir?: () => void) =>
  useMutacaoDoCadastro(salvarEndereco, () => {
    toast.success('Endereço salvo.');
    aoConcluir?.();
  });

export const useEnviarArquivo = () =>
  useMutacaoDoCadastro(
    ({ tipo, arquivo }: { tipo: 'LOGO' | 'DOCUMENTO'; arquivo: File }) =>
      enviarArquivo(tipo, arquivo),
    () => toast.success('Arquivo enviado.'),
  );

export const useArquivarDocumento = () =>
  useMutacaoDoCadastro(arquivarDocumento, () => toast.success('Documento removido.'));

export const useConcluirCadastro = (aoConcluir?: () => void) =>
  useMutacaoDoCadastro(concluirCadastro, (visao) => {
    if (visao.cadastro.status === 'ATIVO') {
      toast.success('Cadastro concluído.');
      aoConcluir?.();
    }
  });
