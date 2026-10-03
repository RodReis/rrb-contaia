/**
 * Abertura do PKCS#12 EM MEMÓRIA e extração dos metadados (SPEC-011 §3.1, §6.2).
 *
 * Esta camada só faz criptografia: abre o contêiner, valida a cadeia contra as
 * raízes configuradas e entrega fatos ao domínio (`avaliarCertificado` decide).
 * Nada vai a disco e nenhum erro carrega bytes, senha ou chave.
 */
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import type { CertificadoExtraido } from '@contaia/domain';
import type { MetadadosExtraidos } from '@contaia/shared';

/**
 * Teto de iterações de KDF aceitas no contêiner. Cada iteração custa CPU síncrona
 * no processo do cofre; um PFX que declare milhões é ataque de negação de serviço.
 * Certificados reais usam de 2.048 a 100.000.
 * ponytail: sem limite de tempo além deste teto (forge é síncrono); mover o parse
 * para um worker com timeout se o teto passar a ser insuficiente.
 */
export const MAXIMO_DE_ITERACOES = 250_000;
/** Descida máxima na árvore ASN.1 (parâmetros de PBE ficam a ~10 níveis; abaixo disso é interior de certificado) e subida na cadeia. */
const PROFUNDIDADE_DO_ASN1 = 14;
const PROFUNDIDADE_DA_CADEIA = 8;

const OID_CNPJ_DO_TITULAR = '2.16.76.1.3.3';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_CERTIFICATE_POLICIES = '2.5.29.32';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';

export type ResultadoDaAbertura =
  | Readonly<{ ok: true; extraido: CertificadoExtraido; metadados: MetadadosExtraidos }>
  | Readonly<{
      ok: false;
      codigo: 'CERTIFICADO_CONTEINER_INVALIDO' | 'CERTIFICADO_SENHA_INCORRETA';
    }>;

const conteinerInvalido = { ok: false, codigo: 'CERTIFICADO_CONTEINER_INVALIDO' } as const;
const senhaIncorreta = { ok: false, codigo: 'CERTIFICADO_SENHA_INCORRETA' } as const;

const inteiro = (no: forge.asn1.Asn1): number => {
  if (typeof no.value !== 'string') return Number.POSITIVE_INFINITY;
  const hex = forge.util.bytesToHex(no.value);
  return hex.length > 8 ? Number.POSITIVE_INFINITY : parseInt(hex || '0', 16);
};

/**
 * Maior contagem de iterações declarada em qualquer parâmetro de PBE/PBKDF2/MAC:
 * toda SEQUENCE em que um OCTET STRING (sal) é seguido de um INTEGER. Entra nos
 * OCTET STRING que parecem DER (o conteúdo dos `data` do PFX).
 */
export const maiorIteracaoDeclarada = (no: forge.asn1.Asn1, profundidade = 0): number => {
  if (profundidade > PROFUNDIDADE_DO_ASN1) return 0;
  const { asn1 } = forge;

  if (Array.isArray(no.value)) {
    let maior = 0;
    const filhos = no.value;
    filhos.forEach((filho, i) => {
      const proximo = filhos[i + 1];
      if (
        filho.type === asn1.Type.OCTETSTRING &&
        filho.tagClass === asn1.Class.UNIVERSAL &&
        proximo?.type === asn1.Type.INTEGER
      ) {
        maior = Math.max(maior, inteiro(proximo));
      }
      maior = Math.max(maior, maiorIteracaoDeclarada(filho, profundidade + 1));
    });
    return maior;
  }

  if (no.type === asn1.Type.OCTETSTRING && typeof no.value === 'string' && no.value.charCodeAt(0) === 0x30) {
    try {
      return maiorIteracaoDeclarada(asn1.fromDer(no.value, false), profundidade + 1);
    } catch {
      return 0;
    }
  }

  return 0;
};

const textoDoOid = (no: forge.asn1.Asn1): string =>
  forge.asn1.derToOid(typeof no.value === 'string' ? no.value : '');

const extensao = (cert: forge.pki.Certificate, id: string): string | null => {
  const encontrada = (cert.extensions as { id: string; value: unknown }[]).find((e) => e.id === id);
  return typeof encontrada?.value === 'string' ? encontrada.value : null;
};

