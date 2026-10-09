/**
 * Regras de validação integral do lote de importação do plano de contas (SPEC-013 §3.4).
 */
import { describe, expect, it } from 'vitest';

import { LIMITE_DO_CODIGO_DA_CONTA, LIMITE_DO_NOME_DA_CONTA, validarLinhasDoPlano } from './validacao.js';
import type { ContaVigente, LinhaBrutaDeEntrada, LinhaDeEntrada } from './validacao.js';

const linha = (dados: Partial<LinhaDeEntrada> & { numeroDaLinha: number }): LinhaDeEntrada => ({
  codigo: '1',
  nome: 'Ativo',
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: null,
  ...dados,
});

describe('validarLinhasDoPlano — SPEC-013 §3.4', () => {
  it('aceita linha raiz sem conta-pai e linha filha com pai válido no mesmo lote', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '1', nome: 'Ativo', contaPai: null }),
      linha({ numeroDaLinha: 2, codigo: '1.1', nome: 'Caixa', tipo: 'analitica', contaPai: '1' }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['1', '1.1']);
    expect(resultado.rejeitadas).toHaveLength(0);
  });

  it('aceita conta-pai que aparece depois da filha na ordem física do arquivo', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '1.1', nome: 'Caixa', tipo: 'analitica', contaPai: '1' }),
      linha({ numeroDaLinha: 2, codigo: '1', nome: 'Ativo', contaPai: null }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['1.1', '1']);
    expect(resultado.rejeitadas).toHaveLength(0);
  });

  it('rejeita todas as ocorrências de um código duplicado no arquivo', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '1', nome: 'Ativo A', contaPai: null }),
      linha({ numeroDaLinha: 2, codigo: '1', nome: 'Ativo B', contaPai: null }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas).toHaveLength(0);
    expect(resultado.rejeitadas.map((r) => r.numeroDaLinha)).toEqual([1, 2]);
    expect(resultado.rejeitadas.every((r) => r.codigoDeErro === 'CODIGO_DUPLICADO_NO_ARQUIVO')).toBe(true);
  });

  it('rejeita campo obrigatório ausente sem interromper a validação das demais linhas', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '', nome: 'Ativo', contaPai: null }),
      linha({ numeroDaLinha: 2, codigo: '2', nome: 'Passivo', natureza: 'credora', contaPai: null }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['2']);
    expect(resultado.rejeitadas).toHaveLength(1);
    expect(resultado.rejeitadas[0]).toMatchObject({ numeroDaLinha: 1, campo: 'codigo', codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE' });
  });

  it('rejeita tipo e natureza fora do domínio permitido', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '1', tipo: 'invalido' as never, contaPai: null }),
      linha({ numeroDaLinha: 2, codigo: '2', natureza: 'invalida' as never, contaPai: null }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas).toHaveLength(0);
    expect(resultado.rejeitadas.map((r) => r.codigoDeErro)).toEqual([
      'VALOR_FORA_DO_DOMINIO',
      'VALOR_FORA_DO_DOMINIO',
    ]);
  });

  it('rejeita conta-pai inexistente tanto no plano vigente quanto no lote', () => {
    const linhas: LinhaDeEntrada[] = [linha({ numeroDaLinha: 1, codigo: '1.1', contaPai: '9.9' })];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.rejeitadas).toEqual([
      expect.objectContaining({ numeroDaLinha: 1, codigoDeErro: 'CONTA_PAI_INEXISTENTE' }),
    ]);
  });

  it('rejeita filha cujo pai foi rejeitado, com vínculo causal', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '1', tipo: 'invalido' as never, contaPai: null }),
      linha({ numeroDaLinha: 2, codigo: '1.1', tipo: 'analitica', contaPai: '1' }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });
    const rejeicaoDaFilha = resultado.rejeitadas.find((r) => r.numeroDaLinha === 2);

    expect(rejeicaoDaFilha).toMatchObject({ codigoDeErro: 'CONTA_PAI_REJEITADA' });
  });

  it('rejeita ciclo hierárquico completo', () => {
    const linhas: LinhaDeEntrada[] = [
      linha({ numeroDaLinha: 1, codigo: '1', contaPai: '2' }),
      linha({ numeroDaLinha: 2, codigo: '2', contaPai: '1' }),
    ];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas).toHaveLength(0);
    expect(resultado.rejeitadas.map((r) => r.numeroDaLinha).sort()).toEqual([1, 2]);
    expect(resultado.rejeitadas.every((r) => r.codigoDeErro === 'CICLO_HIERARQUICO')).toBe(true);
  });

  it('rejeita tentativa de transformar em analítica uma conta vigente que possui filhas', () => {
    const contasVigentes: ContaVigente[] = [
      { codigo: '1', tipo: 'sintetica', arquivada: false, temFilhas: true, contaPai: null },
    ];
    const linhas: LinhaDeEntrada[] = [linha({ numeroDaLinha: 1, codigo: '1', tipo: 'analitica', contaPai: null })];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes });

    expect(resultado.rejeitadas).toEqual([
      expect.objectContaining({ numeroDaLinha: 1, codigoDeErro: 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA' }),
    ]);
  });

  it('rejeita código correspondente a conta arquivada e orienta reativação separada', () => {
    const contasVigentes: ContaVigente[] = [
      { codigo: '1', tipo: 'sintetica', arquivada: true, temFilhas: false, contaPai: null },
    ];
    const linhas: LinhaDeEntrada[] = [linha({ numeroDaLinha: 1, codigo: '1', contaPai: null })];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes });

    expect(resultado.rejeitadas).toEqual([
      expect.objectContaining({ numeroDaLinha: 1, codigoDeErro: 'CONTA_ARQUIVADA' }),
    ]);
  });

  it('não exige conta-pai para conta raiz', () => {
    const linhas: LinhaDeEntrada[] = [linha({ numeroDaLinha: 1, codigo: '1', contaPai: null })];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.aceitas).toHaveLength(1);
    expect(resultado.rejeitadas).toHaveLength(0);
  });
});

