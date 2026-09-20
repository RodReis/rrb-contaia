import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import type { EnderecoDaEmpresa } from './cadastro.js';
import {
  FINALIDADES_DE_ENDERECO,
  arquivarEmpresa,
  camposAlteradosNaIdentificacao,
  diferencasDaFonteExterna,
  ehFinalidadeDeEndereco,
  planejarTrocaDeFinalidadeFiscal,
  reativarEmpresa,
  validarEnderecoComFinalidade,
  validarJustificativa,
  validarVigencia,
} from './manutencao.js';

const HOJE = new Date('2026-09-20T12:00:00Z');

const endereco = (sobrescrita: Partial<EnderecoDaEmpresa> = {}): EnderecoDaEmpresa => ({
  cep: '74000000',
  logradouro: 'Rua Um',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  municipio: 'Goiania',
  uf: 'GO',
  ...sobrescrita,
});

describe('finalidade de endereço', () => {
  it('reconhece as quatro finalidades aprovadas e recusa as demais', () => {
    expect(FINALIDADES_DE_ENDERECO).toEqual([
      'FISCAL',
      'COBRANCA',
      'CORRESPONDENCIA',
      'OUTRO',
    ]);
    expect(ehFinalidadeDeEndereco('FISCAL')).toBe(true);
    expect(ehFinalidadeDeEndereco('ENTREGA')).toBe(false);
  });

  it('exige descrição quando a finalidade é OUTRO', () => {
    const campos = validarEnderecoComFinalidade({
      ...endereco(),
      finalidade: 'OUTRO',
      descricao: '  ',
    });

    expect(campos).toContainEqual({
      campo: 'descricao',
      codigo: CODIGOS_DE_ERRO.DESCRICAO_OBRIGATORIA,
    });
  });

  it('recusa descrição em finalidade que não seja OUTRO', () => {
    const campos = validarEnderecoComFinalidade({
      ...endereco(),
      finalidade: 'COBRANCA',
      descricao: 'qualquer coisa',
    });

    expect(campos).toContainEqual({
      campo: 'descricao',
      codigo: CODIGOS_DE_ERRO.FINALIDADE_INVALIDA,
    });
  });

  it('aceita endereço válido sem apontar campo', () => {
    expect(
      validarEnderecoComFinalidade({
        ...endereco(),
        finalidade: 'FISCAL',
        descricao: null,
      }),
    ).toEqual([]);
  });

  it('propaga os erros de endereço herdados da SPEC-002', () => {
    const campos = validarEnderecoComFinalidade({
      ...endereco({ cep: '123' }),
      finalidade: 'FISCAL',
      descricao: null,
    });

    expect(campos).toContainEqual({
      campo: 'cep',
      codigo: CODIGOS_DE_ERRO.CEP_INVALIDO,
    });
  });
});

describe('troca da finalidade Fiscal', () => {
  const fiscalAtual = { id: 'a', finalidade: 'FISCAL' as const };
  const cobranca = { id: 'b', finalidade: 'COBRANCA' as const };

  it('exige nova finalidade disponível para o endereço Fiscal anterior', () => {
    const plano = planejarTrocaDeFinalidadeFiscal({
      enderecosAtivos: [fiscalAtual, cobranca],
      novoFiscalId: 'b',
      finalidadeDoAnterior: 'CORRESPONDENCIA',
    });

    expect(plano).toEqual([
      { id: 'a', finalidade: 'CORRESPONDENCIA', principal: false },
      { id: 'b', finalidade: 'FISCAL', principal: true },
    ]);
  });

  it('permite a troca simples entre os dois endereços envolvidos', () => {
    // O endereço promovido libera a própria finalidade na mesma transação, então
    // devolvê-la ao Fiscal anterior é uma troca, não uma duplicata.
    expect(
      planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: [fiscalAtual, cobranca],
        novoFiscalId: 'b',
        finalidadeDoAnterior: 'COBRANCA',
      }),
    ).toEqual([
      { id: 'a', finalidade: 'COBRANCA', principal: false },
      { id: 'b', finalidade: 'FISCAL', principal: true },
    ]);
  });

  it('recusa devolver o anterior para uma finalidade ocupada por um terceiro', () => {
    const correspondencia = { id: 'c', finalidade: 'CORRESPONDENCIA' as const };

    expect(() =>
      planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: [fiscalAtual, cobranca, correspondencia],
        novoFiscalId: 'b',
        finalidadeDoAnterior: 'CORRESPONDENCIA',
      }),
    ).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA }),
    );
  });

  it('recusa manter FISCAL no endereço anterior', () => {
    expect(() =>
      planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: [fiscalAtual, cobranca],
        novoFiscalId: 'b',
        finalidadeDoAnterior: 'FISCAL',
      }),
    ).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA }),
    );
  });

  it('recusa promover endereço inexistente', () => {
    expect(() =>
      planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: [fiscalAtual, cobranca],
        novoFiscalId: 'z',
        finalidadeDoAnterior: 'COBRANCA',
      }),
    ).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.ENDERECO_NAO_ENCONTRADO }),
    );
  });

  it('recusa a troca quando não há endereço Fiscal ativo', () => {
    expect(() =>
      planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: [cobranca],
        novoFiscalId: 'b',
        finalidadeDoAnterior: 'CORRESPONDENCIA',
      }),
    ).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.ENDERECO_FISCAL_OBRIGATORIO }),
    );
  });

  it('é operação vazia quando o endereço promovido já é o Fiscal', () => {
    expect(
      planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: [fiscalAtual, cobranca],
        novoFiscalId: 'a',
        finalidadeDoAnterior: 'COBRANCA',
      }),
    ).toEqual([]);
  });
});

