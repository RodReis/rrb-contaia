/**
 * Abertura do PKCS#12 num `worker_thread` com prazo (SPEC-011 §6.2).
 *
 * O node-forge é síncrono e o arquivo vem de fora: um PFX malicioso (KDF com milhões de
 * iterações, ASN.1 gigante ou aninhado, BER "em pedaços") travaria o event loop do cofre
 * inteiro. Por isso todo o trabalho caro — decodificar o ASN.1, auditar os parâmetros de KDF,
 * decifrar — roda num worker que o cofre MATA se passar do prazo. O worker devolve só fatos
 * públicos: os certificados (DER) e os números públicos (n, e) das chaves. A chave privada
 * nunca sai do worker.
 *
 * O código do worker é uma string `eval` (CommonJS) para funcionar igual em `dist/` e na
 * fonte `.ts` dos testes, sem arquivo extra para o `tsc` copiar.
 */
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

/** Teto de iterações de KDF em UM parâmetro. Certificados reais usam de 2.048 a 100.000. */
export const MAXIMO_DE_ITERACOES = 250_000;
/** Teto da SOMA das iterações de todos os parâmetros do contêiner (MAC + bags cifrados). */
export const MAXIMO_DA_SOMA_DE_ITERACOES = 400_000;
export const MAXIMO_DE_CONTENT_INFOS = 16;
export const MAXIMO_DE_BAGS = 64;
/** Nós ASN.1 visitados na auditoria (um PFX normal de 3 certificados tem ~1.500). */
export const MAXIMO_DE_NOS = 30_000;
export const PROFUNDIDADE_MAXIMA_DO_ASN1 = 40;
export const PRAZO_PADRAO_DA_ABERTURA_MS = 15_000;

export type ChavePublica = Readonly<{ n: string; e: string }>;

export type ConteudoAberto = Readonly<{
  /** Certificados do contêiner, em DER. */
  certificados: readonly Uint8Array[];
  /** Números públicos das chaves privadas presentes (a chave em si não sai do worker). */
  chaves: readonly ChavePublica[];
}>;

export type RespostaDoTrabalho =
  | Readonly<{ ok: true; conteudo: ConteudoAberto }>
  | Readonly<{ ok: false; motivo: 'SENHA' | 'INVALIDO' }>;

