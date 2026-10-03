#!/usr/bin/env node
/**
 * PKI SINTÉTICA de teste para o cofre de certificados A1 (SPEC-011 / F11).
 *
 * Cria "AC Raiz de Teste ContaIA" + "AC Intermediária de Teste ContaIA" e emite
 * e-CNPJ A1 de teste (política ICP-Brasil `2.16.76.1.2.1.1`, otherName
 * `2.16.76.1.3.3` com o CNPJ) e as variações inválidas que as provas exigem.
 *
 * Nada aqui é ICP-Brasil real: a raiz é gerada a cada execução e só vale onde
 * for colocada em `COFRE_RAIZES_ICP_DIR`. Chave, PFX e raiz NUNCA são versionados
 * (o `.gitignore` já cobre `*.pfx`, `*.p12`, `*.pem`, `*.key`); o diretório de
 * saída padrão é `infra/docker/.vault-local/`, também ignorado.
 *
 * uso: node scripts/gerar-pki-de-teste.mjs [--cnpj 11222333000181] [--saida <dir>]
 *      (ou `pnpm cofre:pki-teste`)
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const { pki, asn1 } = forge;

export const OID = Object.freeze({
  cnpjDoTitular: '2.16.76.1.3.3',
  cpfDoTitular: '2.16.76.1.3.1',
  politicaA1: '2.16.76.1.2.1.1',
  politicaA3: '2.16.76.1.2.3.1',
  subjectAltName: '2.5.29.17',
  certificatePolicies: '2.5.29.32',
});

export const SENHA_PADRAO_DE_TESTE = 'senha-de-teste-pki';
export const CNPJ_PADRAO_DE_TESTE = '11222333000181';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Chave RSA do Node (rápida) convertida para o formato do forge. */
const gerarChave = (bits = 2048) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  const privada = pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }));
  return { privateKey: privada, publicKey: pki.rsa.setPublicKey(privada.n, privada.e) };
};

const numeroDeSerie = () => `01${randomBytes(15).toString('hex')}`;

const oidParaAsn1 = (oid) =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes());

const extensaoDePolitica = (oidDaPolitica) => ({
  id: OID.certificatePolicies,
  name: 'certificatePolicies',
  value: asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [oidParaAsn1(oidDaPolitica)]),
  ]),
});

/** SubjectAltName com um `otherName` ICP-Brasil (CNPJ no e-CNPJ, dados do titular no e-CPF). */
const extensaoDeSan = (oidDoOtherName, valor) => ({
  id: OID.subjectAltName,
  name: 'subjectAltName',
  value: asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      oidParaAsn1(oidDoOtherName),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, forge.util.encodeUtf8(valor)),
      ]),
    ]),
  ]),
});

const atributos = (nome) => [
  { name: 'countryName', value: 'BR' },
  { name: 'organizationName', value: 'ICP-Brasil (TESTE ContaIA)' },
  { name: 'commonName', value: nome },
];

const assinar = ({ assunto, emissor, chavePublica, chaveDoEmissor, naoAntes, naoDepois, extensoes }) => {
  const cert = pki.createCertificate();
  cert.publicKey = chavePublica;
  cert.serialNumber = numeroDeSerie();
  cert.validity.notBefore = naoAntes;
  cert.validity.notAfter = naoDepois;
  cert.setSubject(assunto);
  cert.setIssuer(emissor);
  cert.setExtensions(extensoes);
  cert.sign(chaveDoEmissor, forge.md.sha256.create());
  return cert;
};