describe('validarLinhasDoPlano — valores crus vindos do CSV (SPEC-013 §3.3)', () => {
  const bruta = (dados: Partial<LinhaBrutaDeEntrada> & { numeroDaLinha: number }): LinhaBrutaDeEntrada => ({
    codigo: '1',
    nome: 'Ativo',
    tipo: 'sintetica',
    natureza: 'devedora',
    contaPai: null,
    ...dados,
  });

  it('aceita linha crua com tipo e natureza do domínio e devolve os tipos estreitos', () => {
    const resultado = validarLinhasDoPlano({ linhas: [bruta({ numeroDaLinha: 2 })], contasVigentes: [] });

    expect(resultado.aceitas).toEqual([
      { numeroDaLinha: 2, codigo: '1', nome: 'Ativo', tipo: 'sintetica', natureza: 'devedora', contaPai: null },
    ]);
  });

  it('rejeita tipo desconhecido como VALOR_FORA_DO_DOMINIO sem lançar', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, tipo: 'xpto' })],
      contasVigentes: [],
    });

    expect(resultado.aceitas).toHaveLength(0);
    expect(resultado.rejeitadas).toEqual([
      { numeroDaLinha: 2, codigo: '1', campo: 'tipo', codigoDeErro: 'VALOR_FORA_DO_DOMINIO' },
    ]);
  });

  it('rejeita tipo e natureza em branco como CAMPO_OBRIGATORIO_AUSENTE', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '1', tipo: '' }),
        bruta({ numeroDaLinha: 3, codigo: '2', natureza: '' }),
      ],
      contasVigentes: [],
    });

    expect(resultado.rejeitadas).toEqual([
      { numeroDaLinha: 2, codigo: '1', campo: 'tipo', codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE' },
      { numeroDaLinha: 3, codigo: '2', campo: 'natureza', codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE' },
    ]);
  });

  it('rejeita código em branco e mantém o código nulo no relatório', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '' })],
      contasVigentes: [],
    });

    expect(resultado.rejeitadas).toEqual([
      { numeroDaLinha: 2, codigo: null, campo: 'codigo', codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE' },
    ]);
  });

  it('trata 01 e 1 como códigos distintos (comparação textual)', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '01' }), bruta({ numeroDaLinha: 3, codigo: '1' })],
      contasVigentes: [],
    });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['01', '1']);
    expect(resultado.rejeitadas).toHaveLength(0);
  });

  it('rejeita conta cujo pai é ela mesma (ciclo de uma conta)', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '5', contaPai: '5' })],
      contasVigentes: [],
    });

    expect(resultado.aceitas).toHaveLength(0);
    expect(resultado.rejeitadas).toEqual([
      { numeroDaLinha: 2, codigo: '5', campo: 'conta_pai', codigoDeErro: 'CICLO_HIERARQUICO' },
    ]);
  });
});

