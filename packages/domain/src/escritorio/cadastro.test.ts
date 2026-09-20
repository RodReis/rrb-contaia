import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  ETAPAS_DO_CADASTRO,
  type CadastroDoEscritorio,
  ativarCadastro,
  etapasConcluidas,
  primeiraEtapaIncompleta,
  podeAtivar,
} from './cadastro.js';

const identificacaoValida = {
  cnpj: '11222333000181',
  razaoSocial: 'Escritório Contábil Exemplo LTDA',
  logoArquivoId: 'arq-logo-1',
};

const responsavelValido = {
  nomeCompleto: 'Maria Souza',
  cpf: '52998224725',
  crc: '1SP123456/O-5',
  email: 'maria@escritorio.cnt.br',
  telefone: '11987654321',
};

const enderecoValido = {
  cep: '01310100',
  logradouro: 'Avenida Paulista',
  numero: '1000',
  complemento: 'Conjunto 101',
  bairro: 'Bela Vista',
  municipio: 'São Paulo',
  uf: 'SP',
};

const cadastroCompleto = (): CadastroDoEscritorio => ({
  status: 'CADASTRO_INCOMPLETO',
  identificacao: identificacaoValida,
  responsavel: responsavelValido,
  enderecoPrincipal: enderecoValido,
  documentosArquivoIds: ['arq-doc-1'],
  versao: 4,
});

describe('etapasConcluidas', () => {
  it('não marca etapa alguma num cadastro recém-seedado', () => {
    const vazio: CadastroDoEscritorio = {
      status: 'CADASTRO_INCOMPLETO',
      identificacao: null,
      responsavel: null,
      enderecoPrincipal: null,
      documentosArquivoIds: [],
      versao: 0,
    };

    expect(etapasConcluidas(vazio)).toEqual([]);
    expect(primeiraEtapaIncompleta(vazio)).toBe('identificacao');
  });

  it('não marca identificação concluída sem logo persistido', () => {
    const cadastro = cadastroCompleto();
    const semLogo = {
      ...cadastro,
      identificacao: { ...identificacaoValida, logoArquivoId: null },
    };

    expect(etapasConcluidas(semLogo)).not.toContain('identificacao');
    expect(primeiraEtapaIncompleta(semLogo)).toBe('identificacao');
  });

  it('não marca identificação concluída com CNPJ inválido', () => {
    const cadastro = cadastroCompleto();
    const cnpjRuim = {
      ...cadastro,
      identificacao: { ...identificacaoValida, cnpj: '11222333000182' },
    };

    expect(etapasConcluidas(cnpjRuim)).not.toContain('identificacao');
  });

  it('não marca responsável concluído com CPF inválido', () => {
    const cadastro = cadastroCompleto();
    const cpfRuim = { ...cadastro, responsavel: { ...responsavelValido, cpf: '52998224726' } };

    expect(etapasConcluidas(cpfRuim)).not.toContain('responsavel');
    expect(primeiraEtapaIncompleta(cpfRuim)).toBe('responsavel');
  });

  it('não marca documentos concluídos sem ao menos um arquivo', () => {
    const cadastro = { ...cadastroCompleto(), documentosArquivoIds: [] };

    expect(etapasConcluidas(cadastro)).not.toContain('documentos');
    expect(primeiraEtapaIncompleta(cadastro)).toBe('documentos');
  });

  it('marca todas as etapas de um cadastro completo', () => {
    expect(etapasConcluidas(cadastroCompleto())).toEqual([...ETAPAS_DO_CADASTRO]);
    expect(primeiraEtapaIncompleta(cadastroCompleto())).toBeNull();
  });
});

describe('ativarCadastro', () => {
  it('ativa quando todas as etapas estão completas', () => {
    const ativado = ativarCadastro(cadastroCompleto());

    expect(ativado.status).toBe('ATIVO');
    expect(podeAtivar(cadastroCompleto())).toBe(true);
  });

  it('é idempotente: reativar não altera o cadastro já ativo', () => {
    const ativo = ativarCadastro(cadastroCompleto());

    expect(ativarCadastro(ativo)).toEqual(ativo);
  });

  it('recusa ativação com etapa incompleta e não altera o estado', () => {
    const incompleto = { ...cadastroCompleto(), documentosArquivoIds: [] };

    expect(() => ativarCadastro(incompleto)).toThrowError(ErroDeDominio);
    expect(incompleto.status).toBe('CADASTRO_INCOMPLETO');
  });

  it('aponta a etapa que falta ao recusar', () => {
    const semEndereco = { ...cadastroCompleto(), enderecoPrincipal: null };

    try {
      ativarCadastro(semEndereco);
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeDominio);
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.ETAPA_INCOMPLETA);
      expect((erro as ErroDeDominio).campos.map((campo) => campo.campo)).toContain('endereco');
    }
  });

  it('não muta a entrada ao ativar', () => {
    const original = cadastroCompleto();
    ativarCadastro(original);

    expect(original.status).toBe('CADASTRO_INCOMPLETO');
  });
});
