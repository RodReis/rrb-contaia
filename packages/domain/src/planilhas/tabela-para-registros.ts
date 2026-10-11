/**
 * Células de uma aba → registros no mesmo formato do CSV (SPEC-015 §3.5–3.6).
 *
 * O resultado alimenta `normalizarLinhas` / `normalizarLinhasDeEmpregados` com o cabeçalho sendo a
 * lista de LETRAS das colunas mapeadas e o mapeamento campo → letra; daí em diante o caminho é o
 * mesmo do CSV. Nenhuma fórmula é executada e nenhum valor é replicado de célula mesclada.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { LIMITE_DE_LINHAS, type RegistroDoCsv } from '../plano-contas/csv.js';
import { cabecalhoEstaMesclado, linhaTemConteudo } from './cabecalho.js';
import { ehLetraDeColuna, letraParaColuna } from './colunas.js';
import { areaDaMescla } from './intervalos.js';
import type {
  CelulaDaTabela,
  CodigoDeRejeicaoEstrutural,
  LeituraDaAba,
  LinhaDaTabela,
  OpcoesDaTabela,
  RejeicaoEstruturalDeCelula,
  ResultadoTabular,
} from './tipos.js';

type Faixa = readonly [number, number];

const letrasEmOrdemDeColuna = (letras: readonly string[]): readonly string[] => {
  const invalida = letras.find((letra) => !ehLetraDeColuna(letra));
  if (letras.length === 0 || invalida !== undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      'O mapeamento não aponta para colunas existentes na planilha.',
    );
  }
  return [...new Set(letras)].sort((a, b) => letraParaColuna(a) - letraParaColuna(b));
};

const emOrdemDeLinha = (linhas: readonly LinhaDaTabela[]): readonly LinhaDaTabela[] =>
  linhas.every((linha, i) => i === 0 || (linhas[i - 1]?.numero ?? 0) <= linha.numero)
    ? linhas
    : [...linhas].sort((a, b) => a.numero - b.numero);

const unir = (faixas: Faixa[]): readonly Faixa[] => {
  const unidas: [number, number][] = [];
  for (const [inicio, fim] of faixas.sort((a, b) => a[0] - b[0])) {
    const ultima = unidas[unidas.length - 1];
    if (ultima !== undefined && inicio <= ultima[1] + 1) {
      ultima[1] = Math.max(ultima[1], fim);
    } else {
      unidas.push([inicio, fim]);
    }
  }
  return unidas;
};

/** Linhas cobertas por mescla em cada coluna mapeada, sem expandir o intervalo (A1:XFD1048576 custa o mesmo que A1:A2). */
const faixasMescladasPorLetra = (
  leitura: LeituraDaAba,
  letras: readonly string[],
): ReadonlyMap<string, readonly Faixa[]> => {
  const porLetra = new Map<string, Faixa[]>(letras.map((letra) => [letra, []]));
  for (const mescla of leitura.mesclas) {
    const area = areaDaMescla(mescla);
    if (area === null) continue;
    for (const letra of letras) {
      const coluna = letraParaColuna(letra);
      if (area.colunaInicial <= coluna && coluna <= area.colunaFinal) {
        porLetra.get(letra)?.push([area.linhaInicial, area.linhaFinal]);
      }
    }
  }
  return new Map([...porLetra].map(([letra, faixas]) => [letra, unir(faixas)]));
};

/** Consulta para linhas em ordem crescente: o ponteiro só avança. */
const consultaDeFaixas = (faixas: readonly Faixa[]): ((linha: number) => boolean) => {
  let indice = 0;
  return (linha) => {
    while (indice < faixas.length && (faixas[indice]?.[1] ?? 0) < linha) indice += 1;
    return indice < faixas.length && (faixas[indice]?.[0] ?? Infinity) <= linha;
  };
};

