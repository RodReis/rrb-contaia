/**
 * Equivalência CSV × planilha no nível do domínio (SPEC-015 §3.6): a mesma tabela, vinda como
 * registros de CSV (mapeamento por nome) ou como células de planilha (mapeamento por letra), passa
 * pelas mesmas funções de normalização e validação e produz exatamente o mesmo resultado.
 */
import { describe, expect, it } from 'vitest';

import { CAMPOS_DE_EMPREGADO, type MapeamentoDeEmpregados } from '../empregados/campos.js';
import { normalizarLinhasDeEmpregados } from '../empregados/normalizacao.js';
import { validarLinhasDeEmpregados } from '../empregados/validacao.js';
import { CAMPOS_DO_CONTRATO, normalizarLinhas, type Mapeamento, type RegistroDoCsv } from '../plano-contas/csv.js';
import { validarLinhasDoPlano } from '../plano-contas/validacao.js';
import { colunaParaLetra } from './colunas.js';
import { tabelaParaRegistros } from './tabela-para-registros.js';
import type { CelulaDaTabela, LeituraDaAba } from './tipos.js';

/** Como o CSV chega: linha 1 = cabeçalho, dados a partir da linha 2. */
const comoCsv = (dados: readonly (readonly string[])[]): readonly RegistroDoCsv[] =>
  dados.map((celulas, indice) => ({ numeroDaLinha: indice + 2, celulas, camposAMais: 0 }));

/** A mesma tabela como planilha: cabeçalho na linha `inicio`, com `antes` linhas de título acima. */
const comoPlanilha = (
  nomes: readonly string[],
  dados: readonly (readonly string[])[],
  antes = 0,
  tipoNativo: CelulaDaTabela['tipoNativo'] = 'texto',
): LeituraDaAba => {
  const celula = (valorExibido: string): CelulaDaTabela => ({
    valorExibido,
    tipoNativo: valorExibido === '' ? 'vazio' : tipoNativo,
    formula: false,
    mesclada: false,
  });
  const linhaDe = (numero: number, valores: readonly string[]) => ({
    numero,
    oculta: false,
    celulas: Object.fromEntries(valores.map((valor, i) => [colunaParaLetra(i + 1), celula(valor)])),
  });
  const titulos = Array.from({ length: antes }, (_, i) => linhaDe(i + 1, [`Título ${i + 1}`]));
  return {
    formato: 'XLSX',
    aba: { nome: 'Dados', posicao: 1, utilizavel: true },
    linhas: [...titulos, linhaDe(antes + 1, nomes), ...dados.map((d, i) => linhaDe(antes + 2 + i, d))],
    mesclas: [],
    totalDeLinhasOcultas: 0,
  };
};

const letras = (campos: readonly string[]): Record<string, string> =>
  Object.fromEntries(campos.map((campo, i) => [campo, colunaParaLetra(i + 1)]));