const CODIGO_DO_TRABALHADOR = `
const { parentPort, workerData } = require('node:worker_threads');
const forge = require(workerData.caminhoDoForge);
const { asn1, util, pki, pkcs12 } = forge;
const L = workerData.limites;

class Limite extends Error {}

let nos = 0;
let soma = 0;

// OCTET STRING BER pode vir "em pedaços" (construído): o forge o concatena antes de decodificar,
// então a auditoria tem de enxergar os mesmos bytes que ele.
const octetos = (no, prof) => {
  if (prof > L.profundidade) throw new Limite();
  if (typeof no.value === 'string') return no.value;
  if (!Array.isArray(no.value)) return '';
  let s = '';
  for (const filho of no.value) {
    if (++nos > L.nos) throw new Limite();
    s += octetos(filho, prof + 1);
  }
  return s;
};

const inteiro = (no) => {
  if (typeof no.value !== 'string') return Infinity;
  const hex = util.bytesToHex(no.value);
  return hex.length > 8 ? Infinity : parseInt(hex || '0', 16);
};

// Procura em qualquer SEQUENCE o par (OCTET STRING salt, INTEGER iterações) de PBE/PBKDF2/MAC.
const auditar = (no, prof) => {
  if (prof > L.profundidade || ++nos > L.nos) throw new Limite();

  // Primeiro o OCTET STRING (inclusive o construído, em pedaços): concatena como o forge faz.
  if (no.type === asn1.Type.OCTETSTRING && no.tagClass === asn1.Class.UNIVERSAL) {
    const bytes = octetos(no, prof);
    if (bytes.length > 0 && bytes.charCodeAt(0) === 0x30) {
      let interno;
      try { interno = asn1.fromDer(bytes, false); } catch { return; }
      auditar(interno, prof + 1);
    }
    return;
  }

  if (Array.isArray(no.value)) {
    no.value.forEach((filho, i) => {
      const proximo = no.value[i + 1];
      if (filho.type === asn1.Type.OCTETSTRING && filho.tagClass === asn1.Class.UNIVERSAL && proximo && proximo.type === asn1.Type.INTEGER) {
        const iteracoes = inteiro(proximo);
        soma += iteracoes;
        if (iteracoes > L.iteracoes || soma > L.soma) throw new Limite();
      }
      auditar(filho, prof + 1);
    });
  }
};

// authSafe: Data cujo conteúdo é uma SEQUENCE OF ContentInfo — conta quantos são.
const contarContentInfos = (raiz) => {
  const conteudo = raiz.value && raiz.value[1] && raiz.value[1].value && raiz.value[1].value[0];
  if (!conteudo) return;
  let authSafe;
  try { authSafe = asn1.fromDer(octetos(conteudo, 0), false); } catch { return; }
  if (Array.isArray(authSafe.value) && authSafe.value.length > L.contentInfos) throw new Limite();
};

try {
  const raiz = asn1.fromDer(util.createBuffer(Buffer.from(workerData.bytes).toString('binary')));
  auditar(raiz, 0);
  contarContentInfos(raiz);

  const p12 = pkcs12.pkcs12FromAsn1(raiz, false, workerData.senha);

  const bagsDe = (tipo) => (p12.getBags({ bagType: tipo })[tipo] || []);
  const certBags = bagsDe(pki.oids.certBag);
  const chaveBags = [...bagsDe(pki.oids.pkcs8ShroudedKeyBag), ...bagsDe(pki.oids.keyBag)];
  if (certBags.length + chaveBags.length > L.bags) throw new Limite();

  const certificados = certBags
    .filter((bag) => bag.cert)
    .map((bag) => Uint8Array.from(Buffer.from(asn1.toDer(pki.certificateToAsn1(bag.cert)).getBytes(), 'binary')));
  const chaves = chaveBags
    .filter((bag) => bag.key && bag.key.n && bag.key.e)
    .map((bag) => ({ n: bag.key.n.toString(16), e: bag.key.e.toString(16) }));

  parentPort.postMessage({ ok: true, conteudo: { certificados, chaves } });
} catch (erro) {
  const senha = !(erro instanceof Limite) && erro instanceof Error && /invalid password|MAC could not be verified/i.test(erro.message);
  parentPort.postMessage({ ok: false, motivo: senha ? 'SENHA' : 'INVALIDO' });
}
`;

export type OpcoesDoTrabalho = Readonly<{ prazoMs?: number }>;

/** Nunca rejeita: prazo estourado, falha do worker e PFX ruim viram `{ ok: false, motivo: 'INVALIDO' }`. */
export const abrirNoTrabalhador = (
  bytes: Uint8Array,
  senha: string,
  opcoes: OpcoesDoTrabalho = {},
): Promise<RespostaDoTrabalho> =>
  new Promise((resolver) => {
    const { prazoMs = PRAZO_PADRAO_DA_ABERTURA_MS } = opcoes;
    // Cópia transferida ao worker: o chamador continua dono (e zera) o buffer dele.
    const copia = Uint8Array.from(bytes);

    let worker: Worker;
    try {
      worker = new Worker(CODIGO_DO_TRABALHADOR, {
        eval: true,
        workerData: {
          bytes: copia,
          senha,
          caminhoDoForge: createRequire(import.meta.url).resolve('node-forge'),
          limites: {
            iteracoes: MAXIMO_DE_ITERACOES,
            soma: MAXIMO_DA_SOMA_DE_ITERACOES,
            contentInfos: MAXIMO_DE_CONTENT_INFOS,
            bags: MAXIMO_DE_BAGS,
            nos: MAXIMO_DE_NOS,
            profundidade: PROFUNDIDADE_MAXIMA_DO_ASN1,
          },
        },
        transferList: [copia.buffer],
        // Sem acesso ao ambiente do processo: o worker não precisa de nenhum segredo.
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
    } catch {
      resolver({ ok: false, motivo: 'INVALIDO' });
      return;
    }

    let resolvido = false;
    const concluir = (resposta: RespostaDoTrabalho): void => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(relogio);
      void worker.terminate();
      resolver(resposta);
    };

    const relogio = setTimeout(() => concluir({ ok: false, motivo: 'INVALIDO' }), prazoMs);

    worker.once('message', (mensagem: RespostaDoTrabalho) => concluir(mensagem));
    worker.once('error', () => concluir({ ok: false, motivo: 'INVALIDO' }));
    worker.once('exit', () => concluir({ ok: false, motivo: 'INVALIDO' }));
  });