const valorDaCelula = (celula: CelulaDaTabela | undefined, ehData: boolean): string => {
  if (celula === undefined) return '';
  return ehData && celula.tipoNativo === 'data' && celula.dataCivil !== undefined ? celula.dataCivil : celula.valorExibido;
};

const limiteDeLinhasExcedido = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, `O arquivo passa de ${LIMITE_DE_LINHAS} linhas de dados.`, [], {
    limiteDeLinhas: LIMITE_DE_LINHAS,
  });

const exigirCabecalhoComConteudo = (linhas: readonly LinhaDaTabela[], linhaCabecalho: number): void => {
  const linha = linhas.find((candidata) => candidata.numero === linhaCabecalho);
  if (linha === undefined || !linhaTemConteudo(linha)) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CABECALHO_INVALIDO,
      'A linha de cabeçalho escolhida está em branco; escolha outra linha.',
      [],
      { linha: linhaCabecalho },
    );
  }
};

export const tabelaParaRegistros = (
  leitura: LeituraDaAba,
  linhaCabecalho: number,
  letrasMapeadas: readonly string[],
  opcoes: OpcoesDaTabela = {},
): ResultadoTabular => {
  if (leitura.linhas.length === 0) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ABA_SEM_DADOS, 'A aba selecionada não tem nenhum conteúdo.');
  }

  const letras = letrasEmOrdemDeColuna(letrasMapeadas);
  const linhas = emOrdemDeLinha(leitura.linhas);
  exigirCabecalhoComConteudo(linhas, linhaCabecalho);

  const ignoradasAntesDoCabecalho = linhas.filter((l) => l.numero < linhaCabecalho && linhaTemConteudo(l)).length;
  if (cabecalhoEstaMesclado(leitura, linhaCabecalho)) {
    return {
      cabecalho: letras,
      registros: [],
      ignoradasAntesDoCabecalho,
      ocultas: 0,
      cabecalhoMesclado: true,
      rejeicoesEstruturaisPorLinha: new Map(),
    };
  }

  const ehData = new Set(opcoes.letrasDeData ?? []);
  const cobertaPorMescla = new Map(
    [...faixasMescladasPorLetra(leitura, letras)].map(([letra, faixas]) => [letra, consultaDeFaixas(faixas)]),
  );
  const registros: RegistroDoCsv[] = [];
  const rejeicoes = new Map<number, RejeicaoEstruturalDeCelula>();
  let ocultas = 0;

  for (const linha of linhas) {
    if (linha.numero <= linhaCabecalho || !linhaTemConteudo(linha)) continue;
    if (registros.length >= LIMITE_DE_LINHAS) throw limiteDeLinhasExcedido();

    const celulas: string[] = [];
    for (const letra of letras) {
      const celula = linha.celulas[letra];
      const coberta = cobertaPorMescla.get(letra)?.(linha.numero) === true;
      const codigo: CodigoDeRejeicaoEstrutural | null = celula?.formula
        ? 'CELULA_COM_FORMULA'
        : celula?.mesclada === true || coberta
          ? 'CELULA_MESCLADA'
          : null;
      // Célula estrutural não alimenta nada: nem o resultado salvo da fórmula, nem o valor da mescla.
      celulas.push(codigo === null ? valorDaCelula(celula, ehData.has(letra)) : '');
      if (codigo !== null && !rejeicoes.has(linha.numero)) rejeicoes.set(linha.numero, { codigo, letra });
    }

    if (linha.oculta) ocultas += 1;
    registros.push({ numeroDaLinha: linha.numero, celulas, camposAMais: 0 });
  }

  if (registros.length === 0) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_VAZIO, 'O arquivo não tem nenhuma linha de dados.');
  }

  return {
    cabecalho: letras,
    registros,
    ignoradasAntesDoCabecalho,
    ocultas,
    cabecalhoMesclado: false,
    rejeicoesEstruturaisPorLinha: rejeicoes,
  };
};
