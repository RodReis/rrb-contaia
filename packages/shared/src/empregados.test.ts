import {
  CODIGOS_DE_ERRO_DE_EMPREGADO as CODIGOS_DO_DOMINIO,
  LIMITE_DE_BYTES,
  MODELO_CSV_DE_EMPREGADOS,
  normalizarLinhasDeEmpregados,
  validarLinhasDeEmpregados,
  validarMapeamentoDeEmpregados,
  type CodigoDeErroDeEmpregado as CodigoDoDominio,
} from '@contaia/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES,
  conteudoConfereComOTipo,
  formatarLimite,
  mensagemDaFalha,
  validarArquivo,
} from './arquivos.js';
import {
  CODIGOS_DE_ERRO_DE_EMPREGADO,
  EmpregadoDaBaseSchema,
  FILA_DE_VALIDACAO_EMPREGADOS,
  FILA_DE_VALIDACAO_EMPREGADOS_MORTA,
  NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS,
  OPCOES_DE_VALIDACAO_EMPREGADOS,
  PaginaDeEmpregadosSchema,
  PaginaDeRejeicoesDeEmpregadosSchema,
  PreviaDaImportacaoDeEmpregadosSchema,
  RejeicaoDeEmpregadoSchema,
  type CodigoDeErroDeEmpregado,
} from './empregados.js';
import * as raiz from './index.js';
import { lerCsv } from './plano-contas-csv.js';
import {
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  OPCOES_DE_VALIDACAO_PLANO_CONTAS,
  PaginaDeRejeicoesDaImportacaoSchema,
  PreviaDaImportacaoSchema,
  RejeicaoDaImportacaoSchema,
} from './plano-contas.js';

const ID = '0198f3c2-0000-7000-8000-000000000003';
const AGORA = '2026-10-11T12:00:00.000Z';

const rejeicao = {
  numeroDaLinha: 3,
  cpf: '123.456.789-00',
  matricula: '00123',
  campo: 'cpf',
  codigoDeErro: 'CPF_INVALIDO',
  mensagem: 'CPF inválido.',
};

const previa = {
  tentativaId: ID,
  estado: 'AGUARDANDO_CONFIRMACAO',
  arquivo: { nome: 'empregados.csv', tamanho: 120, hash: 'a'.repeat(64) },
  mapeamento: { cpf: 'CPF' },
  totais: { lidas: 2, novas: 1, atualizadas: 0, rejeitadas: 1 },
  amostraRejeicoes: [rejeicao],
  criadoEm: AGORA,
  finalizadoEm: null,
  correlationId: 'corr-0001-abc',
  versaoDaPrevia: 4,
  reutilizadaPorIdempotencia: false,
  podeConfirmar: true,
  podeCancelar: true,
  relatorioDisponivel: true,
};

describe('fila de validação de empregados (SPEC-014 §6.4)', () => {
  it('nomes próprios, sem ":" (BullMQ 6) e distintos da fila do plano de contas', () => {
    expect(FILA_DE_VALIDACAO_EMPREGADOS).not.toContain(':');
    expect(FILA_DE_VALIDACAO_EMPREGADOS_MORTA).not.toContain(':');
    expect(NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS.length).toBeGreaterThan(0);
    expect(FILA_DE_VALIDACAO_EMPREGADOS).not.toBe(FILA_DE_VALIDACAO_PLANO_CONTAS);
    expect(FILA_DE_VALIDACAO_EMPREGADOS_MORTA).not.toBe(FILA_DE_VALIDACAO_EMPREGADOS);
  });

  it('retry com as mesmas opções do plano: 5 tentativas, backoff exponencial de 2000 ms', () => {
    expect(OPCOES_DE_VALIDACAO_EMPREGADOS).toEqual(OPCOES_DE_VALIDACAO_PLANO_CONTAS);
    expect(OPCOES_DE_VALIDACAO_EMPREGADOS.attempts).toBe(5);
    expect(OPCOES_DE_VALIDACAO_EMPREGADOS.backoff).toEqual({ type: 'exponential', delay: 2000 });
  });
});

describe('códigos de erro de linha de empregados', () => {
  it('a lista do shared é igual à do domínio (mesma ordem)', () => {
    expect([...CODIGOS_DE_ERRO_DE_EMPREGADO]).toEqual([...CODIGOS_DO_DOMINIO]);
    expectTypeOf<CodigoDeErroDeEmpregado>().toEqualTypeOf<CodigoDoDominio>();
  });
});

