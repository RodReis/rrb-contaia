import {
  CODIGOS_DE_ERRO,
  CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO as CODIGOS_DO_DOMINIO_DE_EMPREGADO,
  type LeituraDaAba as LeituraDoDominio,
} from '@contaia/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as raiz from './index.js';
import {
  CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO,
  RejeicaoDeEmpregadoSchema,
} from './empregados.js';
import { RejeicaoDaImportacaoSchema, PreviaDaImportacaoSchema, TentativaDoHistoricoSchema } from './plano-contas.js';
import {
  CODIGOS_DE_ERRO_DE_PLANILHA,
  CamposDePlanilhaDoEnvioSchema,
  ConfiguracaoDePlanilhaSchema,
  DETALHES_DE_PLANILHA_DO_CSV,
  DiagnosticoDeLeituraSchema,
  FORMATOS_DE_ARQUIVO,
  FormatoDeArquivoSchema,
  InspecaoDePlanilhaSchema,
  LeituraDaAbaSchema,
  MENSAGEM_DO_ERRO_DE_PLANILHA,
  PedidoDeInspecaoSchema,
  detalhesDePlanilhaComPadraoDoCsv,
  type FormatoDeArquivo,
  type LeituraDaAba,
} from './tabela.js';

const ID = '0198f3c2-0000-7000-8000-000000000003';

const celula = { valorExibido: '529.982.247-25', tipoNativo: 'numero', formula: false, mesclada: false };
const leitura = {
  formato: 'XLSX',
  aba: { nome: 'Empregados', posicao: 2, utilizavel: true },
  linhas: [{ numero: 3, oculta: false, celulas: { A: celula, AB: { ...celula, tipoNativo: 'data', dataCivil: '2023-03-15' } } }],
  mesclas: [{ de: 'A1', ate: 'C1' }],
  totalDeLinhasOcultas: 0,
};

describe('formatos e contrato tabular', () => {
  it('os três formatos aceitos, nesta ordem', () => {
    expect([...FORMATOS_DE_ARQUIVO]).toEqual(['CSV', 'XLSX', 'ODS']);
    expect(FormatoDeArquivoSchema.safeParse('XLS').success).toBe(false);
    expectTypeOf<FormatoDeArquivo>().toEqualTypeOf<'CSV' | 'XLSX' | 'ODS'>();
  });

  it('a leitura de aba é validada estritamente (serve ao canal IPC do leitor)', () => {
    expect(LeituraDaAbaSchema.parse(leitura)).toEqual(leitura);
    expect(LeituraDaAbaSchema.safeParse({ ...leitura, formato: 'CSV' }).success).toBe(false);
    expect(LeituraDaAbaSchema.safeParse({ ...leitura, extra: 1 }).success).toBe(false);
    expect(LeituraDaAbaSchema.safeParse({ ...leitura, aba: { ...leitura.aba, posicao: 0 } }).success).toBe(false);
    expect(
      LeituraDaAbaSchema.safeParse({ ...leitura, linhas: [{ numero: 0, oculta: false, celulas: {} }] }).success,
    ).toBe(false);
  });

  it('célula: chave é letra A..XFD, data civil tem formato fixo, campo extra é recusado', () => {
    const comLinha = (celulas: unknown) => ({ ...leitura, linhas: [{ numero: 1, oculta: false, celulas }] });

    expect(LeituraDaAbaSchema.safeParse(comLinha({ a: celula })).success).toBe(false);
    expect(LeituraDaAbaSchema.safeParse(comLinha({ XFE: celula })).success).toBe(false);
    expect(LeituraDaAbaSchema.safeParse(comLinha({ XFD: celula })).success).toBe(true);
    expect(LeituraDaAbaSchema.safeParse(comLinha({ A: { ...celula, dataCivil: '15/03/2023' } })).success).toBe(false);
    expect(LeituraDaAbaSchema.safeParse(comLinha({ A: { ...celula, tipoNativo: 'moeda' } })).success).toBe(false);
    expect(LeituraDaAbaSchema.safeParse(comLinha({ A: { ...celula, sobra: 1 } })).success).toBe(false);
  });

  it('os tipos do schema são os do domínio', () => {
    expectTypeOf<LeituraDaAba>().toEqualTypeOf<LeituraDoDominio>();
  });

  it('configuração de planilha: aba por posição e linha de cabeçalho, ambas a partir de 1', () => {
    expect(ConfiguracaoDePlanilhaSchema.parse({ abaPosicao: 2, linhaCabecalho: 5 })).toEqual({ abaPosicao: 2, linhaCabecalho: 5 });
    expect(ConfiguracaoDePlanilhaSchema.safeParse({ abaPosicao: 0, linhaCabecalho: 1 }).success).toBe(false);
    expect(ConfiguracaoDePlanilhaSchema.safeParse({ abaPosicao: 1, linhaCabecalho: 1.5 }).success).toBe(false);
    expect(ConfiguracaoDePlanilhaSchema.safeParse({ abaPosicao: 1 }).success).toBe(false);
    expect(ConfiguracaoDePlanilhaSchema.safeParse({ abaPosicao: 1, linhaCabecalho: 1, x: 1 }).success).toBe(false);
  });
});

