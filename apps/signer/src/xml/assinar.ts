import { SignedXml } from 'xml-crypto';

import { ErroDoSigner } from '../erro.js';
import { ENVELOPED, RSA_SHA256, SHA256, type Adaptador } from './adaptadores.js';
import { prepararParaAssinar } from './seguranca.js';

export type EntradaDeAssinatura = Readonly<{
  xml: string;
  adaptador: Adaptador;
  chavePem: string;
  certificadoPem: string;
}>;

/**
 * Assina o único elemento-alvo da finalidade (envelopada na raiz), com RSA-SHA256, digest SHA-256 e
 * a canonicalização do adaptador. O XML assinado só leva o certificado público (KeyInfo).
 */
export const assinarXml = ({ xml, adaptador, chavePem, certificadoPem }: EntradaDeAssinatura): string => {
  // Recusas de conteúdo antes de qualquer operação criptográfica.
  const { id } = prepararParaAssinar(xml, adaptador);

  try {
    const assinatura = new SignedXml({
      privateKey: chavePem,
      publicCert: certificadoPem,
      signatureAlgorithm: RSA_SHA256,
      canonicalizationAlgorithm: adaptador.canonicalizacao,
    });

    assinatura.addReference({
      xpath: `//*[@Id='${id}']`,
      transforms: [ENVELOPED, adaptador.canonicalizacao],
      digestAlgorithm: SHA256,
    });
    assinatura.computeSignature(xml, {
      location: { reference: `/*[local-name(.)='${adaptador.raiz}']`, action: 'append' },
    });

    return assinatura.getSignedXml();
  } catch {
    // A causa pode citar a chave ou o XML; só o código estável sai daqui.
    throw new ErroDoSigner('SIGNER_ASSINATURA_INVALIDA');
  }
};