describe('schemas de rejeição e prévia de empregados', () => {
  it('rejeição aceita CPF e matrícula como vieram no arquivo e recusa código do plano de contas', () => {
    expect(RejeicaoDeEmpregadoSchema.parse(rejeicao)).toEqual(rejeicao);
    expect(RejeicaoDeEmpregadoSchema.parse({ ...rejeicao, cpf: null, matricula: null, campo: null })).toBeTruthy();
    expect(RejeicaoDeEmpregadoSchema.safeParse({ ...rejeicao, codigoDeErro: 'CONTA_ARQUIVADA' }).success).toBe(false);
    expect(RejeicaoDeEmpregadoSchema.safeParse({ ...rejeicao, extra: 1 }).success).toBe(false);
  });

  it('o código de erro de empregado não passa no schema do plano de contas, e vice-versa', () => {
    const doPlano = { numeroDaLinha: 2, codigo: '1', campo: 'codigo', codigoDeErro: 'CONTA_ARQUIVADA', mensagem: null };

    expect(RejeicaoDaImportacaoSchema.safeParse(doPlano).success).toBe(true);
    expect(RejeicaoDaImportacaoSchema.safeParse({ ...doPlano, codigoDeErro: 'CPF_INVALIDO' }).success).toBe(false);
    expect(RejeicaoDeEmpregadoSchema.safeParse(doPlano).success).toBe(false);
    // CAMPO_OBRIGATORIO_AUSENTE existe nas duas listas, mas cada schema exige o seu formato de linha.
    expect(RejeicaoDaImportacaoSchema.safeParse(rejeicao).success).toBe(false);
  });

  it('prévia de empregados: mesmo envelope da F13, amostra com o schema de empregados', () => {
    expect(PreviaDaImportacaoDeEmpregadosSchema.parse(previa)).toEqual(previa);
    expect(PreviaDaImportacaoSchema.safeParse(previa).success).toBe(false);
    expect(
      PreviaDaImportacaoDeEmpregadosSchema.safeParse({
        ...previa,
        amostraRejeicoes: [{ ...rejeicao, codigoDeErro: 'CODIGO_DUPLICADO_NO_ARQUIVO' }],
      }).success,
    ).toBe(false);
    expect(PreviaDaImportacaoDeEmpregadosSchema.safeParse({ ...previa, extra: true }).success).toBe(false);
  });

  it('página de rejeições de empregados', () => {
    const pagina = { pagina: 1, itensPorPagina: 50, total: 1, itens: [rejeicao] };

    expect(PaginaDeRejeicoesDeEmpregadosSchema.parse(pagina)).toEqual(pagina);
    expect(PaginaDeRejeicoesDaImportacaoSchema.safeParse(pagina).success).toBe(false);
  });
});

describe('base de empregados', () => {
  const empregado = {
    id: ID,
    cpf: '52998224725',
    nome: 'Maria da Silva',
    matricula: '00123',
    dataNascimento: '1990-03-15',
    dataAdmissao: '2015-02-01',
    arquivado: false,
  };

  it('empregado da base: datas civis aaaa-mm-dd e campo extra recusado', () => {
    expect(EmpregadoDaBaseSchema.parse(empregado)).toEqual(empregado);
    expect(EmpregadoDaBaseSchema.safeParse({ ...empregado, dataNascimento: '15/03/1990' }).success).toBe(false);
    expect(EmpregadoDaBaseSchema.safeParse({ ...empregado, dataAdmissao: AGORA }).success).toBe(false);
    expect(EmpregadoDaBaseSchema.safeParse({ ...empregado, salario: 1 }).success).toBe(false);
    expect(EmpregadoDaBaseSchema.safeParse({ ...empregado, nome: '' }).success).toBe(false);
  });

  it('página da base', () => {
    const pagina = { pagina: 1, itensPorPagina: 25, total: 1, itens: [empregado] };

    expect(PaginaDeEmpregadosSchema.parse(pagina)).toEqual(pagina);
    expect(PaginaDeEmpregadosSchema.safeParse({ ...pagina, itensPorPagina: 101 }).success).toBe(false);
  });
});

