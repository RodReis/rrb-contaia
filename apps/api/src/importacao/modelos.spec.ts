/**
 * Modelos oficiais por domínio (SPEC-015 §3.1, §10): CSV, XLSX e ODS saem das MESMAS constantes do
 * modelo CSV (fonte única) e o XLSX/ODS gerado volta pelo leitor real e pelo domínio como linhas válidas.
 */
import {
  CAMPOS_DE_EMPREGADO,
  CAMPOS_DO_CONTRATO,
  MODELO_CSV,
  MODELO_CSV_DE_EMPREGADOS,
  colunaParaLetra,
  normalizarLinhas,
  normalizarLinhasDeEmpregados,
  tabelaParaRegistros,
  validarLinhasDeEmpregados,
  validarLinhasDoPlano,
  type Mapeamento,
  type MapeamentoDeEmpregados,
} from '@contaia/domain';
import { lerAba } from '@contaia/planilhas';
import { TIPO_DE_CONTEUDO_ODS, TIPO_DE_CONTEUDO_XLSX, lerCsv } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import { montarModelo } from './modelos';

const BOM = String.fromCharCode(0xfeff);
const letras = (quantidade: number): string[] => Array.from({ length: quantidade }, (_, i) => colunaParaLetra(i + 1));
const porLetra = <Campo extends string>(campos: readonly Campo[]) =>
  Object.fromEntries(campos.map((campo, i) => [campo, colunaParaLetra(i + 1)])) as Record<Campo, string>;

describe('montarModelo', () => {
  it('csv é o modelo de hoje, com BOM (comportamento das F13/F14)', () => {
    const modelo = montarModelo(MODELO_CSV, 'csv');

    expect(modelo).toEqual({ conteudo: `${BOM}${MODELO_CSV}`, tipoConteudo: 'text/csv; charset=utf-8', extensao: 'csv' });
  });

  it.each([
    ['xlsx', TIPO_DE_CONTEUDO_XLSX],
    ['ods', TIPO_DE_CONTEUDO_ODS],
  ] as const)('%s: tipo de conteúdo e extensão próprios', (formato, tipo) => {
    const modelo = montarModelo(MODELO_CSV, formato);

    expect(modelo.tipoConteudo).toBe(tipo);
    expect(modelo.extensao).toBe(formato);
    expect(Buffer.isBuffer(modelo.conteudo)).toBe(true);
  });

  describe.each([
    ['plano de contas', MODELO_CSV],
    ['empregados', MODELO_CSV_DE_EMPREGADOS],
  ])('%s', (_dominio, modeloCsv) => {
    const csv = lerCsv(Buffer.from(modeloCsv, 'utf8'));

    it.each(['xlsx', 'ods'] as const)('%s tem exatamente os cabeçalhos do modelo CSV e a 1ª linha de exemplo dele', (formato) => {
      const leitura = lerAba(montarModelo(modeloCsv, formato).conteudo as Buffer, 1);
      const [cabecalho, exemplo] = [...leitura.linhas].sort((a, b) => a.numero - b.numero);
      const valores = (linha: typeof cabecalho) =>
        letras(csv.cabecalho.length).map((letra) => linha?.celulas[letra]?.valorExibido ?? '');

      expect(valores(cabecalho)).toEqual(csv.cabecalho);
      expect(valores(exemplo)).toEqual(csv.registros[0]?.celulas);
    });
  });

  it.each(['xlsx', 'ods'] as const)('plano de contas %s: ida e volta no leitor e no domínio, sem rejeição', (formato) => {
    const leitura = lerAba(montarModelo(MODELO_CSV, formato).conteudo as Buffer, 1);
    const mapeamento = porLetra(CAMPOS_DO_CONTRATO) as Mapeamento;
    const tabela = tabelaParaRegistros(leitura, 1, Object.values(mapeamento));
    const linhas = normalizarLinhas(tabela.cabecalho, tabela.registros, mapeamento, tabela.rejeicoesEstruturaisPorLinha);
    const resultado = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(resultado.rejeitadas).toEqual([]);
    expect(resultado.aceitas).toHaveLength(1);
  });

  it.each(['xlsx', 'ods'] as const)('empregados %s: ida e volta no leitor e no domínio, sem rejeição', (formato) => {
    const leitura = lerAba(montarModelo(MODELO_CSV_DE_EMPREGADOS, formato).conteudo as Buffer, 1);
    const mapeamento = porLetra(CAMPOS_DE_EMPREGADO) as MapeamentoDeEmpregados;
    const tabela = tabelaParaRegistros(leitura, 1, Object.values(mapeamento), {
      letrasDeData: [mapeamento.data_nascimento, mapeamento.data_admissao],
    });
    const linhas = normalizarLinhasDeEmpregados(tabela.cabecalho, tabela.registros, mapeamento, tabela.rejeicoesEstruturaisPorLinha);
    const staging = validarLinhasDeEmpregados(linhas, new Map());

    expect(staging.map((linha) => [linha.status, linha.codigoDeErro])).toEqual([['VALIDA', null]]);
    expect(staging[0]).toMatchObject({ cpfNormalizado: '52998224725', matricula: '00123' });
  });
});
