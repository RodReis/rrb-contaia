import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO_DE_EMPREGADO } from './campos.js';
import { validarLinhasDeEmpregados } from './validacao.js';
import type { LinhaBrutaDeEmpregado } from './validacao.js';

const CPF_A = '529.982.247-25'; // válido
const CPF_B = '111.444.777-35'; // válido
const VAZIO = new Map<string, { arquivado: boolean }>();

const linha = (numeroDaLinha: number, dados: Partial<LinhaBrutaDeEmpregado> = {}): LinhaBrutaDeEmpregado => ({
  numeroDaLinha,
  cpf: CPF_A,
  nome: 'Maria da Silva',
  matricula: '00123',
  dataNascimento: '15/03/1990',
  dataAdmissao: '01/02/2015',
  ...dados,
});

const validar = (
  linhas: readonly LinhaBrutaDeEmpregado[],
  vigentes: ReadonlyMap<string, { arquivado: boolean }> = VAZIO,
) => validarLinhasDeEmpregados(linhas, vigentes);

describe('validarLinhasDeEmpregados — linha válida', () => {
  it('inclui quando a chave não existe, com datas civis e chave CPF|matrícula', () => {
    const [resultado] = validar([linha(2)]);

    expect(resultado).toEqual({
      numeroDaLinha: 2,
      cpf: CPF_A,
      cpfNormalizado: '52998224725',
      nome: 'Maria da Silva',
      matricula: '00123',
      dataNascimento: '1990-03-15',
      dataAdmissao: '2015-02-01',
      chave: '52998224725|00123',
      status: 'VALIDA',
      acao: 'INCLUIR',
      codigoDeErro: null,
      campo: null,
      mensagem: null,
    });
  });

  it('atualiza quando a chave existe ativa no vigente', () => {
    const [resultado] = validar([linha(2)], new Map([['52998224725|00123', { arquivado: false }]]));

    expect(resultado).toMatchObject({ status: 'VALIDA', acao: 'ATUALIZAR' });
  });

  it('devolve uma linha por entrada, na ordem de entrada', () => {
    const resultado = validar([linha(2), linha(3, { matricula: '2' }), linha(4, { cpf: '' })]);

    expect(resultado.map((r) => r.numeroDaLinha)).toEqual([2, 3, 4]);
  });
});

describe('validarLinhasDeEmpregados — chave CPF + matrícula', () => {
  it('CPF com máscara, só com pontos ou só dígitos é a mesma chave', () => {
    const resultado = validar(
      [linha(2, { cpf: '529.982.247-25' })],
      new Map([['52998224725|00123', { arquivado: false }]]),
    );
    const semMascara = validar(
      [linha(2, { cpf: '52998224725' })],
      new Map([['52998224725|00123', { arquivado: false }]]),
    );

    expect(resultado[0]?.acao).toBe('ATUALIZAR');
    expect(semMascara[0]?.acao).toBe('ATUALIZAR');
    expect(semMascara[0]?.cpf).toBe('52998224725');
  });

  it('matrícula 00123 e 123 são chaves distintas', () => {
    const resultado = validar(
      [linha(2, { matricula: '123' })],
      new Map([['52998224725|00123', { arquivado: false }]]),
    );

    expect(resultado[0]).toMatchObject({ status: 'VALIDA', acao: 'INCLUIR', chave: '52998224725|123' });
  });

  it('o mesmo CPF com matrículas diferentes são chaves distintas e ambas válidas', () => {
    const resultado = validar([linha(2, { matricula: '1' }), linha(3, { matricula: '2' })]);

    expect(resultado.map((r) => r.status)).toEqual(['VALIDA', 'VALIDA']);
    expect(resultado.map((r) => r.chave)).toEqual(['52998224725|1', '52998224725|2']);
  });

  it('a matrícula distingue maiúsculas de minúsculas', () => {
    const resultado = validar([linha(2, { matricula: 'ab1' }), linha(3, { matricula: 'AB1' })]);

    expect(resultado.map((r) => r.status)).toEqual(['VALIDA', 'VALIDA']);
  });
});

