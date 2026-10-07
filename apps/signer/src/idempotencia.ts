import { X509Certificate, createHash, createHmac } from 'node:crypto';

/**
 * Representação protegida da chave idempotente (SPEC-012 §3.11): HMAC-SHA256 com um pepper do
 * serviço. É o que o banco guarda — nunca a chave em claro — e continua determinístico, então a
 * mesma chave volta a achar a mesma operação.
 */
export const chaveProtegida = (chave: string, pepper: string): string =>
  createHmac('sha256', pepper).update(chave, 'utf8').digest('hex');

/** SHA-256 hexadecimal do conteúdo: identifica o pedido sem guardá-lo. */
export const hashDoConteudo = (conteudo: string): string =>
  createHash('sha256').update(conteudo, 'utf8').digest('hex');

/** SHA-256 do certificado em hexadecimal minúsculo: o formato que a F11 grava no cadastro. */
export const impressaoDigitalDoCertificado = (certificadoPem: string): string =>
  new X509Certificate(certificadoPem).fingerprint256.replaceAll(':', '').toLowerCase();
