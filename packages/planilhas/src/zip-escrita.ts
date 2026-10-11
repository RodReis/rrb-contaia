import { crc32, deflateRawSync } from 'node:zlib';

/** Uma entrada do ZIP gerado. `metodo` 0 = armazenada (o `mimetype` do ODS precisa disso). */
export interface EntradaParaZip {
  readonly nome: string;
  readonly dados: Uint8Array | string;
  readonly metodo?: 0 | 8;
}

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
const VERSAO = 20;
const NOME_EM_UTF8 = 0x0800;
// Data DOS fixa (1980-01-01 00:00): o mesmo conteúdo gera sempre os mesmos bytes.
const DATA_DOS = 0x0021;

/** Entrada já comprimida, com os campos do cabeçalho como serão gravados (os testes os forjam). */
export interface EntradaCrua {
  readonly nome: string;
  readonly comprimido: Uint8Array;
  readonly crc: number;
  readonly tamanho: number;
  readonly metodo: number;
  readonly flags?: number;
}

/**
 * Escritor mínimo de ZIP (deflate + CRC32 da stdlib), sem zip64: os modelos e os fixtures dos testes
 * têm poucos KB. Escreve na ordem recebida.
 */
export const escreverZip = (entradas: readonly EntradaParaZip[]): Uint8Array =>
  montarZip(
    entradas.map((entrada): EntradaCrua => {
      const dados = typeof entrada.dados === 'string' ? Buffer.from(entrada.dados, 'utf8') : Buffer.from(entrada.dados);
      const metodo = entrada.metodo ?? 8;
      return {
        nome: entrada.nome,
        comprimido: metodo === 8 ? deflateRawSync(dados) : dados,
        crc: crc32(dados),
        tamanho: dados.length,
        metodo,
      };
    }),
  );

export const montarZip = (entradas: readonly EntradaCrua[]): Uint8Array => {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;

  for (const entrada of entradas) {
    const nome = Buffer.from(entrada.nome, 'utf8');
    const comprimido = Buffer.from(entrada.comprimido);
    const flags = entrada.flags ?? NOME_EM_UTF8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(ASSINATURA_LOCAL, 0);
    local.writeUInt16LE(VERSAO, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(entrada.metodo, 8);
    local.writeUInt16LE(DATA_DOS, 12);
    local.writeUInt32LE(entrada.crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(entrada.tamanho, 22);
    local.writeUInt16LE(nome.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
    central.writeUInt16LE(VERSAO, 4);
    central.writeUInt16LE(VERSAO, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(entrada.metodo, 10);
    central.writeUInt16LE(DATA_DOS, 14);
    central.writeUInt32LE(entrada.crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(entrada.tamanho, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);

    locais.push(local, nome, comprimido);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(ASSINATURA_FIM, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return new Uint8Array(Buffer.concat([...locais, diretorio, fim]));
};