describe('campos de planilha no envio e na inspeção (multipart: tudo chega como texto)', () => {
  it('o envio traz aba (posição) e linhaCabecalho; aceita número em texto, recusa lixo', () => {
    expect(CamposDePlanilhaDoEnvioSchema.parse({ aba: '2', linhaCabecalho: '5' })).toEqual({ aba: 2, linhaCabecalho: 5 });
    expect(CamposDePlanilhaDoEnvioSchema.safeParse({ aba: '0', linhaCabecalho: '1' }).success).toBe(false);
    expect(CamposDePlanilhaDoEnvioSchema.safeParse({ aba: 'abc', linhaCabecalho: '1' }).success).toBe(false);
    expect(CamposDePlanilhaDoEnvioSchema.safeParse({ aba: '1' }).success).toBe(false);
  });

  it('a inspeção aceita aba e linhaCabecalho opcionais', () => {
    expect(PedidoDeInspecaoSchema.parse({})).toEqual({});
    expect(PedidoDeInspecaoSchema.parse({ aba: '3' })).toEqual({ aba: 3 });
    expect(PedidoDeInspecaoSchema.parse({ aba: '3', linhaCabecalho: '2' })).toEqual({ aba: 3, linhaCabecalho: 2 });
    expect(PedidoDeInspecaoSchema.safeParse({ linhaCabecalho: '-1' }).success).toBe(false);
    expect(PedidoDeInspecaoSchema.safeParse({ outro: 1 }).success).toBe(false);
  });
});

describe('diagnósticos e inspeção', () => {
  const diagnostico = { codigo: 'LINHAS_OCULTAS_PROCESSADAS', mensagem: 'Linhas ocultas foram processadas.', quantidade: 3 };
  const inspecao = {
    formato: 'XLSX',
    abas: [
      { nome: 'Capa', posicao: 1, utilizavel: false },
      { nome: 'Plano', posicao: 2, utilizavel: true },
    ],
    abaSelecionada: { nome: 'Plano', posicao: 2 },
    linhaCabecalhoSugerida: 3,
    linhaCabecalho: 3,
    colunas: [
      { letra: 'A', nome: 'Código', rotulo: 'Coluna A — Código' },
      { letra: 'B', nome: null, rotulo: 'Coluna B (sem nome)' },
    ],
    amostra: [{ numero: 3, oculta: false, celulas: { A: 'Código' } }],
    linhasIgnoradasAntesDoCabecalho: 2,
    linhasOcultas: 3,
    cabecalhoMesclado: false,
    diagnosticos: [diagnostico],
  };

  it('diagnóstico: código do catálogo, mensagem fixa e quantidade', () => {
    expect(DiagnosticoDeLeituraSchema.parse(diagnostico)).toEqual(diagnostico);
    expect(DiagnosticoDeLeituraSchema.safeParse({ ...diagnostico, codigo: 'QUALQUER' }).success).toBe(false);
    expect(DiagnosticoDeLeituraSchema.safeParse({ ...diagnostico, quantidade: -1 }).success).toBe(false);
  });

  it('inspeção completa; várias abas sem escolha deixam a aba selecionada e as colunas vazias', () => {
    expect(InspecaoDePlanilhaSchema.parse(inspecao)).toEqual(inspecao);
    expect(
      InspecaoDePlanilhaSchema.safeParse({
        ...inspecao,
        abaSelecionada: null,
        linhaCabecalhoSugerida: null,
        linhaCabecalho: null,
        colunas: [],
        amostra: [],
        diagnosticos: [],
      }).success,
    ).toBe(true);
  });

  it('inspeção: CSV não é planilha; campo extra e letra inválida na amostra são recusados', () => {
    expect(InspecaoDePlanilhaSchema.safeParse({ ...inspecao, formato: 'CSV' }).success).toBe(false);
    expect(InspecaoDePlanilhaSchema.safeParse({ ...inspecao, arquivo: 'x' }).success).toBe(false);
    expect(
      InspecaoDePlanilhaSchema.safeParse({ ...inspecao, amostra: [{ numero: 1, oculta: false, celulas: { a1: 'x' } }] }).success,
    ).toBe(false);
  });
});

