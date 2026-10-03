import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';
import { avaliarCertificado } from '@contaia/domain';
import {
  CNPJ_PADRAO_DE_TESTE,
  criarPki,
  emitirPfx,
  gerarConjuntoDeTeste,
  raizConfiavelEmPem,
  SENHA_PADRAO_DE_TESTE,
} from '../../../scripts/gerar-pki-de-teste.mjs';
import { abrirPkcs12, MAXIMO_DE_ITERACOES, maiorIteracaoDeclarada } from './pkcs12.js';

type Pfx = { pfx: Buffer; senha: string };

const AGORA = new Date();
let conjunto: Record<string, Pfx>;
let raizes: forge.pki.Certificate[];

beforeAll(() => {
  const pki = criarPki({ agora: AGORA });
  conjunto = gerarConjuntoDeTeste(pki, { cnpj: CNPJ_PADRAO_DE_TESTE }) as Record<string, Pfx>;
  raizes = [forge.pki.certificateFromPem(raizConfiavelEmPem(pki) as string)];
});

const avaliar = (nome: string, senha?: string) => {
  const item = conjunto[nome]!;
  const aberto = abrirPkcs12(item.pfx, senha ?? item.senha, raizes, AGORA);
  if (!aberto.ok) return aberto.codigo;
  const avaliacao = avaliarCertificado(aberto.extraido, { cnpjDaEmpresa: CNPJ_PADRAO_DE_TESTE, agora: AGORA });
  return avaliacao.ok ? 'ACEITO' : avaliacao.codigo;
};

