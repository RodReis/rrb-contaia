import { describe, expect, it } from 'vitest';

import { CAMPOS_DE_EMPREGADO } from './campos.js';
import { validarMapeamentoDeEmpregados } from './mapeamento.js';

const CABECALHO = ['CPF', 'Nome', 'Matricula', 'Nasc', 'Admissao', 'Extra'];
const COMPLETO = {
  cpf: 'CPF',
  nome: 'Nome',
  matricula: 'Matricula',
  data_nascimento: 'Nasc',
  data_admissao: 'Admissao',
};

describe('validarMapeamentoDeEmpregados', () => {
  it('os cinco campos do contrato, nessa ordem', () => {
    expect([...CAMPOS_DE_EMPREGADO]).toEqual(['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao']);
  });

  it('mapeamento completo e coerente com o cabeçalho é aceito', () => {
    expect(validarMapeamentoDeEmpregados(COMPLETO, CABECALHO)).toEqual({ ok: true, mapeamento: COMPLETO });
  });

  it('apara espaços nos nomes de coluna ao comparar com o cabeçalho', () => {
    const resultado = validarMapeamentoDeEmpregados({ ...COMPLETO, cpf: ' CPF ' }, [' CPF', ...CABECALHO.slice(1)]);

    expect(resultado.ok).toBe(true);
  });

  it('campo ausente ou em branco → AUSENTE', () => {
    const resultado = validarMapeamentoDeEmpregados({ ...COMPLETO, nome: undefined, cpf: '  ' }, CABECALHO);

    expect(resultado).toEqual({
      ok: false,
      pendencias: [
        { campo: 'cpf', motivo: 'AUSENTE' },
        { campo: 'nome', motivo: 'AUSENTE' },
      ],
    });
  });

  it('coluna que não existe no cabeçalho → COLUNA_INEXISTENTE', () => {
    const resultado = validarMapeamentoDeEmpregados({ ...COMPLETO, data_admissao: 'Contratação' }, CABECALHO);

    expect(resultado).toEqual({
      ok: false,
      pendencias: [{ campo: 'data_admissao', motivo: 'COLUNA_INEXISTENTE' }],
    });
  });

  it('a mesma coluna alimentando dois campos → COLUNA_REPETIDA nos dois', () => {
    const resultado = validarMapeamentoDeEmpregados({ ...COMPLETO, data_admissao: 'Nasc' }, CABECALHO);

    expect(resultado).toEqual({
      ok: false,
      pendencias: [
        { campo: 'data_nascimento', motivo: 'COLUNA_REPETIDA' },
        { campo: 'data_admissao', motivo: 'COLUNA_REPETIDA' },
      ],
    });
  });

  it.each([null, undefined, 'texto', 42, [], {}])('entrada que não é mapeamento (%j) → tudo AUSENTE', (entrada) => {
    const resultado = validarMapeamentoDeEmpregados(entrada, CABECALHO);

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? [] : resultado.pendencias.map((p) => p.motivo)).toEqual(Array(5).fill('AUSENTE'));
  });

  it('valor que não é texto vale como ausente; campo desconhecido é ignorado', () => {
    const resultado = validarMapeamentoDeEmpregados({ ...COMPLETO, cpf: 7, salario: 'Extra' }, CABECALHO);

    expect(resultado).toEqual({ ok: false, pendencias: [{ campo: 'cpf', motivo: 'AUSENTE' }] });
  });
});
