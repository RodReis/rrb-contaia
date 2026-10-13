/**
 * Adaptador descartável de NF-e para a simulação tributária (SPEC-016 §3.6, §7).
 *
 * Lê o XML em memória, valida o leiaute fixado (NF-e 4.00, modelo 55, NT 2025.002 v1.50) e devolve
 * SÓ o que a simulação precisa: data civil da emissão, regime mapeável do CRT, itens, bases e os
 * valores IBS/CBS declarados. Nunca devolve DOM ou XML, texto livre, emitente ou chave de acesso;
 * não calcula, não consulta regra e não grava nada. Qualquer falha é erro de validação com código
 * estável, nunca HTTP 500, e a mensagem não ecoa o conteúdo do arquivo.
 *
 * Segurança do parse: tamanho e quantidade de elementos limitados; DTD, `<!ENTITY>` e afins são
 * recusados ANTES do parser (XXE e bombas de entidade nem chegam a ele); só UTF-8; e qualquer
 * aviso ou erro do parser, que por padrão é leniente, vira recusa.
 */
import { DOMParser } from '@xmldom/xmldom';

import { CODIGOS_DE_ERRO, ErroDeDominio, lerDataCivil, type TaxRegime } from '@contaia/domain';
import {
  LIMITE_DA_NFE_BYTES,
  NFE_RTC_LAYOUT,
  type NfeDeclaredTaxDto,
  type NfeExtractionDto,
  type NfeItemExtractionDto,
} from '@contaia/shared';

const NAMESPACE_DA_NFE = 'http://www.portalfiscal.inf.br/nfe';
const MODELO_DA_NFE = '55';
const MAX_ITENS = 990;
/** Folga larga sobre os ~60 elementos por item de 990 itens; corta XML construído para exaurir o processo. */
const MAX_ELEMENTOS = 100_000;

const DECLARACAO_DE_CODIFICACAO = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/iu;
const DECLARACAO_DE_DTD = /<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/iu;
const DATA_E_HORA = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const VALOR_MONETARIO = /^(\d{1,13})(?:\.(\d{1,2}))?$/u;
const PERCENTUAL = /^\d{1,3}(?:\.\d{2,4})?$/u;
const NUMERO_DO_ITEM = /^[1-9]\d{0,2}$/u;

const invalido = (mensagem: string): ErroDeDominio => new ErroDeDominio(CODIGOS_DE_ERRO.NFE_XML_INVALID, mensagem);
const naoSuportado = (mensagem: string): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.NFE_LAYOUT_UNSUPPORTED, mensagem);
const faltando = (mensagem: string): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.NFE_REQUIRED_DATA_MISSING, mensagem);

const decodificar = (conteudo: Buffer): string => {
  if (conteudo.length === 0) {
    throw invalido('O arquivo está vazio.');
  }
  if (conteudo.length > LIMITE_DA_NFE_BYTES) {
    throw invalido('O arquivo excede o limite aceito para a simulação.');
  }

  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(conteudo);
  } catch {
    throw invalido('O XML da NF-e deve estar em UTF-8.');
  }
  texto = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;

  if (texto.trim().length === 0) {
    throw invalido('O arquivo está vazio.');
  }
  const codificacao = DECLARACAO_DE_CODIFICACAO.exec(texto)?.[1];
  if (codificacao !== undefined && codificacao.toUpperCase() !== 'UTF-8') {
    throw invalido('O XML da NF-e deve declarar a codificação UTF-8.');
  }
  if (DECLARACAO_DE_DTD.test(texto)) {
    throw invalido('DTD e declarações de entidade não são aceitas.');
  }
  if ((texto.match(/</gu)?.length ?? 0) > MAX_ELEMENTOS) {
    throw invalido('O XML tem estrutura grande demais para a simulação.');
  }

  return texto;
};

const recusar = (): never => {
  throw invalido('O XML está malformado.');
};

