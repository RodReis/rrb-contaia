/**
 * Regras de validação integral do lote de importação do plano de contas (SPEC-013 §3.4).
 */
import { describe, expect, it } from 'vitest';

import { validarLinhasDoPlano } from './validacao.js';
import type { ContaVigente, LinhaDeEntrada } from './validacao.js';

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
      { codigo: '1', tipo: 'sintetica', arquivada: false, temFilhas: true },
    ];
    const linhas: LinhaDeEntrada[] = [linha({ numeroDaLinha: 1, codigo: '1', tipo: 'analitica', contaPai: null })];

    const resultado = validarLinhasDoPlano({ linhas, contasVigentes });

    expect(resultado.rejeitadas).toEqual([
      expect.objectContaining({ numeroDaLinha: 1, codigoDeErro: 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA' }),
    ]);
  });

  it('rejeita código correspondente a conta arquivada e orienta reativação separada', () => {
    const contasVigentes: ContaVigente[] = [
      { codigo: '1', tipo: 'sintetica', arquivada: true, temFilhas: false },
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
