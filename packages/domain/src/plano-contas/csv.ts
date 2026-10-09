/**
 * Funções puras sobre o CSV de importação do plano de contas (SPEC-013 §3.2–3.3).
 *
 * O domínio não tokeniza CSV: `decodificarCsv` só transforma bytes em texto e escolhe o
 * delimitador; a tokenização (aspas, quebras internas, contagem de linhas) é de `lerCsv`, em
 * `@contaia/shared`. Aqui ficam o mapeamento de colunas e a normalização de linhas já tokenizadas.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import type { LinhaBrutaDeEntrada } from './validacao.js';

export const LIMITE_DE_LINHAS = 10_000;
export const LIMITE_DE_BYTES = 10 * 1024 * 1024;

export const CAMPOS_DO_CONTRATO = ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'] as const;
export type CampoDoContrato = (typeof CAMPOS_DO_CONTRATO)[number];

/** Campo do contrato → nome da coluna de origem no cabeçalho do arquivo. */
export type Mapeamento = Readonly<Record<CampoDoContrato, string>>;

export type Delimitador = ',' | ';' | '\t';

export type PendenciaDoMapeamento = Readonly<{
  campo: CampoDoContrato;
  motivo: 'AUSENTE' | 'COLUNA_INEXISTENTE' | 'COLUNA_REPETIDA';
}>;

/** Ordem de preferência no desempate: o Excel pt-BR grava `;`. */
const DELIMITADORES: readonly Delimitador[] = [';', ',', '\t'];

const CODIGO_DO_BOM = 0xfeff;
const MARCA_DE_ORDEM_UTF8 = [0xef, 0xbb, 0xbf] as const;
const MARCA_DE_ORDEM_UTF16_LE = [0xff, 0xfe] as const;
const MARCA_DE_ORDEM_UTF16_BE = [0xfe, 0xff] as const;

/** Caracteres de controle (exceto tab, LF e CR): sinal de arquivo binário, não de texto. */
// eslint-disable-next-line no-control-regex
const CONTROLE_DE_BINARIO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;

const comecaCom = (bytes: Uint8Array, marca: readonly number[]): boolean =>
  bytes.length >= marca.length && marca.every((byte, indice) => bytes[indice] === byte);

const decodificarBytes = (bytes: Uint8Array): string => {
  if (comecaCom(bytes, MARCA_DE_ORDEM_UTF16_LE)) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (comecaCom(bytes, MARCA_DE_ORDEM_UTF16_BE)) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  const semMarca = comecaCom(bytes, MARCA_DE_ORDEM_UTF8) ? bytes.subarray(MARCA_DE_ORDEM_UTF8.length) : bytes;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(semMarca);
  } catch {
    // Não é UTF-8 válido: o CSV brasileiro usual nesse caso é Latin-1 / Windows-1252 (Excel antigo).
    return new TextDecoder('windows-1252').decode(semMarca);
  }
};

/**
 * Primeiro registro (cabeçalho) respeitando aspas, e o texto que vem depois dele. Ignora linhas
 * em branco antes do cabeçalho.
 */
const separarCabecalho = (
  texto: string,
): Readonly<{ cabecalho: string; resto: string; aspasAbertas: boolean }> => {
  const inicio = texto.search(/\S/u);
  if (inicio < 0) {
    return { cabecalho: '', resto: '', aspasAbertas: false };
  }

  let dentroDeAspas = false;
  for (let indice = inicio; indice < texto.length; indice += 1) {
    const caractere = texto[indice];
    if (caractere === '"') {
      dentroDeAspas = !dentroDeAspas;
    } else if (!dentroDeAspas && (caractere === '\n' || caractere === '\r')) {
      return { cabecalho: texto.slice(inicio, indice), resto: texto.slice(indice), aspasAbertas: false };
    }
  }

  return { cabecalho: texto.slice(inicio), resto: '', aspasAbertas: dentroDeAspas };
};

