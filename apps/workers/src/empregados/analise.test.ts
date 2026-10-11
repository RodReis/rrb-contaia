/**
 * Parte pura da validação de empregados (SPEC-014 §3.2–§3.5): bytes do original + mapeamento da
 * tentativa + empregados vigentes → linhas de staging, ou a recusa do arquivo inteiro com código
 * estável. Sem banco, sem rede, sem relógio.
 */
import { describe, expect, it } from 'vitest';

import { analisarArquivo } from './analise.js';

const MAPEAMENTO = { cpf: 'cpf', nome: 'nome', matricula: 'matricula', data_nascimento: 'data_nascimento', data_admissao: 'data_admissao' };
const CABECALHO = 'cpf;nome;matricula;data_nascimento;data_admissao';
const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';

const csv = (linhas: readonly string[], cabecalho = CABECALHO): Uint8Array =>
  Buffer.from([cabecalho, ...linhas, ''].join('\r\n'), 'utf8');

const linhasDe = (bytes: Uint8Array, vigentes = new Map<string, { arquivado: boolean }>(), mapeamento: Record<string, string> = MAPEAMENTO) => {
  const resultado = analisarArquivo(bytes, mapeamento, vigentes);
  if (resultado.tipo !== 'LINHAS') {
    throw new Error(`arquivo recusado: ${resultado.codigo}`);
  }

  return resultado.linhas;
};

