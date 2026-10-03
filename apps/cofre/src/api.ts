/**
 * Cliente das rotas internas da API principal (SPEC-011 §6.2). O cofre entrega
 * metadados e a referência opaca; a API decide ativar e troca o vigente na transação dela.
 *
 * Desfecho da ativação, que decide se o segredo gravado no Vault é destruído:
 *  - sucesso: a API ativou;
 *  - recusa DEFINITIVA: a API respondeu 4xx com problem+json (tem `code`) — nada foi ativado;
 *  - AMBÍGUO: rede, timeout, 5xx, 408/429 ou resposta sem forma de problema. A API pode ter
 *    comitado antes de a resposta se perder; destruir o segredo aqui deixaria a empresa com
 *    um certificado vigente sem segredo. Quem chama tenta de novo (a ativação é idempotente
 *    por ticket + referência) e, se persistir, deixa o segredo onde está.
 */
import type { PedidoDeAtivacao, PedidoDeRecusa, RespostaDaIngestao } from '@contaia/shared';

export type RecusaDefinitiva = Readonly<{
  ok: false;
  definitiva: true;
  status: number;
  codigo: string;
  titulo: string | null;
  detalhe: string | null;
}>;

export type DesfechoAmbiguo = Readonly<{ ok: false; definitiva: false; status: number | null }>;

export type RespostaDaApi =
  | Readonly<{ ok: true; corpo: RespostaDaIngestao }>
  | RecusaDefinitiva
  | DesfechoAmbiguo;

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

const TAMANHO_MAXIMO_DO_TEXTO = 300;

const textoOuNulo = (valor: unknown): string | null =>
  typeof valor === 'string' && valor !== '' ? valor.slice(0, TAMANHO_MAXIMO_DO_TEXTO) : null;

/** 4xx que não indicam que a API "decidiu": o pedido pode ser repetido com sucesso. */
const STATUS_REPETIVEIS = new Set([408, 425, 429]);

export const classificarResposta = (status: number, corpo: unknown): RespostaDaApi | RecusaDefinitiva | DesfechoAmbiguo => {
  const problema = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
  const codigo = textoOuNulo(problema['code']);

  if (status >= 400 && status < 500 && !STATUS_REPETIVEIS.has(status) && codigo !== null) {
    return {
      ok: false,
      definitiva: true,
      status,
      codigo,
      titulo: textoOuNulo(problema['title']),
      detalhe: textoOuNulo(problema['detail']),
    };
  }

  return { ok: false, definitiva: false, status };
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
      let corpo: unknown;
      try {
        resposta = await enviar('ativacao', pedido, correlationId);
        corpo = await resposta.json().catch(() => null);
      } catch {
        return { ok: false, definitiva: false, status: null };
      }

      if (resposta.ok) {
        const certificado = (corpo as { certificado?: unknown } | null)?.certificado;
        // 2xx sem a forma esperada não prova que a API ativou: tratado como ambíguo.
        return typeof certificado === 'object' && certificado !== null
          ? { ok: true, corpo: corpo as RespostaDaIngestao }
          : { ok: false, definitiva: false, status: resposta.status };
      }
      return classificarResposta(resposta.status, corpo);
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
