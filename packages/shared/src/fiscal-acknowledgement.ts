import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';

export const FISCAL_ACKNOWLEDGEMENT_QUEUE = 'fiscal-acknowledgement';
export const FISCAL_ACKNOWLEDGEMENT_DLQ = 'fiscal-acknowledgement-dead';
export const FISCAL_ACKNOWLEDGEMENT_JOB = 'process-acknowledgement';
export const FISCAL_ACKNOWLEDGEMENT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.5 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
} as const;
export const FiscalAcknowledgementCommandSchema = z.strictObject({
  tenantId: z.string().regex(/^[0-9a-f-]{36}$/iu), companyId: z.string().regex(/^[0-9a-f-]{36}$/iu),
  acknowledgementId: z.string().regex(/^[0-9a-f-]{36}$/iu), correlationId: z.string().min(8).max(128),
});
export type FiscalAcknowledgementCommand = z.infer<typeof FiscalAcknowledgementCommandSchema>;

export const ESTADOS_DA_CIENCIA = [
  'RESUMO_CAPTURADO', 'CIENCIA_PENDENTE', 'CIENCIA_EM_ENVIO', 'CIENCIA_REGISTRADA',
  'XML_COMPLETO_PENDENTE', 'XML_COMPLETO_OBTIDO', 'PARSEADO', 'JA_MANIFESTADO',
  'XML_COMPLETO_JA_DISPONIVEL', 'RESULTADO_INCERTO', 'RETRY_AGENDADO', 'REJEITADO', 'IMPEDIDO', 'DLQ',
] as const;
export type EstadoDaCiencia = (typeof ESTADOS_DA_CIENCIA)[number];

export type ElegibilidadeDaCiencia = Readonly<{ elegivel: true; chaveAcesso: string }> | Readonly<{
  elegivel: false;
  codigo: 'FISCAL_ACK_IDENTITY_INVALID' | 'FISCAL_ACK_NOT_ELIGIBLE';
  chaveAcesso?: string;
}>;

export const ehResumoNfe = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) return false;
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return false; }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) return false;
  const errors: string[] = [];
  const document = new DOMParser({ errorHandler: (_level, message) => errors.push(String(message)) }).parseFromString(source, 'application/xml');
  return errors.length === 0 && document.documentElement?.localName === 'resNFe' &&
    document.documentElement.namespaceURI === 'http://www.portalfiscal.inf.br/nfe';
};

const digitoVerificadorValido = (chave: string): boolean => {
  if (!/^\d{44}$/u.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let indice = 42; indice >= 0; indice--) {
    soma += Number(chave[indice]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return Number(chave[43]) === (resto <= 1 ? 0 : 11 - resto);
};

/** Valida apenas envelope resNFe; não tenta interpretar documento completo nem inferir manifestação. */
export const classificarResumoParaCiencia = (
  bytes: Uint8Array,
  especie: 'NFE_55' | 'CTE',
  cnpjEmpresa: string,
): ElegibilidadeDaCiencia => {
  if (especie !== 'NFE_55' || bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024 || !/^\d{14}$/u.test(cnpjEmpresa)) {
    return { elegivel: false, codigo: 'FISCAL_ACK_NOT_ELIGIBLE' };
  }
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { elegivel: false, codigo: 'FISCAL_ACK_NOT_ELIGIBLE' }; }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) return { elegivel: false, codigo: 'FISCAL_ACK_NOT_ELIGIBLE' };
  const diagnostics: string[] = [];
  const document = new DOMParser({ errorHandler: (_level, message) => diagnostics.push(String(message)) })
    .parseFromString(source, 'application/xml');
  if (diagnostics.length || document.documentElement?.localName !== 'resNFe' ||
      document.documentElement.namespaceURI !== 'http://www.portalfiscal.inf.br/nfe') {
    return { elegivel: false, codigo: 'FISCAL_ACK_NOT_ELIGIBLE' };
  }
  const chave = document.getElementsByTagNameNS('http://www.portalfiscal.inf.br/nfe', 'chNFe')[0]?.textContent?.trim() ?? '';
  const destinatario = document.getElementsByTagNameNS('http://www.portalfiscal.inf.br/nfe', 'CNPJ')[0]?.textContent?.trim() ?? '';
  if (!digitoVerificadorValido(chave) || chave.slice(20,22) !== '55') {
    return { elegivel: false, codigo: 'FISCAL_ACK_IDENTITY_INVALID', ...( /^\d{44}$/u.test(chave) ? { chaveAcesso: chave } : {}) };
  }
  if (destinatario !== cnpjEmpresa) return { elegivel: false, codigo: 'FISCAL_ACK_NOT_ELIGIBLE', chaveAcesso: chave };
  return { elegivel: true, chaveAcesso: chave };
};

const TRANSICOES: Readonly<Record<EstadoDaCiencia, readonly EstadoDaCiencia[]>> = {
  RESUMO_CAPTURADO: ['CIENCIA_PENDENTE', 'JA_MANIFESTADO', 'XML_COMPLETO_JA_DISPONIVEL', 'IMPEDIDO'],
  CIENCIA_PENDENTE: ['CIENCIA_EM_ENVIO', 'JA_MANIFESTADO', 'XML_COMPLETO_JA_DISPONIVEL', 'IMPEDIDO', 'DLQ'],
  CIENCIA_EM_ENVIO: ['CIENCIA_REGISTRADA', 'JA_MANIFESTADO', 'RESULTADO_INCERTO', 'RETRY_AGENDADO', 'REJEITADO', 'DLQ'],
  CIENCIA_REGISTRADA: ['XML_COMPLETO_PENDENTE'],
  XML_COMPLETO_PENDENTE: ['XML_COMPLETO_OBTIDO', 'XML_COMPLETO_JA_DISPONIVEL', 'RETRY_AGENDADO', 'DLQ', 'IMPEDIDO'],
  XML_COMPLETO_OBTIDO: ['PARSEADO', 'IMPEDIDO'],
  PARSEADO: [],
  JA_MANIFESTADO: [],
  XML_COMPLETO_JA_DISPONIVEL: ['XML_COMPLETO_OBTIDO'],
  RESULTADO_INCERTO: ['CIENCIA_EM_ENVIO', 'CIENCIA_REGISTRADA', 'JA_MANIFESTADO', 'RETRY_AGENDADO', 'DLQ'],
  RETRY_AGENDADO: ['CIENCIA_PENDENTE', 'CIENCIA_EM_ENVIO', 'XML_COMPLETO_PENDENTE', 'DLQ'],
  REJEITADO: [],
  IMPEDIDO: [],
  DLQ: ['CIENCIA_PENDENTE', 'CIENCIA_EM_ENVIO', 'XML_COMPLETO_PENDENTE'],
};

export const proximoEstadoDaCiencia = (atual: EstadoDaCiencia, proximo: string): proximo is EstadoDaCiencia =>
  (TRANSICOES[atual] as readonly string[]).includes(proximo);

export const tempoDeRetryDaCiencia = (tentativa: number): number => {
  if (!Number.isInteger(tentativa) || tentativa < 1 || tentativa > 3) throw new Error('FISCAL_ACK_RETRY_EXHAUSTED');
  return 1_000 * (2 ** (tentativa - 1));
};
