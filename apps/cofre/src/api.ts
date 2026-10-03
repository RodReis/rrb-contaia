/**
 * Cliente das rotas internas da API principal (SPEC-011 §6.2). O cofre entrega
 * metadados e a referência opaca; a API decide ativar e troca o vigente na transação dela.
 */
import type { PedidoDeAtivacao, PedidoDeRecusa, RespostaDaIngestao } from '@contaia/shared';

export type RespostaDaApi =
  | Readonly<{ ok: true; corpo: RespostaDaIngestao }>
  | Readonly<{ ok: false; status: number | null; codigo: string | null }>;

export type ClienteDaApi = Readonly<{
  ativar(pedido: PedidoDeAtivacao, correlationId: string): Promise<RespostaDaApi>;
  /** Melhor esforço: a recusa já foi decidida; falhar aqui só deixa de auditar. */
  recusar(pedido: PedidoDeRecusa, correlationId: string): Promise<boolean>;
}>;

export type OpcoesDoClienteDaApi = Readonly<{
  apiUrl: string;
  serviceToken: string;
  fetchImpl?: typeof fetch;
  tempoLimiteMs?: number;
}>;

const codigoDoProblema = (corpo: unknown): string | null => {
  const codigo = (corpo as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' ? codigo : null;
};

export const criarClienteDaApi = (opcoes: OpcoesDoClienteDaApi): ClienteDaApi => {
  const { apiUrl, serviceToken, fetchImpl = fetch, tempoLimiteMs = 10_000 } = opcoes;

  const enviar = (rota: string, corpo: unknown, correlationId: string): Promise<Response> =>
    fetchImpl(`${apiUrl}/interno/cofre/${rota}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceToken}`,
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(tempoLimiteMs),
    });

  return {
    async ativar(pedido, correlationId) {
      let resposta: Response;
      try {
        resposta = await enviar('ativacao', pedido, correlationId);
      } catch {
        return { ok: false, status: null, codigo: null };
      }

      const corpo: unknown = await resposta.json().catch(() => null);
      if (resposta.ok && corpo !== null) return { ok: true, corpo: corpo as RespostaDaIngestao };
      return { ok: false, status: resposta.status, codigo: codigoDoProblema(corpo) };
    },
    async recusar(pedido, correlationId) {
      try {
        return (await enviar('recusa', pedido, correlationId)).ok;
      } catch {
        return false;
      }
    },
  };
};
