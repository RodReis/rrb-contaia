import { SignedXml } from 'xml-crypto';

import { RSA_SHA256, SHA256, type Adaptador } from './adaptadores.js';
import { analisarXml, ehAssinaturaXmlDsig } from './seguranca.js';

export type EntradaDeVerificacao = Readonly<{
  xmlAssinado: string;
  certificadoPem: string;
  adaptador: Adaptador;
}>;

/**
 * Verifica a assinatura produzida com o certificado público (SPEC-012 §3.6): só passa se o XML tem
 * exatamente UMA assinatura, UM elemento-alvo de Id único, os algoritmos do contrato e se a ÚNICA
 * referência assinada é esse elemento. Usa `getSignedReferences()` — o que foi de fato autenticado —
 * e nunca `getReferences()`. Qualquer anomalia devolve `false`, nunca exceção.
 */
export const verificarXmlAssinado = ({ xmlAssinado, certificadoPem, adaptador }: EntradaDeVerificacao): boolean => {
  try {
    const { alvo, id, assinaturas } = analisarXml(xmlAssinado, adaptador);
    const assinatura = assinaturas[0];

    if (assinaturas.length !== 1 || assinatura === undefined || !ehAssinaturaXmlDsig(assinatura)) {
      return false;
    }

    const verificador = new SignedXml({ publicCert: certificadoPem });

    verificador.loadSignature(assinatura as unknown as Node);

    if (verificador.signatureAlgorithm !== RSA_SHA256) {
      return false;
    }

    const referencias = verificador.getReferences();

    if (referencias.length !== 1 || referencias[0]?.digestAlgorithm !== SHA256 || referencias[0]?.uri !== `#${id}`) {
      return false;
    }

    if (!verificador.checkSignature(xmlAssinado)) {
      return false;
    }

    const assinadas = verificador.getSignedReferences();

    return assinadas.length === 1 && alvo.localName !== '' && (assinadas[0] ?? '').includes(`Id="${id}"`);
  } catch {
    return false;
  }
};
