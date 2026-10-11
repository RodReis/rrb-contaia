import { describe, expect, it } from 'vitest';

import { CAMPOS_DE_EMPREGADO } from './campos.js';
import { MODELO_CSV_DE_EMPREGADOS } from './modelo.js';
import { validarLinhasDeEmpregados } from './validacao.js';

describe('MODELO_CSV_DE_EMPREGADOS', () => {
  const linhas = MODELO_CSV_DE_EMPREGADOS.split('\r\n').filter((l) => l !== '');
  const [cabecalho, ...dados] = linhas;

  it('cabeçalho fixo com os cinco campos, separados por ponto e vírgula, CRLF no fim', () => {
    expect(cabecalho).toBe(CAMPOS_DE_EMPREGADO.join(';'));
    expect(MODELO_CSV_DE_EMPREGADOS.endsWith('\r\n')).toBe(true);
    expect(dados.length).toBeGreaterThanOrEqual(2);
  });

  it('as linhas de exemplo passam na validação do domínio (modelo oficial é importável)', () => {
    const brutas = dados.map((texto, indice) => {
      const [cpf = '', nome = '', matricula = '', dataNascimento = '', dataAdmissao = ''] = texto.split(';');
      return { numeroDaLinha: indice + 2, cpf, nome, matricula, dataNascimento, dataAdmissao };
    });

    const resultado = validarLinhasDeEmpregados(brutas, new Map());

    expect(resultado.map((r) => r.status)).toEqual(brutas.map(() => 'VALIDA'));
  });
});
