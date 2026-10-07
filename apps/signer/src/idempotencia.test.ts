import { describe, expect, it } from 'vitest';

import { criarPki, emitirPfx } from '../../../scripts/gerar-pki-de-teste.mjs';
import { chaveProtegida, hashDoConteudo, impressaoDigitalDoCertificado } from './idempotencia.js';
import { abrirPkcs12ParaAssinar } from './xml/pkcs12.js';

describe('chave idempotente protegida (SPEC-012 §3.11, §6.3)', () => {
  it('é um HMAC-SHA256 hexadecimal: determinístico e sem a chave em claro', () => {
    const protegida = chaveProtegida('chave-do-worker-0001', 'pepper-de-teste-com-mais-de-32-bytes!!');

    expect(protegida).toMatch(/^[0-9a-f]{64}$/u);
    expect(protegida).toBe(chaveProtegida('chave-do-worker-0001', 'pepper-de-teste-com-mais-de-32-bytes!!'));
    expect(protegida).not.toContain('chave-do-worker');
  });

  it('muda com a chave e com o pepper', () => {
    const base = chaveProtegida('chave-a', 'pepper-um-com-mais-de-32-bytes-aaaaaaaa');

    expect(chaveProtegida('chave-b', 'pepper-um-com-mais-de-32-bytes-aaaaaaaa')).not.toBe(base);
    expect(chaveProtegida('chave-a', 'pepper-dois-com-mais-de-32-bytes-bbbbbbb')).not.toBe(base);
  });
});

describe('hash do conteúdo', () => {
  it('é SHA-256 hexadecimal e muda com qualquer byte', () => {
    expect(hashDoConteudo('<a/>')).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashDoConteudo('<a/>')).toBe(hashDoConteudo('<a/>'));
    expect(hashDoConteudo('<a/>')).not.toBe(hashDoConteudo('<a />'));
  });
});

describe('impressão digital do certificado', () => {
  it('é o SHA-256 hexadecimal minúsculo do certificado, o mesmo formato que a F11 grava', () => {
    const a1 = emitirPfx(criarPki(), { cnpj: '11222333000181' });
    const { certificadoPem } = abrirPkcs12ParaAssinar(a1.pfx, a1.senha);

    expect(impressaoDigitalDoCertificado(certificadoPem)).toMatch(/^[0-9a-f]{64}$/u);
  });
});