const contarForaDeAspas = (registro: string, delimitador: Delimitador): number => {
  let dentroDeAspas = false;
  let total = 0;
  for (const caractere of registro) {
    if (caractere === '"') {
      dentroDeAspas = !dentroDeAspas;
    } else if (!dentroDeAspas && caractere === delimitador) {
      total += 1;
    }
  }
  return total;
};

/** Maioria no cabeçalho; empate (inclusive zero ocorrências) → `;`. */
const detectarDelimitador = (cabecalho: string): Delimitador => {
  let melhor: Delimitador = ';';
  let maior = contarForaDeAspas(cabecalho, melhor);
  for (const candidato of DELIMITADORES) {
    const total = contarForaDeAspas(cabecalho, candidato);
    if (total > maior) {
      melhor = candidato;
      maior = total;
    }
  }
  return melhor;
};

const arquivoVazio = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_VAZIO, 'O arquivo não tem nenhuma linha de dados.');

/**
 * Bytes → texto + delimitador, com diagnóstico determinístico:
 * - mais de 10 MB → `ARQUIVO_ACIMA_DO_LIMITE` (antes de ler o conteúdo);
 * - BOM UTF-8 removido; UTF-8 estrito, senão Windows-1252 (Latin-1); UTF-16 só com BOM;
 * - conteúdo binário (caracteres de controle) → `ARQUIVO_INVALIDO`;
 * - aspas sem fechar no cabeçalho → `ARQUIVO_INVALIDO`;
 * - vazio ou só cabeçalho → `ARQUIVO_VAZIO`.
 */
export const decodificarCsv = (bytes: Uint8Array): Readonly<{ texto: string; delimitador: Delimitador }> => {
  if (bytes.length > LIMITE_DE_BYTES) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
      'O arquivo passa de 10 MB.',
      [],
      { limiteBytes: LIMITE_DE_BYTES },
    );
  }

  const decodificado = decodificarBytes(bytes);
  const texto = decodificado.charCodeAt(0) === CODIGO_DO_BOM ? decodificado.slice(1) : decodificado;

  if (CONTROLE_DE_BINARIO.test(texto)) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
      'O conteúdo do arquivo não é um CSV de texto legível.',
    );
  }

  const { cabecalho, resto, aspasAbertas } = separarCabecalho(texto);
  if (aspasAbertas) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
      'O CSV está malformado: há aspas sem fechar no cabeçalho.',
    );
  }
  if (cabecalho === '' || resto.trim() === '') {
    throw arquivoVazio();
  }

  return { texto, delimitador: detectarDelimitador(cabecalho) };
};

const nomeDaColuna = (nome: string): string => nome.trim();

/**
 * Confere se o mapeamento cobre os cinco campos com colunas que existem no cabeçalho e que não
 * se repetem entre campos. Um motivo por campo: ausente > inexistente > repetida.
 */
export const validarMapeamento = (
  cabecalho: readonly string[],
  mapeamento: Mapeamento,
): readonly PendenciaDoMapeamento[] => {
  const colunas = new Set(cabecalho.map(nomeDaColuna));
  const usos = new Map<string, number>();
  for (const campo of CAMPOS_DO_CONTRATO) {
    const coluna = nomeDaColuna(mapeamento[campo] ?? '');
    if (coluna !== '') {
      usos.set(coluna, (usos.get(coluna) ?? 0) + 1);
    }
  }

  const pendencias: PendenciaDoMapeamento[] = [];
  for (const campo of CAMPOS_DO_CONTRATO) {
    const coluna = nomeDaColuna(mapeamento[campo] ?? '');
    if (coluna === '') {
      pendencias.push({ campo, motivo: 'AUSENTE' });
    } else if (!colunas.has(coluna)) {
      pendencias.push({ campo, motivo: 'COLUNA_INEXISTENTE' });
    } else if ((usos.get(coluna) ?? 0) > 1) {
      pendencias.push({ campo, motivo: 'COLUNA_REPETIDA' });
    }
  }
  return pendencias;
};

