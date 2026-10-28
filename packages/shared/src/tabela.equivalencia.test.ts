/**
 * Equivalência total CSV × planilha (SPEC-015 §3.6): o mesmo conteúdo semântico, lido do CSV real
 * (`lerCsv`) ou apresentado como células de uma aba, produz os mesmos totais, códigos de rejeição e
 * linhas aceitas nos dois domínios — hierarquia do plano e duplicidade de empregados incluídas.
 */
import {
  CAMPOS_DE_EMPREGADO,
  CAMPOS_DO_CONTRATO,
  colunaParaLetra,
  normalizarLinhas,
  normalizarLinhasDeEmpregados,
  tabelaParaRegistros,
  validarLinhasDeEmpregados,
  validarLinhasDoPlano,
  type CelulaDaTabela,
  type LeituraDaAba,
  type Mapeamento,
  type MapeamentoDeEmpregados,
  type RegistroDoCsv,
} from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import { lerCsv } from './plano-contas-csv.js';
import { LeituraDaAbaSchema } from './tabela.js';

const csvDe = (linhas: readonly string[]): Uint8Array => new TextEncoder().encode(`${linhas.join('\r\n')}\r\n`);

/** As mesmas células do CSV, agora numa aba XLSX; `tipoNativo` varia conforme o conteúdo, como numa planilha real. */
const abaDe = (cabecalho: readonly string[], registros: readonly RegistroDoCsv[], linhasAcima = 0): LeituraDaAba => {
  const celula = (valor: string): CelulaDaTabela => ({
    valorExibido: valor,
    tipoNativo: valor === '' ? 'vazio' : /^\d+$/u.test(valor) ? 'numero' : 'texto',
    formula: false,
    mesclada: false,
  });
  const linha = (numero: number, valores: readonly string[]) => ({
    numero,
    oculta: false,
    celulas: Object.fromEntries(valores.map((v, i) => [colunaParaLetra(i + 1), celula(v)])),
  });
  return {
    formato: 'XLSX',
    aba: { nome: 'Dados', posicao: 1, utilizavel: true },
    linhas: [
      ...Array.from({ length: linhasAcima }, (_, i) => linha(i + 1, [`Título ${i + 1}`])),
      linha(linhasAcima + 1, cabecalho),
      ...registros.map((r) => linha(r.numeroDaLinha + linhasAcima, r.celulas)),
    ],
    mesclas: [],
    totalDeLinhasOcultas: 0,
  };
};

const PLANO = [
  'codigo;nome;tipo;natureza;conta_pai',
  '1.1.01;Caixa;analitica;devedora;1.1',
  '1;Ativo;sintetica;devedora;',
  '1.1;Ativo Circulante;SINTÉTICA;Devedora;1',
  '2;Passivo;sintetica;credora;',
  '2;Passivo de novo;sintetica;credora;',
  '3;Receita;;credora;',
  '4;Despesa;outro;devedora;',
  '5;Órfã;analitica;devedora;99',
  '6;Ciclo A;sintetica;devedora;7',
  '7;Ciclo B;sintetica;devedora;6',
  '01;Zero à esquerda;sintetica;devedora;',
  '8;Analítica;analitica;devedora;',
  '8.1;Filha da analítica;analitica;devedora;8',
  '9;"Nome com ; e ""aspas""";sintetica;credora;',
];

const EMPREGADOS = [
  'cpf;nome;matricula;data_nascimento;data_admissao',
  '529.982.247-25;Maria da Silva;00123;15/03/1990;01/02/2015',
  '52998224725;Maria Outra;123;1990-03-15;2015-02-01',
  '111.444.777-35;João;A-1;15/03/1990;01/02/2015',
  '111.444.777-35;João de novo;A-1;15/03/1990;01/02/2015',
  '123;CPF ruim;9;15/03/1990;01/02/2015',
  '529.982.247-25;Data ruim;7;31/02/1990;01/02/2015',
  '529.982.247-25;Admissão antes;8;15/03/1990;15/03/1990',
  '529.982.247-25;;10;15/03/1990;01/02/2015',
  '529.982.247-25;Serial;11;45000;01/02/2015',
  '222.333.444-05;Arquivado;Z-1;15/03/1990;01/02/2015',
];

const totais = (statuses: readonly string[]) => ({
  lidas: statuses.length,
  rejeitadas: statuses.filter((s) => s === 'REJEITADA').length,
});

