import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  ETAPAS_DA_EMPRESA,
  type CadastroDaEmpresa,
  type DadosFiscaisDaEmpresa,
  ativarEmpresa,
  camposInvalidosDaEtapaDaEmpresa,
  etapasConcluidasDaEmpresa,
  exigeConfirmacaoDeSituacaoExterna,
  podeAtivarEmpresa,
  primeiraEtapaIncompletaDaEmpresa,
  validarDadosFiscais,
  validarIdentificacaoDaEmpresa,
} from './cadastro.js';

const identificacaoValida = {
  cnpj: '11222333000181',
  razaoSocial: 'Padaria Aurora Comércio de Alimentos LTDA',
  nomeFantasia: 'Padaria Aurora',
  logoArquivoId: null,
  telefone: '1133224455',
  email: 'contato@padariaaurora.com.br',
};

const fiscaisValidos: DadosFiscaisDaEmpresa = {
  regimeTributario: 'LUCRO_PRESUMIDO',
  enquadramentoSimples: null,
  cnaePrincipal: '1091102',
  cnaesSecundarios: ['4721102'],
  inscricaoEstadual: { situacao: 'POSSUI', numero: '123456789' },
  inscricaoMunicipal: { situacao: 'ISENTO', numero: null },
};

const enderecoValido = {
  cep: '01310100',
  logradouro: 'Avenida Paulista',
  numero: '1000',
  complemento: null,
  bairro: 'Bela Vista',
  municipio: 'São Paulo',
  uf: 'SP',
};

const cadastroCompleto = (): CadastroDaEmpresa => ({
  status: 'CADASTRO_INCOMPLETO',
  identificacao: identificacaoValida,
  dadosFiscais: fiscaisValidos,
  enderecoPrincipal: enderecoValido,
  situacaoCadastralExterna: 'Ativa',
  validadoPorFonteExterna: true,
  versao: 3,
});

describe('identificação da empresa', () => {
  it('aceita identificação completa', () => {
    expect(validarIdentificacaoDaEmpresa(identificacaoValida)).toEqual([]);
  });

  it('exige nome fantasia, por decisão do PI', () => {
    const campos = validarIdentificacaoDaEmpresa({ ...identificacaoValida, nomeFantasia: '  ' });

    expect(campos).toEqual([
      { campo: 'nomeFantasia', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO },
    ]);
  });

  it('recusa CNPJ com dígito verificador inválido', () => {
    const campos = validarIdentificacaoDaEmpresa({
      ...identificacaoValida,
      cnpj: '11222333000182',
    });

    expect(campos).toContainEqual({ campo: 'cnpj', codigo: CODIGOS_DE_ERRO.CNPJ_INVALIDO });
  });

  it('aceita logo, telefone e e-mail ausentes: são opcionais', () => {
    const campos = validarIdentificacaoDaEmpresa({
      ...identificacaoValida,
      logoArquivoId: null,
      telefone: null,
      email: null,
    });

    expect(campos).toEqual([]);
  });

  it('recusa telefone e e-mail preenchidos com valor inválido', () => {
    const campos = validarIdentificacaoDaEmpresa({
      ...identificacaoValida,
      telefone: '1199',
      email: 'sem-arroba',
    });

    expect(campos).toEqual([
      { campo: 'telefone', codigo: CODIGOS_DE_ERRO.TELEFONE_INVALIDO },
      { campo: 'email', codigo: CODIGOS_DE_ERRO.EMAIL_INVALIDO },
    ]);
  });
});