describe('vigência de regime e CNAE', () => {
  it('aceita data passada e a data de hoje', () => {
    expect(validarVigencia('2026-09-20', HOJE)).toEqual([]);
    expect(validarVigencia('2020-01-01', HOJE)).toEqual([]);
  });

  it('rejeita vigência futura', () => {
    expect(validarVigencia('2026-09-21', HOJE)).toEqual([
      { campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_FUTURA },
    ]);
  });

  it('rejeita vigência ausente ou ilegível', () => {
    expect(validarVigencia('', HOJE)).toEqual([
      { campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_OBRIGATORIA },
    ]);
    expect(validarVigencia('20/09/2026', HOJE)).toEqual([
      { campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_OBRIGATORIA },
    ]);
  });

  it('compara por data civil em America/Sao_Paulo, não por instante (I-11)', () => {
    // 20/09/2026 21:00 UTC ainda é dia 20 em São Paulo (UTC-3).
    const fimDoDia = new Date('2026-09-20T21:00:00Z');
    expect(validarVigencia('2026-09-20', fimDoDia)).toEqual([]);
    // 21/09/2026 02:00 UTC ainda é dia 20 em São Paulo: vigência de 21 é futura.
    const madrugada = new Date('2026-09-21T02:00:00Z');
    expect(validarVigencia('2026-09-21', madrugada)).toEqual([
      { campo: 'vigencia', codigo: CODIGOS_DE_ERRO.VIGENCIA_FUTURA },
    ]);
  });
});

describe('justificativa', () => {
  it('exige conteúdo real', () => {
    expect(validarJustificativa('   ')).toEqual([
      { campo: 'justificativa', codigo: CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA },
    ]);
  });

  it('aceita justificativa preenchida', () => {
    expect(validarJustificativa('Encerrou as atividades.')).toEqual([]);
  });
});

describe('arquivamento e reativação', () => {
  it('arquiva empresa ativa com justificativa', () => {
    expect(arquivarEmpresa('ativo', 'Encerrou as atividades.')).toBe('arquivado');
  });

  it('recusa arquivar sem justificativa', () => {
    expect(() => arquivarEmpresa('ativo', ' ')).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA }),
    );
  });

  it('recusa arquivar empresa já arquivada', () => {
    expect(() => arquivarEmpresa('arquivado', 'Qualquer motivo.')).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA }),
    );
  });

  it('reativa empresa arquivada com justificativa', () => {
    expect(reativarEmpresa('arquivado', 'Retomou as atividades.')).toBe('ativo');
  });

  it('recusa reativar empresa que não está arquivada', () => {
    expect(() => reativarEmpresa('ativo', 'Retomou.')).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.EMPRESA_NAO_ARQUIVADA }),
    );
  });

  it('recusa reativar sem justificativa', () => {
    expect(() => reativarEmpresa('arquivado', '')).toThrowError(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA }),
    );
  });
});

describe('campos alterados', () => {
  const identificacao = {
    cnpj: '11222333000181',
    razaoSocial: 'Alfa Ltda',
    nomeFantasia: 'Alfa',
    logoArquivoId: null,
    telefone: '6230000000',
    email: 'contato@alfa.com.br',
  };

  it('lista apenas o que mudou, com valor anterior e novo', () => {
    expect(
      camposAlteradosNaIdentificacao(identificacao, {
        ...identificacao,
        nomeFantasia: 'Alfa Contabilidade',
      }),
    ).toEqual([
      { campo: 'nomeFantasia', valorAnterior: 'Alfa', valorNovo: 'Alfa Contabilidade' },
    ]);
  });

  it('ignora o CNPJ porque ele é imutável após a ativação', () => {
    expect(
      camposAlteradosNaIdentificacao(identificacao, {
        ...identificacao,
        cnpj: '99888777000166',
      }),
    ).toEqual([]);
  });

  it('não gera evento quando nada mudou', () => {
    expect(camposAlteradosNaIdentificacao(identificacao, identificacao)).toEqual([]);
  });
});

describe('diferenças da fonte externa', () => {
  const atuais = {
    razaoSocial: 'Alfa Ltda',
    nomeFantasia: 'Alfa',
    telefone: '6230000000',
    email: 'contato@alfa.com.br',
    cnaePrincipal: '6920601',
  };

  it('compara campo a campo e ignora o que a fonte não trouxe', () => {
    expect(
      diferencasDaFonteExterna(atuais, {
        razaoSocial: 'Alfa Comercio Ltda',
        nomeFantasia: 'Alfa',
        telefone: null,
        email: null,
        cnaePrincipal: '4711302',
      }),
    ).toEqual([
      {
        campo: 'razaoSocial',
        valorAtual: 'Alfa Ltda',
        valorExterno: 'Alfa Comercio Ltda',
      },
      { campo: 'cnaePrincipal', valorAtual: '6920601', valorExterno: '4711302' },
    ]);
  });

  it('não devolve diferença quando os dados já estão iguais', () => {
    expect(diferencasDaFonteExterna(atuais, atuais)).toEqual([]);
  });

  it('nunca oferece o CNPJ para seleção', () => {
    const diferencas = diferencasDaFonteExterna(
      { ...atuais, cnpj: '11222333000181' } as never,
      { ...atuais, cnpj: '99888777000166' } as never,
    );

    expect(diferencas.some((diferenca) => diferenca.campo === 'cnpj')).toBe(false);
  });
});

describe('erro de domínio', () => {
  it('carrega o código estável que o problem+json publica', () => {
    try {
      arquivarEmpresa('arquivado', 'Qualquer motivo.');
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeDominio);
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
    }
  });
});
