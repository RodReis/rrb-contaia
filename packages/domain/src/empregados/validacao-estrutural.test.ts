/**
 * Rejeição estrutural de célula (SPEC-015 §3.5) na validação de empregados.
 */
import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO_DE_EMPREGADO, CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO } from './campos.js';
import { normalizarLinhasDeEmpregados } from './normalizacao.js';
import { validarLinhasDeEmpregados } from './validacao.js';
import type { LinhaBrutaDeEmpregado } from './validacao.js';

const CPF = '529.982.247-25';
const VAZIO = new Map<string, { arquivado: boolean }>();

const linha = (numeroDaLinha: number, dados: Partial<LinhaBrutaDeEmpregado> = {}): LinhaBrutaDeEmpregado => ({
  numeroDaLinha,
  cpf: CPF,
  nome: 'Maria da Silva',
  matricula: '00123',
  dataNascimento: '15/03/1990',
  dataAdmissao: '01/02/2015',
  ...dados,
});

describe('validarLinhasDeEmpregados — rejeição estrutural de célula', () => {
  it('os dois códigos novos acompanham os sete do CSV, que seguem intactos', () => {
    expect(CODIGOS_DE_ERRO_DE_EMPREGADO).toHaveLength(7);
    expect(CODIGOS_DE_ERRO_DE_EMPREGADO_EM_QUALQUER_FORMATO).toEqual([
      ...CODIGOS_DE_ERRO_DE_EMPREGADO,
      'CELULA_COM_FORMULA',
      'CELULA_MESCLADA',
    ]);
  });

  it('rejeita a linha com código, campo e mensagem fixa, sem CPF nem nome na mensagem', () => {
    const [formula, mescla] = validarLinhasDeEmpregados(
      [
        linha(2, { rejeicaoEstrutural: { codigo: 'CELULA_COM_FORMULA', campo: 'data_nascimento' } }),
        linha(3, { matricula: '9', rejeicaoEstrutural: { codigo: 'CELULA_MESCLADA', campo: 'nome' } }),
      ],
      VAZIO,
    );

    expect(formula).toMatchObject({
      status: 'REJEITADA',
      acao: null,
      codigoDeErro: 'CELULA_COM_FORMULA',
      campo: 'data_nascimento',
    });
    expect(mescla).toMatchObject({ status: 'REJEITADA', codigoDeErro: 'CELULA_MESCLADA', campo: 'nome' });
    for (const rejeitada of [formula, mescla]) {
      expect(rejeitada?.mensagem).toMatch(/fórmula|mescl/iu);
      expect(rejeitada?.mensagem).not.toContain(CPF);
      expect(rejeitada?.mensagem).not.toContain('Maria');
    }
  });

  it('só a linha afetada é rejeitada; vale mesmo com outros defeitos na mesma linha', () => {
    const resultado = validarLinhasDeEmpregados(
      [
        linha(2, { matricula: '1' }),
        linha(3, { matricula: '2', cpf: '123', rejeicaoEstrutural: { codigo: 'CELULA_COM_FORMULA', campo: 'cpf' } }),
        linha(4, { matricula: '3' }),
      ],
      VAZIO,
    );

    expect(resultado.map((r) => [r.numeroDaLinha, r.status, r.codigoDeErro])).toEqual([
      [2, 'VALIDA', null],
      [3, 'REJEITADA', 'CELULA_COM_FORMULA'],
      [4, 'VALIDA', null],
    ]);
  });

  it('chave igual à de linha rejeitada por estrutura rejeita as duas (nunca é chave válida)', () => {
    const resultado = validarLinhasDeEmpregados(
      [
        linha(2, { rejeicaoEstrutural: { codigo: 'CELULA_MESCLADA', campo: 'nome' } }),
        linha(3),
      ],
      VAZIO,
    );

    expect(resultado.map((r) => [r.numeroDaLinha, r.codigoDeErro])).toEqual([
      [2, 'CELULA_MESCLADA'],
      [3, 'CHAVE_DUPLICADA_NO_ARQUIVO'],
    ]);
  });

  it('linha rejeitada por estrutura em chave vigente nunca atualiza', () => {
    const [resultado] = validarLinhasDeEmpregados(
      [linha(2, { rejeicaoEstrutural: { codigo: 'CELULA_COM_FORMULA', campo: 'nome' } })],
      new Map([['52998224725|00123', { arquivado: false }]]),
    );

    expect(resultado).toMatchObject({ status: 'REJEITADA', acao: null, codigoDeErro: 'CELULA_COM_FORMULA' });
  });
});

describe('normalizarLinhasDeEmpregados — rejeição estrutural vinda da planilha', () => {
  const mapeamento = { cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' } as const;
  const cabecalho = ['A', 'B', 'C', 'D', 'E'];
  const registro = (numeroDaLinha: number, celulas: readonly string[]) => ({ numeroDaLinha, celulas, camposAMais: 0 });

  it('traduz a letra da célula afetada para o campo do contrato', () => {
    const linhas = normalizarLinhasDeEmpregados(
      cabecalho,
      [registro(2, [CPF, 'Maria', '1', '', '01/02/2015']), registro(3, [CPF, 'Maria', '2', '15/03/1990', '01/02/2015'])],
      mapeamento,
      new Map([[2, { codigo: 'CELULA_MESCLADA', letra: 'D' }]]),
    );

    expect(linhas[0]?.rejeicaoEstrutural).toEqual({ codigo: 'CELULA_MESCLADA', campo: 'data_nascimento' });
    expect(linhas[1]?.rejeicaoEstrutural).toBeUndefined();
  });

  it('sem o quarto argumento não acrescenta a chave nova', () => {
    const [primeira] = normalizarLinhasDeEmpregados(
      cabecalho,
      [registro(2, [CPF, 'Maria', '1', '15/03/1990', '01/02/2015'])],
      mapeamento,
    );

    expect('rejeicaoEstrutural' in (primeira ?? {})).toBe(false);
  });
});
