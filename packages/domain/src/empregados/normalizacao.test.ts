import { describe, expect, it } from 'vitest';

import { ErroDeDominio } from '../erros.js';
import type { RegistroDoCsv } from '../plano-contas/csv.js';
import type { MapeamentoDeEmpregados } from './campos.js';
import { normalizarLinhasDeEmpregados } from './normalizacao.js';

const CABECALHO = ['Nome', 'Matricula', 'CPF', 'Admissao', 'Nasc'];
const MAPEAMENTO: MapeamentoDeEmpregados = {
  cpf: 'CPF',
  nome: 'Nome',
  matricula: 'Matricula',
  data_nascimento: 'Nasc',
  data_admissao: 'Admissao',
};

const registro = (numeroDaLinha: number, celulas: string[], camposAMais = 0): RegistroDoCsv => ({
  numeroDaLinha,
  celulas,
  camposAMais,
});

describe('normalizarLinhasDeEmpregados', () => {
  it('reordena pelas colunas mapeadas, apara espaços e preserva a numeração', () => {
    const [linha] = normalizarLinhasDeEmpregados(
      CABECALHO,
      [registro(7, ['  Maria  da Silva ', ' 00123 ', ' 529.982.247-25 ', '01/02/2015', '1990-03-15'])],
      MAPEAMENTO,
    );

    expect(linha).toEqual({
      numeroDaLinha: 7,
      cpf: '529.982.247-25',
      nome: 'Maria  da Silva',
      matricula: '00123',
      dataNascimento: '1990-03-15',
      dataAdmissao: '01/02/2015',
    });
  });

  it('matrícula: zeros à esquerda preservados e Unicode em NFC (acento composto = decomposto)', () => {
    const decomposta = 'Á-01'; // A + acento combinante
    const [linha] = normalizarLinhasDeEmpregados(
      CABECALHO,
      [registro(2, ['N', decomposta, '1', 'a', 'b'])],
      MAPEAMENTO,
    );

    expect(linha?.matricula).toBe('Á-01');
  });

  it('matrícula distingue maiúsculas de minúsculas (não altera a caixa)', () => {
    const [a, b] = normalizarLinhasDeEmpregados(
      CABECALHO,
      [registro(2, ['N', 'ab1', '1', 'a', 'b']), registro(3, ['N', 'AB1', '1', 'a', 'b'])],
      MAPEAMENTO,
    );

    expect(a?.matricula).toBe('ab1');
    expect(b?.matricula).toBe('AB1');
  });

  it('célula ausente na linha curta vira texto vazio', () => {
    const [linha] = normalizarLinhasDeEmpregados(CABECALHO, [registro(2, ['N'])], MAPEAMENTO);

    expect(linha).toMatchObject({ cpf: '', matricula: '', dataNascimento: '', dataAdmissao: '' });
  });

  it('nome só com espaços fica vazio', () => {
    const [linha] = normalizarLinhasDeEmpregados(CABECALHO, [registro(2, ['   ', '1', '1', 'a', 'b'])], MAPEAMENTO);

    expect(linha?.nome).toBe('');
  });

  it('campos a mais que o cabeçalho viram defeitoDeEstrutura', () => {
    const [linha] = normalizarLinhasDeEmpregados(CABECALHO, [registro(2, ['N', '1', '1', 'a', 'b'], 2)], MAPEAMENTO);

    expect(linha?.defeitoDeEstrutura).toBe('CAMPOS_A_MAIS');
  });

  it('mapeamento que aponta para coluna inexistente lança MAPEAMENTO_INCOMPLETO', () => {
    const erro = (() => {
      try {
        normalizarLinhasDeEmpregados(CABECALHO, [], { ...MAPEAMENTO, cpf: 'Documento' });
      } catch (e) {
        return e;
      }
      return null;
    })();

    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe('MAPEAMENTO_INCOMPLETO');
    expect((erro as ErroDeDominio).campos.map((c) => c.campo)).toEqual(['cpf']);
  });
});
