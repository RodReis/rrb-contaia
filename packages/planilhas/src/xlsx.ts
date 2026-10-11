import { posix } from 'node:path';

import type { AbaDaPlanilha, LeituraDaAba } from '@contaia/domain';

import { Coletor, ULTIMA_LINHA, type CelulaLida } from './coletor.ts';
import { ErroDePlanilha, corrompido, excedido } from './erros.ts';
import { dataCivilDoIso, dataCivilDoSerial, ehFormatoDeData, formatoDoEstilo, formatoTemData, renderizarNumero } from './formatos-de-numero.ts';
import type { Limites } from './limites.ts';
import { nomeDaAba } from './nome-da-aba.ts';
import { atributoLocal, local, percorrerXml, type Elemento } from './xml.ts';
import type { ZipAberto } from './zip.ts';

interface AbaDoXlsx {
  readonly nome: string;
  readonly caminho: string;
}

interface PastaXlsx {
  readonly abas: readonly AbaDoXlsx[];
  readonly date1904: boolean;
  readonly caminhoDosTextos: string | undefined;
  readonly caminhoDosEstilos: string | undefined;
}

/** Contexto comum às abas: textos compartilhados e o formato de número de cada estilo de célula. */
interface Contexto {
  readonly textos: readonly string[];
  readonly formatos: readonly string[];
  readonly date1904: boolean;
}

const ehVerdadeiro = (valor: string | undefined): boolean => valor === '1' || valor === 'true';

const parte = (zip: ZipAberto, caminho: string): Buffer => {
  const dados = zip.ler(caminho);
  if (dados === undefined) throw corrompido('PARTE_AUSENTE');
  return dados;
};

/** Escape OOXML `_xHHHH_` (o Excel grava CR, LF e controles assim; `_x005F_` é o próprio `_`). */
const decodificarEscapes = (texto: string): string =>
  texto.includes('_x') ? texto.replace(/_x([0-9A-Fa-f]{4})_/gu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))) : texto;

const relacoes = (zip: ZipAberto, caminhoDaParte: string): Map<string, { tipo: string; alvo: string }> => {
  const pasta = posix.dirname(caminhoDaParte);
  const arquivo = posix.join(pasta === '.' ? '' : pasta, '_rels', `${posix.basename(caminhoDaParte)}.rels`);
  const mapa = new Map<string, { tipo: string; alvo: string }>();
  const dados = zip.ler(arquivo);
  if (dados === undefined) return mapa;
  percorrerXml(dados, {
    abrir: (e) => {
      if (local(e.nome) !== 'Relationship' || e.atributos['TargetMode'] === 'External') return;
      const id = e.atributos['Id'];
      const alvo = e.atributos['Target'];
      if (id === undefined || alvo === undefined) return;
      const caminho = alvo.startsWith('/') ? posix.normalize(alvo.slice(1)) : posix.normalize(posix.join(pasta, alvo));
      if (caminho.startsWith('..')) throw corrompido('REFERENCIA_INVALIDA');
      mapa.set(id, { tipo: e.atributos['Type'] ?? '', alvo: caminho });
    },
  });
  return mapa;
};

const porTipo = (rels: Map<string, { tipo: string; alvo: string }>, sufixo: string): string | undefined =>
  [...rels.values()].find((r) => r.tipo.endsWith(sufixo))?.alvo;

const abrirPasta = (zip: ZipAberto, limites: Limites): PastaXlsx => {
  const caminhoDaPasta = porTipo(relacoes(zip, ''), '/officeDocument') ?? 'xl/workbook.xml';
  const rels = relacoes(zip, caminhoDaPasta);
  const declaradas: { nome: string; id: string | undefined }[] = [];
  let date1904 = false;
  percorrerXml(parte(zip, caminhoDaPasta), {
    abrir: (e) => {
      const nome = local(e.nome);
      if (nome === 'workbookPr') date1904 = ehVerdadeiro(e.atributos['date1904']);
      else if (nome === 'sheet') {
        if (declaradas.length >= limites.abas) throw excedido('ABAS');
        declaradas.push({ nome: e.atributos['name'] ?? '', id: atributoLocal(e, 'id') });
      }
    },
  });
  const abas = declaradas.map((a) => {
    const alvo = a.id === undefined ? undefined : rels.get(a.id)?.alvo;
    if (alvo === undefined) throw corrompido('PARTE_AUSENTE');
    return { nome: a.nome, caminho: alvo };
  });
  const caminhoDosTextos = porTipo(rels, '/sharedStrings');
  const caminhoDosEstilos = porTipo(rels, '/styles');
  // Cada aba, os textos e os estilos são partes distintas em qualquer pasta gerada pelo Excel ou pelo
  // LibreOffice. Duas referências à mesma parte só servem para multiplicar o trabalho (a mesma parte
  // de 120 MiB lida uma vez por aba): o arquivo é recusado antes de descompactar qualquer parte.
  const papeis = [...abas.map((a) => a.caminho), caminhoDosTextos, caminhoDosEstilos].filter((c) => c !== undefined);
  if (new Set(papeis).size !== papeis.length) throw corrompido('REFERENCIA_INVALIDA');
  return { abas, date1904, caminhoDosTextos, caminhoDosEstilos };
};