describe('analisarArquivo: linhas', () => {
  it('2 linhas boas e 1 ruim → 2 VALIDA e 1 rejeição com código, campo e mensagem (o arquivo não falha)', () => {
    const linhas = linhasDe(
      csv([`${CPF_A};Maria Souza;00123;15/03/1985;01/02/2010`, `${CPF_B};João Lima;77;1990-07-20;2015-01-10`, '123.456.789-00;Pedro Reis;9;01/01/1980;01/01/2000']),
    );

    expect(linhas.map((l) => [l.numeroDaLinha, l.status, l.acao, l.codigoDeErro, l.campo])).toEqual([
      [2, 'VALIDA', 'INCLUIR', null, null],
      [3, 'VALIDA', 'INCLUIR', null, null],
      [4, 'REJEITADA', null, 'CPF_INVALIDO', 'cpf'],
    ]);
    expect(linhas[0]).toMatchObject({ cpfNormalizado: '52998224725', nome: 'Maria Souza', matricula: '00123', dataNascimento: '1985-03-15', dataAdmissao: '2010-02-01', chave: '52998224725|00123' });
    expect(linhas[2]!.mensagem).toEqual(expect.stringMatching(/\S/u));
  });

  it('empregado já na base vira ATUALIZAR; chave nova, INCLUIR (matrícula 00123 ≠ 123)', () => {
    const vigentes = new Map([['52998224725|00123', { arquivado: false }]]);
    const linhas = linhasDe(csv([`${CPF_A};Maria;00123;15/03/1985;01/02/2010`, `${CPF_A};Maria;123;15/03/1985;01/02/2010`]), vigentes);

    expect(linhas.map((l) => l.acao)).toEqual(['ATUALIZAR', 'INCLUIR']);
  });

  it('chave repetida no arquivo rejeita TODAS as ocorrências (mesmo com CPF mascarado numa e puro na outra)', () => {
    const linhas = linhasDe(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`, `52998224725;Maria Dup;1;15/03/1985;01/02/2010`, `${CPF_B};João;2;15/03/1985;01/02/2010`]));

    expect(linhas.map((l) => [l.status, l.codigoDeErro])).toEqual([
      ['REJEITADA', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
      ['REJEITADA', 'CHAVE_DUPLICADA_NO_ARQUIVO'],
      ['VALIDA', null],
    ]);
  });

  it('empregado arquivado na base rejeita a linha com EMPREGADO_ARQUIVADO e não reativa', () => {
    const linhas = linhasDe(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]), new Map([['52998224725|1', { arquivado: true }]]));

    expect(linhas).toEqual([expect.objectContaining({ status: 'REJEITADA', codigoDeErro: 'EMPREGADO_ARQUIVADO', campo: 'matricula', acao: null })]);
  });

  it('arquivo brasileiro real: Latin-1 com acento no nome e linhas em branco no fim', () => {
    const texto = `${CABECALHO}\r\n${CPF_A};José da Conceição;7;15/03/1985;01/02/2010\r\n\r\n\r\n`;

    expect(linhasDe(Buffer.from(texto, 'latin1'))).toEqual([expect.objectContaining({ status: 'VALIDA', nome: 'José da Conceição' })]);
  });

  it('arquivo brasileiro real: BOM UTF-8 antes do cabeçalho', () => {
    const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${CABECALHO}\r\n${CPF_A};José;7;15/03/1985;01/02/2010\r\n`, 'utf8')]);

    expect(linhasDe(comBom)).toEqual([expect.objectContaining({ status: 'VALIDA', nome: 'José' })]);
  });

  it('mapeamento por nome de coluna do arquivo (cabeçalho diferente do contrato)', () => {
    const mapeamento = { cpf: 'CPF', nome: 'Nome Completo', matricula: 'Matrícula', data_nascimento: 'Nascimento', data_admissao: 'Admissão' };
    const bytes = csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`], 'CPF;Nome Completo;Matrícula;Nascimento;Admissão');

    expect(linhasDe(bytes, new Map(), mapeamento)).toEqual([expect.objectContaining({ status: 'VALIDA', matricula: '1' })]);
  });

  it('nenhuma válida → as rejeições seguem no resultado (o worker marca REJEITADA e o staging guarda os motivos)', () => {
    const linhas = linhasDe(csv(['x;;1;31/02/2020;01/01/2020', `${CPF_A};   ;2;15/03/1985;01/02/2010`]));

    expect(linhas.every((l) => l.status === 'REJEITADA')).toBe(true);
    expect(linhas.map((l) => l.codigoDeErro)).toEqual(['CAMPO_OBRIGATORIO_AUSENTE', 'CAMPO_OBRIGATORIO_AUSENTE']);
  });

  it('a mensagem de rejeição nunca repete CPF nem nome', () => {
    const linhas = linhasDe(csv(['123.456.789-00;Fulano Sigiloso;1;15/03/1985;01/02/2010', `${CPF_A};Beltrano Sigiloso;2;31/02/1985;01/02/2010`]));

    for (const linha of linhas) {
      expect(linha.status).toBe('REJEITADA');
      expect(linha.mensagem).not.toMatch(/Sigiloso|123\.456|12345678900|529\.982|52998224725/u);
    }
  });
});

describe('analisarArquivo: defeitos do arquivo inteiro (REJEITADA sem staging)', () => {
  it.each([
    ['vazio', Buffer.alloc(0), 'ARQUIVO_VAZIO'],
    ['só o cabeçalho', Buffer.from(`${CABECALHO}\r\n`), 'ARQUIVO_VAZIO'],
    ['ilegível (aspas sem fechar)', Buffer.from(`${CABECALHO}\r\n${CPF_A};"Maria;1;15/03/1985;01/02/2010\r\n`), 'ARQUIVO_INVALIDO'],
    ['cabeçalho repetido', Buffer.from('cpf;cpf;matricula;data_nascimento;data_admissao\r\nx\r\n'), 'CABECALHO_INVALIDO'],
  ])('arquivo %s → ARQUIVO_RECUSADO com código estável', (_rotulo, bytes, codigo) => {
    expect(analisarArquivo(bytes, MAPEAMENTO, new Map())).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo });
  });

  it.each([
    ['coluna inexistente', { ...MAPEAMENTO, matricula: 'Registro' }],
    ['campo ausente', { cpf: 'cpf', nome: 'nome', matricula: 'matricula', data_nascimento: 'data_nascimento' }],
    ['coluna repetida', { ...MAPEAMENTO, nome: 'cpf' }],
    ['lixo', 'texto'],
  ])('mapeamento gravado com %s → MAPEAMENTO_INCOMPLETO', (_rotulo, mapeamento) => {
    const resultado = analisarArquivo(csv([`${CPF_A};Maria;1;15/03/1985;01/02/2010`]), mapeamento as never, new Map());

    expect(resultado).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'MAPEAMENTO_INCOMPLETO' });
  });

  it('acima do limite de linhas → ARQUIVO_ACIMA_DO_LIMITE', () => {
    const linhas = Array.from({ length: 10_001 }, (_v, i) => `${CPF_A};Maria;${i};15/03/1985;01/02/2010`);

    expect(analisarArquivo(csv(linhas), MAPEAMENTO, new Map())).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'ARQUIVO_ACIMA_DO_LIMITE' });
  });
});