const lerDocumento = (texto: string): Document => {
  try {
    // O parser é leniente por padrão: erro e aviso só vão ao console. Aqui todo problema é recusa.
    const documento = new DOMParser({
      errorHandler: { warning: recusar, error: recusar, fatalError: recusar },
    }).parseFromString(texto, 'text/xml');

    return documento;
  } catch (erro) {
    throw erro instanceof ErroDeDominio ? erro : invalido('O XML está malformado.');
  }
};

const ehElemento = (no: Node): no is Element => no.nodeType === 1;

const filhos = (pai: Element, nome: string): Element[] => {
  const encontrados: Element[] = [];
  for (let no = pai.firstChild; no !== null; no = no.nextSibling) {
    if (ehElemento(no) && no.namespaceURI === NAMESPACE_DA_NFE && no.localName === nome) {
      encontrados.push(no);
    }
  }

  return encontrados;
};

/** Elemento de ocorrência única: ausente → `null`; repetido → documento fora do leiaute. */
const um = (pai: Element | null, nome: string): Element | null => {
  if (pai === null) {
    return null;
  }
  const encontrados = filhos(pai, nome);
  if (encontrados.length > 1) {
    throw invalido('O XML repete um elemento que deve ser único.');
  }

  return encontrados[0] ?? null;
};

const texto = (elemento: Element | null): string | null => {
  const conteudo = elemento?.textContent?.trim();

  return conteudo === undefined || conteudo.length === 0 ? null : conteudo;
};

const emCentavos = (valor: string): number => {
  const partes = VALOR_MONETARIO.exec(valor);
  if (partes === null) {
    throw invalido('O XML traz um valor monetário fora do formato decimal do leiaute.');
  }

  return Number(partes[1]) * 100 + Number((partes[2] ?? '').padEnd(2, '0'));
};

const dinheiro = (elemento: Element | null): number | null => {
  const conteudo = texto(elemento);

  return conteudo === null ? null : emCentavos(conteudo);
};

const dataDeEmissao = (ide: Element | null): string => {
  const conteudo = texto(um(ide, 'dhEmi'));
  if (conteudo === null) {
    throw faltando('A NF-e não traz a data de emissão.');
  }
  // O dia civil como escrito no documento (I-11): nada de converter fuso.
  const dia = DATA_E_HORA.exec(conteudo)?.[1];
  if (dia === undefined || lerDataCivil(dia) !== dia) {
    throw invalido('A data de emissão da NF-e é inválida.');
  }

  return dia;
};

/** CRT 1 e 2 são do Simples Nacional; 3 (regime normal) e 4 (MEI) não apontam um único regime do catálogo. */
const regimeDoCrt = (emit: Element | null): TaxRegime | null => {
  const crt = texto(um(emit, 'CRT'));

  return crt === '1' || crt === '2' ? 'SIMPLES_NACIONAL' : null;
};

const valorDeclarado = (grupo: Element | null, percentual: string, valor: string): NfeDeclaredTaxDto | null => {
  if (grupo === null) {
    return null;
  }
  const valorEmCentavos = dinheiro(um(grupo, valor));
  if (valorEmCentavos === null) {
    throw faltando('Um grupo IBS/CBS da NF-e não traz o valor.');
  }
  const taxa = texto(um(grupo, percentual));
  if (taxa !== null && !PERCENTUAL.test(taxa)) {
    throw invalido('O XML traz um percentual fora do formato do leiaute.');
  }

  return { ratePercent: taxa, valueCents: valorEmCentavos };
};

