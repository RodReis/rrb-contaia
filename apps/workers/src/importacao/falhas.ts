/**
 * Peças comuns da validação assíncrona das importações (SPEC-013 §6.4, SPEC-014 §6.4): os códigos
 * estáveis de falha técnica, o contrato de dependências e os passos que não dependem do domínio
 * (payload do job, contexto técnico da empresa, leitura do original). Cada importador (plano de
 * contas, empregados) tem o seu `validacao.ts` com o que é dele; o processador e o consumidor
 * genéricos só conhecem o que está aqui.
 */
import { comContexto } from '@contaia/db';
import { ErroDeDominio, contextoTecnico } from '@contaia/domain';
import { ComandoValidarImportacaoSchema, type ComandoValidarImportacao } from '@contaia/shared';
import { UnrecoverableError } from 'bullmq';
import type { Pool, PoolClient } from 'pg';

import { ErroDoArmazenamento } from './leitura-s3.js';
import type { LeitorDeAba } from './planilha.js';

/** Códigos estáveis de falha técnica (evento `FALHA_TECNICA` e fila morta). Nunca mensagem crua. */
export const CODIGOS_DA_FALHA_DA_VALIDACAO = {
  PAYLOAD_INVALIDO: 'PAYLOAD_INVALIDO',
  TENTATIVA_NAO_ENCONTRADA: 'TENTATIVA_NAO_ENCONTRADA',
  ORIGINAL_NAO_ENCONTRADO: 'ORIGINAL_NAO_ENCONTRADO',
  ARMAZENAMENTO_INDISPONIVEL: 'ARMAZENAMENTO_INDISPONIVEL',
  FALHA_NA_VALIDACAO: 'FALHA_NA_VALIDACAO',
} as const;
export type CodigoDaFalhaDaValidacao = (typeof CODIGOS_DA_FALHA_DA_VALIDACAO)[keyof typeof CODIGOS_DA_FALHA_DA_VALIDACAO];

const CODIGOS_CONHECIDOS: readonly string[] = Object.values(CODIGOS_DA_FALHA_DA_VALIDACAO);

/** Sem tentativa identificável (ou de outro tenant/empresa): não há o que marcar como FALHA. */
const SEM_TENTATIVA: readonly CodigoDaFalhaDaValidacao[] = ['PAYLOAD_INVALIDO', 'TENTATIVA_NAO_ENCONTRADA'];

export type DependenciasDaValidacao = Readonly<{
  pool: Pool;
  /** Lê o original pela chave; falha com `ErroDoArmazenamento` (código estável). */
  ler: (chave: string) => Promise<Buffer>;
  agora: () => Date;
  /** Leitor de aba de planilha (padrão: o processo filho real, na vaga do limitador do processo). */
  lerPlanilha?: LeitorDeAba | undefined;
}>;

export type TotaisDaValidacao = Readonly<{ lidas: number; novas: number; atualizadas: number; rejeitadas: number }>;

export type ResultadoDaValidacaoDoJob =
  | Readonly<{ desfecho: 'AGUARDANDO_CONFIRMACAO' | 'REJEITADA'; totais: TotaisDaValidacao }>
  /** Reentrega de tentativa já validada (ou encerrada): ack, sem efeito. */
  | Readonly<{ desfecho: 'JA_PROCESSADA' }>;

export const validarComando = (dados: unknown): ComandoValidarImportacao => {
  const validado = ComandoValidarImportacaoSchema.safeParse(dados);

  if (!validado.success) {
    // Payload fora do contrato: repetir não conserta.
    throw new UnrecoverableError(CODIGOS_DA_FALHA_DA_VALIDACAO.PAYLOAD_INVALIDO);
  }

  return validado.data;
};

/** Transação por empresa com a identidade técnica do worker do importador (classe `empresa` da RLS). */
export const naEmpresaDoComando =
  (identidadeTecnica: string) =>
  <T>(pool: Pool, comando: ComandoValidarImportacao, executar: (c: PoolClient) => Promise<T>): Promise<T> =>
    comContexto(
      pool,
      contextoTecnico({
        identidadeTecnica,
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId: comando.tenantId,
        empresaId: comando.empresaId,
        correlationId: comando.correlationId,
      }),
      executar,
    );

export const ehErroDeDominio = (erro: unknown, codigo: string): boolean => erro instanceof ErroDeDominio && erro.codigo === codigo;

export const naoEncontrada = (): UnrecoverableError => new UnrecoverableError(CODIGOS_DA_FALHA_DA_VALIDACAO.TENTATIVA_NAO_ENCONTRADA);

/** O original do storage, sem transação aberta. Objeto ausente é definitivo. */
export const lerOriginal = async (deps: Pick<DependenciasDaValidacao, 'ler'>, chave: string): Promise<Buffer> => {
  try {
    return await deps.ler(chave);
  } catch (erro) {
    if (erro instanceof ErroDoArmazenamento && erro.codigo === 'ORIGINAL_NAO_ENCONTRADO') {
      throw new UnrecoverableError(CODIGOS_DA_FALHA_DA_VALIDACAO.ORIGINAL_NAO_ENCONTRADO);
    }

    throw erro;
  }
};

/** Código estável da falha, para o evento e a fila morta. A mensagem crua nunca sai daqui. */
export const motivoDaFalhaDaValidacao = (erro: Error): CodigoDaFalhaDaValidacao => {
  if (erro instanceof UnrecoverableError && CODIGOS_CONHECIDOS.includes(erro.message)) {
    return erro.message as CodigoDaFalhaDaValidacao;
  }
  if (erro instanceof ErroDoArmazenamento) {
    return erro.codigo;
  }

  return CODIGOS_DA_FALHA_DA_VALIDACAO.FALHA_NA_VALIDACAO;
};

/** Há uma tentativa da empresa a encerrar em FALHA para este motivo? */
export const motivoEncerraEmFalha = (motivo: CodigoDaFalhaDaValidacao): boolean => !SEM_TENTATIVA.includes(motivo);