describe('validarLinhasDeEmpregados — campos obrigatórios', () => {
  it.each([
    ['cpf', { cpf: '' }],
    ['nome', { nome: '' }],
    ['matricula', { matricula: '' }],
    ['data_nascimento', { dataNascimento: '' }],
    ['data_admissao', { dataAdmissao: '' }],
  ] as const)('%s em branco → CAMPO_OBRIGATORIO_AUSENTE', (campo, dados) => {
    const [resultado] = validar([linha(2, dados)]);

    expect(resultado).toMatchObject({
      status: 'REJEITADA',
      acao: null,
      codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE',
      campo,
    });
    expect(resultado?.mensagem).toEqual(expect.any(String));
  });

  it('linha com campos a mais que o cabeçalho é rejeitada inteira, sem apontar campo', () => {
    const [resultado] = validar([linha(2, { defeitoDeEstrutura: 'CAMPOS_A_MAIS' })]);

    expect(resultado).toMatchObject({ status: 'REJEITADA', codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE', campo: null });
    expect(resultado?.mensagem).toContain('mais campos');
  });
});

describe('validarLinhasDeEmpregados — CPF', () => {
  it.each(['123.456.789-00', '111.111.111-11', '1234567890', '529.982.247-2', 'abc', '529.982.247-25 9'])(
    'CPF %j → CPF_INVALIDO no campo cpf',
    (cpf) => {
      const [resultado] = validar([linha(2, { cpf })]);

      expect(resultado).toMatchObject({ status: 'REJEITADA', codigoDeErro: 'CPF_INVALIDO', campo: 'cpf', chave: null });
    },
  );
});

describe('validarLinhasDeEmpregados — forma do CPF', () => {
  it.each(['52998224725', '529.982.247-25', '529.982.24725', '529982.247-25', '529982247-25', '529982247.25'.replace('.', '')])(
    'aceita %j (11 dígitos, com ou sem máscara) e a chave são os 11 dígitos',
    (cpf) => {
      const [resultado] = validar([linha(2, { cpf })]);

      expect(resultado).toMatchObject({ status: 'VALIDA', chave: '52998224725|00123', cpfNormalizado: '52998224725' });
    },
  );

  it.each(['5299822472x5', '529.998.224-7x5', 'CPF 52998224725', '529 998 224 25', '529.982.247-2 5', '529,982,247-25', '529-982-247.25', '.52998224725', '529.982.247-25-'])(
    'recusa %j com CPF_INVALIDO, mensagem fixa sem eco do valor e sem chave',
    (cpf) => {
      const [resultado] = validar([linha(2, { cpf })]);

      expect(resultado).toMatchObject({
        status: 'REJEITADA',
        codigoDeErro: 'CPF_INVALIDO',
        campo: 'cpf',
        chave: null,
        cpfNormalizado: null,
        mensagem: 'CPF inválido: informe 11 dígitos com os dígitos verificadores corretos.',
      });
    },
  );

  it('CPF com lixo não forma chave nem conta para a duplicidade', () => {
    const resultado = validar([linha(2, { cpf: 'CPF 52998224725' }), linha(3)]);

    expect(resultado.map((r) => r.codigoDeErro)).toEqual(['CPF_INVALIDO', null]);
  });
});

describe('validarLinhasDeEmpregados — trim defensivo', () => {
  it('nome só com espaços passado direto à função → CAMPO_OBRIGATORIO_AUSENTE', () => {
    const [resultado] = validar([linha(2, { nome: '   	 ' })]);

    expect(resultado).toMatchObject({ status: 'REJEITADA', codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE', campo: 'nome' });
  });

  it.each([
    ['cpf', { cpf: '  ' }],
    ['matricula', { matricula: ' ' }],
    ['data_nascimento', { dataNascimento: ' ' }],
    ['data_admissao', { dataAdmissao: ' ' }],
  ] as const)('%s só com espaços → CAMPO_OBRIGATORIO_AUSENTE', (campo, dados) => {
    const [resultado] = validar([linha(2, dados)]);

    expect(resultado).toMatchObject({ codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE', campo });
  });

  it('espaços ao redor não mudam o resultado nem a chave', () => {
    const [resultado] = validar([
      linha(2, { cpf: ' 529.982.247-25 ', nome: '  Maria ', matricula: ' 00123 ', dataNascimento: ' 15/03/1990 ' }),
    ]);

    expect(resultado).toMatchObject({ status: 'VALIDA', chave: '52998224725|00123', nome: 'Maria', matricula: '00123' });
  });
});

describe('validarLinhasDeEmpregados — datas', () => {
  it.each(['31/02/2020', '1/2/20', '43831', '2020-13-01', '15-03-1990', 'ontem'])(
    'nascimento %j → DATA_NASCIMENTO_INVALIDA',
    (dataNascimento) => {
      const [resultado] = validar([linha(2, { dataNascimento })]);

      expect(resultado).toMatchObject({
        codigoDeErro: 'DATA_NASCIMENTO_INVALIDA',
        campo: 'data_nascimento',
        status: 'REJEITADA',
      });
    },
  );

  it.each(['31/02/2020', '1/2/20', '43831'])('admissão %j → DATA_ADMISSAO_INVALIDA', (dataAdmissao) => {
    const [resultado] = validar([linha(2, { dataAdmissao })]);

    expect(resultado).toMatchObject({ codigoDeErro: 'DATA_ADMISSAO_INVALIDA', campo: 'data_admissao' });
  });

  it('aceita as duas grafias (dd/mm/aaaa e aaaa-mm-dd) e normaliza para aaaa-mm-dd', () => {
    const [resultado] = validar([linha(2, { dataNascimento: '1990-03-15', dataAdmissao: '01/02/2015' })]);

    expect(resultado).toMatchObject({ dataNascimento: '1990-03-15', dataAdmissao: '2015-02-01' });
  });

  it('admissão igual ao nascimento → ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO', () => {
    const [resultado] = validar([linha(2, { dataNascimento: '15/03/1990', dataAdmissao: '1990-03-15' })]);

    expect(resultado).toMatchObject({
      status: 'REJEITADA',
      codigoDeErro: 'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
      campo: 'data_admissao',
    });
  });

  it('admissão anterior ao nascimento → ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO', () => {
    const [resultado] = validar([linha(2, { dataNascimento: '15/03/1990', dataAdmissao: '14/03/1990' })]);

    expect(resultado?.codigoDeErro).toBe('ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO');
  });

  it('admissão no dia seguinte ao nascimento é aceita (sem regra legal de DP na F14)', () => {
    const [resultado] = validar([linha(2, { dataNascimento: '15/03/1990', dataAdmissao: '16/03/1990' })]);

    expect(resultado?.status).toBe('VALIDA');
  });
});

describe('validarLinhasDeEmpregados — duplicidade no arquivo', () => {
  it('rejeita TODAS as ocorrências da chave, sem primeira nem última vencedora', () => {
    const resultado = validar([
      linha(2),
      linha(3, { cpf: CPF_B, matricula: '9' }),
      linha(4, { cpf: '52998224725', nome: 'Outra Pessoa' }), // mesma chave que a linha 2
      linha(5),
    ]);

    expect(resultado.map((r) => [r.numeroDaLinha, r.status, r.codigoDeErro])).toEqual([
      [2, 'REJEITADA', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
      [3, 'VALIDA', null],
      [4, 'REJEITADA', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
      [5, 'REJEITADA', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
    ]);
    expect(resultado[0]?.acao).toBeNull();
  });

  it('a duplicata vale mesmo quando a chave já existe ativa no vigente (nada é atualizado)', () => {
    const resultado = validar([linha(2), linha(3)], new Map([['52998224725|00123', { arquivado: false }]]));

    expect(resultado.every((r) => r.status === 'REJEITADA' && r.acao === null)).toBe(true);
  });

  it('linha rejeitada por outro motivo mas com chave formada conta para a duplicidade (e mantém o próprio erro)', () => {
    // Decisão: a chave é formada quando o CPF é válido e a matrícula existe, independente de
    // nome/datas. A linha com data ruim fica com o próprio erro; a vizinha válida é duplicata.
    const resultado = validar([linha(2, { dataNascimento: '31/02/2020' }), linha(3)]);

    expect(resultado.map((r) => r.codigoDeErro)).toEqual(['DATA_NASCIMENTO_INVALIDA', 'CHAVE_DUPLICADA_NO_ARQUIVO']);
  });

  it('linha sem chave formada (CPF inválido ou matrícula vazia) não conta para a duplicidade', () => {
    const resultado = validar([
      linha(2, { cpf: '123.456.789-00' }),
      linha(3, { cpf: '123.456.789-00' }),
      linha(4, { matricula: '' }),
      linha(5, { matricula: '' }),
      linha(6),
    ]);

    expect(resultado.map((r) => r.codigoDeErro)).toEqual([
      'CPF_INVALIDO',
      'CPF_INVALIDO',
      'CAMPO_OBRIGATORIO_AUSENTE',
      'CAMPO_OBRIGATORIO_AUSENTE',
      null,
    ]);
  });
});

describe('validarLinhasDeEmpregados — empregado arquivado', () => {
  it('chave presente e arquivada → EMPREGADO_ARQUIVADO, nunca reativa', () => {
    const [resultado] = validar([linha(2)], new Map([['52998224725|00123', { arquivado: true }]]));

    expect(resultado).toMatchObject({
      status: 'REJEITADA',
      acao: null,
      codigoDeErro: 'EMPREGADO_ARQUIVADO',
    });
    expect(resultado?.mensagem).toContain('MVP-3');
  });

  it('outra matrícula do mesmo CPF não é afetada pelo arquivado', () => {
    const [resultado] = validar([linha(2, { matricula: '7' })], new Map([['52998224725|00123', { arquivado: true }]]));

    expect(resultado).toMatchObject({ status: 'VALIDA', acao: 'INCLUIR' });
  });
});

describe('validarLinhasDeEmpregados — contrato dos códigos', () => {
  it('os sete códigos estáveis', () => {
    expect([...CODIGOS_DE_ERRO_DE_EMPREGADO]).toEqual([
      'CAMPO_OBRIGATORIO_AUSENTE',
      'CPF_INVALIDO',
      'DATA_NASCIMENTO_INVALIDA',
      'DATA_ADMISSAO_INVALIDA',
      'ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO',
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'EMPREGADO_ARQUIVADO',
    ]);
  });

  it('toda rejeição tem código, campo (ou null só no defeito de estrutura) e mensagem acionável', () => {
    const resultado = validar([
      linha(2, { cpf: '1' }),
      linha(3, { nome: '' }),
      linha(4, { dataNascimento: 'x' }),
      linha(5, { dataAdmissao: 'x' }),
      linha(6, { dataAdmissao: '01/01/1980' }),
    ]);

    for (const r of resultado) {
      expect(r.status).toBe('REJEITADA');
      expect(CODIGOS_DE_ERRO_DE_EMPREGADO).toContain(r.codigoDeErro);
      expect(r.campo).not.toBeNull();
      expect(r.mensagem?.length).toBeGreaterThan(5);
    }
  });

  it('a mensagem de rejeição não repete o CPF nem o nome do empregado (PII fora de mensagens)', () => {
    const resultado = validar([linha(2, { cpf: '123.456.789-00' }), linha(3, { dataNascimento: 'x' })]);

    for (const r of resultado) {
      expect(r.mensagem).not.toContain('123.456.789-00');
      expect(r.mensagem).not.toContain('Maria');
    }
  });
});

describe('validarLinhasDeEmpregados — desempenho', () => {
  it('10.000 linhas distintas validam em tempo linear', () => {
    const linhas = Array.from({ length: 10_000 }, (_, i) => linha(i + 2, { matricula: String(i) }));
    const inicio = performance.now();
    const resultado = validar(linhas);

    expect(resultado.every((r) => r.status === 'VALIDA')).toBe(true);
    expect(performance.now() - inicio).toBeLessThan(2_000);
  });
});