const grupoIbsCbs = (imposto: Element | null): NfeItemExtractionDto['ibsCbs'] => {
  const grupo = um(um(imposto, 'IBSCBS'), 'gIBSCBS');
  if (grupo === null) {
    return null;
  }
  const base = dinheiro(um(grupo, 'vBC'));
  if (base === null) {
    throw faltando('O grupo IBS/CBS da NF-e não traz a base de cálculo.');
  }

  return {
    baseCents: base,
    ibsUf: valorDeclarado(um(grupo, 'gIBSUF'), 'pIBSUF', 'vIBSUF'),
    ibsMun: valorDeclarado(um(grupo, 'gIBSMun'), 'pIBSMun', 'vIBSMun'),
    cbs: valorDeclarado(um(grupo, 'gCBS'), 'pCBS', 'vCBS'),
  };
};

const itens = (infNFe: Element): readonly NfeItemExtractionDto[] => {
  const dets = filhos(infNFe, 'det');
  if (dets.length === 0) {
    throw faltando('A NF-e não traz itens.');
  }
  if (dets.length > MAX_ITENS) {
    throw invalido('A NF-e tem mais itens do que o leiaute permite.');
  }

  const vistos = new Set<number>();

  return dets.map((det) => {
    const rotulo = det.getAttribute('nItem') ?? '';
    const numero = NUMERO_DO_ITEM.test(rotulo) ? Number(rotulo) : Number.NaN;
    if (!Number.isInteger(numero) || numero > MAX_ITENS || vistos.has(numero)) {
      throw invalido('A numeração dos itens da NF-e é inválida ou repetida.');
    }
    vistos.add(numero);

    const produto = dinheiro(um(um(det, 'prod'), 'vProd'));
    if (produto === null) {
      throw faltando('Um item da NF-e não traz o valor do produto.');
    }

    return { number: numero, productCents: produto, ibsCbs: grupoIbsCbs(um(det, 'imposto')) };
  });
};

const totaisDeclarados = (infNFe: Element): NfeExtractionDto['declaredTotals'] => {
  const totais = um(um(infNFe, 'total'), 'IBSCBSTot');
  if (totais === null) {
    return null;
  }

  return {
    ibsCents: dinheiro(um(um(totais, 'gIBS'), 'vIBS')),
    cbsCents: dinheiro(um(um(totais, 'gCBS'), 'vCBS')),
  };
};

const localizarInfNFe = (documento: Document): Element => {
  const raiz = documento.documentElement as Element | null;
  if (raiz === null) {
    throw invalido('O arquivo não é um XML.');
  }
  if (raiz.namespaceURI !== NAMESPACE_DA_NFE) {
    throw naoSuportado('O documento não é uma NF-e do leiaute aceito.');
  }

  const nfe = raiz.localName === 'nfeProc' ? um(raiz, 'NFe') : raiz.localName === 'NFe' ? raiz : null;
  const infNFe = um(nfe, 'infNFe');
  if (infNFe === null) {
    throw naoSuportado('O documento não é uma NF-e do leiaute aceito.');
  }

  return infNFe;
};

export const parseNfeTaxInput = (conteudo: Buffer): NfeExtractionDto => {
  const infNFe = localizarInfNFe(lerDocumento(decodificar(conteudo)));

  if (infNFe.getAttribute('versao') !== NFE_RTC_LAYOUT.nfeVersion) {
    throw naoSuportado(`Só a NF-e versão ${NFE_RTC_LAYOUT.nfeVersion} (NT ${NFE_RTC_LAYOUT.nt} v${NFE_RTC_LAYOUT.ntVersion}) é aceita.`);
  }

  const ide = um(infNFe, 'ide');
  const modelo = texto(um(ide, 'mod'));
  if (modelo !== null && modelo !== MODELO_DA_NFE) {
    throw naoSuportado('Só a NF-e modelo 55 é aceita; NFC-e e outros documentos ficam fora da simulação.');
  }
  if (modelo === null) {
    throw faltando('A NF-e não declara o modelo do documento.');
  }

  return {
    layout: NFE_RTC_LAYOUT,
    issueDate: dataDeEmissao(ide),
    regime: regimeDoCrt(um(infNFe, 'emit')),
    items: itens(infNFe),
    declaredTotals: totaisDeclarados(infNFe),
  };
};
