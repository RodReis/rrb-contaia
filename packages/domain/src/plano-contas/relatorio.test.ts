/**
 * Relatório CSV da importação do plano de contas (SPEC-013 §3.9).
 */
import { describe, expect, it } from 'vitest';

import { gerarRelatorioCsv } from './relatorio.js';
import type { LinhaDoRelatorio } from './relatorio.js';

const BOM = String.fromCharCode(0xfeff);
const CABECALHO = 'linha;codigo;nome;tipo;natureza;conta_pai;status;acao;codigo_de_erro;campo;mensagem';

const linha = (dados: Partial<LinhaDoRelatorio> = {}): LinhaDoRelatorio => ({
  numeroDaLinha: 2,
  codigo: '1',
  nome: 'Ativo',
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: null,
  status: 'VALIDA',
  acao: 'INCLUIR',
  codigoDeErro: null,
  campo: null,
  mensagem: null,
  ...dados,
});

async function* de(linhas: readonly LinhaDoRelatorio[]): AsyncGenerator<LinhaDoRelatorio> {
  for (const l of linhas) {
    yield l;
  }
}

const gerar = async (linhas: readonly LinhaDoRelatorio[]): Promise<string> => {
  let saida = '';
  for await (const parte of gerarRelatorioCsv(de(linhas))) {
    saida += parte;
  }
  return saida;
};

describe('gerarRelatorioCsv', () => {
  it('começa com BOM, usa ponto e vírgula e CRLF', async () => {
    const csv = await gerar([linha()]);

    expect(csv.startsWith(BOM + CABECALHO + '\r\n')).toBe(true);
    expect(csv).toContain('2;1;Ativo;sintetica;devedora;;VALIDA;INCLUIR;;;\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/u);
  });

  it('sem linhas, emite só BOM e cabeçalho', async () => {
    expect(await gerar([])).toBe(BOM + CABECALHO + '\r\n');
  });

  it("neutraliza injeção de fórmula: célula iniciada em = + - @ recebe o prefixo '", async () => {
    const csv = await gerar([linha({ codigo: '=1+1', nome: '+SOMA(A1)', contaPai: '-5', mensagem: '@cmd' })]);

    expect(csv).toContain("2;'=1+1;'+SOMA(A1);sintetica;devedora;'-5;VALIDA;INCLUIR;;;'@cmd\r\n");
  });

  it('neutraliza também tabulação e CR iniciais, que o Excel trata como início de fórmula', async () => {
    const csv = await gerar([linha({ nome: '\t=1', mensagem: '\r=2' })]);

    expect(csv).toContain("'\t=1");
    expect(csv).toContain('"\'\r=2"');
  });

  it('não prefixa quando o símbolo não está no início da célula', async () => {
    const csv = await gerar([linha({ nome: 'Caixa = geral', codigo: '1-2' })]);

    expect(csv).toContain(';1-2;Caixa = geral;');
  });

  it('escapa aspas, ponto e vírgula e quebras de linha', async () => {
    const csv = await gerar([linha({ nome: 'Banco "A"; filial', mensagem: 'linha 1\nlinha 2\r\nlinha 3' })]);

    expect(csv).toContain('"Banco ""A""; filial"');
    expect(csv).toContain('"linha 1\nlinha 2\r\nlinha 3"');
  });

  it('aplica o prefixo antes do escape quando a célula também precisa de aspas', async () => {
    const csv = await gerar([linha({ nome: '=A1;B1' })]);

    expect(csv).toContain('"\'=A1;B1"');
  });

  it('linha rejeitada leva código de erro, campo e mensagem', async () => {
    const csv = await gerar([
      linha({
        status: 'REJEITADA',
        acao: null,
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        campo: 'tipo',
        mensagem: 'Tipo deve ser analítica ou sintética.',
      }),
    ]);

    expect(csv).toContain(';REJEITADA;;VALOR_FORA_DO_DOMINIO;tipo;Tipo deve ser analítica ou sintética.\r\n');
  });

  it('emite o relatório de 10.000 linhas por demanda, sem consumir a fonte inteira de uma vez', async () => {
    let produzidas = 0;
    async function* fonte(): AsyncGenerator<LinhaDoRelatorio> {
      for (let i = 0; i < 10_000; i += 1) {
        produzidas += 1;
        yield linha({ numeroDaLinha: i + 2, codigo: String(i + 1) });
      }
    }

    const iterador = gerarRelatorioCsv(fonte())[Symbol.asyncIterator]();
    await iterador.next(); // cabeçalho
    await iterador.next(); // primeira linha de dados
    expect(produzidas).toBeLessThanOrEqual(2);

    let pedacos = 2;
    for (;;) {
      const passo = await iterador.next();
      if (passo.done) {
        break;
      }
      pedacos += 1;
    }

    expect(produzidas).toBe(10_000);
    expect(pedacos).toBe(10_001);
  });

  it('propaga o erro da fonte', async () => {
    async function* falha(): AsyncGenerator<LinhaDoRelatorio> {
      yield linha();
      throw new Error('cursor caiu');
    }

    const recebidas: string[] = [];
    await expect(async () => {
      for await (const parte of gerarRelatorioCsv(falha())) {
        recebidas.push(parte);
      }
    }).rejects.toThrow('cursor caiu');
    expect(recebidas).toHaveLength(2); // cabeçalho e a linha anterior à falha
  });
});