describe('prévia e histórico: campos de planilha são aditivos, com padrão CSV', () => {
  const previa = {
    tentativaId: ID,
    estado: 'AGUARDANDO_CONFIRMACAO',
    arquivo: { nome: 'plano.xlsx', tamanho: 120, hash: 'a'.repeat(64) },
    mapeamento: { codigo: 'A', nome: 'B', tipo: 'C', natureza: 'D', conta_pai: 'E' },
    totais: { lidas: 3, novas: 2, atualizadas: 0, rejeitadas: 1 },
    amostraRejeicoes: [],
    criadoEm: '2026-10-08T12:00:00.000Z',
    finalizadoEm: null,
    correlationId: 'corr-0001-abc',
    versaoDaPrevia: 0,
    reutilizadaPorIdempotencia: false,
    podeConfirmar: true,
    podeCancelar: true,
    relatorioDisponivel: true,
  };
  const planilha = {
    formato: 'XLSX',
    aba: { nome: 'Plano', posicao: 2 },
    linhaCabecalho: 3,
    linhasIgnoradasAntesDoCabecalho: 2,
    linhasOcultas: 1,
    diagnosticosDaPlanilha: [
      { codigo: 'LINHAS_COM_FORMULA_REJEITADAS', mensagem: 'Linhas com fórmula em coluna mapeada foram rejeitadas.', quantidade: 2 },
    ],
  } as const;

  it('prévia sem nenhum campo novo continua válida (cliente e F13 inalterados)', () => {
    expect(PreviaDaImportacaoSchema.parse(previa)).toEqual(previa);
  });

  it('prévia com os campos de planilha', () => {
    expect(PreviaDaImportacaoSchema.parse({ ...previa, ...planilha })).toEqual({ ...previa, ...planilha });
    expect(PreviaDaImportacaoSchema.safeParse({ ...previa, ...planilha, formato: 'XLS' }).success).toBe(false);
    expect(PreviaDaImportacaoSchema.safeParse({ ...previa, ...planilha, linhaCabecalho: 0 }).success).toBe(false);
    expect(PreviaDaImportacaoSchema.safeParse({ ...previa, ...planilha, aba: { nome: 'x' } }).success).toBe(false);
  });

  it('CSV não tem aba: aba nula é válida', () => {
    expect(PreviaDaImportacaoSchema.safeParse({ ...previa, formato: 'CSV', aba: null }).success).toBe(true);
  });

  it('histórico recebe os mesmos campos', () => {
    const tentativa = {
      id: ID,
      arquivo: previa.arquivo,
      mapeamento: previa.mapeamento,
      usuarioIniciador: { id: ID, nome: 'Rodrigo' },
      usuarioConfirmadorOuCancelador: null,
      estado: 'CONCLUIDA',
      totais: previa.totais,
      inicioEm: previa.criadoEm,
      fimEm: previa.criadoEm,
      correlationId: previa.correlationId,
      reutilizadaPorIdempotencia: true,
    };

    expect(TentativaDoHistoricoSchema.safeParse(tentativa).success).toBe(true);
    expect(TentativaDoHistoricoSchema.parse({ ...tentativa, ...planilha })).toEqual({ ...tentativa, ...planilha });
  });

  it('padrão de CSV para campos ausentes', () => {
    expect(DETALHES_DE_PLANILHA_DO_CSV).toEqual({
      formato: 'CSV',
      aba: null,
      linhaCabecalho: 1,
      linhasIgnoradasAntesDoCabecalho: 0,
      linhasOcultas: 0,
      diagnosticosDaPlanilha: [],
    });
    expect(detalhesDePlanilhaComPadraoDoCsv({})).toEqual(DETALHES_DE_PLANILHA_DO_CSV);
    expect(detalhesDePlanilhaComPadraoDoCsv(planilha)).toEqual(planilha);
    expect(detalhesDePlanilhaComPadraoDoCsv({ formato: 'ODS' })).toEqual({ ...DETALHES_DE_PLANILHA_DO_CSV, formato: 'ODS' });
  });
});

