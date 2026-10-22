import { DOMParser } from '@xmldom/xmldom';
import { parsearDocumentoFiscal, type DocumentoFiscalParseado } from './fiscal-documents/parser.js';

export const TAMANHO_MAXIMO_XML_NFCE = 10 * 1024 * 1024;
export const NAMESPACE_NFE = 'http://www.portalfiscal.inf.br/nfe';

export type CodigoDeRejeicaoNfce =
  | 'NFCE_XML_INVALID'
  | 'NFCE_XML_UNSAFE'
  | 'NFCE_LAYOUT_UNSUPPORTED'
  | 'NFCE_MODEL_MISMATCH'
  | 'NFCE_ISSUER_MISMATCH'
  | 'NFCE_ACCESS_KEY_INVALID'
  | 'NFCE_PROTOCOL_INVALID';

export type NfceNormalizada = Readonly<{
  modelo: '65';
  versaoLayout: '3.10' | '4.00';
  chaveAcesso: string;
  cnpjEmitente: string;
  ufEmitente: 'GO';
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO';
  serie: string;
  numero: string;
  emitidaEm: string;
  protocolo: string;
  protocoloRecebidoEm: string;
  statusProtocolo: 'AUTORIZADA';
  assinaturasEncontradas: 1;
  documento: DocumentoFiscalParseado;
}>;

function erro(codigo: CodigoDeRejeicaoNfce): never { throw new Error(codigo); }

const texto = (parent: Document | Element | null, name: string): string | null =>
  parent?.getElementsByTagNameNS(NAMESPACE_NFE, name)[0]?.textContent?.trim() || null;