describe('plano de contas — CSV × XLSX', () => {
  const porNome: Mapeamento = Object.fromEntries(CAMPOS_DO_CONTRATO.map((c) => [c, c])) as Mapeamento;
  const porLetra: Mapeamento = Object.fromEntries(
    CAMPOS_DO_CONTRATO.map((c, i) => [c, colunaParaLetra(i + 1)]),
  ) as Mapeamento;
  const vigentes = [
    { codigo: '3', tipo: 'sintetica' as const, arquivada: true, temFilhas: false, contaPai: null },
  ];

  it.each([0, 4])('mesmo resultado com %i linhas de título acima do cabeçalho', (acima) => {
    const csv = lerCsv(csvDe(PLANO));
    const viaCsv = validarLinhasDoPlano({
      linhas: normalizarLinhas(csv.cabecalho, csv.registros, porNome),
      contasVigentes: vigentes,
    });

    const tabela = tabelaParaRegistros(abaDe(csv.cabecalho, csv.registros, acima), acima + 1, Object.values(porLetra));
    const viaPlanilha = validarLinhasDoPlano({
      linhas: normalizarLinhas(tabela.cabecalho, tabela.registros, porLetra, tabela.rejeicoesEstruturaisPorLinha),
      contasVigentes: vigentes,
    });

    const sem = (r: typeof viaCsv) => ({
      aceitas: r.aceitas.map((a) => [a.numeroDaLinha - 0, a.codigo, a.nome, a.tipo, a.natureza, a.contaPai]),
      rejeitadas: r.rejeitadas.map((x) => [x.numeroDaLinha, x.codigo, x.campo, x.codigoDeErro, x.mensagem ?? null]),
    });
    const deslocar = (r: typeof viaCsv) => ({
      aceitas: sem(r).aceitas.map(([n, ...resto]) => [(n as number) + acima, ...resto]),
      rejeitadas: sem(r).rejeitadas.map(([n, ...resto]) => [(n as number) + acima, ...resto]),
    });

    expect(sem(viaPlanilha)).toEqual(deslocar(viaCsv));
    expect(viaCsv.rejeitadas.map((r) => r.codigoDeErro)).toEqual(
      expect.arrayContaining([
        'CODIGO_DUPLICADO_NO_ARQUIVO',
        'CAMPO_OBRIGATORIO_AUSENTE',
        'VALOR_FORA_DO_DOMINIO',
        'CONTA_PAI_INEXISTENTE',
        'CICLO_HIERARQUICO',
        'CLASSE_CONTABIL_INCOMPATIVEL',
      ]),
    );
    expect(viaCsv.aceitas.length + viaCsv.rejeitadas.length).toBe(csv.registros.length);
    expect(viaPlanilha.aceitas.length + viaPlanilha.rejeitadas.length).toBe(csv.registros.length);
  });
});

describe('empregados — CSV × XLSX', () => {
  const porNome: MapeamentoDeEmpregados = Object.fromEntries(CAMPOS_DE_EMPREGADO.map((c) => [c, c])) as MapeamentoDeEmpregados;
  const porLetra: MapeamentoDeEmpregados = Object.fromEntries(
    CAMPOS_DE_EMPREGADO.map((c, i) => [c, colunaParaLetra(i + 1)]),
  ) as MapeamentoDeEmpregados;
  const vigentes = new Map([
    ['11144477735|A-1', { arquivado: false }],
    ['22233344405|Z-1', { arquivado: true }],
  ]);

  it.each([0, 3])('mesmo staging linha a linha, totais e códigos, com %i linhas de título', (acima) => {
    const csv = lerCsv(csvDe(EMPREGADOS));
    const viaCsv = validarLinhasDeEmpregados(normalizarLinhasDeEmpregados(csv.cabecalho, csv.registros, porNome), vigentes);

    const tabela = tabelaParaRegistros(abaDe(csv.cabecalho, csv.registros, acima), acima + 1, Object.values(porLetra), {
      letrasDeData: [porLetra.data_nascimento, porLetra.data_admissao],
    });
    const viaPlanilha = validarLinhasDeEmpregados(
      normalizarLinhasDeEmpregados(tabela.cabecalho, tabela.registros, porLetra, tabela.rejeicoesEstruturaisPorLinha),
      vigentes,
    );

    expect(viaPlanilha.map((l) => ({ ...l, numeroDaLinha: l.numeroDaLinha - acima }))).toEqual(viaCsv);
    expect(totais(viaPlanilha.map((l) => l.status))).toEqual(totais(viaCsv.map((l) => l.status)));
    expect(viaCsv.map((l) => l.codigoDeErro)).toEqual([
      null,
      null,
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'CPF_INVALIDO',
      'DATA_NASCIMENTO_INVALIDA',
      'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
      'CAMPO_OBRIGATORIO_AUSENTE',
      'DATA_NASCIMENTO_INVALIDA',
      'EMPREGADO_ARQUIVADO',
    ]);
  });
});

describe('a leitura que o domínio recebe é a que o schema do canal aceita', () => {
  it('uma aba montada como a do leitor passa na validação estrita', () => {
    const csv = lerCsv(csvDe(EMPREGADOS));

    expect(LeituraDaAbaSchema.safeParse(abaDe(csv.cabecalho, csv.registros, 2)).success).toBe(true);
  });
});
