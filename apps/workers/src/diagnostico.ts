/**
 * Diagnóstico pelo worker (SPEC-012 §3.8–§3.9). O Signer faz UMA tentativa por chamada; quem decide
 * repetir, com que espaço e até quando é o worker, aqui:
 *
 *   - falha transitória (rede, destino, Vault, "em andamento") → o erro volta e o BullMQ repete
 *     com backoff exponencial, sempre com o mesmo id de operação (a chave idempotente é derivada);
 *   - falha definitiva (contexto, alçada, certificado, conteúdo) → `UnrecoverableError`: repetir
 *     não muda o resultado;
 *   - esgotadas as tentativas ou irrecuperável → o job é copiado para a fila morta.
 */
import { ComandoDiagnosticarSchema, type ComandoDiagnosticar, type RespostaDeExecucaoMtls } from '@contaia/shared';
import { ErroDoClienteDoSigner, type ClienteDoSigner } from '@contaia/signer-client';
import { UnrecoverableError } from 'bullmq';

export const processarDiagnostico = async (
  dados: unknown,
  cliente: Pick<ClienteDoSigner, 'diagnosticar'>,
): Promise<RespostaDeExecucaoMtls> => {
  const validado = ComandoDiagnosticarSchema.safeParse(dados);

  if (!validado.success) {
    // Payload fora do contrato: repetir não conserta.
    throw new UnrecoverableError('SIGNER_CONTEXTO_INVALIDO');
  }

  const comando: ComandoDiagnosticar = validado.data;

  try {
    return await cliente.diagnosticar(comando);
  } catch (erro) {
    if (erro instanceof ErroDoClienteDoSigner && !erro.transitorio) {
      throw new UnrecoverableError(erro.codigo);
    }

    throw erro;
  }
};

type JobParaDlq = Readonly<{ attemptsMade: number; opts: Readonly<{ attempts?: number }> }>;

export const deveIrParaDlq = (job: JobParaDlq, erro: Error): boolean =>
  erro instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);

/** Código estável da falha. A mensagem crua de uma exceção qualquer nunca vai para a fila morta. */
export const motivoDaFalha = (erro: Error): string => {
  if (erro instanceof ErroDoClienteDoSigner) {
    return erro.codigo;
  }
  // O `UnrecoverableError` do worker carrega o código estável como mensagem.
  if (erro instanceof UnrecoverableError && erro.message.startsWith('SIGNER_')) {
    return erro.message;
  }

  return 'SIGNER_INDISPONIVEL';
};
