import { describe, expect, it } from 'vitest';

import { gerarRelatorioCsvDeEmpregados } from './relatorio.js';
import type { LinhaDoRelatorioDeEmpregados } from './relatorio.js';

const BOM = String.fromCharCode(0xfeff);
const CABECALHO =
  'linha;cpf;nome;matricula;data_nascimento;data_admissao;status;acao;codigo_de_erro;campo;mensagem';

const linha = (dados: Partial<LinhaDoRelatorioDeEmpregados> = {}): LinhaDoRelatorioDeEmpregados => ({
  numeroDaLinha: 2,
  cpf: '529.982.247-25',
  nome: 'Maria da Silva',
  matricula: '00123',
  dataNascimento: '1990-03-15',
  dataAdmissao: '2015-02-01',
  status: 'VALIDA',
  acao: 'INCLUIR',
  codigoDeErro: null,
  campo: null,
  mensagem: null,
  ...dados,
});

async function* de(linhas: readonly LinhaDoRelatorioDeEmpregados[]): AsyncGenerator<LinhaDoRelatorioDeEmpregados> {
  for (const l of linhas) {
    yield l;
  }
}

const gerar = async (linhas: readonly LinhaDoRelatorioDeEmpregados[]): Promise<string> => {
  let saida = '';
  for await (const parte of gerarRelatorioCsvDeEmpregados(de(linhas))) {
    saida += parte;
  }
  return saida;
};

describe('gerarRelatorioCsvDeEmpregados', () => {
  it('BOM, cabeçalho de empregados, ponto e vírgula e CRLF', async () => {
    const csv = await gerar([linha()]);

    expect(csv.startsWith(`${BOM}${CABECALHO}\r\n`)).toBe(true);
    expect(csv).toContain('2;529.982.247-25;Maria da Silva;00123;1990-03-15;2015-02-01;VALIDA;INCLUIR;;;\r\n');
  });

  it('neutraliza fórmula (= + - @) em qualquer célula de texto, preservando zeros da matrícula', async () => {
    const csv = await gerar([
      linha({ nome: '=HYPERLINK("http://x")', matricula: '+0012', cpf: '-1', mensagem: '@cmd' }),
    ]);

    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(csv).toContain(";'+0012;");
    expect(csv).toContain(";'-1;");
    expect(csv).toContain(";'@cmd\r\n");
  });

  it('linha rejeitada leva código, campo e mensagem; células nulas saem vazias', async () => {
    const csv = await gerar([
      linha({
        cpf: null,
        status: 'REJEITADA',
        acao: null,
        codigoDeErro: 'CPF_INVALIDO',
        campo: 'cpf',
        mensagem: 'CPF inválido; confira os dígitos.',
      }),
    ]);

    expect(csv).toContain('2;;Maria da Silva;00123;1990-03-15;2015-02-01;REJEITADA;;CPF_INVALIDO;cpf;"CPF inválido; confira os dígitos."\r\n');
  });
});
