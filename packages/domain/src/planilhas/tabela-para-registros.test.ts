import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { LIMITE_DE_LINHAS } from '../plano-contas/csv.js';
import { tabelaParaRegistros } from './tabela-para-registros.js';
import type { CelulaDaTabela, LeituraDaAba, LinhaDaTabela } from './tipos.js';

type Entrada = string | Partial<CelulaDaTabela>;

const celula = (entrada: Entrada): CelulaDaTabela =>
  typeof entrada === 'string'
    ? { valorExibido: entrada, tipoNativo: entrada === '' ? 'vazio' : 'texto', formula: false, mesclada: false }
    : { valorExibido: '', tipoNativo: 'texto', formula: false, mesclada: false, ...entrada };

const linha = (numero: number, celulas: Record<string, Entrada>, oculta = false): LinhaDaTabela => ({
  numero,
  oculta,
  celulas: Object.fromEntries(Object.entries(celulas).map(([letra, valor]) => [letra, celula(valor)])),
});

const leitura = (linhas: readonly LinhaDaTabela[], mesclas: LeituraDaAba['mesclas'] = []): LeituraDaAba => ({
  formato: 'XLSX',
  aba: { nome: 'Plano', posicao: 1, utilizavel: true },
  linhas,
  mesclas,
  totalDeLinhasOcultas: linhas.filter((l) => l.oculta).length,
});

const codigoDoErro = (acao: () => unknown): string | undefined => {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `outro: ${String(erro)}`;
  }
  return undefined;
};

const BASE = [
  linha(1, { A: 'codigo', B: 'nome', C: 'tipo' }),
  linha(2, { A: '1', B: 'Ativo', C: 'sintetica' }),
  linha(3, { A: '1.1', B: 'Caixa', C: 'analitica' }),
];

describe('tabelaParaRegistros — registros', () => {
  it('devolve só as colunas mapeadas, em ordem de coluna, com o número original da linha', () => {
    const resultado = tabelaParaRegistros(leitura(BASE), 1, ['C', 'A']);

    expect(resultado.cabecalho).toEqual(['A', 'C']);
    expect(resultado.registros).toEqual([
      { numeroDaLinha: 2, celulas: ['1', 'sintetica'], camposAMais: 0 },
      { numeroDaLinha: 3, celulas: ['1.1', 'analitica'], camposAMais: 0 },
    ]);
    expect(resultado.cabecalhoMesclado).toBe(false);
    expect(resultado.ocultas).toBe(0);
    expect(resultado.ignoradasAntesDoCabecalho).toBe(0);
    expect(resultado.rejeicoesEstruturaisPorLinha.size).toBe(0);
  });

  it('letra repetida entra uma vez; célula ausente na linha vira texto vazio', () => {
    const aba = leitura([linha(1, { A: 'a', B: 'b' }), linha(2, { A: 'x' })]);

    const resultado = tabelaParaRegistros(aba, 1, ['B', 'A', 'B']);

    expect(resultado.cabecalho).toEqual(['A', 'B']);
    expect(resultado.registros).toEqual([{ numeroDaLinha: 2, celulas: ['x', ''], camposAMais: 0 }]);
  });

  it('o cabeçalho pode estar em qualquer linha; o que vem antes é ignorado e contado', () => {
    const aba = leitura([
      linha(1, { A: 'Plano de contas — Empresa X' }),
      linha(2, { A: 'Gerado em 11/10/2026' }),
      linha(5, { A: 'codigo', B: 'nome' }),
      linha(6, { A: '1', B: 'Ativo' }),
    ]);

    const resultado = tabelaParaRegistros(aba, 5, ['A', 'B']);

    expect(resultado.ignoradasAntesDoCabecalho).toBe(2);
    expect(resultado.registros).toEqual([{ numeroDaLinha: 6, celulas: ['1', 'Ativo'], camposAMais: 0 }]);
  });

  it('linhas em branco depois do cabeçalho são puladas e não contam', () => {
    const aba = leitura([
      linha(1, { A: 'codigo' }),
      linha(2, { A: '1' }),
      linha(3, { A: '   ' }),
      linha(4, { A: '' }),
      linha(7, { A: '2' }),
    ]);

    const resultado = tabelaParaRegistros(aba, 1, ['A']);

    expect(resultado.registros.map((r) => r.numeroDaLinha)).toEqual([2, 7]);
  });

  it('linhas fora de ordem na leitura saem ordenadas pelo número original', () => {
    const aba = leitura([linha(3, { A: 'c' }), linha(1, { A: 'h' }), linha(2, { A: 'b' })]);

    expect(tabelaParaRegistros(aba, 1, ['A']).registros.map((r) => r.celulas[0])).toEqual(['b', 'c']);
  });
});