describe('equivalência CSV × planilha — plano de contas', () => {
  const NOMES = ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'];
  const DADOS: readonly (readonly string[])[] = [
    ['1.1.01', 'Caixa', 'analitica', 'devedora', '1.1'], // filha antes do pai
    ['1', 'Ativo', 'sintetica', 'devedora', ''],
    ['1.1', 'Ativo Circulante', 'Sintética', 'Devedora', '1'], // caixa/acento normalizados
    ['2', 'Passivo', 'sintetica', 'credora', ''],
    ['2', 'Passivo duplicado', 'sintetica', 'credora', ''], // duplicidade
    ['3', 'Receita', '', 'credora', ''], // obrigatório ausente
    ['4', 'Despesa', 'inexistente', 'devedora', ''], // fora do domínio
    ['5', 'Órfã', 'analitica', 'devedora', '99'], // pai inexistente
    ['6', 'Ciclo A', 'sintetica', 'devedora', '7'],
    ['7', 'Ciclo B', 'sintetica', 'devedora', '6'],
    ['01', 'Zero à esquerda', 'sintetica', 'devedora', ''],
    ['8', 'Analítica', 'analitica', 'devedora', ''],
    ['8.1', 'Filha de analítica', 'analitica', 'devedora', '8'],
  ];

  it('produz exatamente as mesmas aceitas e rejeitadas', () => {
    const porNome: Mapeamento = Object.fromEntries(CAMPOS_DO_CONTRATO.map((c) => [c, c])) as Mapeamento;
    const porLetra = letras(CAMPOS_DO_CONTRATO) as Mapeamento;

    const csv = validarLinhasDoPlano({
      linhas: normalizarLinhas(NOMES, comoCsv(DADOS), porNome),
      contasVigentes: [],
    });
    const tabela = tabelaParaRegistros(comoPlanilha(NOMES, DADOS), 1, Object.values(porLetra));
    const planilha = validarLinhasDoPlano({
      linhas: normalizarLinhas(tabela.cabecalho, tabela.registros, porLetra, tabela.rejeicoesEstruturaisPorLinha),
      contasVigentes: [],
    });

    expect(planilha).toEqual(csv);
    expect(csv.aceitas.length).toBeGreaterThan(0);
    expect(csv.rejeitadas.length).toBeGreaterThan(0);
  });

  it('colunas fora de ordem, título acima do cabeçalho e linhas em branco não mudam o resultado', () => {
    const porNome: Mapeamento = Object.fromEntries(CAMPOS_DO_CONTRATO.map((c) => [c, c])) as Mapeamento;
    const csv = validarLinhasDoPlano({
      linhas: normalizarLinhas(NOMES, comoCsv(DADOS), porNome),
      contasVigentes: [],
    });

    // Planilha com as colunas embaralhadas (E, C, A, D, B) e 3 linhas de título acima.
    const ordem = [4, 2, 0, 3, 1];
    const nomes = ordem.map((i) => NOMES[i] as string);
    const dados = DADOS.map((d) => ordem.map((i) => d[i] as string));
    const porLetra = Object.fromEntries(
      CAMPOS_DO_CONTRATO.map((campo) => [campo, colunaParaLetra(nomes.indexOf(campo) + 1)]),
    ) as Mapeamento;
    const aba = comoPlanilha(nomes, dados, 3);
    const comBrancas = { ...aba, linhas: [...aba.linhas.slice(0, 6), { numero: 99, oculta: false, celulas: {} }, ...aba.linhas.slice(6)] };

    const tabela = tabelaParaRegistros(comBrancas, 4, Object.values(porLetra));
    const planilha = validarLinhasDoPlano({
      linhas: normalizarLinhas(tabela.cabecalho, tabela.registros, porLetra, tabela.rejeicoesEstruturaisPorLinha),
      contasVigentes: [],
    });

    // O número da linha na planilha é o original (3 títulos + cabeçalho => dados na linha 5+).
    const semNumero = (r: typeof csv) => ({
      aceitas: r.aceitas.map((a) => [a.codigo, a.nome, a.tipo, a.natureza, a.contaPai]),
      rejeitadas: r.rejeitadas.map((x) => [x.codigo, x.campo, x.codigoDeErro, x.mensagem]),
    });
    expect(semNumero(planilha)).toEqual(semNumero(csv));
    expect(planilha.aceitas.map((a) => a.numeroDaLinha)).toEqual(csv.aceitas.map((a) => a.numeroDaLinha + 3));
  });
});

