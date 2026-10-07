/**
 * Análise segura do XML antes de assinar ou verificar (SPEC-012 §3.6).
 *
 * Recusa DOCTYPE/entidades (XXE e bomba de expansão), XML malformado, raiz diferente da esperada,
 * alvo ausente ou ambíguo, `Id` ausente, inseguro para XPath ou duplicado (wrapping) e assinatura
 * preexistente. Nada aqui usa rede, arquivo nem relógio.
 */
import { DOMParser } from '@xmldom/xmldom';

import { ErroDoSigner } from '../erro.js';
import { NS_XMLDSIG, type Adaptador } from './adaptadores.js';

/** Mesmo alfabeto que o contrato de `Id` do XML-DSig aceita sem escapar no XPath da referência. */
const ID_SEGURO = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const NOMES_DE_ID = ['Id', 'ID', 'id'] as const;

const invalido = (): never => {
  throw new ErroDoSigner('SIGNER_XML_INVALIDO');
};

export type XmlAnalisado = Readonly<{
  documento: Document;
  alvo: Element;
  id: string;
  assinaturas: readonly Element[];
}>;

const elementosDe = (documento: Document): Element[] => Array.from(documento.getElementsByTagName('*'));

const idsDe = (elemento: Element): string[] =>
  NOMES_DE_ID.map((nome) => elemento.getAttribute(nome)).filter((valor): valor is string => valor !== null && valor !== '');

export const analisarXml = (xml: string, adaptador: Adaptador): XmlAnalisado => {
  if (xml.trim() === '' || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    return invalido();
  }

  let houveErro = false;
  const marcar = (): void => {
    houveErro = true;
  };
  const documento = new DOMParser({ errorHandler: { warning: marcar, error: marcar, fatalError: marcar } }).parseFromString(
    xml,
    'text/xml',
  );
  const raiz = documento.documentElement;

  if (houveErro || raiz === null || raiz.localName !== adaptador.raiz) {
    return invalido();
  }

  const elementos = elementosDe(documento);
  const alvos = elementos.filter((elemento) => adaptador.alvo.test(elemento.localName));

  if (alvos.length !== 1) {
    return invalido();
  }

  const alvo = alvos[0] as Element;
  const id = alvo.getAttribute('Id') ?? '';

  if (!ID_SEGURO.test(id)) {
    return invalido();
  }
  // Id único no documento inteiro: dois elementos com o mesmo Id é o ataque de wrapping.
  if (elementos.filter((elemento) => idsDe(elemento).includes(id)).length !== 1) {
    return invalido();
  }

  const assinaturas = elementos.filter((elemento) => elemento.localName === 'Signature');

  return { documento, alvo, id, assinaturas };
};

/** Para assinar: o XML não pode trazer assinatura alguma. */
export const prepararParaAssinar = (xml: string, adaptador: Adaptador): XmlAnalisado => {
  const analisado = analisarXml(xml, adaptador);

  if (analisado.assinaturas.length > 0) {
    return invalido();
  }

  return analisado;
};

export const ehAssinaturaXmlDsig = (elemento: Element): boolean =>
  elemento.localName === 'Signature' && elemento.namespaceURI === NS_XMLDSIG;