describe('validarLinhasDoPlano — defeito de estrutura da linha (SPEC-013 §3.4)', () => {
  const linhaBruta = (dados: Partial<LinhaBrutaDeEntrada> & { numeroDaLinha: number }): LinhaBrutaDeEntrada => ({
    codigo: '1',
    nome: 'Ativo',
    tipo: 'sintetica',
    natureza: 'devedora',
    contaPai: null,
    ...dados,
  });

  it('rejeita só a linha com campos a mais, como VALOR_FORA_DO_DOMINIO sem campo e com mensagem em PT-BR', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        linhaBruta({ numeroDaLinha: 2, codigo: '1' }),
        linhaBruta({ numeroDaLinha: 3, codigo: '3', defeitoDeEstrutura: 'CAMPOS_A_MAIS' }),
        linhaBruta({ numeroDaLinha: 4, codigo: '4', tipo: 'analitica', contaPai: '1' }),
      ],
      contasVigentes: [],
    });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['1', '4']);
    expect(resultado.rejeitadas).toEqual([
      {
        numeroDaLinha: 3,
        codigo: '3',
        campo: null,
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        mensagem: "A linha tem mais campos do que o cabeçalho; confira ';' ou aspas no texto.",
      },
    ]);
  });

  it('a linha com defeito não entra na hierarquia: a filha dela é rejeitada com CONTA_PAI_REJEITADA', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        linhaBruta({ numeroDaLinha: 2, codigo: '3', defeitoDeEstrutura: 'CAMPOS_A_MAIS' }),
        linhaBruta({ numeroDaLinha: 3, codigo: '3.1', tipo: 'analitica', contaPai: '3' }),
      ],
      contasVigentes: [],
    });

    expect(resultado.rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro])).toEqual([
      [2, 'VALOR_FORA_DO_DOMINIO'],
      [3, 'CONTA_PAI_REJEITADA'],
    ]);
  });
});

describe('validarLinhasDoPlano — limites de coluna (SPEC-013 §3.3–§3.4)', () => {
  const linhaBruta = (dados: Partial<LinhaBrutaDeEntrada> & { numeroDaLinha: number }): LinhaBrutaDeEntrada => ({
    codigo: '1',
    nome: 'Ativo',
    tipo: 'sintetica',
    natureza: 'devedora',
    contaPai: null,
    ...dados,
  });

  it('expõe os limites do contrato da conta: código até 64 e nome até 255 caracteres', () => {
    expect(LIMITE_DO_CODIGO_DA_CONTA).toBe(64);
    expect(LIMITE_DO_NOME_DA_CONTA).toBe(255);
  });

  it('aceita código com exatamente 64 caracteres e nome com exatamente 255', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [linhaBruta({ numeroDaLinha: 2, codigo: 'C'.repeat(64), nome: 'N'.repeat(255) })],
      contasVigentes: [],
    });

    expect(resultado.rejeitadas).toEqual([]);
    expect(resultado.aceitas).toHaveLength(1);
  });

  it('código com 65 caracteres é rejeição da linha (VALOR_FORA_DO_DOMINIO no campo codigo), com mensagem em PT-BR', () => {
    const codigo = 'C'.repeat(65);
    const resultado = validarLinhasDoPlano({
      linhas: [linhaBruta({ numeroDaLinha: 2, codigo }), linhaBruta({ numeroDaLinha: 3, codigo: '2' })],
      contasVigentes: [],
    });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['2']);
    expect(resultado.rejeitadas).toEqual([
      {
        numeroDaLinha: 2,
        codigo,
        campo: 'codigo',
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        mensagem: 'O código tem 65 caracteres; o limite é 64.',
      },
    ]);
  });

  it('nome com 256 caracteres é rejeição da linha (VALOR_FORA_DO_DOMINIO no campo nome), com mensagem em PT-BR', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [linhaBruta({ numeroDaLinha: 7, codigo: '1', nome: 'N'.repeat(256) })],
      contasVigentes: [],
    });

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas).toEqual([
      {
        numeroDaLinha: 7,
        codigo: '1',
        campo: 'nome',
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        mensagem: 'O nome tem 256 caracteres; o limite é 255.',
      },
    ]);
  });

  it('a filha de um código rejeitado por tamanho recebe CONTA_PAI_REJEITADA', () => {
    const longo = 'C'.repeat(70);
    const resultado = validarLinhasDoPlano({
      linhas: [
        linhaBruta({ numeroDaLinha: 2, codigo: longo }),
        linhaBruta({ numeroDaLinha: 3, codigo: '1.1', tipo: 'analitica', contaPai: longo }),
      ],
      contasVigentes: [],
    });

    expect(resultado.rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro, r.campo])).toEqual([
      [2, 'VALOR_FORA_DO_DOMINIO', 'codigo'],
      [3, 'CONTA_PAI_REJEITADA', 'conta_pai'],
    ]);
  });
});

