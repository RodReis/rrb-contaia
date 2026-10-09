/**
 * Hierarquia RESULTANTE da importação (SPEC-013 §3.4, §7): o lote é avaliado junto com o plano
 * vigente — ciclo formado com contas vigentes, conta analítica com filhas e filha de pai rejeitado
 * que existe no plano vigente.
 */
import { describe, expect, it } from 'vitest';

import { validarLinhasDoPlano } from './validacao.js';
import type { ContaVigente, LinhaBrutaDeEntrada, ResultadoDaValidacao } from './validacao.js';

const vigente = (dados: Partial<ContaVigente> & { codigo: string }): ContaVigente => ({
  tipo: 'sintetica',
  arquivada: false,
  temFilhas: false,
  contaPai: null,
  ...dados,
});

const bruta = (dados: Partial<LinhaBrutaDeEntrada> & { numeroDaLinha: number; codigo: string }): LinhaBrutaDeEntrada => ({
  nome: `Conta ${dados.codigo}`,
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: null,
  ...dados,
});

const desfecho = (resultado: ResultadoDaValidacao) => ({
  aceitas: resultado.aceitas.map((a) => a.codigo),
  rejeitadas: resultado.rejeitadas.map((r) => [r.codigo, r.codigoDeErro, r.campo]),
});

const MENSAGEM_PAI_ANALITICO = 'A conta-pai é analítica; apenas conta sintética pode ter filhas.';

describe('validarLinhasDoPlano — ciclo com o plano vigente (SPEC-013 §3.4, §7)', () => {
  it('rejeita re-parentear uma raiz vigente sob a própria descendente vigente (1 → 1.1 → 1)', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '1', contaPai: '1.1' })],
      contasVigentes: [vigente({ codigo: '1', temFilhas: true }), vigente({ codigo: '1.1', contaPai: '1' })],
    });

    expect(desfecho(resultado)).toEqual({ aceitas: [], rejeitadas: [['1', 'CICLO_HIERARQUICO', 'conta_pai']] });
  });

  it('rejeita a troca de pai de uma conta vigente que fecharia um ciclo com outras vigentes', () => {
    // Vigente: A (raiz) ← B ← C. O lote põe A sob C: A → C → B → A.
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: 'A', contaPai: 'C' })],
      contasVigentes: [
        vigente({ codigo: 'A', temFilhas: true }),
        vigente({ codigo: 'B', contaPai: 'A', temFilhas: true }),
        vigente({ codigo: 'C', contaPai: 'B' }),
      ],
    });

    expect(desfecho(resultado)).toEqual({ aceitas: [], rejeitadas: [['A', 'CICLO_HIERARQUICO', 'conta_pai']] });
  });

  it('rejeita duas contas vigentes que trocam de pai entre si no mesmo lote', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: 'X', contaPai: 'Y' }), bruta({ numeroDaLinha: 3, codigo: 'Y', contaPai: 'X' })],
      contasVigentes: [
        vigente({ codigo: 'R', temFilhas: true }),
        vigente({ codigo: 'X', contaPai: 'R' }),
        vigente({ codigo: 'Y', contaPai: 'R' }),
      ],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['X', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['Y', 'CICLO_HIERARQUICO', 'conta_pai'],
      ],
    });
  });

  it('continua rejeitando o ciclo formado só por linhas do lote (regressão)', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: 'N1', contaPai: 'N3' }),
        bruta({ numeroDaLinha: 3, codigo: 'N2', contaPai: 'N1' }),
        bruta({ numeroDaLinha: 4, codigo: 'N3', contaPai: 'N2' }),
        bruta({ numeroDaLinha: 5, codigo: 'N4', tipo: 'analitica', contaPai: 'N3' }),
      ],
      contasVigentes: [],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['N1', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['N2', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['N3', 'CICLO_HIERARQUICO', 'conta_pai'],
        // Fora do ciclo: filha de uma conta rejeitada (vínculo causal), não parte do ciclo.
        ['N4', 'CONTA_PAI_REJEITADA', 'conta_pai'],
      ],
    });
  });

  it('rejeita o ciclo longo que atravessa contas vigentes e linhas novas do lote', () => {
    // Vigente: R ← V1 ← V2. Lote: N1 (pai V2), N2 (pai N1) e R passa a ser filha de N2.
    // Plano pretendido: R → N2 → N1 → V2 → V1 → R.
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: 'N1', contaPai: 'V2' }),
        bruta({ numeroDaLinha: 3, codigo: 'N2', contaPai: 'N1' }),
        bruta({ numeroDaLinha: 4, codigo: 'R', contaPai: 'N2' }),
      ],
      contasVigentes: [
        vigente({ codigo: 'R', temFilhas: true }),
        vigente({ codigo: 'V1', contaPai: 'R', temFilhas: true }),
        vigente({ codigo: 'V2', contaPai: 'V1' }),
      ],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['N1', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['N2', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['R', 'CICLO_HIERARQUICO', 'conta_pai'],
      ],
    });
  });

  it('aceita mover uma conta vigente para outro ramo quando não forma ciclo', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '1.1', contaPai: '2' })],
      contasVigentes: [vigente({ codigo: '1', temFilhas: true }), vigente({ codigo: '1.1', contaPai: '1' }), vigente({ codigo: '2' })],
    });

    expect(desfecho(resultado)).toEqual({ aceitas: ['1.1'], rejeitadas: [] });
  });

  it('a conta vigente que fica com o pai antigo (linha rejeitada) não reabre um ciclo no plano final', () => {
    // Vigente: A (raiz) ← Q ← V. O lote põe A sob V e traz Q com pai inexistente.
    // Q é rejeitada e continua sob A no plano; aceitar A fecharia A → V → Q → A.
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: 'A', contaPai: 'V' }), bruta({ numeroDaLinha: 3, codigo: 'Q', contaPai: 'X' })],
      contasVigentes: [
        vigente({ codigo: 'A', temFilhas: true }),
        vigente({ codigo: 'Q', contaPai: 'A', temFilhas: true }),
        vigente({ codigo: 'V', contaPai: 'Q' }),
      ],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['A', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['Q', 'CONTA_PAI_INEXISTENTE', 'conta_pai'],
      ],
    });
  });

  it('a filha cujo caminho até a raiz passa por conta vigente que volta ao pai antigo é aceita', () => {
    // Vigente: Q (raiz) ← V. O lote traz Q ↔ P em ciclo e S sob V. Q é rejeitada e fica raiz;
    // V continua sob Q, e S sob V é válida no plano final.
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: 'Q', contaPai: 'P' }),
        bruta({ numeroDaLinha: 3, codigo: 'P', contaPai: 'Q' }),
        bruta({ numeroDaLinha: 4, codigo: 'S', tipo: 'analitica', contaPai: 'V' }),
      ],
      contasVigentes: [vigente({ codigo: 'Q', temFilhas: true }), vigente({ codigo: 'V', contaPai: 'Q' })],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: ['S'],
      rejeitadas: [
        ['Q', 'CICLO_HIERARQUICO', 'conta_pai'],
        ['P', 'CICLO_HIERARQUICO', 'conta_pai'],
      ],
    });
  });
});

