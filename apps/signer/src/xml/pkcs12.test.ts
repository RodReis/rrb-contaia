import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { criarPki, emitirPfx } from '../../../../scripts/gerar-pki-de-teste.mjs';
import { abrirPkcs12ParaAssinar } from './pkcs12.js';

const pki = criarPki();
const a1 = emitirPfx(pki, { cnpj: '11222333000181' });

describe('abertura do PKCS#12 em memória para assinar (SPEC-012 §3.4)', () => {
  it('devolve a chave e o certificado do titular, e eles formam um par', () => {
    const { chavePem, certificadoPem } = abrirPkcs12ParaAssinar(a1.pfx, a1.senha);

    const certificado = new X509Certificate(certificadoPem);

    expect(certificado.subject).toContain('11222333000181');
    expect(certificado.checkPrivateKey(createPrivateKey(chavePem))).toBe(true);
    expect(createPublicKey(chavePem).asymmetricKeyType).toBe('rsa');
  });

  it('escolhe o certificado do titular, não o da intermediária que vai junto no PFX', () => {
    const { certificadoPem } = abrirPkcs12ParaAssinar(a1.pfx, a1.senha);

    expect(new X509Certificate(certificadoPem).ca).toBe(false);
  });

  it('senha errada falha sem revelar nada do conteúdo', () => {
    expect(() => abrirPkcs12ParaAssinar(a1.pfx, 'senha-errada')).toThrowError(/indispon/iu);
  });

  it('PFX corrompido falha com o mesmo erro genérico', () => {
    expect(() => abrirPkcs12ParaAssinar(a1.pfx.subarray(0, 40), a1.senha)).toThrowError(/indispon/iu);
  });

  it('PFX sem chave privada não serve para assinar', () => {
    const semChave = emitirPfx(pki, { cnpj: '11222333000181', semChavePrivada: true });

    expect(() => abrirPkcs12ParaAssinar(semChave.pfx, semChave.senha)).toThrowError(/indispon/iu);
  });
});
