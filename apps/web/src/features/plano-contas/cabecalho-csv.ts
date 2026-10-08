/**
 * Cabeçalho e amostra do CSV lidos no navegador (SPEC-013 §3.2–3.3).
 *
 * Só para montar o mapeamento: quem decide se o arquivo vale é o servidor, com o arquivo inteiro.
 * A decodificação é a do domínio (`decodificarCsv`: BOM, UTF-8 estrito ou Latin-1, UTF-16 com
 * BOM, binário recusado), para o navegador e a API lerem os mesmos nomes de coluna. O tokenizador
 * do `csv-parse` fica de fora de propósito: ele não entra no bundle do cliente por 64 KB de leitura.
 */
import {
  CAMPOS_DO_CONTRATO,
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  decodificarCsv,
  validarMapeamento,
  type CampoDoContrato,
  type Delimitador,
  type PendenciaDoMapeamento,
} from '@contaia/domain';

/** Basta para o cabeçalho e algumas linhas; o resto do arquivo não é lido no navegador. */
export const BYTES_LIDOS_NO_NAVEGADOR = 64 * 1024;
export const LINHAS_DA_AMOSTRA = 3;

const FIM_DE_LINHA = 0x0a;
const MARCA_UTF16_LE = [0xff, 0xfe] as const;

export type LeituraDoCabecalho =
  | Readonly<{
      tipo: 'LIDO';
      cabecalho: readonly string[];
      amostra: readonly (readonly string[])[];
      delimitador: Delimitador;
    }>
  | Readonly<{ tipo: 'RECUSADO'; codigo: string }>;

/** Campo do contrato → coluna do arquivo. Campo ausente = ainda não associado. */
export type RascunhoDoMapeamento = Readonly<Partial<Record<CampoDoContrato, string>>>;

const recusado = (codigo: string): LeituraDoCabecalho => ({ tipo: 'RECUSADO', codigo });

/**
 * Recorte no último fim de linha: cortar no byte 65.536 partiria um caractere UTF-8 ao meio, e a
 * decodificação estrita cairia para Latin-1, trocando os acentos do cabeçalho.
 */
const recortarNaUltimaLinha = (bytes: Uint8Array): Uint8Array => {
  const ultima = bytes.lastIndexOf(FIM_DE_LINHA);

  if (ultima <= 0) {
    return bytes;
  }

  const utf16 = bytes[0] === MARCA_UTF16_LE[0] && bytes[1] === MARCA_UTF16_LE[1];

  return bytes.subarray(0, Math.min(bytes.length, ultima + (utf16 ? 2 : 1)));
};

const lerBytes = async (arquivo: Blob): Promise<Uint8Array> =>
  new Uint8Array(await arquivo.slice(0, BYTES_LIDOS_NO_NAVEGADOR).arrayBuffer());

const temConteudo = (celulas: readonly string[]): boolean => celulas.some((celula) => celula.trim() !== '');

/**
 * Registros do texto respeitando aspas (`""` é aspa literal; quebra de linha entre aspas fica no
 * campo). Registros em branco são pulados, como faz o servidor. Com `completo = false` (recorte de
 * um arquivo maior), o último registro sem fim de linha é descartado: pode estar cortado.
 */
export const registrosDoTexto = (
  texto: string,
  delimitador: Delimitador,
  limite: number,
  completo: boolean,
): readonly (readonly string[])[] => {
  const registros: string[][] = [];
  let celulas: string[] = [];
  let celula = '';
  let entreAspas = false;
  let indice = 0;

  const fecharRegistro = (): void => {
    celulas.push(celula);
    if (temConteudo(celulas)) {
      registros.push(celulas);
    }
    celulas = [];
    celula = '';
  };

  while (indice < texto.length && registros.length < limite) {
    const caractere = texto[indice];

    if (entreAspas) {
      if (caractere === '"' && texto[indice + 1] === '"') {
        celula += '"';
        indice += 2;
        continue;
      }
      if (caractere === '"') {
        entreAspas = false;
      } else {
        celula += caractere;
      }
      indice += 1;
      continue;
    }

    if (caractere === '"' && celula.trim() === '') {
      entreAspas = true;
      celula = '';
    } else if (caractere === delimitador) {
      celulas.push(celula);
      celula = '';
    } else if (caractere === '\r' || caractere === '\n') {
      if (caractere === '\r' && texto[indice + 1] === '\n') {
        indice += 1;
      }
      fecharRegistro();
    } else {
      celula += caractere;
    }
    indice += 1;
  }

  if (completo && !entreAspas && registros.length < limite && (celula !== '' || celulas.length > 0)) {
    fecharRegistro();
  }

  return registros;
};

