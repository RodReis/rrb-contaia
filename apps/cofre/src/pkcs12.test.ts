import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';
import { avaliarCertificado } from '@contaia/domain';
import {
  CNPJ_PADRAO_DE_TESTE,
  criarPki,
  emitirPfx,
  gerarConjuntoDeTeste,
  raizConfiavelEmPem,
} from '../../../scripts/gerar-pki-de-teste.mjs';
import { abrirPkcs12 } from './pkcs12.js';
import { MAXIMO_DA_SOMA_DE_ITERACOES, MAXIMO_DE_ITERACOES } from './pkcs12-trabalho.js';

type Pfx = { pfx: Buffer; senha: string };

const AGORA = new Date();
let conjunto: Record<string, Pfx>;
let raizes: forge.pki.Certificate[];

beforeAll(() => {
  const pki = criarPki({ agora: AGORA });
  conjunto = gerarConjuntoDeTeste(pki, { cnpj: CNPJ_PADRAO_DE_TESTE }) as Record<string, Pfx>;
  raizes = [forge.pki.certificateFromPem(raizConfiavelEmPem(pki) as string)];
});

const avaliar = async (nome: string, senha?: string) => {
  const item = conjunto[nome]!;
  const aberto = await abrirPkcs12(item.pfx, senha ?? item.senha, raizes, AGORA);
  if (!aberto.ok) return aberto.codigo;
  const avaliacao = avaliarCertificado(aberto.extraido, { cnpjDaEmpresa: CNPJ_PADRAO_DE_TESTE, agora: AGORA });
  return avaliacao.ok ? 'ACEITO' : avaliacao.codigo;
};