/** OIDs de `certificatePolicies` (a política ICP-Brasil distingue A1 de A3). */
const politicasDe = (cert: forge.pki.Certificate): string[] => {
  const bruto = extensao(cert, OID_CERTIFICATE_POLICIES);
  if (bruto === null) return [];

  const raiz = forge.asn1.fromDer(bruto);
  if (!Array.isArray(raiz.value)) return [];

  return raiz.value.flatMap((politica) => {
    const primeiro = Array.isArray(politica.value) ? politica.value[0] : undefined;
    return primeiro?.type === forge.asn1.Type.OID ? [textoDoOid(primeiro)] : [];
  });
};

/** CNPJs do `otherName` 2.16.76.1.3.3 do SubjectAltName (e-CNPJ ICP-Brasil). */
const cnpjsDoTitularDe = (cert: forge.pki.Certificate): string[] => {
  const bruto = extensao(cert, OID_SUBJECT_ALT_NAME);
  if (bruto === null) return [];

  const raiz = forge.asn1.fromDer(bruto);
  if (!Array.isArray(raiz.value)) return [];

  return raiz.value.flatMap((nome) => {
    // [0] otherName ::= SEQUENCE { type-id OID, value [0] EXPLICIT ANY }
    if (nome.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || nome.type !== 0) return [];
    if (!Array.isArray(nome.value) || nome.value.length < 2) return [];
    const [oid, explicito] = nome.value as [forge.asn1.Asn1, forge.asn1.Asn1];
    if (oid.type !== forge.asn1.Type.OID || textoDoOid(oid) !== OID_CNPJ_DO_TITULAR) return [];
    const texto = Array.isArray(explicito.value) ? explicito.value[0] : undefined;
    return typeof texto?.value === 'string' ? [forge.util.decodeUtf8(texto.value).trim()] : [];
  });
};

const ehAutoridadeDe = (cert: forge.pki.Certificate): boolean => {
  const bruto = extensao(cert, OID_BASIC_CONSTRAINTS);
  if (bruto === null) return false;
  const raiz = forge.asn1.fromDer(bruto);
  const primeiro = Array.isArray(raiz.value) ? raiz.value[0] : undefined;
  return primeiro?.type === forge.asn1.Type.BOOLEAN && typeof primeiro.value === 'string'
    ? primeiro.value.charCodeAt(0) !== 0
    : false;
};

/** Sem `keyUsage` a extensão não restringe; com ela, exige `digitalSignature` (bit 0). */
const permiteAssinaturaDe = (cert: forge.pki.Certificate): boolean => {
  const bruto = extensao(cert, OID_KEY_USAGE);
  if (bruto === null) return true;
  const bits = forge.asn1.fromDer(bruto);
  return typeof bits.value === 'string' && bits.value.length > 1
    ? (bits.value.charCodeAt(1) & 0x80) === 0x80
    : false;
};

const nomeComum = (atributos: forge.pki.CertificateField[]): string =>
  String(atributos.find((a) => a.shortName === 'CN' || a.name === 'commonName')?.value ?? '');

/** O CN do e-CNPJ vem como `RAZAO SOCIAL:CNPJ`; a tela mostra só o nome. */
const titularLegivel = (cn: string): string => cn.replace(/:[0-9A-Z]{14}$/i, '').trim();

const mesmaChave = (cert: forge.pki.Certificate, chave: forge.pki.rsa.PrivateKey): boolean => {
  const publica = cert.publicKey as forge.pki.rsa.PublicKey;
  return publica.n?.compareTo(chave.n) === 0 && publica.e?.compareTo(chave.e) === 0;
};

const vigenteEm = (cert: forge.pki.Certificate, agora: Date): boolean =>
  cert.validity.notBefore <= agora && agora <= cert.validity.notAfter;

/** Sobe do titular até uma autoridade que não seja ela mesma raiz do próprio PFX. */
const intermediariasDe = (
  titular: forge.pki.Certificate,
  todos: readonly forge.pki.Certificate[],
): forge.pki.Certificate[] => {
  const cadeia: forge.pki.Certificate[] = [];
  let atual = titular;

  for (let i = 0; i < PROFUNDIDADE_DA_CADEIA; i++) {
    const emissor = todos.find((c) => {
      if (c === atual || !atual.isIssuer(c)) return false;
      try {
        return c.verify(atual);
      } catch {
        return false;
      }
    });
    // Autoassinado (raiz embutida no PFX) não conta: a confiança vem só do diretório de raízes.
    if (emissor === undefined || emissor.isIssuer(emissor)) break;
    cadeia.push(emissor);
    atual = emissor;
  }

  return cadeia;
};

