import { DOMParser } from '@xmldom/xmldom';

export const TAMANHO_MAXIMO_XML_FISCAL = 10 * 1024 * 1024;
export type EspecieFiscal = 'NFE_55' | 'CTE';
export type FalhaParseFiscal = 'FISCAL_XML_INVALID' | 'FISCAL_XML_UNSAFE' | 'FISCAL_XML_TOO_LARGE' | 'FISCAL_LAYOUT_UNSUPPORTED' | 'FISCAL_DOCUMENT_TYPE_MISMATCH' | 'FISCAL_DOCUMENT_IDENTITY_INVALID' | 'FISCAL_IBS_CBS_INCOMPLETE';
export type DocumentoFiscalParseado = Readonly<{
  especie: EspecieFiscal; modelo: string; versaoLayout: string; chaveAcesso: string;
  emitidoEm: string | null; emitente: string | null; destinatario: string | null;
  total: string | null; itens: readonly Readonly<{ codigo: string | null; descricao: string | null; quantidade: string | null; unidade: string | null; valor: string | null; ibs: string | null; cbs: string | null }>[];
  ibsCbsPendente: boolean; tamanho: number;
}>;

type XmlContainer = { getElementsByTagName(name: string): { readonly length: number; readonly [index: number]: { textContent: string | null } | undefined } };
const texto = (element: XmlContainer | null, path: string): string | null => {
  if (!element) return null;
  const found = element.getElementsByTagName(path)[0];
  const value = found?.textContent?.trim();
  return value ? value : null;
};
function erro(codigo: FalhaParseFiscal): never { throw new Error(codigo); }

export const parsearDocumentoFiscal = (bytes: Uint8Array, especieEsperada: EspecieFiscal, dataEmissao: string | null = null): DocumentoFiscalParseado => {
  if (bytes.byteLength === 0) erro('FISCAL_XML_INVALID');
  if (bytes.byteLength > TAMANHO_MAXIMO_XML_FISCAL) erro('FISCAL_XML_TOO_LARGE');
  let source = '';
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { erro('FISCAL_XML_INVALID'); }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) erro('FISCAL_XML_UNSAFE');
  const diagnostics: string[] = [];
  let document: ReturnType<InstanceType<typeof DOMParser>['parseFromString']> | null = null;
  try {
    document = new DOMParser({ errorHandler: (_level, message) => { diagnostics.push(String(message).slice(0, 160)); } }).parseFromString(source, 'application/xml');
  } catch {
    erro('FISCAL_XML_INVALID');
  }
  if (diagnostics.length || !document?.documentElement) erro('FISCAL_XML_INVALID');
  const rootName = document.documentElement.localName;
  const nfe = rootName === 'nfeProc' || rootName === 'NFe';
  const cte = rootName === 'cteProc' || rootName === 'CTe';
  if (!nfe && !cte) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const especie: EspecieFiscal = nfe ? 'NFE_55' : 'CTE';
  if (especie !== especieEsperada) erro('FISCAL_DOCUMENT_TYPE_MISMATCH');
  const info = document.getElementsByTagName(nfe ? 'infNFe' : 'infCte')[0];
  if (!info) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const model = nfe ? texto(document, 'mod') : '57';
  if ((nfe && model !== '55') || (cte && model !== '57')) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const rawId = info.getAttribute('Id') ?? '';
  const key = rawId.replace(/^(NFe|CTe)/, '');
  if (!/^\d{44}$/.test(key)) erro('FISCAL_DOCUMENT_IDENTITY_INVALID');
  const emission = texto(document, 'dhEmi') ?? texto(document, 'dEmi') ?? dataEmissao;
  const itemNodes = Array.from(document.getElementsByTagName(nfe ? 'det' : 'infQ'));
  const items = itemNodes.map((node) => {
    const content = node as Element;
    const product = nfe ? content.getElementsByTagName('prod')[0] : content;
    const tax = nfe ? content.getElementsByTagName('imposto')[0] : content;
    return {
      codigo: texto(product ?? null, nfe ? 'cProd' : 'cUnid'), descricao: texto(product ?? null, nfe ? 'xProd' : 'tpMed'),
      quantidade: texto(product ?? null, nfe ? 'qCom' : 'qCarga'), unidade: texto(product ?? null, nfe ? 'uCom' : 'cUnid'),
      // CT-e informa medidas de carga por infQ, mas o valor do frete é total do documento.
      valor: nfe ? texto(product ?? null, 'vProd') : null,
      ibs: texto(tax ?? null, 'vIBS'), cbs: texto(tax ?? null, 'vCBS'),
    };
  });
  const ibsCbsPendente = Boolean(emission && emission.slice(0, 10) >= '2026-08-03' &&
    (nfe ? items.some((item) => item.ibs === null || item.cbs === null) : texto(document, 'vIBS') === null || texto(document, 'vCBS') === null));
  const emitenteNode = document.getElementsByTagName('emit')[0];
  const destinatarioNode = document.getElementsByTagName('dest')[0];
  return {
    especie, modelo: model!, versaoLayout: info.getAttribute('versao') ?? document.documentElement.getAttribute('versao') ?? 'desconhecida',
    chaveAcesso: key, emitidoEm: emission,
    emitente: texto(emitenteNode ?? null, 'CNPJ') ?? texto(emitenteNode ?? null, 'CPF') ?? texto(emitenteNode ?? null, 'xNome'),
    destinatario: texto(destinatarioNode ?? null, 'CNPJ') ?? texto(destinatarioNode ?? null, 'CPF') ?? texto(destinatarioNode ?? null, 'xNome'),
    total: texto(document, nfe ? 'vNF' : 'vTPrest'), itens: items, ibsCbsPendente,
    tamanho: bytes.byteLength,
  };
};

/** Retorna falso apenas para resumos/eventos encaminhados às fatias posteriores à F18. */
export const ehDocumentoFiscalElegivel = (bytes: Uint8Array, especie: EspecieFiscal): boolean => {
  if (bytes.byteLength === 0 || bytes.byteLength > TAMANHO_MAXIMO_XML_FISCAL) return true;
  let source = '';
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return true; }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) return true;
  try {
    const document = new DOMParser({ errorHandler: () => undefined }).parseFromString(source, 'application/xml');
    const root = document.documentElement?.localName;
    if (especie === 'NFE_55') return !['resNFe','procEventoNFe','retEvento'].includes(root ?? '');
    return !['resCTe','procEventoCTe','resEvento','retEvento'].includes(root ?? '');
  } catch { return true; }
};
