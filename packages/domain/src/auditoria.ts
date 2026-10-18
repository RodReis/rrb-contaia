import { createHash } from 'node:crypto';

export type ValorCanonico = null | boolean | number | string | readonly ValorCanonico[] | { readonly [chave: string]: ValorCanonico };

const ordenar = (valor: ValorCanonico): ValorCanonico => {
  if (Array.isArray(valor)) return valor.map((item) => ordenar(item));
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).sort(([a], [b]) => a.localeCompare(b)).map(([chave, item]) => [chave, ordenar(item)]));
  }
  if (typeof valor === 'number' && !Number.isFinite(valor)) throw new TypeError('Valor não finito não pode compor envelope de auditoria.');
  return valor;
};

export const canonicalizarEnvelopeDeAuditoria = (valor: ValorCanonico): string => JSON.stringify(ordenar(valor));

export const sha256DeAuditoria = (valor: string | Uint8Array): string =>
  createHash('sha256').update(valor).digest('hex');

export const hashDoEnvelopeDeAuditoria = (valor: ValorCanonico): string =>
  sha256DeAuditoria(canonicalizarEnvelopeDeAuditoria(valor));

export const redigirPayloadDeAuditoria = (valor: ValorCanonico): ValorCanonico => {
  if (Array.isArray(valor)) return valor.map((item) => redigirPayloadDeAuditoria(item));
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => {
      if (/^(?:input|output)_tokens$/iu.test(chave)) return [chave, item];
      if (/prompt|context|entrada|saida|resposta|conteudo|xml|senha|segredo|credential|private.?key|api.?key|access.?token|refresh.?token|auth.?token|authorization|cookie|session.?token/iu.test(chave)) {
        return [chave, '[REDACTADO]'];
      }
      return [chave, redigirPayloadDeAuditoria(item)];
    }));
  }
  return valor;
};