/** Acumula texto com o teto por célula, sem concatenar além dele. */
const anexar = (atual: string, mais: string, limites: Limites): string => {
  if (atual.length + mais.length > limites.caracteresPorCelula) throw excedido('TEXTO_DA_CELULA');
  return atual + mais;
};

const lerTextos = (zip: ZipAberto, caminho: string | undefined, limites: Limites): string[] => {
  const textos: string[] = [];
  const dados = caminho === undefined ? undefined : zip.ler(caminho);
  if (dados === undefined) return textos;
  let atual: string | null = null;
  let emT = false;
  let emFonetica = 0;
  percorrerXml(dados, {
    abrir: (e) => {
      const nome = local(e.nome);
      if (nome === 'si') atual = '';
      else if (nome === 'rPh') emFonetica += 1;
      else if (nome === 't') emT = true;
    },
    texto: (t) => {
      if (emT && emFonetica === 0 && atual !== null) atual = anexar(atual, t, limites);
    },
    fechar: (n) => {
      const nome = local(n);
      if (nome === 't') emT = false;
      else if (nome === 'rPh') emFonetica -= 1;
      else if (nome === 'si' && atual !== null) {
        if (textos.length >= limites.textosCompartilhados) throw excedido('TEXTOS_COMPARTILHADOS');
        textos.push(decodificarEscapes(atual));
        atual = null;
      }
    },
  });
  return textos;
};

const numero = (valor: string | undefined): number | undefined => {
  if (valor === undefined || !/^\d{1,9}$/u.test(valor)) return undefined;
  return Number(valor);
};

const lerFormatos = (zip: ZipAberto, caminho: string | undefined, limites: Limites): string[] => {
  const dados = caminho === undefined ? undefined : zip.ler(caminho);
  if (dados === undefined) return [];
  const personalizados = new Map<number, string>();
  const idsDosEstilos: number[] = [];
  let emNumFmts = false;
  let emCellXfs = false;
  percorrerXml(dados, {
    abrir: (e) => {
      const nome = local(e.nome);
      if (nome === 'numFmts') emNumFmts = true;
      else if (nome === 'cellXfs') emCellXfs = true;
      else if (nome === 'numFmt' && emNumFmts) {
        const id = numero(e.atributos['numFmtId']);
        const codigo = e.atributos['formatCode'];
        if (id === undefined || codigo === undefined) return;
        // Mesmo teto dos `xf`: styles.xml forjado com milhões de numFmt acabaria em OOM, não em código.
        if (!personalizados.has(id) && personalizados.size >= limites.estilos) throw excedido('ESTILOS');
        personalizados.set(id, codigo);
      } else if (nome === 'xf' && emCellXfs) {
        if (idsDosEstilos.length >= limites.estilos) throw excedido('ESTILOS');
        idsDosEstilos.push(numero(e.atributos['numFmtId']) ?? 0);
      }
    },
    fechar: (n) => {
      const nome = local(n);
      if (nome === 'numFmts') emNumFmts = false;
      else if (nome === 'cellXfs') emCellXfs = false;
    },
  });
  return idsDosEstilos.map((id) => formatoDoEstilo(id, personalizados));
};

const REFERENCIA = /^([A-Z]{1,4})(\d{1,8})$/u;
/** Número de linha só em decimal (o mesmo trecho de `REFERENCIA`): `Number` aceitaria `0x10`, ` 5`, `1e3`. */
const NUMERO_DA_LINHA = /^\d{1,8}$/u;

