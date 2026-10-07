import type { Finalidade } from '@contaia/domain';

/**
 * Contrato de cada adaptador (SPEC-012 §3.3, §3.6). Algoritmo e canonicalização são FIXOS aqui —
 * o chamador nunca os informa. Destino local (host, porta, CA) mora na configuração da execução
 * mTLS, não no XML nem no comando.
 */

export const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
export const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
export const C14N_1_0 = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
export const NS_XMLDSIG = 'http://www.w3.org/2000/09/xmldsig#';

export type Adaptador = Readonly<{
  finalidade: Finalidade;
  /** `localName` do elemento raiz esperado; a assinatura é envelopada nele. */
  raiz: string;
  /** `localName` do ÚNICO elemento assinado. */
  alvo: RegExp;
  canonicalizacao: string;
}>;

export const ADAPTADORES: Readonly<Record<Finalidade, Adaptador>> = {
  DFE_TESTE: { finalidade: 'DFE_TESTE', raiz: 'NFe', alvo: /^infNFe$/u, canonicalizacao: C14N_1_0 },
  ESOCIAL_TESTE: {
    finalidade: 'ESOCIAL_TESTE',
    raiz: 'eSocial',
    alvo: /^evt[A-Za-z0-9]+$/u,
    canonicalizacao: C14N_1_0,
  },
};