/** Nome sem espaço nas pontas; colunas sem nome no fim (`;` sobrando do Excel) saem. */
const nomesDasColunas = (registro: readonly string[]): readonly string[] => {
  const nomes = registro.map((nome) => nome.trim());
  let fim = nomes.length;

  while (fim > 0 && nomes[fim - 1] === '') {
    fim -= 1;
  }

  return nomes.slice(0, fim);
};

const cabecalhoValido = (nomes: readonly string[]): boolean => {
  const vistos = new Set(nomes.map((nome) => nome.toLowerCase()));

  return nomes.length > 0 && !nomes.includes('') && vistos.size === nomes.length;
};

/**
 * Lê o cabeçalho e as primeiras linhas. Arquivo que o servidor recusaria de qualquer jeito (vazio,
 * só cabeçalho, binário, aspas sem fechar no cabeçalho, coluna repetida ou sem nome) volta como
 * `RECUSADO` com o mesmo código estável, antes de gastar o envio.
 */
export const lerCabecalhoDoArquivo = async (arquivo: Blob): Promise<LeituraDoCabecalho> => {
  let bytes: Uint8Array;

  try {
    bytes = await lerBytes(arquivo);
  } catch {
    return recusado(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO);
  }

  const completo = arquivo.size <= BYTES_LIDOS_NO_NAVEGADOR;
  let decodificado: Readonly<{ texto: string; delimitador: Delimitador }>;

  try {
    decodificado = decodificarCsv(completo ? bytes : recortarNaUltimaLinha(bytes));
  } catch (erro) {
    return recusado(erro instanceof ErroDeDominio ? erro.codigo : CODIGOS_DE_ERRO.ARQUIVO_INVALIDO);
  }

  const [primeiro, ...dados] = registrosDoTexto(
    decodificado.texto,
    decodificado.delimitador,
    LINHAS_DA_AMOSTRA + 1,
    completo,
  );
  const cabecalho = nomesDasColunas(primeiro ?? []);

  if (!cabecalhoValido(cabecalho)) {
    return recusado(CODIGOS_DE_ERRO.CABECALHO_INVALIDO);
  }

  if (dados.length === 0) {
    return recusado(CODIGOS_DE_ERRO.ARQUIVO_VAZIO);
  }

  return {
    tipo: 'LIDO',
    cabecalho,
    delimitador: decodificado.delimitador,
    amostra: dados.map((registro) => cabecalho.map((_, coluna) => (registro[coluna] ?? '').trim())),
  };
};

/** `Conta Pai`, `conta-pai`, `CÓDIGO` → `conta_pai`, `conta_pai`, `codigo`. */
const nomeComparavel = (nome: string): string =>
  nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');

/**
 * Pré-seleção por nome: a coluna cujo nome é o do campo no modelo do ContaIA. É só um ponto de
 * partida visível e editável; nada é inferido do conteúdo.
 */
export const mapeamentoSugerido = (cabecalho: readonly string[]): RascunhoDoMapeamento => {
  const sugestao: Partial<Record<CampoDoContrato, string>> = {};

  for (const campo of CAMPOS_DO_CONTRATO) {
    const iguais = cabecalho.filter((coluna) => nomeComparavel(coluna) === campo);
    const unica = iguais.length === 1 ? iguais[0] : undefined;

    if (unica !== undefined) {
      sugestao[campo] = unica;
    }
  }

  return sugestao;
};

/** As mesmas pendências que a API devolveria em `MAPEAMENTO_INCOMPLETO` (regra do domínio). */
export const pendenciasDoRascunho = (
  cabecalho: readonly string[],
  rascunho: RascunhoDoMapeamento,
): readonly PendenciaDoMapeamento[] =>
  validarMapeamento(cabecalho, {
    codigo: rascunho.codigo ?? '',
    nome: rascunho.nome ?? '',
    tipo: rascunho.tipo ?? '',
    natureza: rascunho.natureza ?? '',
    conta_pai: rascunho.conta_pai ?? '',
  });
