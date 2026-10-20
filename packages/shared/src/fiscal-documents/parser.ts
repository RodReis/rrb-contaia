import { DOMParser } from '@xmldom/xmldom';

export const TAMANHO_MAXIMO_XML_FISCAL = 10 * 1024 * 1024;
export type EspecieFiscal = 'NFE_55' | 'CTE';
export type FalhaParseFiscal = 'FISCAL_XML_INVALID' | 'FISCAL_XML_UNSAFE' | 'FISCAL_XML_TOO_LARGE' | 'FISCAL_LAYOUT_UNSUPPORTED' | 'FISCAL_DOCUMENT_TYPE_MISMATCH' | 'FISCAL_DOCUMENT_IDENTITY_INVALID' | 'FISCAL_IBS_CBS_INCOMPLETE';
export type ParteFiscalParseada = Readonly<{
  papel: 'EMITENTE' | 'DESTINATARIO'; identificador: string | null; nome: string | null; inscricaoEstadual: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null;
  codigoMunicipio: string | null; municipio: string | null; uf: string | null; cep: string | null;
  codigoPais: string | null; pais: string | null;
}>;
export type TributoFiscalParseado = Readonly<{
  escopo: 'DOCUMENTO' | 'ITEM'; numeroItem: number | null; codigo: 'ICMS' | 'ICMS_ST' | 'IPI' | 'II' | 'PIS' | 'COFINS' | 'IBS' | 'CBS';
  baseCalculo: string | null; aliquota: string | null; valor: string | null; situacao: string | null; classificacao: string | null;
}>;
export type DocumentoFiscalParseado = Readonly<{
  especie: EspecieFiscal; modelo: string; versaoLayout: string; chaveAcesso: string;
  protocolo: string | null; protocoloRecebidoEm: string | null;
  referencias: readonly Readonly<{ tipo: string; chave: string }>[];
  partes: readonly ParteFiscalParseada[];
  tributos: readonly TributoFiscalParseado[];
  emitidoEm: string | null; emitente: string | null; destinatario: string | null;
  baseIbsCbs: string | null; totalIbs: string | null; totalCbs: string | null;
  total: string | null; itens: readonly Readonly<{ tipo: 'ITEM' | 'COMPONENTE' | 'MEDIDA_CARGA'; codigo: string | null; descricao: string | null; ncm: string | null; cest: string | null; cfop: string | null; cstCsosn: string | null; codigoBeneficio: string | null; quantidade: string | null; unidade: string | null; valor: string | null; ibs: string | null; cbs: string | null }>[];
  ibsCbsPendente: boolean; tamanho: number;
}>;

type XmlContainer = { getElementsByTagNameNS(namespace: string, name: string): { readonly length: number; readonly [index: number]: { textContent: string | null } | undefined } };
const texto = (element: XmlContainer | null, path: string, namespace: string): string | null => {
  if (!element) return null;
  const found = element.getElementsByTagNameNS(namespace, path)[0];
  const value = found?.textContent?.trim();
  return value ? value : null;
};
const existe = (element: XmlContainer | null, path: string, namespace: string): boolean =>
  Boolean(element?.getElementsByTagNameNS(namespace, path).length);
function erro(codigo: FalhaParseFiscal): never { throw new Error(codigo); }