describe('equivalência CSV × planilha — empregados', () => {
  const NOMES = ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'];
  const DADOS: readonly (readonly string[])[] = [
    ['529.982.247-25', 'Maria', '00123', '15/03/1990', '01/02/2015'],
    ['52998224725', 'Maria Outra', '123', '1990-03-15', '2015-02-01'], // matrícula distinta de 00123
    ['111.444.777-35', 'João', 'A-1', '15/03/1990', '01/02/2015'],
    ['111.444.777-35', 'João Duplicado', 'A-1', '15/03/1990', '01/02/2015'], // chave duplicada
    ['123', 'CPF ruim', '9', '15/03/1990', '01/02/2015'],
    ['529.982.247-25', 'Data ruim', '7', '31/02/1990', '01/02/2015'],
    ['529.982.247-25', 'Admissão antes', '8', '15/03/1990', '15/03/1990'],
    ['529.982.247-25', '', '10', '15/03/1990', '01/02/2015'],
    ['529.982.247-25', 'Serial no campo de data', '11', '45000', '01/02/2015'],
  ];
  const VIGENTES = new Map([['11144477735|A-1', { arquivado: false }]]);

  it('produz exatamente o mesmo staging por linha, e chaves e códigos iguais', () => {
    const porNome = Object.fromEntries(CAMPOS_DE_EMPREGADO.map((c) => [c, c])) as MapeamentoDeEmpregados;
    const porLetra = letras(CAMPOS_DE_EMPREGADO) as MapeamentoDeEmpregados;

    const csv = validarLinhasDeEmpregados(normalizarLinhasDeEmpregados(NOMES, comoCsv(DADOS), porNome), VIGENTES);
    const tabela = tabelaParaRegistros(comoPlanilha(NOMES, DADOS), 1, Object.values(porLetra));
    const planilha = validarLinhasDeEmpregados(
      normalizarLinhasDeEmpregados(tabela.cabecalho, tabela.registros, porLetra, tabela.rejeicoesEstruturaisPorLinha),
      VIGENTES,
    );

    expect(planilha).toEqual(csv);
    expect(csv.map((r) => r.codigoDeErro)).toEqual([
      null,
      null,
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'CPF_INVALIDO',
      'DATA_NASCIMENTO_INVALIDA',
      'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
      'CAMPO_OBRIGATORIO_AUSENTE',
      'DATA_NASCIMENTO_INVALIDA',
    ]);
  });

  it('data nativa na coluna de data equivale ao texto dd/mm/aaaa do CSV', () => {
    const porNome = Object.fromEntries(CAMPOS_DE_EMPREGADO.map((c) => [c, c])) as MapeamentoDeEmpregados;
    const porLetra = letras(CAMPOS_DE_EMPREGADO) as MapeamentoDeEmpregados;
    const dados = [['529.982.247-25', 'Maria', '00123', '15/03/1990', '01/02/2015']];
    const csv = validarLinhasDeEmpregados(normalizarLinhasDeEmpregados(NOMES, comoCsv(dados), porNome), new Map());

    const aba = comoPlanilha(NOMES, dados);
    const nativa = (valorExibido: string, dataCivil: string): CelulaDaTabela => ({
      valorExibido,
      tipoNativo: 'data',
      dataCivil,
      formula: false,
      mesclada: false,
    });
    const [cabecalho, dado] = aba.linhas;
    const comDatas: LeituraDaAba = {
      ...aba,
      linhas: [
        cabecalho as NonNullable<typeof cabecalho>,
        {
          ...(dado as NonNullable<typeof dado>),
          celulas: {
            ...(dado as NonNullable<typeof dado>).celulas,
            D: nativa('15/03/90', '1990-03-15'),
            E: nativa('fev/15', '2015-02-01'),
          },
        },
      ],
    };
    const tabela = tabelaParaRegistros(comDatas, 1, Object.values(porLetra), {
      letrasDeData: [porLetra.data_nascimento, porLetra.data_admissao],
    });
    const planilha = validarLinhasDeEmpregados(
      normalizarLinhasDeEmpregados(tabela.cabecalho, tabela.registros, porLetra, tabela.rejeicoesEstruturaisPorLinha),
      new Map(),
    );

    expect(planilha).toEqual(csv);
  });
});