const indiceDaColuna = (letras: string, limites: Limites): number => {
  let indice = 0;
  for (const letra of letras) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  if (indice > limites.colunas) throw excedido('COLUNAS');
  return indice;
};

const lerReferencia = (ref: string, limites: Limites): { coluna: number; linha: number } => {
  const partes = REFERENCIA.exec(ref);
  if (partes === null) throw corrompido('REFERENCIA_INVALIDA');
  return { coluna: indiceDaColuna(partes[1] as string, limites), linha: Number(partes[2]) };
};

interface CelulaEmLeitura {
  readonly coluna: number;
  readonly tipo: string;
  readonly estilo: number;
  formula: boolean;
  valor: string | null;
  texto: string;
}

const montarCelula = (c: CelulaEmLeitura, contexto: Contexto): CelulaLida | null => {
  const temValor = c.valor !== null && c.valor !== '';
  switch (c.tipo) {
    case 's': {
      if (!temValor) return c.formula ? { valorExibido: '', tipoNativo: 'texto', formula: true } : null;
      const texto = contexto.textos[Number(c.valor)];
      if (texto === undefined || !/^\d+$/u.test(c.valor ?? '')) throw corrompido('REFERENCIA_INVALIDA');
      return { valorExibido: texto, tipoNativo: 'texto', formula: c.formula };
    }
    case 'inlineStr':
      return c.texto === '' && !c.formula ? null : { valorExibido: decodificarEscapes(c.texto), tipoNativo: 'texto', formula: c.formula };
    case 'str':
      return !temValor && !c.formula ? null : { valorExibido: decodificarEscapes(c.valor ?? ''), tipoNativo: 'texto', formula: c.formula };
    case 'b':
      return !temValor ? semValor(c) : { valorExibido: c.valor === '1' ? 'VERDADEIRO' : 'FALSO', tipoNativo: 'booleano', formula: c.formula };
    case 'e':
      return !temValor ? semValor(c) : { valorExibido: c.valor ?? '', tipoNativo: 'erro', formula: c.formula };
    case 'd':
      return !temValor ? semValor(c) : celulaDeDataIso(c.valor ?? '', c.formula);
    default:
      return !temValor ? semValor(c) : celulaNumerica(c, contexto);
  }
};

const semValor = (c: CelulaEmLeitura): CelulaLida | null => (c.formula ? { valorExibido: '', tipoNativo: 'vazio', formula: true } : null);

const celulaNumerica = (c: CelulaEmLeitura, contexto: Contexto): CelulaLida => {
  const valor = Number(c.valor);
  if (!Number.isFinite(valor)) throw corrompido('REFERENCIA_INVALIDA');
  const formato = contexto.formatos[c.estilo] ?? 'General';
  const valorExibido = renderizarNumero(valor, formato, contexto.date1904);
  if (!ehFormatoDeData(formato)) return { valorExibido, tipoNativo: 'numero', formula: c.formula };
  const dataCivil = formatoTemData(formato) ? dataCivilDoSerial(valor, contexto.date1904) : undefined;
  return { valorExibido, tipoNativo: 'data', formula: c.formula, ...(dataCivil === undefined ? {} : { dataCivil }) };
};

// Célula `t="d"` (data ISO 8601, gravada por alguns geradores): a data civil vem do próprio texto.
const celulaDeDataIso = (valor: string, formula: boolean): CelulaLida => {
  const dataCivil = dataCivilDoIso(valor);
  const valorExibido = dataCivil === undefined ? valor : dataCivil.split('-').reverse().join('/');
  return { valorExibido, tipoNativo: 'data', formula, ...(dataCivil === undefined ? {} : { dataCivil }) };
};