describe('arquivo de importação de empregados', () => {
  // A F15 (SPEC-015) passou a aceitar .xlsx e .ods; o que segue recusado é planilha com macros.
  it('limite de 10 MB igual ao do domínio; CSV aceito e planilha com macros recusada', () => {
    expect(LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES).toBe(LIMITE_DE_BYTES);
    expect(formatarLimite(LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES)).toBe('10 MB');
    expect(validarArquivo('IMPORTACAO_EMPREGADOS', { tipoConteudo: 'text/csv', tamanhoBytes: 1024 })).toBeNull();
    expect(
      validarArquivo('IMPORTACAO_EMPREGADOS', { tipoConteudo: 'application/vnd.ms-excel', tamanhoBytes: 1024 }),
    ).toBeNull();
    expect(
      validarArquivo('IMPORTACAO_EMPREGADOS', {
        tipoConteudo: 'application/vnd.ms-excel.sheet.macroEnabled.12',
        tamanhoBytes: 1024,
      }),
    ).toBe('TIPO_NAO_ACEITO');
    expect(
      validarArquivo('IMPORTACAO_EMPREGADOS', {
        tipoConteudo: 'text/csv',
        tamanhoBytes: LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES + 1,
      }),
    ).toBe('TAMANHO_EXCEDIDO');
    expect(validarArquivo('IMPORTACAO_EMPREGADOS', { tipoConteudo: 'text/csv', tamanhoBytes: 0 })).toBe('ARQUIVO_VAZIO');
    expect(mensagemDaFalha('IMPORTACAO_EMPREGADOS', 'TIPO_NAO_ACEITO')).toContain('.csv');
  });

  it('XLSX disfarçado de CSV não confere com o tipo de texto', () => {
    expect(conteudoConfereComOTipo('text/csv', Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });
});

describe('pipeline completo sobre o arquivo (lerCsv + domínio)', () => {
  const MAPEAMENTO = {
    cpf: 'cpf',
    nome: 'nome',
    matricula: 'matricula',
    data_nascimento: 'data_nascimento',
    data_admissao: 'data_admissao',
  };

  const processar = (bytes: Uint8Array, vigentes = new Map<string, { arquivado: boolean }>()) => {
    const lido = lerCsv(bytes);
    const mapeamento = validarMapeamentoDeEmpregados(MAPEAMENTO, lido.cabecalho);
    if (!mapeamento.ok) throw new Error('mapeamento');
    return validarLinhasDeEmpregados(
      normalizarLinhasDeEmpregados(lido.cabecalho, lido.registros, mapeamento.mapeamento),
      vigentes,
    );
  };

  it('o modelo oficial é lido e todas as linhas de exemplo são válidas', () => {
    const resultado = processar(new TextEncoder().encode(MODELO_CSV_DE_EMPREGADOS));

    expect(resultado.length).toBeGreaterThanOrEqual(2);
    expect(resultado.every((r) => r.status === 'VALIDA' && r.acao === 'INCLUIR')).toBe(true);
  });

  it('BOM, ponto e vírgula, linhas em branco ao final e nome só com espaços', () => {
    const texto = [
      'cpf;nome;matricula;data_nascimento;data_admissao',
      '529.982.247-25;Maria;00123;15/03/1990;01/02/2015',
      '111.444.777-35;   ;1;15/03/1990;01/02/2015',
      '',
      '',
    ].join('\r\n');
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(texto)]);

    const resultado = processar(bytes);

    expect(resultado.map((r) => [r.numeroDaLinha, r.status, r.codigoDeErro, r.campo])).toEqual([
      [2, 'VALIDA', null, null],
      [3, 'REJEITADA', 'CAMPO_OBRIGATORIO_AUSENTE', 'nome'],
    ]);
  });

  it('Latin-1 com acento no nome é decodificado e preservado', () => {
    const texto = 'cpf,nome,matricula,data_nascimento,data_admissao\n529.982.247-25,João Conceição,9,15/03/1990,01/02/2015\n';
    const bytes = Uint8Array.from(texto, (c) => c.charCodeAt(0));

    const [linha] = processar(bytes);

    expect(linha).toMatchObject({ status: 'VALIDA', nome: 'João Conceição' });
  });

  it('serial do Excel colado na data é rejeitado com código estável, nunca interpretado', () => {
    const texto = 'cpf;nome;matricula;data_nascimento;data_admissao\n529.982.247-25;Maria;1;43831;01/02/2015\n';

    const [linha] = processar(new TextEncoder().encode(texto));

    expect(linha).toMatchObject({ status: 'REJEITADA', codigoDeErro: 'DATA_NASCIMENTO_INVALIDA' });
  });
});

describe('raiz do pacote', () => {
  it('reexporta o contrato de empregados', () => {
    for (const nome of [
      'FILA_DE_VALIDACAO_EMPREGADOS',
      'FILA_DE_VALIDACAO_EMPREGADOS_MORTA',
      'NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS',
      'OPCOES_DE_VALIDACAO_EMPREGADOS',
      'CODIGOS_DE_ERRO_DE_EMPREGADO',
      'EmpregadoDaBaseSchema',
      'PaginaDeEmpregadosSchema',
      'PreviaDaImportacaoDeEmpregadosSchema',
      'RejeicaoDeEmpregadoSchema',
      'PaginaDeRejeicoesDeEmpregadosSchema',
      'LIMITE_DE_IMPORTACAO_DE_EMPREGADOS_BYTES',
    ]) {
      expect(raiz, nome).toHaveProperty(nome);
    }
  });
});