describe('dados fiscais', () => {
  it('aceita os três regimes previstos', () => {
    for (const regime of ['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const) {
      const dados: DadosFiscaisDaEmpresa = {
        ...fiscaisValidos,
        regimeTributario: regime,
        enquadramentoSimples: regime === 'SIMPLES_NACIONAL' ? 'NAO_MEI' : null,
      };

      expect(validarDadosFiscais(dados)).toEqual([]);
    }
  });

  it('exige enquadramento quando o regime é Simples Nacional', () => {
    const campos = validarDadosFiscais({
      ...fiscaisValidos,
      regimeTributario: 'SIMPLES_NACIONAL',
      enquadramentoSimples: null,
    });

    expect(campos).toEqual([
      { campo: 'enquadramentoSimples', codigo: CODIGOS_DE_ERRO.ENQUADRAMENTO_OBRIGATORIO },
    ]);
  });

  it('não exige enquadramento fora do Simples: MEI é enquadramento, não regime', () => {
    const campos = validarDadosFiscais({
      ...fiscaisValidos,
      regimeTributario: 'LUCRO_REAL',
      enquadramentoSimples: null,
    });

    expect(campos).toEqual([]);
  });

  it('recusa regime ausente sem inferir Presumido nem Real', () => {
    const campos = validarDadosFiscais({ ...fiscaisValidos, regimeTributario: null });

    expect(campos).toEqual([
      { campo: 'regimeTributario', codigo: CODIGOS_DE_ERRO.REGIME_INVALIDO },
    ]);
  });

  it('exige um CNAE principal', () => {
    const campos = validarDadosFiscais({ ...fiscaisValidos, cnaePrincipal: '' });

    expect(campos).toEqual([
      { campo: 'cnaePrincipal', codigo: CODIGOS_DE_ERRO.CNAE_OBRIGATORIO },
    ]);
  });

  it('aceita CNAEs secundários vazios: são opcionais', () => {
    expect(validarDadosFiscais({ ...fiscaisValidos, cnaesSecundarios: [] })).toEqual([]);
  });

  it('exige número de inscrição somente quando a situação é POSSUI', () => {
    const semNumero = validarDadosFiscais({
      ...fiscaisValidos,
      inscricaoEstadual: { situacao: 'POSSUI', numero: null },
    });

    expect(semNumero).toEqual([
      {
        campo: 'inscricaoEstadual.numero',
        codigo: CODIGOS_DE_ERRO.INSCRICAO_NUMERO_OBRIGATORIO,
      },
    ]);

    for (const situacao of ['ISENTO', 'NAO_SE_APLICA'] as const) {
      expect(
        validarDadosFiscais({
          ...fiscaisValidos,
          inscricaoEstadual: { situacao, numero: null },
          inscricaoMunicipal: { situacao, numero: null },
        }),
      ).toEqual([]);
    }
  });
});

describe('etapas do cadastro', () => {
  it('conclui as quatro etapas quando o cadastro está completo', () => {
    expect(etapasConcluidasDaEmpresa(cadastroCompleto())).toEqual([...ETAPAS_DA_EMPRESA]);
    expect(primeiraEtapaIncompletaDaEmpresa(cadastroCompleto())).toBeNull();
    expect(podeAtivarEmpresa(cadastroCompleto())).toBe(true);
  });

  it('aponta a primeira etapa pendente para retomar o wizard', () => {
    const semFiscais: CadastroDaEmpresa = { ...cadastroCompleto(), dadosFiscais: null };

    expect(primeiraEtapaIncompletaDaEmpresa(semFiscais)).toBe('fiscal');
    expect(etapasConcluidasDaEmpresa(semFiscais)).toEqual(['identificacao', 'endereco']);
  });

  it('revisão só conclui quando as três etapas anteriores concluíram', () => {
    const semEndereco: CadastroDaEmpresa = { ...cadastroCompleto(), enderecoPrincipal: null };

    expect(camposInvalidosDaEtapaDaEmpresa(semEndereco, 'revisao')).toEqual([
      { campo: 'endereco', codigo: CODIGOS_DE_ERRO.ENDERECO_PRINCIPAL_OBRIGATORIO },
    ]);
  });
});

describe('ativação da empresa', () => {
  it('leva o cadastro completo de CADASTRO_INCOMPLETO para ATIVA', () => {
    expect(ativarEmpresa(cadastroCompleto()).status).toBe('ATIVA');
  });

  it('é idempotente: empresa já ativa volta inalterada', () => {
    const ativa: CadastroDaEmpresa = { ...cadastroCompleto(), status: 'ATIVA' };

    expect(ativarEmpresa(ativa)).toBe(ativa);
  });

  it('não muta a entrada', () => {
    const original = cadastroCompleto();
    ativarEmpresa(original);

    expect(original.status).toBe('CADASTRO_INCOMPLETO');
  });

  it('recusa ativação sem endereço principal, apontando a pendência', () => {
    const semEndereco: CadastroDaEmpresa = { ...cadastroCompleto(), enderecoPrincipal: null };

    expect(() => ativarEmpresa(semEndereco)).toThrow(ErroDeDominio);
    expect(() => ativarEmpresa(semEndereco)).toThrow(/etapas incompletas/);
  });

  it('recusa ativação sem dados fiscais', () => {
    const semFiscais: CadastroDaEmpresa = { ...cadastroCompleto(), dadosFiscais: null };

    expect(() => ativarEmpresa(semFiscais)).toThrow(ErroDeDominio);
  });

  it('empresa já ativa continua idempotente mesmo com situação externa irregular', () => {
    const ativa: CadastroDaEmpresa = {
      ...cadastroCompleto(),
      status: 'ATIVA',
      situacaoCadastralExterna: 'Baixada',
    };

    expect(ativarEmpresa(ativa)).toBe(ativa);
  });
});

describe('situação cadastral externa', () => {
  it('não exige confirmação quando a situação é Ativa ou não foi consultada', () => {
    expect(exigeConfirmacaoDeSituacaoExterna(cadastroCompleto())).toBe(false);
    expect(
      exigeConfirmacaoDeSituacaoExterna({
        ...cadastroCompleto(),
        situacaoCadastralExterna: null,
      }),
    ).toBe(false);
  });

  it('exige confirmação explícita quando a situação externa não é Ativa', () => {
    const baixada: CadastroDaEmpresa = {
      ...cadastroCompleto(),
      situacaoCadastralExterna: 'Baixada',
    };

    expect(exigeConfirmacaoDeSituacaoExterna(baixada)).toBe(true);
    expect(() => ativarEmpresa(baixada)).toThrow(/confirmação explícita/);
  });

  it('ativa com alerta quando o usuário confirma a situação irregular', () => {
    const baixada: CadastroDaEmpresa = {
      ...cadastroCompleto(),
      situacaoCadastralExterna: 'Baixada',
    };

    expect(ativarEmpresa(baixada, true).status).toBe('ATIVA');
  });
});
