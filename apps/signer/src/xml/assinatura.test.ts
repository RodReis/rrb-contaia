import { createPrivateKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { criarPki, emitirPfx } from '../../../../scripts/gerar-pki-de-teste.mjs';
import { ErroDoSigner } from '../erro.js';
import { ADAPTADORES } from './adaptadores.js';
import { assinarXml } from './assinar.js';
import { abrirPkcs12ParaAssinar } from './pkcs12.js';
import { verificarXmlAssinado } from './verificar.js';

const pki = criarPki();
const titular = abrirPkcs12ParaAssinar(...(((p) => [p.pfx, p.senha] as const)(emitirPfx(pki, { cnpj: '11222333000181' }))));
// Outra PKI = outro par de chaves do titular (dentro da mesma PKI as variações reaproveitam a chave).
const outro = abrirPkcs12ParaAssinar(
  ...(((p) => [p.pfx, p.senha] as const)(emitirPfx(criarPki(), { cnpj: '45723174000110' }))),
);

const ID_NFE = 'NFe35261011222333000181550010000000011000000011';
const ID_EVT = 'ID1112223330001812026100712000000000001';

const NFE = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="${ID_NFE}"><ide><cUF>35</cUF></ide><emit><CNPJ>11222333000181</CNPJ></emit></infNFe></NFe>`;
const ESOCIAL = `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtInfoEmpregador/v_S_01_02_00"><evtInfoEmpregador Id="${ID_EVT}"><ideEvento><tpAmb>2</tpAmb></ideEvento></evtInfoEmpregador></eSocial>`;

const dfe = ADAPTADORES.DFE_TESTE;
const esocial = ADAPTADORES.ESOCIAL_TESTE;

const assinar = (xml: string, adaptador = dfe) =>
  assinarXml({ xml, adaptador, chavePem: titular.chavePem, certificadoPem: titular.certificadoPem });

const recusa = (acao: () => unknown): void => {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDoSigner);
    expect((erro as ErroDoSigner).codigo).toBe('SIGNER_XML_INVALIDO');
    return;
  }
  throw new Error('o XML inválido foi aceito');
};

describe('catálogo de adaptadores (SPEC-012 §3.3, §3.6)', () => {
  it('cada finalidade tem o seu adaptador, com algoritmos fixos no contrato', () => {
    expect(Object.keys(ADAPTADORES).sort()).toEqual(['DFE_TESTE', 'ESOCIAL_TESTE']);
    expect(dfe.raiz).toBe('NFe');
    expect(esocial.raiz).toBe('eSocial');
  });
});

