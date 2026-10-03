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
import { abrirNoTrabalhador, type ChavePublica, type OpcoesDoTrabalho } from './pkcs12-trabalho.js';

const PROFUNDIDADE_DA_CADEIA = 8;

const OID_CNPJ_DO_TITULAR = '2.16.76.1.3.3';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_CERTIFICATE_POLICIES = '2.5.29.32';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';

/** Metadados do cofre: os de contrato mais TODOS os CNPJs do SubjectAltName. */
export type MetadadosDoCofre = MetadadosExtraidos & Readonly<{ cnpjsDoTitular: readonly string[] }>;

export type ResultadoDaAbertura =
  | Readonly<{ ok: true; extraido: CertificadoExtraido; metadados: MetadadosDoCofre }>
  | Readonly<{
      ok: false;
      codigo: 'CERTIFICADO_CONTEINER_INVALIDO' | 'CERTIFICADO_SENHA_INCORRETA';
    }>;

const conteinerInvalido = { ok: false, codigo: 'CERTIFICADO_CONTEINER_INVALIDO' } as const;
const senhaIncorreta = { ok: false, codigo: 'CERTIFICADO_SENHA_INCORRETA' } as const;

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

const mesmaChave = (cert: forge.pki.Certificate, chave: ChavePublica): boolean => {
  const publica = cert.publicKey as Partial<forge.pki.rsa.PublicKey>;
  return publica.n?.toString(16) === chave.n && publica.e?.toString(16) === chave.e;
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
  cadeia: readonly [forge.pki.Certificate, ...forge.pki.Certificate[]],
  raizes: readonly forge.pki.Certificate[],
  agora: Date,
): boolean => {
  if (raizes.length === 0) return false;
  try {
    // A vigência do titular é decisão do domínio (data civil); aqui só as autoridades.
    const confere = forge.pki.verifyCertificateChain(forge.pki.createCaStore([...raizes]), [...cadeia], {
      validityCheckDate: null,
    });
    if (!confere) return false;

    const autoridades = cadeia.slice(1);
    const raizUsada = raizes.find((r) => ultimoDa(cadeia).isIssuer(r));
    return [...autoridades, ...(raizUsada ? [raizUsada] : [])].every((c) => vigenteEm(c, agora));
  } catch {
    return false;
  }
};

const ultimoDa = (
  cadeia: readonly [forge.pki.Certificate, ...forge.pki.Certificate[]],
): forge.pki.Certificate => cadeia[cadeia.length - 1] ?? cadeia[0];

/**
 * Abre o PFX e extrai os fatos. Não lança: todo defeito vira código estável.
 * `agora` só entra na checagem de vigência das autoridades. A parte cara e perigosa
 * (ASN.1, KDF) roda num worker com prazo; aqui só se monta o que o worker devolveu.
 */
export const abrirPkcs12 = async (
  bytes: Uint8Array,
  senha: string,
  raizes: readonly forge.pki.Certificate[],
  agora: Date,
  opcoes: OpcoesDoTrabalho = {},
): Promise<ResultadoDaAbertura> => {
  const aberto = await abrirNoTrabalhador(bytes, senha, opcoes);
  if (!aberto.ok) return aberto.motivo === 'SENHA' ? senhaIncorreta : conteinerInvalido;

  try {
    const certificados = aberto.conteudo.certificados.map((der) =>
      forge.pki.certificateFromAsn1(forge.asn1.fromDer(Buffer.from(der).toString('binary'))),
    );
    const { chaves } = aberto.conteudo;

    const titular =
      certificados.find((c) => chaves.some((k) => mesmaChave(c, k))) ??
      certificados.find((c) => !certificados.some((outro) => outro !== c && outro.isIssuer(c))) ??
      certificados[0];
    if (titular === undefined) return conteinerInvalido;

    const possuiChavePrivada = chaves.some((k) => mesmaChave(titular, k));
    const intermediarias = intermediariasDe(titular, certificados);
    const cadeia: readonly [forge.pki.Certificate, ...forge.pki.Certificate[]] = [titular, ...intermediarias];

    const cnpjsDoTitular = cnpjsDoTitularDe(titular);
    const emissorDaCadeia = raizes.find((r) => ultimoDa(cadeia).isIssuer(r));

    return {
      ok: true,
      extraido: {
        cnpjsDoTitular,
        oidsDePoliticas: politicasDe(titular),
        ehAutoridade: ehAutoridadeDe(titular),
        permiteAssinaturaDigital: permiteAssinaturaDe(titular),
        cadeiaIcpValidada: cadeiaConfiavel(cadeia, raizes, agora),
        possuiChavePrivada,
        naoAntes: titular.validity.notBefore,
        naoDepois: titular.validity.notAfter,
      },
      metadados: {
        titular: titularLegivel(nomeComum(titular.subject.attributes)),
        cnpjTitular: cnpjsDoTitular[0] ?? '',
        cnpjsDoTitular,
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
    // Estrutura interna malformada: contêiner inválido, sem detalhe do motivo.
    return conteinerInvalido;
  }
};