describe('tabelaParaRegistros — valor exibido e datas', () => {
  it('usa o valor EXIBIDO: CPF numérico com máscara, zeros visíveis e número sem máscara', () => {
    const aba = leitura([
      linha(1, { A: 'cpf', B: 'matricula' }),
      linha(2, {
        A: { valorExibido: '529.982.247-25', tipoNativo: 'numero' },
        B: { valorExibido: '00123', tipoNativo: 'numero' },
      }),
      linha(3, {
        A: { valorExibido: '52998224725', tipoNativo: 'numero' },
        B: { valorExibido: '123', tipoNativo: 'numero' },
      }),
    ]);

    const { registros } = tabelaParaRegistros(aba, 1, ['A', 'B']);

    expect(registros.map((r) => r.celulas)).toEqual([
      ['529.982.247-25', '00123'],
      ['52998224725', '123'],
    ]);
  });

  it('data nativa em coluna de data alimenta a data civil; em outra coluna segue o valor exibido', () => {
    const data: Partial<CelulaDaTabela> = { valorExibido: '15/03/23', tipoNativo: 'data', dataCivil: '2023-03-15' };
    const aba = leitura([linha(1, { A: 'nascimento', B: 'matricula' }), linha(2, { A: data, B: data })]);

    const { registros } = tabelaParaRegistros(aba, 1, ['A', 'B'], { letrasDeData: ['A'] });

    expect(registros[0]?.celulas).toEqual(['2023-03-15', '15/03/23']);
  });

  it('data em texto e número serial em formato de número seguem como exibidos (o domínio decide)', () => {
    const aba = leitura([
      linha(1, { A: 'nascimento' }),
      linha(2, { A: '15/03/2023' }),
      linha(3, { A: { valorExibido: '45000', tipoNativo: 'numero' } }),
      linha(4, { A: { valorExibido: '15/03/2023', tipoNativo: 'data' } }), // sem dataCivil: cai no exibido
    ]);

    const { registros } = tabelaParaRegistros(aba, 1, ['A'], { letrasDeData: ['A'] });

    expect(registros.map((r) => r.celulas[0])).toEqual(['15/03/2023', '45000', '15/03/2023']);
  });
});

describe('tabelaParaRegistros — linhas ocultas', () => {
  it('processa a linha oculta e a conta; oculta antes do cabeçalho não entra na conta', () => {
    const aba = leitura([
      linha(1, { A: 'lixo' }, true),
      linha(2, { A: 'codigo' }),
      linha(3, { A: '1' }, true),
      linha(4, { A: '2' }),
      linha(5, { A: '3' }, true),
    ]);

    const resultado = tabelaParaRegistros(aba, 2, ['A']);

    expect(resultado.registros.map((r) => r.numeroDaLinha)).toEqual([3, 4, 5]);
    expect(resultado.ocultas).toBe(2);
    expect(resultado.ignoradasAntesDoCabecalho).toBe(1);
  });

  it('linha oculta e em branco não é contada', () => {
    const aba = leitura([linha(1, { A: 'codigo' }), linha(2, { A: '' }, true), linha(3, { A: '1' })]);

    expect(tabelaParaRegistros(aba, 1, ['A']).ocultas).toBe(0);
  });
});

