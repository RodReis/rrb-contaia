/**
 * Idempotência da importação do plano de contas (SPEC-013 §3.7, I-9).
 *
 * A identidade da tentativa é tenant + empresa + hash do arquivo + mapeamento confirmado.
 * Reenviar o mesmo conteúdo com o mesmo mapeamento reutiliza o resultado terminal existente.
 * Mesmo arquivo com mapeamento diferente é uma nova tentativa vinculada ao mesmo arquivo de
 * origem — nunca duplica aplicação nem notificação.
 */

export type EstadoDaTentativa =
  | 'RECEBIDA'
  | 'VALIDANDO'
  | 'AGUARDANDO_CONFIRMACAO'
  | 'APLICANDO'
  | 'CONCLUIDA'
  | 'CONCLUIDA_COM_REJEICOES'
  | 'REJEITADA'
  | 'CANCELADA'
  | 'FALHA';

export interface TentativaExistente {
  readonly id: string;
  readonly tenantId: string;
  readonly empresaId: string;
  readonly hashArquivo: string;
  readonly mapeamento: string;
  readonly estado: EstadoDaTentativa;
}

export interface PedidoDeImportacao {
  readonly tenantId: string;
  readonly empresaId: string;
  readonly hashArquivo: string;
  readonly mapeamento: string;
}

export type DecisaoDeIdempotenciaDaImportacao =
  | Readonly<{ tipo: 'NOVA' }>
  | Readonly<{ tipo: 'REUTILIZAR'; tentativaId: string }>
  | Readonly<{ tipo: 'EM_ANDAMENTO'; tentativaId: string }>;

const ESTADOS_TERMINAIS: readonly EstadoDaTentativa[] = [
  'CONCLUIDA',
  'CONCLUIDA_COM_REJEICOES',
  'REJEITADA',
  'CANCELADA',
  'FALHA',
];

export const decidirIdempotenciaDaImportacao = (
  existente: TentativaExistente | null,
  pedido: PedidoDeImportacao,
): DecisaoDeIdempotenciaDaImportacao => {
  if (existente === null) {
    return { tipo: 'NOVA' };
  }

  const mesmoContexto =
    existente.tenantId === pedido.tenantId &&
    existente.empresaId === pedido.empresaId &&
    existente.hashArquivo === pedido.hashArquivo &&
    existente.mapeamento === pedido.mapeamento;

  if (!mesmoContexto) {
    return { tipo: 'NOVA' };
  }

  if (ESTADOS_TERMINAIS.includes(existente.estado)) {
    return { tipo: 'REUTILIZAR', tentativaId: existente.id };
  }

  return { tipo: 'EM_ANDAMENTO', tentativaId: existente.id };
};