const extrairTributosDeGrupo = (scope: XmlContainer, namespace: string, escopo: TributoFiscalParseado['escopo'], numeroItem: number | null): TributoFiscalParseado[] => {
  const resultado: TributoFiscalParseado[] = [];
  const adicionar = (tributo: TributoFiscalParseado) => {
    if (tributo.baseCalculo !== null || tributo.aliquota !== null || tributo.valor !== null || tributo.situacao !== null || tributo.classificacao !== null) resultado.push(tributo);
  };
  const grupos: readonly Readonly<{ xml: string; codigo: 'ICMS' | 'IPI' | 'II' | 'PIS' | 'COFINS'; valor: string; base: string; aliquota: string }>[] = [
    { xml: 'ICMS', codigo: 'ICMS', valor: 'vICMS', base: 'vBC', aliquota: 'pICMS' },
    { xml: 'IPI', codigo: 'IPI', valor: 'vIPI', base: 'vBC', aliquota: 'pIPI' },
    { xml: 'II', codigo: 'II', valor: 'vII', base: 'vBC', aliquota: 'pII' },
    { xml: 'PIS', codigo: 'PIS', valor: 'vPIS', base: 'vBC', aliquota: 'pPIS' },
    { xml: 'COFINS', codigo: 'COFINS', valor: 'vCOFINS', base: 'vBC', aliquota: 'pCOFINS' },
  ];
  for (const group of grupos) {
    const node = scope.getElementsByTagNameNS(namespace, group.xml)[0] as Element | undefined;
    if (!node) continue;
    adicionar({ escopo, numeroItem, codigo: group.codigo, baseCalculo: texto(node, group.base, namespace), aliquota: texto(node, group.aliquota, namespace), valor: texto(node, group.valor, namespace), situacao: texto(node, 'CST', namespace) ?? texto(node, 'CSOSN', namespace), classificacao: null });
    const valorSt = texto(node, 'vICMSST', namespace);
    if (group.codigo === 'ICMS' && valorSt !== null) adicionar({ escopo, numeroItem, codigo: 'ICMS_ST', baseCalculo: texto(node, 'vBCST', namespace), aliquota: texto(node, 'pICMSST', namespace), valor: valorSt, situacao: texto(node, 'CST', namespace) ?? texto(node, 'CSOSN', namespace), classificacao: null });
  }
  const ibscbs = scope.getElementsByTagNameNS(namespace, 'IBSCBS')[0] as Element | undefined;
  const ibscbsGroup = ibscbs?.getElementsByTagNameNS(namespace, 'gIBSCBS')[0] as Element | undefined;
  if (ibscbs && ibscbsGroup) {
    const baseCalculo = texto(ibscbsGroup, 'vBC', namespace);
    const situacao = texto(ibscbs, 'CST', namespace);
    const classificacao = texto(ibscbs, 'cClassTrib', namespace);
    const ibs = (ibscbsGroup.getElementsByTagNameNS(namespace, 'gIBS')[0] as Element | undefined) ?? ibscbsGroup;
    const cbs = ibscbsGroup.getElementsByTagNameNS(namespace, 'gCBS')[0] as Element | undefined;
    if (ibs) adicionar({ escopo, numeroItem, codigo: 'IBS', baseCalculo, aliquota: null, valor: texto(ibs, 'vIBS', namespace), situacao, classificacao });
    if (cbs) adicionar({ escopo, numeroItem, codigo: 'CBS', baseCalculo, aliquota: texto(cbs, 'pCBS', namespace), valor: texto(cbs, 'vCBS', namespace), situacao, classificacao });
  }
  return resultado;
};

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
  const namespaceEsperado = nfe ? 'http://www.portalfiscal.inf.br/nfe' : 'http://www.portalfiscal.inf.br/cte';
  if (document.documentElement.namespaceURI !== namespaceEsperado) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const info = document.getElementsByTagNameNS(namespaceEsperado, nfe ? 'infNFe' : 'infCte')[0];
  if (!info) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const model = nfe ? texto(document, 'mod', namespaceEsperado) : '57';
  if ((nfe && model !== '55') || (cte && model !== '57')) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const versaoLayout = info.getAttribute('versao') ?? document.documentElement.getAttribute('versao') ?? 'desconhecida';
  if (versaoLayout !== '4.00') erro('FISCAL_LAYOUT_UNSUPPORTED');
  if (!existe(info as unknown as XmlContainer, 'ide', namespaceEsperado) || !existe(info as unknown as XmlContainer, 'emit', namespaceEsperado)) erro('FISCAL_LAYOUT_UNSUPPORTED');
  if (nfe && (!document.getElementsByTagNameNS(namespaceEsperado, 'det').length || !texto(info as unknown as XmlContainer, 'vNF', namespaceEsperado))) erro('FISCAL_LAYOUT_UNSUPPORTED');
  if (cte && (!texto(info as unknown as XmlContainer, 'vTPrest', namespaceEsperado) || !existe(info as unknown as XmlContainer, 'infCarga', namespaceEsperado))) erro('FISCAL_LAYOUT_UNSUPPORTED');
  const rawId = info.getAttribute('Id') ?? '';
  const key = rawId.replace(/^(NFe|CTe)/, '');
  if (!/^\d{44}$/.test(key)) erro('FISCAL_DOCUMENT_IDENTITY_INVALID');
  const emission = texto(document, 'dhEmi', namespaceEsperado) ?? texto(document, 'dEmi', namespaceEsperado) ?? dataEmissao;
  const itemNodes = Array.from(document.getElementsByTagNameNS(namespaceEsperado, nfe ? 'det' : 'infQ'));
  const items: DocumentoFiscalParseado['itens'][number][] = itemNodes.map((node) => {
    const content = node as Element;
    const product = nfe ? content.getElementsByTagNameNS(namespaceEsperado, 'prod')[0] : content;
    const tax = nfe ? content.getElementsByTagNameNS(namespaceEsperado, 'imposto')[0] : content;
    const icms = nfe ? tax?.getElementsByTagNameNS(namespaceEsperado, 'ICMS')[0] : undefined;
    return {
      tipo: nfe ? 'ITEM' as const : 'MEDIDA_CARGA' as const,
      codigo: texto(product ?? null, nfe ? 'cProd' : 'cUnid', namespaceEsperado),
      ncm: nfe ? texto(product ?? null, 'NCM', namespaceEsperado) : null, cest: nfe ? texto(product ?? null, 'CEST', namespaceEsperado) : null,
      cfop: nfe ? texto(product ?? null, 'CFOP', namespaceEsperado) : null,
      cstCsosn: nfe ? texto(icms ?? null, 'CST', namespaceEsperado) ?? texto(icms ?? null, 'CSOSN', namespaceEsperado) : null,
      codigoBeneficio: nfe ? texto(product ?? null, 'cBenef', namespaceEsperado) : null,
      descricao: texto(product ?? null, nfe ? 'xProd' : 'tpMed', namespaceEsperado),
      quantidade: texto(product ?? null, nfe ? 'qCom' : 'qCarga', namespaceEsperado), unidade: texto(product ?? null, nfe ? 'uCom' : 'cUnid', namespaceEsperado),
      // CT-e informa medidas de carga por infQ, mas o valor do frete é total do documento.
      valor: nfe ? texto(product ?? null, 'vProd', namespaceEsperado) : null,
      ibs: texto(tax ?? null, 'vIBS', namespaceEsperado), cbs: texto(tax ?? null, 'vCBS', namespaceEsperado),
    };
  });
  if (cte) {
    const components = Array.from(document.getElementsByTagNameNS(namespaceEsperado, 'Comp')).map((node) => ({
      tipo: 'COMPONENTE' as const, codigo: null, ncm: null, cest: null, cfop: null, cstCsosn: null, codigoBeneficio: null, descricao: texto(node as unknown as XmlContainer, 'xNome', namespaceEsperado),
      quantidade: null, unidade: null, valor: texto(node as unknown as XmlContainer, 'vComp', namespaceEsperado), ibs: null, cbs: null,
    }));
    items.unshift(...components);
  }
  const tributos: TributoFiscalParseado[] = [];
  if (nfe) {
    itemNodes.forEach((node, index) => {
      const item = node as Element;
      const tax = item.getElementsByTagNameNS(namespaceEsperado, 'imposto')[0] as Element | undefined;
      if (tax) tributos.push(...extrairTributosDeGrupo(tax as unknown as XmlContainer, namespaceEsperado, 'ITEM', index + 1));
    });
    const totals = document.getElementsByTagNameNS(namespaceEsperado, 'ICMSTot')[0] as Element | undefined;
    const totaisBasicos: readonly Readonly<{ codigo: 'ICMS' | 'ICMS_ST' | 'IPI' | 'II' | 'PIS' | 'COFINS'; base: string | null; valor: string | null }>[] = totals ? [
      { codigo: 'ICMS', base: texto(totals, 'vBC', namespaceEsperado), valor: texto(totals, 'vICMS', namespaceEsperado) },
      { codigo: 'ICMS_ST', base: texto(totals, 'vBCST', namespaceEsperado), valor: texto(totals, 'vST', namespaceEsperado) },
      { codigo: 'IPI', base: null, valor: texto(totals, 'vIPI', namespaceEsperado) },
      { codigo: 'II', base: null, valor: texto(totals, 'vII', namespaceEsperado) },
      { codigo: 'PIS', base: null, valor: texto(totals, 'vPIS', namespaceEsperado) },
      { codigo: 'COFINS', base: null, valor: texto(totals, 'vCOFINS', namespaceEsperado) },
    ] : [];
    for (const total of totaisBasicos) if (total.base !== null || total.valor !== null) tributos.push({ escopo: 'DOCUMENTO', numeroItem: null, codigo: total.codigo, baseCalculo: total.base, aliquota: null, valor: total.valor, situacao: null, classificacao: null });
    const ibsTotals = document.getElementsByTagNameNS(namespaceEsperado, 'IBSCBSTot')[0] as Element | undefined;
    const ibsGroup = ibsTotals?.getElementsByTagNameNS(namespaceEsperado, 'gIBS')[0] as Element | undefined;
    const cbsGroup = ibsTotals?.getElementsByTagNameNS(namespaceEsperado, 'gCBS')[0] as Element | undefined;
    const baseIbs = texto(ibsTotals ?? null, 'vBCIBSCBS', namespaceEsperado);
    if (ibsGroup) tributos.push({ escopo: 'DOCUMENTO', numeroItem: null, codigo: 'IBS', baseCalculo: baseIbs, aliquota: null, valor: texto(ibsGroup, 'vIBS', namespaceEsperado), situacao: null, classificacao: null });
    if (cbsGroup) tributos.push({ escopo: 'DOCUMENTO', numeroItem: null, codigo: 'CBS', baseCalculo: baseIbs, aliquota: texto(cbsGroup, 'pCBS', namespaceEsperado), valor: texto(cbsGroup, 'vCBS', namespaceEsperado), situacao: null, classificacao: null });
  } else {
    const tax = document.getElementsByTagNameNS(namespaceEsperado, 'imp')[0] as Element | undefined;
    if (tax) tributos.push(...extrairTributosDeGrupo(tax as unknown as XmlContainer, namespaceEsperado, 'DOCUMENTO', null));
  }
  const ibsCbsPendente = Boolean(emission && emission.slice(0, 10) >= '2026-08-03' &&
    (nfe ? items.some((item) => item.ibs === null || item.cbs === null) || texto(document, 'IBSCBSTot', namespaceEsperado) === null
      : texto(document, 'gIBSCBS', namespaceEsperado) === null));
  const ibsCbsTotalNode = document.getElementsByTagNameNS(namespaceEsperado, nfe ? 'IBSCBSTot' : 'gIBSCBS')[0] as Element | undefined;
  const ibsTotalNode = ibsCbsTotalNode?.getElementsByTagNameNS(namespaceEsperado, 'gIBS')[0] as Element | undefined;
  const cbsTotalNode = ibsCbsTotalNode?.getElementsByTagNameNS(namespaceEsperado, 'gCBS')[0] as Element | undefined;
  const emitenteNode = document.getElementsByTagNameNS(namespaceEsperado, 'emit')[0];
  const destinatarioNode = document.getElementsByTagNameNS(namespaceEsperado, 'dest')[0];
  const protocolNode = document.getElementsByTagNameNS(namespaceEsperado, nfe ? 'protNFe' : 'protCTe')[0];
  const protocolReceivedAt = texto(protocolNode ? protocolNode as unknown as XmlContainer : null, 'dhRecbto', namespaceEsperado);
  if (protocolReceivedAt && (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(protocolReceivedAt) || Number.isNaN(Date.parse(protocolReceivedAt)))) erro('FISCAL_XML_INVALID');
  const referenceNodes = Array.from(document.getElementsByTagNameNS(namespaceEsperado, nfe ? 'NFref' : 'infNFe'));
  const referencias = referenceNodes.flatMap((node) => {
    const chave = texto(node as unknown as XmlContainer, nfe ? 'refNFe' : 'chave', namespaceEsperado);
    return chave ? [{ tipo: nfe ? 'NFE' : 'NFE_VINCULADA_CTE', chave }] : [];
  });
  const partes = ([['EMITENTE', emitenteNode], ['DESTINATARIO', destinatarioNode]] as const).flatMap(([papel, node]) => {
    if (!node) return [];
    const addressName = papel === 'EMITENTE' ? 'enderEmit' : 'enderDest';
    const address = node.getElementsByTagNameNS(namespaceEsperado, addressName)[0] as Element | undefined;
    return [{
      papel,
      identificador: texto(node, 'CNPJ', namespaceEsperado) ?? texto(node, 'CPF', namespaceEsperado),
      nome: texto(node, 'xNome', namespaceEsperado), inscricaoEstadual: texto(node, 'IE', namespaceEsperado),
      logradouro: texto(address ?? null, 'xLgr', namespaceEsperado), numero: texto(address ?? null, 'nro', namespaceEsperado),
      complemento: texto(address ?? null, 'xCpl', namespaceEsperado), bairro: texto(address ?? null, 'xBairro', namespaceEsperado),
      codigoMunicipio: texto(address ?? null, 'cMun', namespaceEsperado), municipio: texto(address ?? null, 'xMun', namespaceEsperado),
      uf: texto(address ?? null, 'UF', namespaceEsperado), cep: texto(address ?? null, 'CEP', namespaceEsperado),
      codigoPais: texto(address ?? null, 'cPais', namespaceEsperado), pais: texto(address ?? null, 'xPais', namespaceEsperado),
    }];
  });
  return {
    especie, modelo: model!, versaoLayout, tributos,
    chaveAcesso: key, emitidoEm: emission,
    protocolo: texto(protocolNode ? protocolNode as unknown as XmlContainer : null, 'nProt', namespaceEsperado),
    protocoloRecebidoEm: protocolReceivedAt ? new Date(protocolReceivedAt).toISOString() : null, referencias, partes,
    emitente: texto(emitenteNode ?? null, 'CNPJ', namespaceEsperado) ?? texto(emitenteNode ?? null, 'CPF', namespaceEsperado) ?? texto(emitenteNode ?? null, 'xNome', namespaceEsperado),
    destinatario: texto(destinatarioNode ?? null, 'CNPJ', namespaceEsperado) ?? texto(destinatarioNode ?? null, 'CPF', namespaceEsperado) ?? texto(destinatarioNode ?? null, 'xNome', namespaceEsperado),
    baseIbsCbs: texto(ibsCbsTotalNode ?? null, nfe ? 'vBCIBSCBS' : 'vBC', namespaceEsperado),
    totalIbs: texto(ibsTotalNode ?? null, 'vIBS', namespaceEsperado), totalCbs: texto(cbsTotalNode ?? null, 'vCBS', namespaceEsperado),
    total: texto(document, nfe ? 'vNF' : 'vTPrest', namespaceEsperado), itens: items, ibsCbsPendente,
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
