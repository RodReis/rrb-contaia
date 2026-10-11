import { crc32, inflateRawSync } from 'node:zlib';

import { ErroDePlanilha, corrompido, excedido } from './erros.ts';
import { LIMITES, type Limites } from './limites.ts';

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_LOCALIZADOR_ZIP64 = 0x07064b50;
const TAMANHO_DO_FIM = 22;
const MAIOR_COMENTARIO = 0xffff;
const MARCA_ZIP64_16 = 0xffff;
const MARCA_ZIP64_32 = 0xffffffff;
const FLAG_CIFRADA = 0x0001;
const FLAG_CIFRA_FORTE = 0x0040;

interface Entrada {
  readonly metodo: number;
  readonly crc: number;
  readonly comprimido: number;
  readonly tamanho: number;
  readonly inicioDosDados: number;
}

export interface ZipAberto {
  /** Nomes na ordem do diretório central. */
  readonly nomes: readonly string[];
  tem(nome: string): boolean;
  metodo(nome: string): number | undefined;
  /**
   * Descompacta a entrada (`undefined` se não existe). Nunca produz mais que o tamanho declarado:
   * declarado acima de `teto` → limite; expansão além do declarado → limite (bomba com tamanho
   * mentiroso); tamanho ou CRC divergentes → corrompido. Toda leitura (inclusive a repetida da mesma
   * parte) soma no orçamento do arquivo: passou do teto total → limite, antes de descompactar.
   */
  ler(nome: string, teto?: number): Buffer | undefined;
}

const procurarFim = (b: Buffer): number => {
  const ultimo = b.length - TAMANHO_DO_FIM;
  for (let i = ultimo; i >= Math.max(0, ultimo - MAIOR_COMENTARIO); i--) {
    // O comentário precisa terminar exatamente no fim do arquivo: uma assinatura dentro dele não vale.
    if (b.readUInt32LE(i) === ASSINATURA_FIM && i + TAMANHO_DO_FIM + b.readUInt16LE(i + 20) === b.length) return i;
  }
  throw corrompido('ZIP_TRUNCADO');
};

/**
 * Lê o ZIP pelo diretório central (não pelos cabeçalhos locais, que um arquivo forjado pode
 * contradizer): recusa zip64, multivolume, entrada cifrada, método diferente de armazenado/deflate,
 * nome duplicado e qualquer deslocamento fora do arquivo; aplica os tetos de entradas e de tamanho
 * declarado antes de descompactar qualquer coisa.
 */
export const abrirZip = (bytes: Uint8Array, limites: Limites = LIMITES): ZipAberto => {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < TAMANHO_DO_FIM) throw corrompido('ZIP_TRUNCADO');
  const fim = procurarFim(b);
  if (fim >= 20 && b.readUInt32LE(fim - 20) === ASSINATURA_LOCALIZADOR_ZIP64) throw corrompido('ZIP64');

  const quantidade = b.readUInt16LE(fim + 10);
  const tamanhoDoDiretorio = b.readUInt32LE(fim + 12);
  const inicioDoDiretorio = b.readUInt32LE(fim + 16);
  if (quantidade === MARCA_ZIP64_16 || tamanhoDoDiretorio === MARCA_ZIP64_32 || inicioDoDiretorio === MARCA_ZIP64_32) {
    throw corrompido('ZIP64');
  }
  if (b.readUInt16LE(fim + 4) !== 0 || b.readUInt16LE(fim + 6) !== 0 || b.readUInt16LE(fim + 8) !== quantidade) {
    throw corrompido('ZIP_INVALIDO');
  }
  if (quantidade > limites.entradasDoZip) throw excedido('ENTRADAS');
  const fimDoDiretorio = inicioDoDiretorio + tamanhoDoDiretorio;
  if (fimDoDiretorio > fim) throw corrompido('ZIP_INVALIDO');

  const entradas = new Map<string, Entrada>();
  let p = inicioDoDiretorio;
  let total = 0;
  for (let n = 0; n < quantidade; n++) {
    if (p + 46 > fimDoDiretorio || b.readUInt32LE(p) !== ASSINATURA_CENTRAL) throw corrompido('ZIP_INVALIDO');
    const flags = b.readUInt16LE(p + 8);
    const metodo = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const comprimido = b.readUInt32LE(p + 20);
    const tamanho = b.readUInt32LE(p + 24);
    const tamanhoDoNome = b.readUInt16LE(p + 28);
    const proximo = p + 46 + tamanhoDoNome + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    if (proximo > fimDoDiretorio) throw corrompido('ZIP_INVALIDO');
    if (comprimido === MARCA_ZIP64_32 || tamanho === MARCA_ZIP64_32 || local === MARCA_ZIP64_32) throw corrompido('ZIP64');
    if ((flags & (FLAG_CIFRADA | FLAG_CIFRA_FORTE)) !== 0) throw new ErroDePlanilha('ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO', 'ENTRADA_CIFRADA');
    if (metodo !== 0 && metodo !== 8) throw corrompido('METODO_DE_COMPRESSAO');
    if (metodo === 0 && comprimido !== tamanho) throw corrompido('ZIP_INVALIDO');
    if (tamanho > limites.bytesPorParte) throw excedido('ZIP_BOMBA');
    total += tamanho;
    if (total > limites.bytesNoTotal) throw excedido('ZIP_BOMBA');

    const nome = b.toString('utf8', p + 46, p + 46 + tamanhoDoNome);
    if (entradas.has(nome)) throw corrompido('ZIP_INVALIDO');
    // Cabeçalho local: só para achar o início dos dados; tamanho e CRC vêm do diretório central.
    if (local + 30 > inicioDoDiretorio || b.readUInt32LE(local) !== ASSINATURA_LOCAL) throw corrompido('ZIP_INVALIDO');
    const nomeLocal = b.readUInt16LE(local + 26);
    if (b.toString('utf8', local + 30, local + 30 + nomeLocal) !== nome) throw corrompido('ZIP_INVALIDO');
    const inicioDosDados = local + 30 + nomeLocal + b.readUInt16LE(local + 28);
    if (inicioDosDados + comprimido > inicioDoDiretorio) throw corrompido('ZIP_INVALIDO');

    entradas.set(nome, { metodo, crc, comprimido, tamanho, inicioDosDados });
    p = proximo;
  }

  let inflados = 0;
  return {
    nomes: [...entradas.keys()],
    tem: (nome) => entradas.has(nome),
    metodo: (nome) => entradas.get(nome)?.metodo,
    ler: (nome, teto = limites.bytesPorParte) => {
      const e = entradas.get(nome);
      if (e === undefined) return undefined;
      if (e.tamanho > teto || inflados + e.tamanho > limites.bytesNoTotal) throw excedido('ZIP_BOMBA');
      inflados += e.tamanho;
      const cru = b.subarray(e.inicioDosDados, e.inicioDosDados + e.comprimido);
      let dados: Buffer;
      try {
        dados = e.metodo === 0 ? cru : inflateRawSync(cru, { maxOutputLength: Math.max(e.tamanho, 1) });
      } catch (erro) {
        const codigo = (erro as { code?: unknown }).code;
        if (codigo === 'ERR_BUFFER_TOO_LARGE' || erro instanceof RangeError) throw excedido('ZIP_BOMBA');
        throw corrompido('DEFLATE_INVALIDO');
      }
      if (dados.length !== e.tamanho || crc32(dados) !== e.crc) throw corrompido('CRC_OU_TAMANHO');
      return dados;
    },
  };
};
