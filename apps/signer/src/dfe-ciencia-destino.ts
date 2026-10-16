import https from 'node:https';
import type { Destino } from './destino.js';

const LIMITE_RESPOSTA = 10 * 1024 * 1024;
type Identidade = Readonly<{ cnpj: string; chaveAcesso: string }>;
type Conexao = Identidade & Readonly<{ destino: Destino; pfx: Buffer; senha: string; caPem: string; chaveIdempotente: string; tempoLimiteMs: number }>;

const requisitarJson = (entrada: Conexao, caminho: string): Promise<Readonly<{ status: number; corpo: unknown }>> =>
  new Promise((resolve, reject) => {
    const corpo = JSON.stringify({ cnpj: entrada.cnpj, chaveAcesso: entrada.chaveAcesso, tipoEvento: '210210', sequencia: 1 });
    const request = https.request({ host: entrada.destino.host, port: entrada.destino.porta, method: 'POST', path: caminho,
      servername: entrada.destino.servername, agent: false, ca: entrada.caPem, pfx: entrada.pfx, passphrase: entrada.senha,
      minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', signal: AbortSignal.timeout(entrada.tempoLimiteMs),
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo),
        'idempotency-key': entrada.chaveIdempotente, 'x-cnpj-declarado': entrada.cnpj } }, (response) => {
      const parts: Buffer[] = []; let size = 0;
      response.on('data', (part: Buffer) => { size += part.length; if (size > LIMITE_RESPOSTA) { response.destroy(); reject(new Error('DFE_ACK_RESPONSE_TOO_LARGE')); return; } parts.push(part); });
      response.on('end', () => { try { resolve({ status: response.statusCode ?? 0, corpo: JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown }); } catch { resolve({ status: response.statusCode ?? 0, corpo: null }); } });
      response.on('error', () => reject(new Error('DFE_ACK_UNCERTAIN')));
    });
    request.on('error', () => reject(new Error('DFE_ACK_UNCERTAIN')));
    request.end(corpo);
  });

const requisitarXml = (entrada: Conexao, caminho: string, xml: string): Promise<Readonly<{ status: number; corpo: unknown }>> =>
  new Promise((resolve, reject) => {
    const request = https.request({ host: entrada.destino.host, port: entrada.destino.porta, method: 'POST', path: caminho,
      servername: entrada.destino.servername, agent: false, ca: entrada.caPem, pfx: entrada.pfx, passphrase: entrada.senha,
      minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', signal: AbortSignal.timeout(entrada.tempoLimiteMs),
      headers: { 'content-type': 'application/xml; charset=utf-8', 'content-length': Buffer.byteLength(xml),
        'idempotency-key': entrada.chaveIdempotente, 'x-cnpj-declarado': entrada.cnpj } }, (response) => {
      const parts: Buffer[] = []; let size = 0;
      response.on('data', (part: Buffer) => { size += part.length; if (size > LIMITE_RESPOSTA) { response.destroy(); reject(new Error('DFE_ACK_RESPONSE_TOO_LARGE')); return; } parts.push(part); });
      response.on('end', () => { try { resolve({ status: response.statusCode ?? 0, corpo: JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown }); } catch { resolve({ status: response.statusCode ?? 0, corpo: null }); } });
      response.on('error', () => reject(new Error('DFE_ACK_UNCERTAIN')));
    });
    request.on('error', () => reject(new Error('DFE_ACK_UNCERTAIN')));
    request.end(xml);
  });

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null;
const textoCurto = (valor: unknown, max = 40): string | null => typeof valor === 'string' && valor.length <= max && /^[\w.-]+$/u.test(valor) ? valor : null;

export type RespostaCienciaDestino = Readonly<{
  tipo: 'ACEITO' | 'DUPLICIDADE' | 'JA_MANIFESTADO' | 'REJEITADO' | 'INCERTO'; codigo: string | null; protocolo: string | null;
  chaveAcesso: string; cnpj: string; tipoEvento: '210210'; sequencia: 1; ambiente: 'HOMOLOGACAO'; recebidoEm: string | null;
}>;