describe('tabelaParaRegistros — fórmula e mescla em coluna mapeada', () => {
  it('fórmula rejeita só a linha afetada, mesmo com resultado salvo, e não repete o valor', () => {
    const aba = leitura([
      linha(1, { A: 'codigo', B: 'nome' }),
      linha(2, { A: '1', B: { valorExibido: 'Resultado salvo', formula: true } }),
      linha(3, { A: '2', B: 'Caixa' }),
    ]);

    const resultado = tabelaParaRegistros(aba, 1, ['A', 'B']);

    expect(resultado.rejeicoesEstruturaisPorLinha).toEqual(new Map([[2, { codigo: 'CELULA_COM_FORMULA', letra: 'B' }]]));
    expect(resultado.registros).toEqual([
      { numeroDaLinha: 2, celulas: ['1', ''], camposAMais: 0 },
      { numeroDaLinha: 3, celulas: ['2', 'Caixa'], camposAMais: 0 },
    ]);
  });

  it('fórmula em coluna NÃO mapeada é ignorada', () => {
    const aba = leitura([
      linha(1, { A: 'codigo', B: 'total' }),
      linha(2, { A: '1', B: { valorExibido: '10', formula: true } }),
    ]);

    const resultado = tabelaParaRegistros(aba, 1, ['A']);

    expect(resultado.rejeicoesEstruturaisPorLinha.size).toBe(0);
    expect(resultado.registros[0]?.celulas).toEqual(['1']);
  });

  it('célula marcada como mesclada em coluna mapeada rejeita a linha, sem replicar o valor', () => {
    const aba = leitura([
      linha(1, { A: 'codigo', B: 'nome' }),
      linha(2, { A: '1', B: { valorExibido: 'Ativo', mesclada: true } }),
    ]);

    const resultado = tabelaParaRegistros(aba, 1, ['A', 'B']);

    expect(resultado.rejeicoesEstruturaisPorLinha).toEqual(new Map([[2, { codigo: 'CELULA_MESCLADA', letra: 'B' }]]));
    expect(resultado.registros[0]?.celulas).toEqual(['1', '']);
  });

  it('intervalo mesclado vertical rejeita todas as linhas cobertas, mesmo sem a célula materializada', () => {
    const aba = leitura(
      [
        linha(1, { A: 'codigo', B: 'nome' }),
        linha(2, { A: '1', B: 'Ativo' }),
        linha(3, { A: '2' }),
        linha(4, { A: '3' }),
        linha(5, { A: '4', B: 'Passivo' }),
      ],
      [{ de: 'B2', ate: 'B4' }],
    );

    const resultado = tabelaParaRegistros(aba, 1, ['A', 'B']);

    expect([...resultado.rejeicoesEstruturaisPorLinha.keys()]).toEqual([2, 3, 4]);
    expect(resultado.rejeicoesEstruturaisPorLinha.get(3)).toEqual({ codigo: 'CELULA_MESCLADA', letra: 'B' });
    expect(resultado.registros.map((r) => r.celulas)).toEqual([['1', ''], ['2', ''], ['3', ''], ['4', 'Passivo']]);
  });

  it('intervalo horizontal cobre as colunas mapeadas dentro dele', () => {
    const aba = leitura(
      [linha(1, { A: 'a', B: 'b', C: 'c' }), linha(2, { A: 'x', B: 'y' }), linha(3, { A: 'z', B: 'w', C: 'v' })],
      [{ de: 'B2', ate: 'C2' }],
    );

    expect(tabelaParaRegistros(aba, 1, ['A', 'C']).rejeicoesEstruturaisPorLinha).toEqual(
      new Map([[2, { codigo: 'CELULA_MESCLADA', letra: 'C' }]]),
    );
    expect(tabelaParaRegistros(aba, 1, ['A']).rejeicoesEstruturaisPorLinha.size).toBe(0);
  });

  it('mescla só em coluna não mapeada ou de uma célula só é ignorada', () => {
    const aba = leitura(
      [linha(1, { A: 'codigo', B: 'obs' }), linha(2, { A: '1', B: 'x' }), linha(3, { A: '2', B: 'y' })],
      [
        { de: 'B2', ate: 'B3' },
        { de: 'A2', ate: 'A2' },
      ],
    );

    const resultado = tabelaParaRegistros(aba, 1, ['A']);

    expect(resultado.rejeicoesEstruturaisPorLinha.size).toBe(0);
    expect(resultado.registros).toHaveLength(2);
  });

  it('com várias células afetadas na linha, vale a mais à esquerda; fórmula antes de mescla na mesma coluna', () => {
    const aba = leitura([
      linha(1, { A: 'a', B: 'b', C: 'c' }),
      linha(2, { A: 'x', B: { valorExibido: 'y', formula: true }, C: { valorExibido: 'z', mesclada: true } }),
      linha(3, { A: { valorExibido: 'x', formula: true, mesclada: true }, B: 'y', C: 'z' }),
    ]);

    const resultado = tabelaParaRegistros(aba, 1, ['A', 'B', 'C']);

    expect(resultado.rejeicoesEstruturaisPorLinha.get(2)).toEqual({ codigo: 'CELULA_COM_FORMULA', letra: 'B' });
    expect(resultado.rejeicoesEstruturaisPorLinha.get(3)).toEqual({ codigo: 'CELULA_COM_FORMULA', letra: 'A' });
    expect(resultado.registros[0]?.celulas).toEqual(['x', '', '']);
  });
});