const criarAutoridade = ({ nome, emissor, agora, chaveDoEmissor }) => {
  const chaves = gerarChave();
  const assunto = atributos(nome);
  const cert = assinar({
    assunto,
    emissor: emissor ?? assunto,
    chavePublica: chaves.publicKey,
    chaveDoEmissor: chaveDoEmissor ?? chaves.privateKey,
    naoAntes: new Date(agora.getTime() - 5 * 365 * DIA_MS),
    naoDepois: new Date(agora.getTime() + 20 * 365 * DIA_MS),
    extensoes: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
  return { cert, chaves };
};

/**
 * Cria duas hierarquias independentes: a CONFIÁVEL (raiz + intermediária, a raiz
 * é a que vai para o cofre) e a DESCONHECIDA (usada na variação "cadeia fora da
 * raiz confiável"). As chaves do titular são reaproveitadas entre variações.
 */
export const criarPki = ({ agora = new Date() } = {}) => {
  const montar = (rotulo) => {
    const raiz = criarAutoridade({ nome: `AC Raiz de Teste ContaIA${rotulo}`, agora });
    const intermediaria = criarAutoridade({
      nome: `AC Intermediaria de Teste ContaIA${rotulo}`,
      emissor: raiz.cert.subject.attributes,
      chaveDoEmissor: raiz.chaves.privateKey,
      agora,
    });
    return { raiz, intermediaria };
  };

  return {
    agora,
    confiavel: montar(''),
    desconhecida: montar(' (nao confiavel)'),
    chavesDoTitular: gerarChave(),
  };
};

/**
 * @typedef {object} OpcoesDoCertificado
 * @property {string} [cnpj]            CNPJ no otherName `2.16.76.1.3.3` (padrão: CNPJ de teste).
 * @property {'E_CNPJ_A1'|'E_CNPJ_A3'|'E_CPF_A1'} [tipo]
 * @property {'confiavel'|'desconhecida'} [hierarquia]
 * @property {Date} [naoAntes]
 * @property {Date} [naoDepois]
 * @property {string} [senha]
 * @property {'3des'|'aes256'} [algoritmo]
 * @property {boolean} [incluirRaiz]    Inclui a raiz no PFX (padrão: só titular + intermediária).
 * @property {boolean} [semChavePrivada]
 * @property {boolean} [ehAutoridade]   Emite o titular com `basicConstraints.cA = true`.
 * @property {string} [nome]
 */

/** Emite um PFX de teste. Devolve `{ pfx: Buffer, senha, certificadoPem }`. */
export const emitirPfx = (pkiDeTeste, opcoes = {}) => {
  const {
    cnpj = CNPJ_PADRAO_DE_TESTE,
    tipo = 'E_CNPJ_A1',
    hierarquia = 'confiavel',
    naoAntes = new Date(pkiDeTeste.agora.getTime() - 30 * DIA_MS),
    naoDepois = new Date(pkiDeTeste.agora.getTime() + 365 * DIA_MS),
    senha = SENHA_PADRAO_DE_TESTE,
    algoritmo = '3des',
    incluirRaiz = false,
    semChavePrivada = false,
    ehAutoridade = false,
    nome = `EMPRESA DE TESTE LTDA:${cnpj}`,
  } = opcoes;

  const { raiz, intermediaria } = pkiDeTeste[hierarquia];
  const { privateKey, publicKey } = pkiDeTeste.chavesDoTitular;

  const san =
    tipo === 'E_CPF_A1'
      ? extensaoDeSan(OID.cpfDoTitular, `01011980${'12345678909'}00000000000000000000000`)
      : extensaoDeSan(OID.cnpjDoTitular, cnpj);

  const titular = assinar({
    assunto: atributos(nome),
    emissor: intermediaria.cert.subject.attributes,
    chavePublica: publicKey,
    chaveDoEmissor: intermediaria.chaves.privateKey,
    naoAntes,
    naoDepois,
    extensoes: [
      { name: 'basicConstraints', cA: ehAutoridade },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
      extensaoDePolitica(tipo === 'E_CNPJ_A3' ? OID.politicaA3 : OID.politicaA1),
      san,
    ],
  });

  const cadeia = [titular, intermediaria.cert, ...(incluirRaiz ? [raiz.cert] : [])];
  const chave = semChavePrivada ? null : privateKey;
  const p12 = forge.pkcs12.toPkcs12Asn1(chave, cadeia, senha, { algorithm: algoritmo });
  const pfx = Buffer.from(asn1.toDer(p12).getBytes(), 'binary');

  return { pfx, senha, certificadoPem: pki.certificateToPem(titular) };
};

/** PEM da raiz que o cofre deve confiar (`COFRE_RAIZES_ICP_DIR`). */
export const raizConfiavelEmPem = (pkiDeTeste) => pki.certificateToPem(pkiDeTeste.confiavel.raiz.cert);

/** Conjunto nomeado de PFXs: o válido e uma variação inválida por motivo de recusa. */
export const gerarConjuntoDeTeste = (pkiDeTeste, { cnpj = CNPJ_PADRAO_DE_TESTE } = {}) => {
  const { agora } = pkiDeTeste;
  const antes = (dias) => new Date(agora.getTime() - dias * DIA_MS);
  const depois = (dias) => new Date(agora.getTime() + dias * DIA_MS);
  const outroCnpj = cnpj === '45723174000110' ? '11222333000181' : '45723174000110';

  const pfx = emitirPfx(pkiDeTeste, { cnpj });
  const corrompido = Buffer.from(pfx.pfx.subarray(0, Math.floor(pfx.pfx.length / 2)));

  return {
    'valido-e-cnpj-a1': pfx,
    'valido-aes256': emitirPfx(pkiDeTeste, { cnpj, algoritmo: 'aes256' }),
    'valido-com-raiz-no-pfx': emitirPfx(pkiDeTeste, { cnpj, incluirRaiz: true }),
    'invalido-a3': emitirPfx(pkiDeTeste, { cnpj, tipo: 'E_CNPJ_A3' }),
    'invalido-e-cpf': emitirPfx(pkiDeTeste, { cnpj, tipo: 'E_CPF_A1' }),
    'invalido-cadeia-desconhecida': emitirPfx(pkiDeTeste, { cnpj, hierarquia: 'desconhecida' }),
    'invalido-expirado': emitirPfx(pkiDeTeste, { cnpj, naoAntes: antes(400), naoDepois: antes(35) }),
    'invalido-ainda-nao-vigente': emitirPfx(pkiDeTeste, { cnpj, naoAntes: depois(10), naoDepois: depois(375) }),
    'invalido-cnpj-diferente': emitirPfx(pkiDeTeste, { cnpj: outroCnpj }),
    'invalido-sem-chave-privada': emitirPfx(pkiDeTeste, { cnpj, semChavePrivada: true }),
    'invalido-titular-e-autoridade': emitirPfx(pkiDeTeste, { cnpj, ehAutoridade: true }),
    'invalido-corrompido': { pfx: corrompido, senha: SENHA_PADRAO_DE_TESTE },
  };
};

const lerArgumento = (nome, padrao) => {
  const indice = process.argv.indexOf(`--${nome}`);
  return indice > 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao;
};

const executarComoCli = async () => {
  const raizDoRepo = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const saida = resolve(lerArgumento('saida', join(raizDoRepo, 'infra/docker/.vault-local')));
  const cnpj = lerArgumento('cnpj', CNPJ_PADRAO_DE_TESTE);

  const pkiDeTeste = criarPki();
  const pastaDasRaizes = join(saida, 'raizes-icp');
  const pastaDosPfx = join(saida, 'pki-teste');
  await mkdir(pastaDasRaizes, { recursive: true });
  await mkdir(pastaDosPfx, { recursive: true });

  await writeFile(join(pastaDasRaizes, 'ac-raiz-de-teste-contaia.pem'), raizConfiavelEmPem(pkiDeTeste));
  for (const [nomeDoArquivo, { pfx }] of Object.entries(gerarConjuntoDeTeste(pkiDeTeste, { cnpj }))) {
    await writeFile(join(pastaDosPfx, `${nomeDoArquivo}.pfx`), pfx);
  }

  console.warn(`PKI de teste gerada em ${saida}`);
  console.warn(`  raiz confiável : ${join(pastaDasRaizes, 'ac-raiz-de-teste-contaia.pem')}`);
  console.warn(`  PFXs de teste  : ${pastaDosPfx} (CNPJ ${cnpj}, senha "${SENHA_PADRAO_DE_TESTE}")`);
  console.warn('  Material sintético; nunca versionar.');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await executarComoCli();
}