describe('assinatura XMLDSig RSA-SHA256 / SHA-256', () => {
  it('assina o infNFe do DF-e, envelopada, e a assinatura produzida é verificada', () => {
    const assinado = assinar(NFE);

    expect(assinado).toContain('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
    expect(assinado).toContain('http://www.w3.org/2001/04/xmlenc#sha256');
    expect(assinado).toContain('http://www.w3.org/2000/09/xmldsig#enveloped-signature');
    expect(assinado).toContain(`URI="#${ID_NFE}"`);
    expect(assinado.indexOf('</infNFe>')).toBeLessThan(assinado.indexOf('<Signature'));
    expect(verificarXmlAssinado({ xmlAssinado: assinado, certificadoPem: titular.certificadoPem, adaptador: dfe })).toBe(true);
  });

  it('assina o evento do eSocial com o adaptador do eSocial', () => {
    const assinado = assinar(ESOCIAL, esocial);

    expect(assinado).toContain(`URI="#${ID_EVT}"`);
    expect(
      verificarXmlAssinado({ xmlAssinado: assinado, certificadoPem: titular.certificadoPem, adaptador: esocial }),
    ).toBe(true);
  });

  it('o XML assinado só leva o certificado público: nunca a chave privada', () => {
    const assinado = assinar(NFE);

    expect(assinado).toContain('<X509Certificate>');
    expect(assinado).not.toMatch(/PRIVATE KEY/u);
    expect(assinado).not.toContain(titular.chavePem.replace(/-----[^-]+-----|\s/gu, '').slice(0, 60));
  });

  it('o conteúdo assinado não se altera: adulterar o infNFe depois de assinar reprova a verificação', () => {
    const adulterado = assinar(NFE).replace('<cUF>35</cUF>', '<cUF>41</cUF>');

    expect(
      verificarXmlAssinado({ xmlAssinado: adulterado, certificadoPem: titular.certificadoPem, adaptador: dfe }),
    ).toBe(false);
  });

  it('verificar com o certificado de OUTRO titular reprova', () => {
    expect(
      verificarXmlAssinado({ xmlAssinado: assinar(NFE), certificadoPem: outro.certificadoPem, adaptador: dfe }),
    ).toBe(false);
  });

  it('uma chave que não é a do certificado produz assinatura que não verifica', () => {
    const assinado = assinarXml({
      xml: NFE,
      adaptador: dfe,
      chavePem: outro.chavePem,
      certificadoPem: titular.certificadoPem,
    });

    expect(
      verificarXmlAssinado({ xmlAssinado: assinado, certificadoPem: titular.certificadoPem, adaptador: dfe }),
    ).toBe(false);
  });

  it('wrapping: um segundo elemento-alvo com o mesmo Id reprova a verificação', () => {
    const assinado = assinar(NFE);
    const atacado = assinado.replace(
      '</NFe>',
      `<infNFe versao="4.00" Id="${ID_NFE}"><emit><CNPJ>99999999000199</CNPJ></emit></infNFe></NFe>`,
    );

    expect(
      verificarXmlAssinado({ xmlAssinado: atacado, certificadoPem: titular.certificadoPem, adaptador: dfe }),
    ).toBe(false);
  });

  it('o adaptador do DF-e não verifica XML do eSocial e vice-versa', () => {
    expect(
      verificarXmlAssinado({ xmlAssinado: assinar(ESOCIAL, esocial), certificadoPem: titular.certificadoPem, adaptador: dfe }),
    ).toBe(false);
  });
});

describe('recusas antes de assinar (nada disso chega à rede)', () => {
  it('XML malformado', () => {
    recusa(() => assinar('<NFe><infNFe Id="X1"></NFe>'));
    recusa(() => assinar('isto não é xml'));
    recusa(() => assinar(''));
  });

  it('raiz diferente da esperada pela finalidade', () => {
    recusa(() => assinar(ESOCIAL, dfe));
    recusa(() => assinar(NFE, esocial));
  });

  it('elemento-alvo ausente', () => {
    recusa(() => assinar('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><outro Id="A1"/></NFe>'));
  });

  it('alvo ambíguo: dois infNFe', () => {
    recusa(() =>
      assinar(
        `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="A1"/><infNFe Id="A2"/></NFe>`,
      ),
    );
  });

  it('Id ausente, vazio, duplicado ou com metacaracteres de XPath', () => {
    recusa(() => assinar('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe/></NFe>'));
    recusa(() => assinar('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id=""/></NFe>'));
    recusa(() => assinar(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="A1"><x Id="A1"/></infNFe></NFe>`));
    recusa(() => assinar(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="x' or '1'='1"/></NFe>`));
  });

  it('assinatura preexistente incompatível', () => {
    recusa(() => assinar(assinar(NFE)));
    recusa(() =>
      assinar(
        `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="A1"/><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/></NFe>`,
      ),
    );
  });

  it('DOCTYPE e entidades (XXE e bomba de expansão)', () => {
    recusa(() =>
      assinar(`<!DOCTYPE NFe [<!ENTITY x SYSTEM "file:///etc/passwd">]><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="A1">&x;</infNFe></NFe>`),
    );
    recusa(() => assinar(`<!DOCTYPE NFe><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="A1"/></NFe>`));
  });
});

describe('falha criptográfica', () => {
  it('chave que não é RSA-PEM válida vira SIGNER_ASSINATURA_INVALIDA, sem vazar a causa', () => {
    try {
      assinarXml({ xml: NFE, adaptador: dfe, chavePem: 'não-é-pem', certificadoPem: titular.certificadoPem });
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDoSigner);
      expect((erro as ErroDoSigner).codigo).toBe('SIGNER_ASSINATURA_INVALIDA');
      expect((erro as Error).message).not.toContain('não-é-pem');
      return;
    }
    throw new Error('a chave inválida foi aceita');
  });

  it('a chave de teste usada aqui é RSA', () => {
    expect(createPrivateKey(titular.chavePem).asymmetricKeyType).toBe('rsa');
  });
});
