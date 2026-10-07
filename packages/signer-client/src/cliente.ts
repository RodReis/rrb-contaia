/**
 * Cliente mTLS do Signer (SPEC-012 §3.1, §6.2), compartilhado por workers e API.
 *
 * Cada processo apresenta a SUA identidade de serviço (certificado emitido pela CA interna) e valida
 * o servidor contra essa mesma CA e o nome da rede privada — nunca desliga a validação. O cliente
 * só fala o contrato tipado: não há URL arbitrária, caminho de Vault nem segredo em nenhum método.
 *
 * Retry, backoff e DLQ NÃO moram aqui: o Signer faz uma tentativa por chamada e o chamador decide.
 * O erro só diz se vale tentar de novo (`transitorio`).
 */
import https from 'node:https';
import type {
  ComandoAssinar,
  ComandoDiagnosticar,
  ComandoExecutarMtls,
  ConsultaEstados,
  ConsultaHistorico,
  RespostaDeAssinatura,
  RespostaDeEstados,
  RespostaDeExecucaoMtls,
  RespostaDeHistorico,
  RespostaDeSaude,
} from '@contaia/shared';

const LIMITE_DA_RESPOSTA_BYTES = 2 * 1024 * 1024;
const TEMPO_LIMITE_PADRAO_MS = 15_000;

export type ConfigDoClienteDoSigner = Readonly<{
  host: string;
  porta: number;
  /** Nome que o certificado do Signer precisa apresentar (SAN). */
  servername: string;
  certificadoPem: string;
  chavePem: string;
  caPem: string;
  tempoLimiteMs?: number;
}>;

export class ErroDoClienteDoSigner extends Error {
  constructor(
    readonly codigo: string,
    /** `null` quando não houve resposta HTTP (rede, TLS, tempo). */
    readonly status: number | null,
    readonly correlationId: string | null,
    /** Vale tentar de novo com a mesma chave idempotente. */
    readonly transitorio: boolean,
  ) {
    // Só o código: a mensagem nunca carrega corpo de resposta nem causa de baixo nível.
    super(codigo);
    this.name = 'ErroDoClienteDoSigner';
  }
}

type Retorno = Readonly<{ status: number; tipo: string; texto: string }>;

const falhaDeTransporte = (): ErroDoClienteDoSigner =>
  new ErroDoClienteDoSigner('SIGNER_INDISPONIVEL', null, null, true);

const consulta = (valores: Record<string, string | number | undefined>): string => {
  const parametros = new URLSearchParams();

  for (const [chave, valor] of Object.entries(valores)) {
    if (valor !== undefined) {
      parametros.set(chave, String(valor));
    }
  }

  return parametros.toString();
};

const traduzirErro = (retorno: Retorno, correlationId: string): ErroDoClienteDoSigner => {
  let corpo: unknown = null;

  try {
    corpo = JSON.parse(retorno.texto);
  } catch {
    corpo = null;
  }

  const problema = corpo as { code?: unknown; correlationId?: unknown } | null;
  const codigo = typeof problema?.code === 'string' ? problema.code : 'SIGNER_INDISPONIVEL';
  const correlacao = typeof problema?.correlationId === 'string' ? problema.correlationId : correlationId;
  // 5xx do Signer e "em andamento" são transitórios; contexto, alçada, conflito e certificado não.
  const transitorio = retorno.status >= 500 || codigo === 'SIGNER_OPERACAO_EM_ANDAMENTO';

  return new ErroDoClienteDoSigner(codigo, retorno.status, correlacao, transitorio);
};

export const criarClienteDoSigner = (config: ConfigDoClienteDoSigner) => {
  const tempoLimiteMs = config.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;

  const requisitar = (metodo: 'GET' | 'POST', caminho: string, corpo: unknown, correlationId: string): Promise<Retorno> =>
    new Promise((resolver, rejeitar) => {
      const texto = corpo === undefined ? undefined : JSON.stringify(corpo);
      const requisicao = https.request(
        {
          host: config.host,
          port: config.porta,
          method: metodo,
          path: caminho,
          // Identidade de serviço do chamador; servidor validado pela CA e pelo NOME configurados.
          cert: config.certificadoPem,
          key: config.chavePem,
          ca: config.caPem,
          servername: config.servername,
          minVersion: 'TLSv1.3',
          signal: AbortSignal.timeout(tempoLimiteMs),
          headers: {
            accept: 'application/json',
            'x-correlation-id': correlationId,
            ...(texto === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto) }),
          },
        },
        (resposta) => {
          const partes: Buffer[] = [];
          let total = 0;

          resposta.on('data', (parte: Buffer) => {
            total += parte.length;
            if (total > LIMITE_DA_RESPOSTA_BYTES) {
              resposta.destroy();
              rejeitar(falhaDeTransporte());
              return;
            }
            partes.push(parte);
          });
          resposta.on('end', () =>
            resolver({
              status: resposta.statusCode ?? 0,
              tipo: String(resposta.headers['content-type'] ?? ''),
              texto: Buffer.concat(partes).toString('utf8'),
            }),
          );
          resposta.on('error', () => rejeitar(falhaDeTransporte()));
        },
      );

      requisicao.on('error', () => rejeitar(falhaDeTransporte()));
      requisicao.end(texto);
    });

  const chamar = async <T>(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo: unknown,
    correlationId: string,
  ): Promise<T> => {
    const retorno = await requisitar(metodo, caminho, corpo, correlationId);

    if (retorno.status < 200 || retorno.status >= 300) {
      throw traduzirErro(retorno, correlationId);
    }

    try {
      return JSON.parse(retorno.texto) as T;
    } catch {
      throw new ErroDoClienteDoSigner('SIGNER_INDISPONIVEL', retorno.status, correlationId, true);
    }
  };

  return {
    saude: (correlationId: string) => chamar<RespostaDeSaude>('GET', '/v1/saude', undefined, correlationId),
    assinar: (comando: ComandoAssinar) =>
      chamar<RespostaDeAssinatura>('POST', '/v1/assinar', comando, comando.correlationId),
    executarMtls: (comando: ComandoExecutarMtls) =>
      chamar<RespostaDeExecucaoMtls>('POST', '/v1/executar-mtls', comando, comando.correlationId),
    diagnosticar: (comando: ComandoDiagnosticar) =>
      chamar<RespostaDeExecucaoMtls>('POST', '/v1/diagnosticar', comando, comando.correlationId),
    estados: (pedido: ConsultaEstados) =>
      chamar<RespostaDeEstados>(
        'GET',
        `/v1/estados?${consulta({
          tenantId: pedido.tenantId,
          empresaIds: pedido.empresaIds.join(','),
          correlationId: pedido.correlationId,
        })}`,
        undefined,
        pedido.correlationId,
      ),
    historico: (pedido: ConsultaHistorico) =>
      chamar<RespostaDeHistorico>(
        'GET',
        `/v1/historico?${consulta({
          tenantId: pedido.tenantId,
          empresaId: pedido.empresaId,
          correlationId: pedido.correlationId,
          pagina: pedido.pagina,
          finalidade: pedido.finalidade,
          resultado: pedido.resultado,
        })}`,
        undefined,
        pedido.correlationId,
      ),
  };
};

export type ClienteDoSigner = ReturnType<typeof criarClienteDoSigner>;