describe('abrirPkcs12 + avaliarCertificado com PKI sintética', () => {
  it('aceita e-CNPJ A1 válido (3DES e AES-256, com ou sem raiz embutida)', async () => {
    expect(await avaliar('valido-e-cnpj-a1')).toBe('ACEITO');
    expect(await avaliar('valido-aes256')).toBe('ACEITO');
    expect(await avaliar('valido-com-raiz-no-pfx')).toBe('ACEITO');
  });

  it('extrai metadados sem conteúdo criptográfico', async () => {
    const item = conjunto['valido-e-cnpj-a1']!;
    const aberto = await abrirPkcs12(item.pfx, item.senha, raizes, AGORA);

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
    expect(aberto.metadados.cnpjsDoTitular).toEqual([CNPJ_PADRAO_DE_TESTE]);
    expect(Object.keys(aberto.metadados).sort()).toEqual([
      'autoridadeCertificadora',
      'cadeia',
      'cnpjTitular',
      'cnpjsDoTitular',
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
  ])('%s é recusado com %s', async (nome, codigo) => {
    expect(await avaliar(nome)).toBe(codigo);
  });

  it('sem nenhuma raiz configurada nada é aceito', async () => {
    const item = conjunto['valido-e-cnpj-a1']!;
    const aberto = await abrirPkcs12(item.pfx, item.senha, [], AGORA);

    expect(aberto.ok && aberto.extraido.cadeiaIcpValidada).toBe(false);
  });

  it.each(['valido-e-cnpj-a1', 'valido-aes256'])('senha errada em %s vira SENHA_INCORRETA', async (nome) => {
    expect(await avaliar(nome, 'senha-errada')).toBe('CERTIFICADO_SENHA_INCORRETA');
  });

  it('PFX truncado, lixo e bytes vazios viram CONTEINER_INVALIDO', async () => {
    expect(await avaliar('invalido-corrompido')).toBe('CERTIFICADO_CONTEINER_INVALIDO');
    expect(await abrirPkcs12(Buffer.from('isto não é um pkcs12'), 'x', raizes, AGORA)).toEqual({
      ok: false,
      codigo: 'CERTIFICADO_CONTEINER_INVALIDO',
    });
    expect((await abrirPkcs12(Buffer.alloc(0), 'x', raizes, AGORA)).ok).toBe(false);
  });

  it('um PEM de certificado (sem contêiner) não é PKCS#12', async () => {
    const pki = criarPki({ agora: AGORA });
    const { certificadoPem } = emitirPfx(pki, {}) as { certificadoPem: string };

    expect((await abrirPkcs12(Buffer.from(certificadoPem), 'x', raizes, AGORA)).ok).toBe(false);
  });

  it('o aceite não depende de a raiz do PFX ser a do diretório: confia só no diretório', async () => {
    const pkiOutra = criarPki({ agora: AGORA });
    const { pfx, senha } = emitirPfx(pkiOutra, { incluirRaiz: true }) as Pfx;
    const aberto = await abrirPkcs12(pfx, senha, raizes, AGORA);

    expect(aberto.ok && aberto.extraido.cadeiaIcpValidada).toBe(false);
  });

  it('autoridade da cadeia vencida invalida a cadeia', async () => {
    const pki = criarPki({ agora: AGORA });
    const { pfx, senha } = emitirPfx(pki, {}) as Pfx;
    const daqui20Anos = new Date(AGORA.getTime() + 21 * 365 * 24 * 3600 * 1000);
    const aberto = await abrirPkcs12(pfx, senha, [forge.pki.certificateFromPem(raizConfiavelEmPem(pki) as string)], daqui20Anos);

    expect(aberto.ok && aberto.extraido.cadeiaIcpValidada).toBe(false);
  });
});


describe('abertura isolada e limites defensivos (worker com prazo)', () => {
  const { asn1, util } = forge;
  const octeto = (bytes: string, construido = false, filhos: forge.asn1.Asn1[] = []): forge.asn1.Asn1 =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, construido, construido ? filhos : bytes);

  /** PFX com `count` iterações de KDF declaradas no MAC e nos bags (gerado pelo próprio forge). */
  const pfxComIteracoes = (count: number, senha = 'pw'): forge.asn1.Asn1 => {
    const chaves = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = chaves.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 1e6);
    cert.validity.notAfter = new Date(Date.now() + 1e9);
    cert.setSubject([{ name: 'commonName', value: 'x' }]);
    cert.setIssuer([{ name: 'commonName', value: 'x' }]);
    cert.sign(chaves.privateKey);

    return forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, {
      count,
      algorithm: '3des',
      generateLocalKeyId: false,
    });
  };

  const comoBytes = (raiz: forge.asn1.Asn1): Buffer =>
    Buffer.from(asn1.toDer(raiz).getBytes(), 'binary');

  /** O PoC da revisão: authSafe como OCTET STRING construído (BER em pedaços). */
  const emPedacos = (raiz: forge.asn1.Asn1): forge.asn1.Asn1 => {
    const copia = asn1.fromDer(util.createBuffer(asn1.toDer(raiz).getBytes()));
    const authSafe = (copia.value as forge.asn1.Asn1[])[1] as forge.asn1.Asn1;
    const conteudo = (authSafe.value as forge.asn1.Asn1[])[1] as forge.asn1.Asn1;
    const original = (conteudo.value as forge.asn1.Asn1[])[0] as forge.asn1.Asn1;
    const bytes = original.value as string;
    (conteudo.value as forge.asn1.Asn1[])[0] = octeto('', true, [octeto(bytes.slice(0, 1)), octeto(bytes.slice(1))]);
    return copia;
  };

  it('PFX normal (count dentro do teto) abre', async () => {
    const aberto = await abrirPkcs12(comoBytes(pfxComIteracoes(2048)), 'pw', [], AGORA);

    expect(aberto.ok).toBe(true);
  });

  it('count acima do teto é recusado sem derivar a chave (e rápido)', async () => {
    const pfx = comoBytes(pfxComIteracoes(MAXIMO_DE_ITERACOES + 1));
    const inicio = Date.now();

    const resultado = await abrirPkcs12(pfx, 'pw', [], AGORA);

    expect(resultado).toEqual({ ok: false, codigo: 'CERTIFICADO_CONTEINER_INVALIDO' });
    expect(Date.now() - inicio).toBeLessThan(5000);
  });

  it('PoC da revisão: authSafe em pedaços (BER) com 1.000.000 de iterações NÃO contorna o teto', async () => {
    const pfx = comoBytes(emPedacos(pfxComIteracoes(1_000_000)));
    const inicio = Date.now();

    const resultado = await abrirPkcs12(pfx, 'pw', [], AGORA);

    expect(resultado).toEqual({ ok: false, codigo: 'CERTIFICADO_CONTEINER_INVALIDO' });
    expect(Date.now() - inicio).toBeLessThan(5000);
  });

  it('o mesmo PFX em pedaços, com count normal, continua abrindo (o forge aceita BER)', async () => {
    const resultado = await abrirPkcs12(comoBytes(emPedacos(pfxComIteracoes(2048))), 'pw', [], AGORA);

    expect(resultado.ok).toBe(true);
  });

  it('a SOMA das iterações também tem teto, mesmo com cada parâmetro abaixo do individual', async () => {
    // EncryptedData + shrouded key bag: dois parâmetros de MAXIMO_DE_ITERACOES passam do teto da soma.
    expect(MAXIMO_DE_ITERACOES * 2).toBeGreaterThan(MAXIMO_DA_SOMA_DE_ITERACOES);
    const pfx = comoBytes(pfxComIteracoes(MAXIMO_DE_ITERACOES));

    const resultado = await abrirPkcs12(pfx, 'pw', [], AGORA);

    expect(resultado).toEqual({ ok: false, codigo: 'CERTIFICADO_CONTEINER_INVALIDO' });
  });

  it('prazo estourado mata o worker e devolve contêiner inválido', async () => {
    const item = conjunto['valido-e-cnpj-a1']!;

    // 1 ms não dá nem para o worker subir.
    const resultado = await abrirPkcs12(item.pfx, item.senha, raizes, AGORA, { prazoMs: 1 });

    expect(resultado).toEqual({ ok: false, codigo: 'CERTIFICADO_CONTEINER_INVALIDO' });
  });

  it('o event loop do cofre continua girando enquanto o PFX é aberto', async () => {
    const pfx = comoBytes(pfxComIteracoes(100_000));
    let batidas = 0;
    const relogio = setInterval(() => batidas++, 5);

    const resultado = await abrirPkcs12(pfx, 'pw', [], AGORA);
    clearInterval(relogio);

    expect(resultado.ok).toBe(true);
    // A derivação síncrona de 100k iterações leva centenas de ms; no worker o intervalo segue batendo.
    expect(batidas).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it('ASN.1 profundamente aninhado é recusado, não derruba o processo', async () => {
    let no = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '');
    for (let i = 0; i < 5000; i++) no = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [no]);

    const resultado = await abrirPkcs12(comoBytes(no), 'pw', [], AGORA);

    expect(resultado.ok).toBe(false);
  });

  it('o worker não devolve a chave privada: só os certificados e os números públicos', async () => {
    const item = conjunto['valido-e-cnpj-a1']!;
    const { abrirNoTrabalhador } = await import('./pkcs12-trabalho.js');

    const resposta = await abrirNoTrabalhador(item.pfx, item.senha);

    expect(resposta.ok).toBe(true);
    if (!resposta.ok) return;
    expect(Object.keys(resposta.conteudo).sort()).toEqual(['certificados', 'chaves']);
    expect(Object.keys(resposta.conteudo.chaves[0] ?? {}).sort()).toEqual(['e', 'n']);
  });
});
