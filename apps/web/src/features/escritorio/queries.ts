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

/**
 * Chave de cache do cadastro (REVIEW.md §3.1).
 *
 * O tenant da sessão é resolvido pelo servidor a partir do cookie, e a resposta
 * o declara: a chave carrega esse `tenantId` para que dado de um escritório
 * nunca seja servido a outro por um cache que sobreviva à troca de sessão.
 */
export const CHAVE_DO_CADASTRO = ['escritorio', 'cadastro'] as const;

export const chaveDoCadastro = (tenantId: string): readonly unknown[] => [
  ...CHAVE_DO_CADASTRO,
  tenantId,
];

export const useCadastro = () =>
  useQuery({
    queryKey: CHAVE_DO_CADASTRO,
    queryFn: obterCadastro,
    // A resposta é reescrita sob a chave escopada em `onSuccess` das mutações;
    // a leitura inicial não tem o tenant antes de recebê-lo.
  });

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
      clienteDeQuery.setQueryData(chaveDoCadastro(visao.tenantId), visao);
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
