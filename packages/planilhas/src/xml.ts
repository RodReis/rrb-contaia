import { SaxesParser } from 'saxes';

import { ErroDePlanilha, corrompido } from './erros.ts';

export interface Elemento {
  /** Nome como escrito no arquivo, com prefixo (`table:table-row`, `x:row`). */
  readonly nome: string;
  readonly atributos: Readonly<Record<string, string>>;
}

export interface Manipuladores {
  abrir?(elemento: Elemento): void;
  fechar?(nome: string): void;
  texto?(texto: string): void;
}

/** Lançada por um manipulador para encerrar a leitura antes do fim (sem erro). */
export class ParadaAntecipada extends Error {
  constructor() {
    super('parada antecipada');
    this.name = 'ParadaAntecipada';
  }
}

/** Nome sem o prefixo de namespace (`x:row` → `row`). */
export const local = (nome: string): string => {
  const doisPontos = nome.indexOf(':');
  return doisPontos === -1 ? nome : nome.slice(doisPontos + 1);
};

/** Atributo pelo nome local (`r:id` → `id`), para partes OOXML geradas com prefixos diversos. */
export const atributoLocal = (elemento: Elemento, nomeLocal: string): string | undefined => {
  for (const chave of Object.keys(elemento.atributos)) {
    if (chave === nomeLocal || chave.endsWith(`:${nomeLocal}`)) return elemento.atributos[chave];
  }
  return undefined;
};

const PEDACO = 1024 * 1024;
const DOCTYPE = /<!doctype/iu;
// Tamanho de `<!doctype` menos um: o que precisa sobrar do pedaço anterior para pegar o marcador partido.
const SOBRA_DO_MARCADOR = 8;

/**
 * XML em fluxo com `saxes` (SAX estrito, sem DTD): qualquer DOCTYPE é recusado, entidade não
 * declarada é erro (nada é expandido nem buscado fora).
 *
 * O buffer descompactado é decodificado e entregue ao `saxes` em pedaços de 1 MiB, mas isso não
 * limita a memória por nó: o `saxes` acumula cada nó de texto ou valor de atributo inteiro antes de
 * chamar o manipulador, e o teto de 32.767 caracteres por célula (`anexar`) só age depois. O limite
 * real de um nó enorme é o heap do processo filho (e o teto de 128 MiB por parte).
 *
 * O DOCTYPE é recusado no prólogo assim que o texto `<!doctype` (qualquer capitalização) aparece,
 * sem esperar o `saxes` montar o subconjunto interno. Depois que o elemento raiz abre, a busca para
 * (um `<!DOCTYPE` literal num CDATA do primeiro pedaço ainda seria recusado — aceitável).
 */
export const percorrerXml = (dados: Buffer, manipuladores: Manipuladores): void => {
  if ((dados[0] === 0xff && dados[1] === 0xfe) || (dados[0] === 0xfe && dados[1] === 0xff)) throw corrompido('CODIFICACAO');

  const parser = new SaxesParser<{ xmlns: false; position: false }>({ xmlns: false, position: false });
  parser.on('doctype', () => {
    throw corrompido('DTD_PROIBIDO');
  });
  parser.on('error', (erro) => {
    throw erro instanceof ErroDePlanilha || erro instanceof ParadaAntecipada ? erro : corrompido('XML_INVALIDO');
  });
  const { abrir, fechar, texto } = manipuladores;
  if (abrir !== undefined) parser.on('opentag', (tag) => abrir({ nome: tag.name, atributos: tag.attributes }));
  if (fechar !== undefined) parser.on('closetag', (tag) => fechar(tag.name));
  if (texto !== undefined) {
    parser.on('text', texto);
    parser.on('cdata', texto);
  }

  let raizAberta = false;
  parser.on('opentagstart', () => {
    raizAberta = true;
  });
  let sobra = '';
  const conferirPrologo = (texto: string): string => {
    if (!raizAberta) {
      if (DOCTYPE.test(sobra + texto)) throw corrompido('DTD_PROIBIDO');
      sobra = texto.slice(-SOBRA_DO_MARCADOR);
    }
    return texto;
  };

  const decodificador = new TextDecoder('utf-8', { fatal: true });
  const decodificar = (pedaco?: Buffer): string => {
    try {
      return pedaco === undefined ? decodificador.decode() : decodificador.decode(pedaco, { stream: true });
    } catch {
      throw corrompido('CODIFICACAO');
    }
  };

  try {
    for (let i = 0; i < dados.length; i += PEDACO) parser.write(conferirPrologo(decodificar(dados.subarray(i, i + PEDACO))));
    parser.write(conferirPrologo(decodificar()));
    parser.close();
  } catch (erro) {
    // Erros do saxes já chegam convertidos pelo manipulador de `error`; o resto é falha nossa e sobe.
    if (erro instanceof ParadaAntecipada) return;
    throw erro;
  }
};