describe('abrirPkcs12 + avaliarCertificado com PKI sintética', () => {
  it('aceita e-CNPJ A1 válido (3DES e AES-256, com ou sem raiz embutida)', () => {
    expect(avaliar('valido-e-cnpj-a1')).toBe('ACEITO');
    expect(avaliar('valido-aes256')).toBe('ACEITO');
    expect(avaliar('valido-com-raiz-no-pfx')).toBe('ACEITO');
  });

  it('extrai metadados sem conteúdo criptográfico', () => {
    const item = conjunto['valido-e-cnpj-a1']!;
    const aberto = abrirPkcs12(item.pfx, item.senha, raizes, AGORA);

    expect(aberto.ok).toBe(true);
    if (!aberto.ok) return;
    expect(aberto.metadados.titular).toBe('EMPRESA DE TESTE LTDA');
    expect(aberto.metadados.cnpjTitular).toBe(CNPJ_PADRAO_DE_TESTE);
    expect(aberto.metadados.autoridadeCertificadora).toBe('AC Intermediaria de Teste ContaIA');
    expect(aberto.metadados.cadeia).toEqual([
      'EMPRESA DE TESTE LTDA:11222333000181',
      'AC Intermediaria de Teste ContaIA',
      'AC Raiz de Teste ContaIA',
    ]);
    expect(aberto.metadados.impressaoDigital).toMatch(/^[0-9A-F]{64}$/);
    expect(aberto.metadados.numeroSerie).toMatch(/^[0-9A-F]+$/);
    expect(Object.keys(aberto.metadados).sort()).toEqual([
      'autoridadeCertificadora',
      'cadeia',
      'cnpjTitular',
      'impressaoDigital',
      'naoAntes',
      'naoDepois',
      'numeroSerie',
      'titular',
    ]);
  });

  it.each([
    ['invalido-a3', 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-e-cpf', 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-cadeia-desconhecida', 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-sem-chave-privada', 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-titular-e-autoridade', 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-cnpj-diferente', 'CERTIFICADO_CNPJ_DIVERGENTE'],
    ['invalido-expirado', 'CERTIFICADO_EXPIRADO'],
    ['invalido-ainda-nao-vigente', 'CERTIFICADO_AINDA_NAO_VIGENTE'],
  ])('%s é recusado com %s', (nome, codigo) => {
    expect(avaliar(nome)).toBe(codigo);
  });

  it('sem nenhuma raiz configurada nada é aceito', () => {
    const item = conjunto['valido-e-cnpj-a1']!;
    const aberto = abrirPkcs12(item.pfx, item.senha, [], AGORA);

    expect(aberto.ok && aberto.extraido.cadeiaIcpValidada).toBe(false);
  });

  it.each(['valido-e-cnpj-a1', 'valido-aes256'])('senha errada em %s vira SENHA_INCORRETA', (nome) => {
    expect(avaliar(nome, 'senha-errada')).toBe('CERTIFICADO_SENHA_INCORRETA');
  });

  it('PFX truncado, lixo e bytes vazios viram CONTEINER_INVALIDO', () => {
    expect(avaliar('invalido-corrompido')).toBe('CERTIFICADO_CONTEINER_INVALIDO');
    expect(abrirPkcs12(Buffer.from('isto não é um pkcs12'), 'x', raizes, AGORA)).toEqual({
      ok: false,
      codigo: 'CERTIFICADO_CONTEINER_INVALIDO',
    });
    expect(abrirPkcs12(Buffer.alloc(0), 'x', raizes, AGORA).ok).toBe(false);
  });

  it('um PEM de certificado (sem contêiner) não é PKCS#12', () => {
    const pki = criarPki({ agora: AGORA });
    const { certificadoPem } = emitirPfx(pki, {}) as { certificadoPem: string };

    expect(abrirPkcs12(Buffer.from(certificadoPem), 'x', raizes, AGORA).ok).toBe(false);
  });

  it('o aceite não depende de a raiz do PFX ser a do diretório: confia só no diretório', () => {
    const pkiOutra = criarPki({ agora: AGORA });
    const { pfx, senha } = emitirPfx(pkiOutra, { incluirRaiz: true }) as Pfx;
    const aberto = abrirPkcs12(pfx, senha, raizes, AGORA);

    expect(aberto.ok && aberto.extraido.cadeiaIcpValidada).toBe(false);
  });

  it('autoridade da cadeia vencida invalida a cadeia', () => {
    const pki = criarPki({ agora: AGORA });
    const { pfx, senha } = emitirPfx(pki, {}) as Pfx;
    const daqui20Anos = new Date(AGORA.getTime() + 21 * 365 * 24 * 3600 * 1000);
    const aberto = abrirPkcs12(pfx, senha, [forge.pki.certificateFromPem(raizConfiavelEmPem(pki) as string)], daqui20Anos);

    expect(aberto.ok && aberto.extraido.cadeiaIcpValidada).toBe(false);
  });
});

describe('limite defensivo de iterações do KDF', () => {
  const sequencia = (iteracoes: number): forge.asn1.Asn1 =>
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, 'saltsalt'),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.asn1.integerToDer(iteracoes).getBytes()),
    ]);

  it('lê a contagem declarada em parâmetros de PBE/MAC, mesmo aninhados', () => {
    const aninhado = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      sequencia(2048),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [sequencia(9_999_999)]),
    ]);

    expect(maiorIteracaoDeclarada(aninhado)).toBe(9_999_999);
  });

  it('entra em OCTET STRING que carrega DER (conteúdo do authSafe)', () => {
    const interno = forge.asn1.toDer(sequencia(5_000_000)).getBytes();
    const externo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, interno),
    ]);

    expect(maiorIteracaoDeclarada(externo)).toBe(5_000_000);
  });

  it('recusa PFX cujo MAC declara iterações acima do teto sem tentar derivar a chave', () => {
    const pki = criarPki({ agora: AGORA });
    const chaves = pki.chavesDoTitular as { privateKey: forge.pki.rsa.PrivateKey };
    const { pfx } = emitirPfx(pki, {}) as Pfx;
    const raiz = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    // macData é o 3º filho do PFX: SEQUENCE { DigestInfo, salt, iterations }.
    const macData = (raiz.value as forge.asn1.Asn1[])[2]!;
    (macData.value as forge.asn1.Asn1[])[2] = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.INTEGER,
      false,
      forge.asn1.integerToDer(MAXIMO_DE_ITERACOES + 1).getBytes(),
    );
    const adulterado = Buffer.from(forge.asn1.toDer(raiz).getBytes(), 'binary');

    expect(chaves.privateKey).toBeDefined();
    expect(abrirPkcs12(adulterado, SENHA_PADRAO_DE_TESTE, raizes, AGORA)).toEqual({
      ok: false,
      codigo: 'CERTIFICADO_CONTEINER_INVALIDO',
    });
  });
});
