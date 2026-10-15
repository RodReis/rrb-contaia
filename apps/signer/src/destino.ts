/**
 * Saída mTLS para o dublê local da finalidade (SPEC-012 §3.7).
 *
 * UMA tentativa por chamada: backoff, teto e DLQ são do worker. O Signer valida o certificado, a
 * cadeia e o NOME do servidor contra a CA configurada — nunca desliga a validação, nunca aceita
 * qualquer certificado, nunca cai para HTTP. Destino, porta e CA vêm da configuração da
 * finalidade; o chamador do Signer não os informa.
 *
 * O resultado é só uma classificação: o corpo da resposta do destino não sai daqui.
 */
import https from 'node:https';
import { DFE_CAPTURE_MAX_RESPONSE_BYTES } from '@contaia/shared';

export type Destino = Readonly<{
  host: string;
  porta: number;
  /** Nome que o certificado do servidor precisa apresentar (SAN). */
  servername: string;
  caminho: string;
}>;

export type EntradaDeDistribuicaoDfe = Readonly<{
  destino: Destino;
  pfx: Buffer;
  senha: string;
  caPem: string;
  cnpj: string;
  ultNSU: string;
  limite: number;
  chaveIdempotente: string;
  tempoLimiteMs: number;
}>;

export type RespostaDeDistribuicaoDfe = Readonly<{
  tipo: 'LOTE' | 'SEM_NOVOS' | 'CONSUMO_INDEVIDO';
  codigoResposta: string;
  ultNSU: string;
  maxNSU: string;
  tempoMedioMs: number;
  itens: readonly Readonly<{ nsu: string; chaveAcesso: string | null; especie: 'NFE_55' | 'CTE'; conteudoBruto: string; disponibilizadoEm: string | null }>[];
  disponivelNovamenteEm: string | null;
}>;

export const consultarDistribuicaoDfe = (entrada: EntradaDeDistribuicaoDfe): Promise<RespostaDeDistribuicaoDfe> =>
  new Promise((resolver, rejeitar) => {
    const corpo = JSON.stringify({ cnpj: entrada.cnpj, ultNSU: entrada.ultNSU, limite: entrada.limite });
    const requisicao = https.request({
      host: entrada.destino.host, port: entrada.destino.porta, method: 'POST', path: '/v1/distribuicao',
      servername: entrada.destino.servername, agent: false, ca: entrada.caPem,
      pfx: entrada.pfx, passphrase: entrada.senha, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2',
      signal: AbortSignal.timeout(entrada.tempoLimiteMs),
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo),
        'idempotency-key': entrada.chaveIdempotente, 'x-cnpj-declarado': entrada.cnpj,
      },
    }, (resposta) => {
      const partes: Buffer[] = [];
      let tamanho = 0;
      resposta.on('data', (parte: Buffer) => {
        tamanho += parte.length;
        if (tamanho > DFE_CAPTURE_MAX_RESPONSE_BYTES) {
          resposta.destroy();
          rejeitar(new Error('DFE_RESPONSE_INVALID'));
          return;
        }
        partes.push(parte);
      });
      resposta.on('end', () => {
        if ((resposta.statusCode ?? 0) >= 500 || resposta.statusCode === 429 || resposta.statusCode === 408) {
          rejeitar(new Error('DFE_PROVIDER_UNAVAILABLE'));
          return;
        }
        try {
          const resultado: unknown = JSON.parse(Buffer.concat(partes).toString('utf8'));
          if (resposta.statusCode !== 200) throw new Error('DFE_RESPONSE_INVALID');
          if (!respostaDfeValida(resultado, entrada.limite, entrada.ultNSU)) throw new Error('DFE_RESPONSE_INVALID');
          resolver(resultado);
        } catch {
          rejeitar(new Error('DFE_RESPONSE_INVALID'));
        }
      });
      resposta.on('error', () => rejeitar(new Error('DFE_PROVIDER_UNAVAILABLE')));
    });
    requisicao.on('error', (erro: NodeJS.ErrnoException) => rejeitar(new Error(classificarErro(erro).tipo === 'INDISPONIVEL' ? 'DFE_PROVIDER_UNAVAILABLE' : 'DFE_SIGNER_UNAVAILABLE')));
    requisicao.end(corpo);
  });

const respostaDfeValida = (valor: unknown, limite: number, cursor: string): valor is RespostaDeDistribuicaoDfe => {
  if (typeof valor !== 'object' || valor === null) return false;
  const resposta = valor as Partial<RespostaDeDistribuicaoDfe>;
  if (!['LOTE', 'SEM_NOVOS', 'CONSUMO_INDEVIDO'].includes(resposta.tipo ?? '') ||
      typeof resposta.codigoResposta !== 'string' || !/^\d{1,15}$/u.test(resposta.ultNSU ?? '') ||
      !/^\d{1,15}$/u.test(resposta.maxNSU ?? '') || !Number.isSafeInteger(resposta.tempoMedioMs) ||
      (resposta.tempoMedioMs ?? -1) < 0 || !Array.isArray(resposta.itens) || resposta.itens.length > limite ||
      typeof resposta.ultNSU !== 'string' || typeof resposta.maxNSU !== 'string') return false;
  let anterior = BigInt(cursor);
  for (const item of resposta.itens as readonly { nsu?: string; especie?: string; conteudoBruto?: string; chaveAcesso?: string | null; disponibilizadoEm?: string | null }[]) {
    if (typeof item.nsu !== 'string' || !/^\d{1,15}$/u.test(item.nsu) || BigInt(item.nsu) <= anterior ||
        typeof item.especie !== 'string' || !['NFE_55', 'CTE'].includes(item.especie) || typeof item.conteudoBruto !== 'string' || item.conteudoBruto.length === 0 ||
        (item.chaveAcesso !== null && (typeof item.chaveAcesso !== 'string' || !/^\d{44}$/u.test(item.chaveAcesso))) ||
        (item.disponibilizadoEm !== null && (typeof item.disponibilizadoEm !== 'string' || Number.isNaN(Date.parse(item.disponibilizadoEm))))) return false;
    anterior = BigInt(item.nsu);
  }
  return BigInt(resposta.ultNSU) >= BigInt(cursor) && BigInt(resposta.maxNSU) >= BigInt(resposta.ultNSU) &&
    (resposta.itens.length === 0 || anterior === BigInt(resposta.ultNSU)) &&
    (resposta.disponivelNovamenteEm === null || typeof resposta.disponivelNovamenteEm === 'string');
};

