/**
 * Rejeição estrutural de célula (SPEC-015 §3.5): fórmula ou mescla em coluna mapeada rejeita só a
 * linha, com código estável, campo e mensagem fixa — sem eco de valor, sem virar chave nem pai.
 */
import { describe, expect, it } from 'vitest';

import { normalizarLinhas } from './csv.js';
import { CODIGOS_DE_ERRO_DA_LINHA, validarLinhasDoPlano } from './validacao.js';
import type { LinhaBrutaDeEntrada } from './validacao.js';

const linha = (numeroDaLinha: number, dados: Partial<LinhaBrutaDeEntrada> = {}): LinhaBrutaDeEntrada => ({
  numeroDaLinha,
  codigo: '1',
  nome: 'Ativo',
  tipo: 'sintetica',
  natureza: 'devedora',
  contaPai: null,
  ...dados,
});

const validar = (linhas: readonly LinhaBrutaDeEntrada[]) => validarLinhasDoPlano({ linhas, contasVigentes: [] });

describe('validarLinhasDoPlano — rejeição estrutural de célula', () => {
  it('os dois códigos novos fazem parte do contrato de rejeição de linha', () => {
    expect(CODIGOS_DE_ERRO_DA_LINHA).toContain('CELULA_COM_FORMULA');
    expect(CODIGOS_DE_ERRO_DA_LINHA).toContain('CELULA_MESCLADA');
  });

  it('rejeita a linha com o código, o campo e uma mensagem fixa, sem repetir valores', () => {
    const resultado = validar([
      linha(2, { codigo: '9.9.99', nome: 'Nome secreto', rejeicaoEstrutural: { codigo: 'CELULA_COM_FORMULA', campo: 'nome' } }),
      linha(3, { codigo: '9.9.98', nome: 'Outro', rejeicaoEstrutural: { codigo: 'CELULA_MESCLADA', campo: 'tipo' } }),
    ]);

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas).toEqual([
      expect.objectContaining({ numeroDaLinha: 2, codigoDeErro: 'CELULA_COM_FORMULA', campo: 'nome', codigo: '9.9.99' }),
      expect.objectContaining({ numeroDaLinha: 3, codigoDeErro: 'CELULA_MESCLADA', campo: 'tipo', codigo: '9.9.98' }),
    ]);
    for (const rejeitada of resultado.rejeitadas) {
      expect(rejeitada.mensagem).toMatch(/fórmula|mescl/iu);
      expect(rejeitada.mensagem).not.toContain('9.9.9');
      expect(rejeitada.mensagem).not.toContain('Nome secreto');
    }
    expect(resultado.rejeitadas[0]?.mensagem).not.toBe(resultado.rejeitadas[1]?.mensagem);
  });

  it('só a linha afetada é rejeitada; as demais seguem normalmente', () => {
    const resultado = validar([
      linha(2, { codigo: '1' }),
      linha(3, { codigo: '2', rejeicaoEstrutural: { codigo: 'CELULA_COM_FORMULA', campo: 'natureza' } }),
      linha(4, { codigo: '3' }),
    ]);

    expect(resultado.aceitas.map((a) => a.codigo)).toEqual(['1', '3']);
    expect(resultado.rejeitadas.map((r) => r.numeroDaLinha)).toEqual([3]);
  });

  it('a rejeição estrutural vale mesmo se os demais campos estiverem em branco ou inválidos', () => {
    const [rejeitada] = validar([
      linha(2, { codigo: '', nome: '', tipo: 'lixo', rejeicaoEstrutural: { codigo: 'CELULA_MESCLADA', campo: 'codigo' } }),
    ]).rejeitadas;

    expect(rejeitada).toMatchObject({ codigoDeErro: 'CELULA_MESCLADA', campo: 'codigo', codigo: null });
  });

  it('linha rejeitada por estrutura nunca é conta-pai válida: a filha é CONTA_PAI_REJEITADA', () => {
    const resultado = validar([
      linha(2, { codigo: '1', rejeicaoEstrutural: { codigo: 'CELULA_COM_FORMULA', campo: 'nome' } }),
      linha(3, { codigo: '1.1', tipo: 'analitica', contaPai: '1' }),
    ]);

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro])).toEqual([
      [2, 'CELULA_COM_FORMULA'],
      [3, 'CONTA_PAI_REJEITADA'],
    ]);
  });

  it('linha rejeitada por estrutura não aceita um código que outra linha também usa', () => {
    const resultado = validar([
      linha(2, { codigo: '1', rejeicaoEstrutural: { codigo: 'CELULA_MESCLADA', campo: 'nome' } }),
      linha(3, { codigo: '1', nome: 'Outro Ativo' }),
    ]);

    expect(resultado.aceitas).toEqual([]);
    expect(resultado.rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro])).toEqual([
      [2, 'CELULA_MESCLADA'],
      [3, 'CODIGO_DUPLICADO_NO_ARQUIVO'],
    ]);
  });
});

describe('normalizarLinhas — rejeição estrutural vinda da planilha', () => {
  const mapeamento = { codigo: 'A', nome: 'B', tipo: 'C', natureza: 'D', conta_pai: 'E' } as const;
  const cabecalho = ['A', 'B', 'C', 'D', 'E'];
  const registro = (numeroDaLinha: number, celulas: readonly string[]) => ({ numeroDaLinha, celulas, camposAMais: 0 });

  it('traduz a letra da célula afetada para o campo do contrato', () => {
    const linhas = normalizarLinhas(
      cabecalho,
      [registro(2, ['1', '', 'sintetica', 'devedora', '']), registro(3, ['2', 'Caixa', 'analitica', 'devedora', '1'])],
      mapeamento,
      new Map([[2, { codigo: 'CELULA_COM_FORMULA', letra: 'B' }]]),
    );

    expect(linhas[0]?.rejeicaoEstrutural).toEqual({ codigo: 'CELULA_COM_FORMULA', campo: 'nome' });
    expect(linhas[1]?.rejeicaoEstrutural).toBeUndefined();
  });

  it('sem o quarto argumento o resultado é o do CSV, sem a chave nova', () => {
    const [primeira] = normalizarLinhas(cabecalho, [registro(2, ['1', 'Ativo', 'sintetica', 'devedora', ''])], mapeamento);

    expect(primeira).toEqual({
      numeroDaLinha: 2,
      codigo: '1',
      nome: 'Ativo',
      tipo: 'sintetica',
      natureza: 'devedora',
      contaPai: null,
    });
    expect('rejeicaoEstrutural' in (primeira ?? {})).toBe(false);
  });
});