export const digitoVerificadorDaChaveNfeValido = (chave: string): boolean => {
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

export const normalizarEventoCancelamentoNfce = (bytes: Uint8Array): Readonly<{ chaveAcesso: string; cnpjEmitente: string; protocolo: string; ambiente: 'PRODUCAO'|'HOMOLOGACAO'; sequencia: string }> => {
  if (bytes.byteLength === 0 || bytes.byteLength > TAMANHO_MAXIMO_XML_NFCE) erro('NFCE_XML_INVALID');
  let source = ''; try { source = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { return erro('NFCE_XML_INVALID'); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) erro('NFCE_XML_UNSAFE');
  const diagnostics:string[]=[];
  let document:Document;
  try { document=new DOMParser({errorHandler:(_level:string,message:string)=>diagnostics.push(String(message).slice(0,160))}).parseFromString(source,'application/xml'); } catch { return erro('NFCE_XML_INVALID'); }
  const root=document.documentElement;
  if(diagnostics.length||root.localName!=='procEventoNFe'||root.namespaceURI!==NAMESPACE_NFE) erro('NFCE_LAYOUT_UNSUPPORTED');
  const info=document.getElementsByTagNameNS(NAMESPACE_NFE,'infEvento')[0];
  const signature=document.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#','Signature');
  const key=texto(info??null,'chNFe'); const cnpj=texto(info??null,'CNPJ'); const tpAmb=texto(info??null,'tpAmb'); const seq=texto(info??null,'nSeqEvento');
  if(!info||texto(info,'tpEvento')!=='110111'||!key||!digitoVerificadorDaChaveNfeValido(key)||key.slice(0,2)!=='52'||key.slice(20,22)!=='65'||!cnpjValido(cnpj??'')||cnpj!==key.slice(6,20)||!seq||!/^\d{1,2}$/u.test(seq)||signature.length!==1||(tpAmb!=='1'&&tpAmb!=='2')) erro('NFCE_PROTOCOL_INVALID');
  const returned=document.getElementsByTagNameNS(NAMESPACE_NFE,'retEvento')[0]?.getElementsByTagNameNS(NAMESPACE_NFE,'infEvento')[0];
  const protocol=texto(returned??null,'nProt');
  if(!protocol||texto(returned??null,'cStat')!=='135'||texto(returned??null,'chNFe')!==key||texto(returned??null,'tpEvento')!=='110111'||texto(returned??null,'nSeqEvento')!==seq||texto(returned??null,'tpAmb')!==tpAmb) erro('NFCE_PROTOCOL_INVALID');
  return {chaveAcesso:key,cnpjEmitente:cnpj!,protocolo:protocol,ambiente:tpAmb==='1'?'PRODUCAO':'HOMOLOGACAO',sequencia:seq!};
};

const cnpjValido = (cnpj: string): boolean => {
  if (!/^\d{14}$/u.test(cnpj) || /^([0-9])\1{13}$/u.test(cnpj)) return false;
  const calcular = (base: string, pesos: readonly number[]): number => {
    const soma = [...base].reduce((acc, char, index) => acc + Number(char) * (pesos[index] ?? 0), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcular(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const segundo = calcular(cnpj.slice(0, 12) + String(primeiro), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return cnpj.endsWith(String(primeiro) + String(segundo));
};

const digitosDeData = (data: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/u.exec(data);
  if (!match) return null;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  return year.slice(-2) + month;
};

const cUFDeGoias = '52';

/**
 * Extrai NFC-e autorizada para normalização. Não valida XSD nem XMLDSig:
 * consumidores só podem persistir o resultado após executar esses validadores
 * com os artefatos oficiais e âncoras ICP-Brasil configuradas.
 */
export const normalizarNfceGoias = (bytes: Uint8Array, cnpjEmpresa: string): NfceNormalizada => {
  if (bytes.byteLength === 0 || bytes.byteLength > TAMANHO_MAXIMO_XML_NFCE) erro('NFCE_XML_INVALID');
  if (!cnpjValido(cnpjEmpresa)) erro('NFCE_ISSUER_MISMATCH');
  let source = '';
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return erro('NFCE_XML_INVALID'); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) erro('NFCE_XML_UNSAFE');

  const diagnostics: string[] = [];
  let document: Document;
  try {
    document = new DOMParser({ errorHandler: (_level: string, message: string) => diagnostics.push(String(message).slice(0, 160)) })
      .parseFromString(source, 'application/xml');
  } catch { return erro('NFCE_XML_INVALID'); }
  if (diagnostics.length > 0 || document.documentElement?.localName !== 'nfeProc' ||
      document.documentElement.namespaceURI !== NAMESPACE_NFE) return erro('NFCE_LAYOUT_UNSUPPORTED');

  const nfe = document.getElementsByTagNameNS(NAMESPACE_NFE, 'NFe')[0];
  const info = document.getElementsByTagNameNS(NAMESPACE_NFE, 'infNFe')[0];
  const ide = info?.getElementsByTagNameNS(NAMESPACE_NFE, 'ide')[0];
  const emit = info?.getElementsByTagNameNS(NAMESPACE_NFE, 'emit')[0];
  const protocol = document.getElementsByTagNameNS(NAMESPACE_NFE, 'infProt')[0];
  const version = info?.getAttribute('versao');
  if (!nfe || !info || !ide || !emit || !protocol ||
      document.getElementsByTagNameNS(NAMESPACE_NFE, 'NFe').length !== 1 ||
      document.getElementsByTagNameNS(NAMESPACE_NFE, 'infNFe').length !== 1 ||
      document.getElementsByTagNameNS(NAMESPACE_NFE, 'infProt').length !== 1) return erro('NFCE_LAYOUT_UNSUPPORTED');
  if (version !== '3.10' && version !== '4.00') return erro('NFCE_LAYOUT_UNSUPPORTED');
  if (texto(info, 'mod') !== '65') return erro('NFCE_MODEL_MISMATCH');

  const key = (info.getAttribute('Id') ?? '').replace(/^NFe/u, '');
  const cnpj = texto(emit, 'CNPJ') ?? '';
  const cUF = texto(ide, 'cUF');
  const tpEmis = texto(ide, 'tpEmis');
  const cNF = texto(ide, 'cNF');
  const emission = texto(ide, version === '3.10' ? 'dEmi' : 'dhEmi');
  const aamm = emission ? digitosDeData(emission) : null;
  const serie = texto(ide, 'serie') ?? '';
  const number = texto(ide, 'nNF') ?? '';
  if (!digitoVerificadorDaChaveNfeValido(key) || key.slice(0, 2) !== cUFDeGoias ||
      key.slice(6, 20) !== cnpj || key.slice(20, 22) !== '65' ||
      key.slice(22, 25) !== serie.padStart(3, '0') || key.slice(25, 34) !== number.padStart(9, '0') ||
      !aamm || key.slice(2, 6) !== aamm || cUF !== cUFDeGoias ||
      key[34] !== tpEmis || key.slice(35, 43) !== cNF) return erro('NFCE_ACCESS_KEY_INVALID');
  if (emission === null) return erro('NFCE_ACCESS_KEY_INVALID');
  if (!cnpjValido(cnpj) || cnpj !== cnpjEmpresa || texto(emit, 'UF') !== 'GO') return erro('NFCE_ISSUER_MISMATCH');

  const signature = nfe.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature');
  const protocolKey = texto(protocol, 'chNFe');
  const protocolStatus = texto(protocol, 'cStat');
  const environment = texto(protocol, 'tpAmb');
  const protocolNumber = texto(protocol, 'nProt');
  const receivedAt = texto(protocol, 'dhRecbto');
  if (signature.length !== 1 || protocolKey !== key || !['100', '150'].includes(protocolStatus ?? '') ||
      (environment !== '1' && environment !== '2') || !protocolNumber ||
      texto(ide, 'tpAmb') !== environment ||
      !receivedAt || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(receivedAt) || !Number.isFinite(Date.parse(receivedAt))) {
    return erro('NFCE_PROTOCOL_INVALID');
  }
  if (protocolNumber === null || receivedAt === null) return erro('NFCE_PROTOCOL_INVALID');
  const documento = parsearDocumentoFiscal(bytes, 'NFCE_65');

  return {
    modelo: '65',
    versaoLayout: version,
    chaveAcesso: key,
    cnpjEmitente: cnpj,
    ufEmitente: 'GO',
    ambiente: environment === '1' ? 'PRODUCAO' : 'HOMOLOGACAO',
    serie,
    numero: number,
    emitidaEm: emission,
    protocolo: protocolNumber,
    protocoloRecebidoEm: receivedAt,
    statusProtocolo: 'AUTORIZADA',
    assinaturasEncontradas: 1,
    documento,
  };
};