describe('validarLinhasDoPlano — conta analítica não tem filhas (SPEC-013 §3.4)', () => {
  it('(a) rejeita a filha nova de uma conta analítica vigente, no campo conta_pai', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '1.1.1', tipo: 'analitica', contaPai: '1.1' })],
      contasVigentes: [vigente({ codigo: '1', temFilhas: true }), vigente({ codigo: '1.1', tipo: 'analitica', contaPai: '1' })],
    });

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas).toEqual([
      {
        numeroDaLinha: 2,
        codigo: '1.1.1',
        campo: 'conta_pai',
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        mensagem: MENSAGEM_PAI_ANALITICO,
      },
    ]);
  });

  it('(a) aceita a filha quando o mesmo lote transforma a analítica vigente em sintética', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '1.1', tipo: 'sintetica', contaPai: '1' }),
        bruta({ numeroDaLinha: 3, codigo: '1.1.1', tipo: 'analitica', contaPai: '1.1' }),
      ],
      contasVigentes: [vigente({ codigo: '1', temFilhas: true }), vigente({ codigo: '1.1', tipo: 'analitica', contaPai: '1' })],
    });

    expect(desfecho(resultado)).toEqual({ aceitas: ['1.1', '1.1.1'], rejeitadas: [] });
  });

  it('(b) rejeita a sintética vigente sem filhas que vira analítica no lote que lhe dá filhas', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '1', tipo: 'analitica' }),
        bruta({ numeroDaLinha: 3, codigo: '1.1', tipo: 'analitica', contaPai: '1' }),
      ],
      contasVigentes: [vigente({ codigo: '1' })],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['1', 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA', 'tipo'],
        // A conta-pai foi rejeitada: a filha segue o vínculo causal.
        ['1.1', 'CONTA_PAI_REJEITADA', 'conta_pai'],
      ],
    });
  });

  it('(b) aceita a sintética vigente sem filhas que vira analítica quando o lote não lhe dá filhas', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '1', tipo: 'analitica' })],
      contasVigentes: [vigente({ codigo: '1' })],
    });

    expect(desfecho(resultado)).toEqual({ aceitas: ['1'], rejeitadas: [] });
  });

  it('(b) a sintética vigente com filhas não vira analítica mesmo que o lote mova as filhas para outro ramo', () => {
    // Conservador: as filhas podem ser recusadas no mesmo lote e voltar ao pai antigo.
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '1', tipo: 'analitica' }), bruta({ numeroDaLinha: 3, codigo: '1.1', contaPai: '2' })],
      contasVigentes: [vigente({ codigo: '1', temFilhas: true }), vigente({ codigo: '1.1', contaPai: '1' }), vigente({ codigo: '2' })],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: ['1.1'],
      rejeitadas: [['1', 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA', 'tipo']],
    });
  });

  it('(c) rejeita a filha de um pai novo analítico do mesmo lote, em qualquer ordem física', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '5.1', tipo: 'analitica', contaPai: '5' }),
        bruta({ numeroDaLinha: 3, codigo: '5', tipo: 'analitica' }),
      ],
      contasVigentes: [],
    });

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['5']);
    expect(resultado.rejeitadas).toEqual([
      {
        numeroDaLinha: 2,
        codigo: '5.1',
        campo: 'conta_pai',
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        mensagem: MENSAGEM_PAI_ANALITICO,
      },
    ]);
  });
});