export type EntradaDoDestino = Readonly<{
  destino: Destino;
  /** PKCS#12 do A1 vigente: o certificado cliente. Só em memória, só durante a chamada. */
  pfx: Buffer;
  senha: string;
  /** CA em que o Signer confia ao falar com os dublês. */
  caPem: string;
  /** Estável entre tentativas da mesma operação: o destino deduplica o efeito por ela. */
  idempotencyKey: string;
  cnpj: string;
  xml: string;
  tempoLimiteMs: number;
}>;

export type ResultadoDoDestino =
  /** O destino aceitou. */
  | Readonly<{ tipo: 'ACEITO'; statusHttp: number }>
  /** O destino respondeu e recusou o pedido (HTTP 4xx): identidade ou conteúdo. Definitiva. */
  | Readonly<{ tipo: 'RECUSADO'; statusHttp: number }>
  /**
   * Handshake/validação TLS falhou (certificado cliente, cadeia, nome do servidor). Transitória: o
   * operador corrige a confiança ou a rotação e a MESMA chave idempotente precisa poder voltar.
   */
  | Readonly<{ tipo: 'FALHA_DE_TLS' }>
  /** Sem resposta útil (rede, tempo, 5xx): falha transitória, o retry é do worker. */
  | Readonly<{ tipo: 'INDISPONIVEL' }>;

/** Falhas de validação do certificado ou do nome no handshake. */
const CODIGOS_DE_RECUSA_TLS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REVOKED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_CERT_ALTNAME_FORMAT',
]);

const classificarErro = (erro: NodeJS.ErrnoException): ResultadoDoDestino => {
  const codigo = erro.code ?? '';

  // Alertas de TLS vindos do servidor (certificado cliente ausente, desconhecido, ruim).
  const derrubadaNoHandshake =
    codigo === 'ECONNRESET' && /before secure TLS connection was established/iu.test(erro.message);

  if (CODIGOS_DE_RECUSA_TLS.has(codigo) || codigo.startsWith('ERR_SSL_') || codigo === 'EPROTO' || derrubadaNoHandshake) {
    return { tipo: 'FALHA_DE_TLS' };
  }

  return { tipo: 'INDISPONIVEL' };
};

const classificarStatus = (status: number): ResultadoDoDestino => {
  if (status >= 200 && status < 300) {
    return { tipo: 'ACEITO', statusHttp: status };
  }
  if (status >= 500 || status === 429 || status === 408) {
    return { tipo: 'INDISPONIVEL' };
  }

  return { tipo: 'RECUSADO', statusHttp: status };
};

export const chamarDestino = (entrada: EntradaDoDestino): Promise<ResultadoDoDestino> =>
  new Promise((resolver) => {
    const { destino, xml } = entrada;
    let concluido = false;
    const concluir = (resultado: ResultadoDoDestino): void => {
      if (!concluido) {
        concluido = true;
        resolver(resultado);
      }
    };

    const requisicao = https.request(
      {
        host: destino.host,
        port: destino.porta,
        method: 'POST',
        path: destino.caminho,
        // Nome validado contra o SAN do servidor; a CA é a configurada e nenhuma outra.
        servername: destino.servername,
        // Sem agente compartilhado: o `globalAgent` guardaria o PKCS#12 na chave do pool, o socket
        // ocioso (com a chave privada no contexto TLS) e a sessão TLS depois da operação (SPEC §3.4).
        agent: false,
        ca: entrada.caPem,
        pfx: entrada.pfx,
        passphrase: entrada.senha,
        // TLS 1.2 na saída: o servidor recusa certificado cliente ruim DURANTE o handshake e o
        // alerta chega com código. Em 1.3 a recusa vem depois do handshake e disputa com o envio do
        // corpo (o cliente só vê ECONNRESET, indistinguível de uma queda de rede).
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        signal: AbortSignal.timeout(entrada.tempoLimiteMs),
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'content-length': Buffer.byteLength(xml),
          'idempotency-key': entrada.idempotencyKey,
          'x-cnpj-declarado': entrada.cnpj,
        },
      },
      (resposta) => {
        // O corpo é descartado: só o status classifica o resultado.
        resposta.resume();
        resposta.on('end', () => concluir(classificarStatus(resposta.statusCode ?? 0)));
        resposta.on('error', () => concluir({ tipo: 'INDISPONIVEL' }));
      },
    );

    requisicao.on('error', (erro: NodeJS.ErrnoException) => concluir(classificarErro(erro)));
    requisicao.end(xml);
  });