const lerPlanilha = (zip: ZipAberto, caminho: string, contexto: Contexto, coletor: Coletor, limites: Limites): void => {
  let naSheetData = false;
  let linhaAtual = 0;
  let ultimaColuna = 0;
  let ocultaAtual = false;
  let celulasDaLinha = new Map<number, CelulaLida>();
  let celula: CelulaEmLeitura | null = null;
  let campo: 'v' | 't' | null = null;
  let emIs = false;
  let emFonetica = 0;

  const abrir = (e: Elemento): void => {
    const nome = local(e.nome);
    if (nome === 'sheetData') naSheetData = true;
    else if (nome === 'row' && naSheetData) {
      const r = e.atributos['r'];
      linhaAtual = r === undefined ? linhaAtual + 1 : NUMERO_DA_LINHA.test(r) ? Number(r) : Number.NaN;
      if (!Number.isInteger(linhaAtual) || linhaAtual < 1 || linhaAtual > ULTIMA_LINHA) throw corrompido('REFERENCIA_INVALIDA');
      ocultaAtual = ehVerdadeiro(e.atributos['hidden']);
      ultimaColuna = 0;
      celulasDaLinha = new Map();
    } else if (nome === 'c' && naSheetData) {
      const r = e.atributos['r'];
      const coluna = r === undefined ? ultimaColuna + 1 : lerReferencia(r, limites).coluna;
      if (coluna > limites.colunas) throw excedido('COLUNAS');
      ultimaColuna = coluna;
      celula = { coluna, tipo: e.atributos['t'] ?? 'n', estilo: numero(e.atributos['s']) ?? 0, formula: false, valor: null, texto: '' };
    } else if (celula !== null) {
      if (nome === 'f') celula.formula = true;
      else if (nome === 'v') {
        campo = 'v';
        celula.valor = '';
      } else if (nome === 'is') emIs = true;
      else if (nome === 'rPh') emFonetica += 1;
      else if (nome === 't' && emIs && emFonetica === 0) campo = 't';
    } else if (nome === 'mergeCell') {
      const ref = e.atributos['ref'];
      if (ref === undefined) return;
      const [de = '', ate = de] = ref.split(':');
      const inicio = lerReferencia(de, limites);
      const fim = lerReferencia(ate, limites);
      coletor.mesclar(inicio.coluna, inicio.linha, fim.coluna, fim.linha);
    }
  };

  const texto = (t: string): void => {
    if (celula === null || campo === null) return;
    if (campo === 'v') celula.valor = anexar(celula.valor ?? '', t, limites);
    else celula.texto = anexar(celula.texto, t, limites);
  };

  const fechar = (n: string): void => {
    const nome = local(n);
    if (nome === 'v' || nome === 't') campo = null;
    else if (nome === 'is') emIs = false;
    else if (nome === 'rPh') emFonetica -= 1;
    else if (nome === 'c' && celula !== null) {
      const pronta = montarCelula(celula, contexto);
      if (pronta !== null) celulasDaLinha.set(celula.coluna, pronta);
      celula = null;
    } else if (nome === 'row' && naSheetData) {
      coletor.fecharLinha(linhaAtual, ocultaAtual, celulasDaLinha);
      celulasDaLinha = new Map();
    } else if (nome === 'sheetData') naSheetData = false;
  };

  percorrerXml(parte(zip, caminho), { abrir, texto, fechar });
};

const contexto = (zip: ZipAberto, pasta: PastaXlsx, limites: Limites): Contexto => ({
  textos: lerTextos(zip, pasta.caminhoDosTextos, limites),
  formatos: lerFormatos(zip, pasta.caminhoDosEstilos, limites),
  date1904: pasta.date1904,
});

export const inspecionarXlsx = (zip: ZipAberto, limites: Limites): AbaDaPlanilha[] => {
  const pasta = abrirPasta(zip, limites);
  if (pasta.abas.length === 0) return [];
  const ctx = contexto(zip, pasta, limites);
  return pasta.abas.map((aba, i) => {
    const coletor = new Coletor(limites, true);
    lerPlanilha(zip, aba.caminho, ctx, coletor, limites);
    return { nome: nomeDaAba(aba.nome, i + 1), posicao: i + 1, utilizavel: coletor.temLinhas };
  });
};

export const lerAbaDoXlsx = (zip: ZipAberto, posicao: number, limites: Limites): LeituraDaAba => {
  const pasta = abrirPasta(zip, limites);
  const aba = pasta.abas[posicao - 1];
  if (aba === undefined) throw new ErroDePlanilha('ABA_INEXISTENTE', 'ABA');
  const coletor = new Coletor(limites);
  lerPlanilha(zip, aba.caminho, contexto(zip, pasta, limites), coletor, limites);
  return coletor.leitura('XLSX', { nome: nomeDaAba(aba.nome, posicao), posicao });
};