describe('tabelaParaRegistros — cabeçalho mesclado', () => {
  it('bloqueia: sinaliza, não devolve registros e não rejeita linhas', () => {
    const aba = leitura([linha(1, { A: 'Plano de contas' }), linha(2, { A: '1' })], [{ de: 'A1', ate: 'C1' }]);

    const resultado = tabelaParaRegistros(aba, 1, ['A']);

    expect(resultado.cabecalhoMesclado).toBe(true);
    expect(resultado.registros).toEqual([]);
    expect(resultado.rejeicoesEstruturaisPorLinha.size).toBe(0);
  });

  it('mescla em coluna não mapeada do cabeçalho também bloqueia (o cabeçalho é um só)', () => {
    const aba = leitura([linha(1, { A: 'codigo', B: 'x' }), linha(2, { A: '1' })], [{ de: 'B1', ate: 'C1' }]);

    expect(tabelaParaRegistros(aba, 1, ['A']).cabecalhoMesclado).toBe(true);
  });
});

describe('tabelaParaRegistros — limites e erros de estrutura', () => {
  const comLinhas = (dados: number, antes = 0): LeituraDaAba => {
    const linhas: LinhaDaTabela[] = [];
    for (let i = 1; i <= antes; i += 1) linhas.push(linha(i, { A: `titulo ${i}` }));
    const cabecalho = antes + 1;
    linhas.push(linha(cabecalho, { A: 'codigo' }));
    for (let i = 1; i <= dados; i += 1) linhas.push(linha(cabecalho + i, { A: String(i) }));
    return leitura(linhas);
  };

  it('aceita exatamente 10.000 linhas de dados', () => {
    expect(tabelaParaRegistros(comLinhas(LIMITE_DE_LINHAS), 1, ['A']).registros).toHaveLength(LIMITE_DE_LINHAS);
  });

  it('linhas anteriores ao cabeçalho e linhas em branco não entram na conta do limite', () => {
    const aba = comLinhas(LIMITE_DE_LINHAS, 3_000);
    const comBrancas = { ...aba, linhas: [...aba.linhas, linha(20_000, { A: '' }), linha(20_001, { A: '  ' })] };

    const resultado = tabelaParaRegistros(comBrancas, 3_001, ['A']);

    expect(resultado.registros).toHaveLength(LIMITE_DE_LINHAS);
    expect(resultado.ignoradasAntesDoCabecalho).toBe(3_000);
  });

  it('10.001 linhas de dados → ARQUIVO_ACIMA_DO_LIMITE', () => {
    expect(codigoDoErro(() => tabelaParaRegistros(comLinhas(LIMITE_DE_LINHAS + 1), 1, ['A']))).toBe(
      CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
    );
  });

  it('aba sem nenhuma linha → ABA_SEM_DADOS', () => {
    expect(codigoDoErro(() => tabelaParaRegistros(leitura([]), 1, ['A']))).toBe(CODIGOS_DE_ERRO.ABA_SEM_DADOS);
  });

  it('linha de cabeçalho sem conteúdo ou inexistente → CABECALHO_INVALIDO', () => {
    const aba = leitura([linha(2, { A: 'codigo' }), linha(3, { A: '1' })]);

    expect(codigoDoErro(() => tabelaParaRegistros(aba, 1, ['A']))).toBe(CODIGOS_DE_ERRO.CABECALHO_INVALIDO);
    expect(codigoDoErro(() => tabelaParaRegistros(aba, 9, ['A']))).toBe(CODIGOS_DE_ERRO.CABECALHO_INVALIDO);
    expect(codigoDoErro(() => tabelaParaRegistros(aba, 0, ['A']))).toBe(CODIGOS_DE_ERRO.CABECALHO_INVALIDO);
  });

  it('só o cabeçalho, sem dado → ARQUIVO_VAZIO, como no CSV', () => {
    expect(codigoDoErro(() => tabelaParaRegistros(leitura([linha(1, { A: 'codigo' })]), 1, ['A']))).toBe(
      CODIGOS_DE_ERRO.ARQUIVO_VAZIO,
    );
  });

  it('letra mapeada fora de A..XFD ou nenhuma letra → MAPEAMENTO_INCOMPLETO', () => {
    expect(codigoDoErro(() => tabelaParaRegistros(leitura(BASE), 1, ['a']))).toBe(CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO);
    expect(codigoDoErro(() => tabelaParaRegistros(leitura(BASE), 1, ['XFE']))).toBe(CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO);
    expect(codigoDoErro(() => tabelaParaRegistros(leitura(BASE), 1, []))).toBe(CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO);
  });
});
