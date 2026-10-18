import { Injectable } from '@nestjs/common';
import type { PoderRfb } from '@contaia/domain';

type RespostaDuble = Readonly<{
  code: string;
  summary: Readonly<Record<string, unknown>>;
}>;
const RESUMO_INDISPONIVEL = { sucesso: false } as const;

@Injectable()
export class RfbDubleClient {
  private readonly baseUrl =
    process.env['RFB_DUBLE_URL'] ?? 'http://rfb-duble:8080';

  async executar(
    entrada: Readonly<{
      poder: PoderRfb;
      cnpj: string;
      idempotencyKey: string;
      correlationId: string;
    }>,
  ): Promise<RespostaDuble> {
    const caminhos: Readonly<Record<PoderRfb, string>> = {
      RFB_CNPJ_STATUS_READ: '/v1/cnpj/status',
      RFB_TAX_CLEARANCE_CERTIFICATE_READ: '/v1/certidao/consultar',
      RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE: '/v1/certidao/emitir',
    };
    const operacoes: Readonly<Record<PoderRfb, string>> = {
      RFB_CNPJ_STATUS_READ: 'CNPJ_STATUS',
      RFB_TAX_CLEARANCE_CERTIFICATE_READ: 'CERTIDAO_CONSULTADA',
      RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE: 'CERTIDAO_EMITIDA',
    };
    const url = new URL(caminhos[entrada.poder], this.baseUrl);
    if (url.origin !== this.baseUrl)
      throw new Error('Destino do dublê inválido.');
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': entrada.idempotencyKey,
        'x-correlation-id': entrada.correlationId,
      },
      body: JSON.stringify({ poder: entrada.poder, cnpj: entrada.cnpj }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resposta.ok)
      return { code: 'DUBLE_INDISPONIVEL', summary: RESUMO_INDISPONIVEL };
    const leitor = resposta.body?.getReader();
    if (!leitor)
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    const partes: Uint8Array[] = [];
    let tamanho = 0;
    try {
      while (true) {
        const parte = await leitor.read();
        if (parte.done) break;
        tamanho += parte.value.byteLength;
        if (tamanho > 16_384) {
          void leitor.cancel();
          return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
        }
        partes.push(parte.value);
      }
    } catch {
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    }
    const bytes = new Uint8Array(tamanho);
    let offset = 0;
    for (const parte of partes) {
      bytes.set(parte, offset);
      offset += parte.byteLength;
    }
    let texto: string;
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    }
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto) as unknown;
    } catch {
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    }
    if (
      typeof corpo !== 'object' ||
      corpo === null ||
      !('code' in corpo) ||
      !('summary' in corpo)
    ) {
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    }
    const valor = corpo as { code: unknown; summary: unknown };
    if (
      typeof valor.code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,63}$/u.test(valor.code) ||
      typeof valor.summary !== 'object' ||
      valor.summary === null ||
      Array.isArray(valor.summary)
    )
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    const resumo = valor.summary as Record<string, unknown>;
    const numero = resumo['numero'];
    if (
      resumo['operacao'] !== operacoes[entrada.poder] ||
      resumo['cnpj'] !== entrada.cnpj ||
      (numero !== null &&
        (typeof numero !== 'string' ||
          numero.length > 64 ||
          !/^DUBLE-[A-Z0-9-]+$/u.test(numero))) ||
      (entrada.poder === 'RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE' &&
        typeof numero !== 'string')
    )
      return { code: 'RESPOSTA_INVALIDA', summary: RESUMO_INDISPONIVEL };
    return {
      code: valor.code,
      summary: {
        operacao: operacoes[entrada.poder],
        cnpj: entrada.cnpj,
        ...(typeof numero === 'string' ? { numero } : {}),
      },
    };
  }
}