const cadeiaConfiavel = (
  cadeia: forge.pki.Certificate[],
  raizes: readonly forge.pki.Certificate[],
  agora: Date,
): boolean => {
  if (raizes.length === 0) return false;
  try {
    // A vigência do titular é decisão do domínio (data civil); aqui só as autoridades.
    const confere = forge.pki.verifyCertificateChain(forge.pki.createCaStore([...raizes]), cadeia, {
      validityCheckDate: null,
    });
    if (!confere) return false;

    const autoridades = cadeia.slice(1);
    const raizUsada = raizes.find((r) => (cadeia.at(-1) ?? cadeia[0])!.isIssuer(r));
    return [...autoridades, ...(raizUsada ? [raizUsada] : [])].every((c) => vigenteEm(c, agora));
  } catch {
    return false;
  }
};

const mensagemDeSenhaIncorreta = (erro: unknown): boolean =>
  erro instanceof Error && /invalid password|MAC could not be verified/i.test(erro.message);

/**
 * Abre o PFX e extrai os fatos. Não lança: todo defeito vira código estável.
 * `agora` só entra na checagem de vigência das autoridades.
 */
export const abrirPkcs12 = (
  bytes: Uint8Array,
  senha: string,
  raizes: readonly forge.pki.Certificate[],
  agora: Date,
): ResultadoDaAbertura => {
  let p12: forge.pkcs12.Pkcs12Pfx;

  try {
    const raiz = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(bytes).toString('binary')));
    if (maiorIteracaoDeclarada(raiz) > MAXIMO_DE_ITERACOES) return conteinerInvalido;
    p12 = forge.pkcs12.pkcs12FromAsn1(raiz, false, senha);
  } catch (erro) {
    return mensagemDeSenhaIncorreta(erro) ? senhaIncorreta : conteinerInvalido;
  }

  try {
    const certificados = (p12.getBags({ bagType: forge.pki.oids['certBag']! })[forge.pki.oids['certBag']!] ?? [])
      .map((bag) => bag.cert)
      .filter((c): c is forge.pki.Certificate => c !== undefined);
    const chaves = [forge.pki.oids['pkcs8ShroudedKeyBag']!, forge.pki.oids['keyBag']!]
      .flatMap((tipo) => p12.getBags({ bagType: tipo })[tipo] ?? [])
      .map((bag) => bag.key)
      .filter((k): k is forge.pki.rsa.PrivateKey => k !== undefined && k !== null);

    if (certificados.length === 0) return conteinerInvalido;

    const titular =
      certificados.find((c) => chaves.some((k) => mesmaChave(c, k))) ??
      certificados.find((c) => !certificados.some((outro) => outro !== c && outro.isIssuer(c))) ??
      certificados[0]!;
    const possuiChavePrivada = chaves.some((k) => mesmaChave(titular, k));
    const cadeia = [titular, ...intermediariasDe(titular, certificados)];

    const nomeDoTitular = nomeComum(titular.subject.attributes);
    const cnpjsDoTitular = cnpjsDoTitularDe(titular);
    const cadeiaIcpValidada = cadeiaConfiavel(cadeia, raizes, agora);
    const emissorDaCadeia = raizes.find((r) => cadeia.at(-1)!.isIssuer(r));

    return {
      ok: true,
      extraido: {
        cnpjsDoTitular,
        oidsDePoliticas: politicasDe(titular),
        ehAutoridade: ehAutoridadeDe(titular),
        permiteAssinaturaDigital: permiteAssinaturaDe(titular),
        cadeiaIcpValidada,
        possuiChavePrivada,
        naoAntes: titular.validity.notBefore,
        naoDepois: titular.validity.notAfter,
      },
      metadados: {
        titular: titularLegivel(nomeDoTitular),
        cnpjTitular: cnpjsDoTitular[0] ?? '',
        autoridadeCertificadora: nomeComum(titular.issuer.attributes),
        cadeia: [
          ...cadeia.map((c) => nomeComum(c.subject.attributes)),
          ...(emissorDaCadeia ? [nomeComum(emissorDaCadeia.subject.attributes)] : []),
        ],
        numeroSerie: titular.serialNumber.toUpperCase(),
        impressaoDigital: createHash('sha256')
          .update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(titular)).getBytes(), 'binary'))
          .digest('hex')
          .toUpperCase(),
        naoAntes: titular.validity.notBefore.toISOString(),
        naoDepois: titular.validity.notAfter.toISOString(),
      },
    };
  } catch {
    // Estrutura ASN.1 interna malformada: contêiner inválido, sem detalhe do motivo.
    return conteinerInvalido;
  }
};