const semAcentoEmMinusculo = (valor: string): string =>
  valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * `Analítica `, `SINTÉTICA`, `Devedora` → valor do domínio. O que não for reconhecido segue como
 * veio (aparado), para a validação rejeitá-lo com o valor visível no relatório.
 */
const normalizarEnumerado = (valor: string, validos: readonly string[]): string => {
  const aparado = valor.trim();
  const canonico = semAcentoEmMinusculo(aparado);
  return validos.includes(canonico) ? canonico : aparado;
};

const TIPOS = ['analitica', 'sintetica'] as const;
const NATUREZAS = ['devedora', 'credora'] as const;

const indicesDasColunas = (
  cabecalho: readonly string[],
  mapeamento: Mapeamento,
): Readonly<Record<CampoDoContrato, number>> => {
  const nomes = cabecalho.map(nomeDaColuna);
  const indices = Object.fromEntries(
    CAMPOS_DO_CONTRATO.map((campo) => [campo, nomes.indexOf(nomeDaColuna(mapeamento[campo] ?? ''))]),
  ) as Record<CampoDoContrato, number>;

  const faltantes = CAMPOS_DO_CONTRATO.filter((campo) => indices[campo] < 0);
  if (faltantes.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      'O mapeamento não aponta para colunas existentes no arquivo.',
      faltantes.map((campo) => ({ campo, codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO })),
    );
  }
  return indices;
};

/**
 * Registro de dados já tokenizado. O número da linha física viaja junto com as células (cabeçalho
 * = linha 1; um registro com quebra de linha entre aspas ocupa várias linhas), então não há como
 * a numeração se descolar dos dados.
 */
export type RegistroDoCsv = Readonly<{
  numeroDaLinha: number;
  /** Exatamente a largura do cabeçalho. */
  celulas: readonly string[];
  /** Campos preenchidos além do cabeçalho (ex.: `;` sem aspas dentro do nome). 0 = nenhum. */
  camposAMais: number;
}>;

/**
 * Registros tokenizados → entrada da validação.
 *
 * Todo texto é aparado; o código é preservado como texto (`01` ≠ `1`); conta-pai em branco → `null`;
 * tipo e natureza reconhecidos viram o valor do domínio e os demais seguem crus. Registro com
 * campos a mais leva `defeitoDeEstrutura`, que a validação transforma em rejeição da linha.
 */
export const normalizarLinhas = (
  cabecalho: readonly string[],
  registros: readonly RegistroDoCsv[],
  mapeamento: Mapeamento,
): readonly LinhaBrutaDeEntrada[] => {
  const indices = indicesDasColunas(cabecalho, mapeamento);

  return registros.map((registro) => {
    const celula = (campo: CampoDoContrato): string => (registro.celulas[indices[campo]] ?? '').trim();
    const contaPai = celula('conta_pai');
    return {
      numeroDaLinha: registro.numeroDaLinha,
      codigo: celula('codigo'),
      nome: celula('nome'),
      tipo: normalizarEnumerado(celula('tipo'), TIPOS),
      natureza: normalizarEnumerado(celula('natureza'), NATUREZAS),
      contaPai: contaPai === '' ? null : contaPai,
      ...(registro.camposAMais > 0 ? { defeitoDeEstrutura: 'CAMPOS_A_MAIS' as const } : {}),
    };
  });
};

/** Modelo oficial para download: cabeçalho fixo, `;`, CRLF e uma hierarquia mínima válida. */
export const MODELO_CSV = [
  'codigo;nome;tipo;natureza;conta_pai',
  '1;Ativo;sintetica;devedora;',
  '1.1;Ativo Circulante;sintetica;devedora;1',
  '1.1.01;Caixa;analitica;devedora;1.1',
  '1.1.02;Bancos;analitica;devedora;1.1',
  '2;Passivo;sintetica;credora;',
  '2.1;Fornecedores;analitica;credora;2',
  '',
].join('\r\n');