describe('códigos de erro de arquivo/estrutura da planilha', () => {
  it('são os doze do contrato, todos conhecidos pelo domínio e com mensagem acionável em PT-BR', () => {
    expect([...CODIGOS_DE_ERRO_DE_PLANILHA]).toEqual([
      'FORMATO_XLS_NAO_SUPORTADO',
      'FORMATO_XLSM_NAO_SUPORTADO',
      'ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO',
      'ARQUIVO_CORROMPIDO',
      'EXTENSAO_DIFERENTE_DO_CONTEUDO',
      'PLANILHA_SEM_ABA_UTILIZAVEL',
      'ABA_INEXISTENTE',
      'ABA_SEM_DADOS',
      'CABECALHO_MESCLADO',
      'CONFIGURACAO_DE_PLANILHA_INCOMPLETA',
      'LIMITE_DE_PROCESSAMENTO_EXCEDIDO',
      'SERVICO_OCUPADO',
    ]);
    for (const codigo of CODIGOS_DE_ERRO_DE_PLANILHA) {
      expect(CODIGOS_DE_ERRO, codigo).toHaveProperty(codigo, codigo);
      expect(MENSAGEM_DO_ERRO_DE_PLANILHA[codigo].length, codigo).toBeGreaterThan(20);
    }
  });

  it('as mensagens não ecoam conteúdo e orientam a correção', () => {
    expect(MENSAGEM_DO_ERRO_DE_PLANILHA.FORMATO_XLS_NAO_SUPORTADO).toContain('.xlsx');
    expect(MENSAGEM_DO_ERRO_DE_PLANILHA.FORMATO_XLSM_NAO_SUPORTADO).toContain('macro');
    expect(MENSAGEM_DO_ERRO_DE_PLANILHA.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO).toContain('senha');
  });
});

describe('códigos de erro de linha: contrato × domínio com fórmula e mescla', () => {
  it('empregados: a lista completa do contrato é a do domínio, e os dois novos são aceitos na rejeição', () => {
    expect([...CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO]).toEqual([...CODIGOS_DO_DOMINIO_DE_EMPREGADO]);
    const rejeicao = { numeroDaLinha: 4, cpf: null, matricula: null, campo: 'cpf', mensagem: null };

    for (const codigoDeErro of ['CELULA_COM_FORMULA', 'CELULA_MESCLADA']) {
      expect(RejeicaoDeEmpregadoSchema.safeParse({ ...rejeicao, codigoDeErro }).success, codigoDeErro).toBe(true);
    }
  });

  it('plano de contas: os dois novos são aceitos na rejeição', () => {
    const rejeicao = { numeroDaLinha: 4, codigo: null, campo: 'nome', mensagem: null };

    for (const codigoDeErro of ['CELULA_COM_FORMULA', 'CELULA_MESCLADA']) {
      expect(RejeicaoDaImportacaoSchema.safeParse({ ...rejeicao, codigoDeErro }).success, codigoDeErro).toBe(true);
    }
  });
});

describe('exportações da raiz do shared', () => {
  it('expõe o contrato tabular', () => {
    for (const nome of [
      'FORMATOS_DE_ARQUIVO',
      'FormatoDeArquivoSchema',
      'LeituraDaAbaSchema',
      'ConfiguracaoDePlanilhaSchema',
      'InspecaoDePlanilhaSchema',
      'PedidoDeInspecaoSchema',
      'CamposDePlanilhaDoEnvioSchema',
      'DiagnosticoDeLeituraSchema',
      'CODIGOS_DE_ERRO_DE_PLANILHA',
      'MENSAGEM_DO_ERRO_DE_PLANILHA',
      'DETALHES_DE_PLANILHA_DO_CSV',
      'detalhesDePlanilhaComPadraoDoCsv',
      'CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO',
      'formatoPelaExtensao',
      'tipoDeConteudoDoFormato',
    ]) {
      expect(raiz, nome).toHaveProperty(nome);
    }
  });
});