describe('validarLinhasDoPlano — campo de cada rejeição (SPEC-013 §3.4)', () => {
  it('toda rejeição informa o campo de forma determinística pelo código de erro', () => {
    const vigentes: ContaVigente[] = [
      { codigo: '8', tipo: 'sintetica', arquivada: false, temFilhas: true, contaPai: null },
      { codigo: '9', tipo: 'analitica', arquivada: true, temFilhas: false, contaPai: null },
    ];
    const linhas: LinhaBrutaDeEntrada[] = [
      { numeroDaLinha: 2, codigo: '1', nome: 'Ativo', tipo: 'sintetica', natureza: 'devedora', contaPai: null },
      { numeroDaLinha: 3, codigo: '2', nome: '', tipo: 'sintetica', natureza: 'devedora', contaPai: null },
      { numeroDaLinha: 4, codigo: '3', nome: 'Tipo ruim', tipo: 'grupo', natureza: 'devedora', contaPai: null },
      { numeroDaLinha: 5, codigo: '4', nome: 'Repetida', tipo: 'sintetica', natureza: 'credora', contaPai: null },
      { numeroDaLinha: 6, codigo: '4', nome: 'Repetida de novo', tipo: 'sintetica', natureza: 'credora', contaPai: null },
      { numeroDaLinha: 7, codigo: '4.1', nome: 'Filha da repetida', tipo: 'analitica', natureza: 'credora', contaPai: '4' },
      { numeroDaLinha: 8, codigo: '5.1', nome: 'Sem pai', tipo: 'analitica', natureza: 'devedora', contaPai: '5' },
      { numeroDaLinha: 9, codigo: '6', nome: 'Ciclo A', tipo: 'sintetica', natureza: 'devedora', contaPai: '7' },
      { numeroDaLinha: 10, codigo: '7', nome: 'Ciclo B', tipo: 'sintetica', natureza: 'devedora', contaPai: '6' },
      { numeroDaLinha: 11, codigo: '8', nome: 'Viraria analítica', tipo: 'analitica', natureza: 'devedora', contaPai: null },
      { numeroDaLinha: 12, codigo: '9', nome: 'Arquivada', tipo: 'analitica', natureza: 'devedora', contaPai: null },
      {
        numeroDaLinha: 13,
        codigo: '10',
        nome: 'Campos a mais',
        tipo: 'analitica',
        natureza: 'devedora',
        contaPai: null,
        defeitoDeEstrutura: 'CAMPOS_A_MAIS',
      },
    ];

    const { rejeitadas } = validarLinhasDoPlano({ linhas, contasVigentes: vigentes });

    expect(rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro, r.campo])).toEqual([
      [3, 'CAMPO_OBRIGATORIO_AUSENTE', 'nome'],
      [4, 'VALOR_FORA_DO_DOMINIO', 'tipo'],
      [5, 'CODIGO_DUPLICADO_NO_ARQUIVO', 'codigo'],
      [6, 'CODIGO_DUPLICADO_NO_ARQUIVO', 'codigo'],
      [7, 'CONTA_PAI_REJEITADA', 'conta_pai'],
      [8, 'CONTA_PAI_INEXISTENTE', 'conta_pai'],
      [9, 'CICLO_HIERARQUICO', 'conta_pai'],
      [10, 'CICLO_HIERARQUICO', 'conta_pai'],
      [11, 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA', 'tipo'],
      [12, 'CONTA_ARQUIVADA', 'codigo'],
      // Campos a mais deslocam todas as colunas: a linha inteira, sem campo.
      [13, 'VALOR_FORA_DO_DOMINIO', null],
    ]);
  });
});
