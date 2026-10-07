/**
 * Abre o PKCS#12 SÓ na memória, para assinar XML (SPEC-012 §3.4).
 *
 * O arquivo já passou pelos limites defensivos do cofre na ingestão (F11); aqui ele só é lido do
 * Vault e aberto. Chave e certificado saem como PEM de curta vida — strings do V8 não se apagam,
 * então a única mitigação possível é o escopo curto: quem chama não os guarda, não loga, não
 * serializa. Falha de qualquer tipo vira um erro genérico: a causa pode descrever o conteúdo.
 */
import forge from 'node-forge';

import { ErroDoSigner } from '../erro.js';

const { pki, pkcs12, asn1, util } = forge;

export type ParDeAssinatura = Readonly<{ chavePem: string; certificadoPem: string }>;

const falhar = (): never => {
  throw new ErroDoSigner('SIGNER_INDISPONIVEL', 500);
};

export const abrirPkcs12ParaAssinar = (pfx: Buffer, senha: string): ParDeAssinatura => {
  try {
    const p12 = pkcs12.pkcs12FromAsn1(asn1.fromDer(util.createBuffer(pfx.toString('binary'))), false, senha);

    const chaves = [
      ...(p12.getBags({ bagType: pki.oids['pkcs8ShroudedKeyBag'] as string })[pki.oids['pkcs8ShroudedKeyBag'] as string] ?? []),
      ...(p12.getBags({ bagType: pki.oids['keyBag'] as string })[pki.oids['keyBag'] as string] ?? []),
    ];
    const certificados = p12.getBags({ bagType: pki.oids['certBag'] as string })[pki.oids['certBag'] as string] ?? [];
    const chave = chaves[0]?.key as forge.pki.rsa.PrivateKey | undefined;

    if (chave === undefined) {
      return falhar();
    }

    // O titular é o certificado cuja chave pública é a do par; a intermediária que vem junto não é.
    const titular = certificados
      .map((bolsa) => bolsa.cert)
      .find((cert) => cert !== undefined && (cert.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));

    if (titular === undefined) {
      return falhar();
    }

    return { chavePem: pki.privateKeyToPem(chave), certificadoPem: pki.certificateToPem(titular) };
  } catch {
    return falhar();
  }
};