export const transmitirCienciaNoDestino = async (entrada: Conexao & Readonly<{ xml: string }>): Promise<RespostaCienciaDestino> => {
  let retorno: Readonly<{ status: number; corpo: unknown }>;
  try { retorno = await requisitarXml(entrada, '/v1/manifestacao', entrada.xml); }
  catch { return { tipo: 'INCERTO', codigo: 'DFE_ACK_RESULT_UNCERTAIN', protocolo: null, chaveAcesso: entrada.chaveAcesso,
    cnpj: entrada.cnpj, tipoEvento: '210210', sequencia: 1, ambiente: 'HOMOLOGACAO', recebidoEm: null }; }
  const payload = ehObjeto(retorno.corpo) ? retorno.corpo : null;
  const protocolo = textoCurto(payload?.['protocolo'], 64);
  const codigo = textoCurto(payload?.['codigo'], 12);
  const recebidoEm = typeof payload?.['recebidoEm'] === 'string' && !Number.isNaN(Date.parse(payload['recebidoEm'])) ? new Date(payload['recebidoEm']).toISOString() : null;
  const identidadeConfere = payload?.['chaveAcesso'] === entrada.chaveAcesso && payload?.['cnpj'] === entrada.cnpj &&
    payload?.['tipoEvento'] === '210210' && payload?.['sequencia'] === 1 && payload?.['ambiente'] === 'HOMOLOGACAO';
  if (!identidadeConfere || retorno.status >= 500 || retorno.status === 0) {
    return { tipo: 'INCERTO', codigo: codigo ?? 'DFE_ACK_RESULT_UNCERTAIN', protocolo: null, chaveAcesso: entrada.chaveAcesso,
      cnpj: entrada.cnpj, tipoEvento: '210210', sequencia: 1, ambiente: 'HOMOLOGACAO', recebidoEm: null };
  }
  const tipo = payload?.['tipo'];
  if (tipo !== 'ACEITO' && tipo !== 'DUPLICIDADE' && tipo !== 'JA_MANIFESTADO' && tipo !== 'REJEITADO') {
    return { tipo: 'INCERTO', codigo: codigo ?? 'DFE_ACK_RESULT_UNCERTAIN', protocolo: null, chaveAcesso: entrada.chaveAcesso,
      cnpj: entrada.cnpj, tipoEvento: '210210', sequencia: 1, ambiente: 'HOMOLOGACAO', recebidoEm: null };
  }
  return { tipo, codigo, protocolo, chaveAcesso: entrada.chaveAcesso, cnpj: entrada.cnpj, tipoEvento: '210210', sequencia: 1,
    ambiente: 'HOMOLOGACAO', recebidoEm };
};

export type RespostaProcNFeDestino = Readonly<{ tipo: 'OBTIDO' | 'PENDENTE' | 'DIVERGENTE'; xmlCompleto: string | null; codigo: string | null }>;

export const consultarProcNFeNoDestino = async (entrada: Conexao): Promise<RespostaProcNFeDestino> => {
  let retorno: Readonly<{ status: number; corpo: unknown }>;
  try { retorno = await requisitarJson(entrada, '/v1/distribuicao-chave'); }
  catch { return { tipo: 'PENDENTE', xmlCompleto: null, codigo: 'DFE_FULL_XML_UNAVAILABLE' }; }
  const payload = ehObjeto(retorno.corpo) ? retorno.corpo : null;
  if (retorno.status < 200 || retorno.status >= 300 || payload?.['chaveAcesso'] !== entrada.chaveAcesso || payload?.['cnpj'] !== entrada.cnpj) {
    return { tipo: 'DIVERGENTE', xmlCompleto: null, codigo: 'FISCAL_FULL_XML_MISMATCH' };
  }
  if (payload['tipo'] === 'PENDENTE') return { tipo: 'PENDENTE', xmlCompleto: null, codigo: textoCurto(payload['codigo'], 64) };
  const xml = payload['xmlCompleto'];
  if (payload['tipo'] !== 'OBTIDO' || typeof xml !== 'string' || Buffer.byteLength(xml) > LIMITE_RESPOSTA) {
    return { tipo: 'DIVERGENTE', xmlCompleto: null, codigo: 'FISCAL_FULL_XML_MISMATCH' };
  }
  return { tipo: 'OBTIDO', xmlCompleto: xml, codigo: null };
};