describe('validarLinhasDoPlano — filha de pai rejeitado que existe no plano vigente (SPEC-013 §3.4, §7)', () => {
  it('rejeita com CONTA_PAI_REJEITADA a filha cujo pai vigente foi rejeitado no lote', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '1', nome: '' }),
        bruta({ numeroDaLinha: 3, codigo: '1.9', tipo: 'analitica', contaPai: '1' }),
      ],
      contasVigentes: [vigente({ codigo: '1' })],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['1', 'CAMPO_OBRIGATORIO_AUSENTE', 'nome'],
        ['1.9', 'CONTA_PAI_REJEITADA', 'conta_pai'],
      ],
    });
  });

  it('filha de conta arquivada rejeitada no lote recebe CONTA_PAI_REJEITADA, não CONTA_PAI_INEXISTENTE', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '9' }), bruta({ numeroDaLinha: 3, codigo: '9.1', tipo: 'analitica', contaPai: '9' })],
      contasVigentes: [vigente({ codigo: '9', arquivada: true })],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['9', 'CONTA_ARQUIVADA', 'codigo'],
        ['9.1', 'CONTA_PAI_REJEITADA', 'conta_pai'],
      ],
    });
  });

  it('filha de conta arquivada ausente do lote continua CONTA_PAI_INEXISTENTE (arquivada não é pai válido)', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [bruta({ numeroDaLinha: 2, codigo: '9.1', tipo: 'analitica', contaPai: '9' })],
      contasVigentes: [vigente({ codigo: '9', arquivada: true })],
    });

    expect(desfecho(resultado)).toEqual({ aceitas: [], rejeitadas: [['9.1', 'CONTA_PAI_INEXISTENTE', 'conta_pai']] });
  });

  it('filha de conta duplicada no lote que também existe no plano vigente recebe CONTA_PAI_REJEITADA', () => {
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '1' }),
        bruta({ numeroDaLinha: 3, codigo: '1' }),
        bruta({ numeroDaLinha: 4, codigo: '1.2', tipo: 'analitica', contaPai: '1' }),
      ],
      contasVigentes: [vigente({ codigo: '1' })],
    });

    expect(desfecho(resultado).rejeitadas).toEqual([
      ['1', 'CODIGO_DUPLICADO_NO_ARQUIVO', 'codigo'],
      ['1', 'CODIGO_DUPLICADO_NO_ARQUIVO', 'codigo'],
      ['1.2', 'CONTA_PAI_REJEITADA', 'conta_pai'],
    ]);
  });

  it('código repetido numa linha inválida e numa válida: as duas ficam de fora e a filha segue o vínculo', () => {
    // SPEC §3.4: o código que aparece mais de uma vez no arquivo tem TODAS as ocorrências rejeitadas.
    const resultado = validarLinhasDoPlano({
      linhas: [
        bruta({ numeroDaLinha: 2, codigo: '3.1', tipo: 'analitica', contaPai: '3' }),
        bruta({ numeroDaLinha: 3, codigo: '3', nome: '' }),
        bruta({ numeroDaLinha: 4, codigo: '3' }),
      ],
      contasVigentes: [],
    });

    expect(desfecho(resultado)).toEqual({
      aceitas: [],
      rejeitadas: [
        ['3.1', 'CONTA_PAI_REJEITADA', 'conta_pai'],
        ['3', 'CAMPO_OBRIGATORIO_AUSENTE', 'nome'],
        ['3', 'CODIGO_DUPLICADO_NO_ARQUIVO', 'codigo'],
      ],
    });
  });
});
