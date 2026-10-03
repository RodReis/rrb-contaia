import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  podePerderAdministracao,
  situacaoApresentada,
  transicionar,
  validarPapeis,
  type EstadoDoUsuario,
  type Transicao,
} from './ciclo-de-vida.js';

const VALIDAS: ReadonlyArray<readonly [EstadoDoUsuario, Transicao, EstadoDoUsuario]> = [
  ['CONVIDADO', 'ACEITAR', 'ATIVO'],
  ['CONVIDADO', 'REENVIAR', 'CONVIDADO'],
  ['ATIVO', 'SUSPENDER', 'SUSPENSO'],
  ['SUSPENSO', 'REATIVAR', 'ATIVO'],
  ['ATIVO', 'ARQUIVAR', 'ARQUIVADO'],
  ['SUSPENSO', 'ARQUIVAR', 'ARQUIVADO'],
  ['ARQUIVADO', 'NOVO_CONVITE', 'CONVIDADO'],
];

const ESTADOS: readonly EstadoDoUsuario[] = ['CONVIDADO', 'ATIVO', 'SUSPENSO', 'ARQUIVADO'];
const TRANSICOES: readonly Transicao[] = [
  'ACEITAR',
  'SUSPENDER',
  'REATIVAR',
  'ARQUIVAR',
  'REENVIAR',
  'NOVO_CONVITE',
];

describe('transicionar (SPEC-007 §3.3)', () => {
  for (const [de, transicao, para] of VALIDAS) {
    it(`${de} --${transicao}--> ${para}`, () => {
      expect(transicionar(de, transicao)).toBe(para);
    });
  }

  for (const estado of ESTADOS) {
    for (const transicao of TRANSICOES) {
      const valida = VALIDAS.some(([de, t]) => de === estado && t === transicao);

      if (valida) {
        continue;
      }

      it(`recusa ${transicao} a partir de ${estado}`, () => {
        expect(() => transicionar(estado, transicao)).toThrow(
          expect.objectContaining({
            codigo: CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA,
          }) as Error,
        );
      });
    }
  }

  it('lança ErroDeDominio com código estável', () => {
    expect(() => transicionar('CONVIDADO', 'SUSPENDER')).toThrow(ErroDeDominio);
  });
});

describe('situacaoApresentada', () => {
  const agora = new Date('2026-10-02T12:00:00Z');

  it('CONVIDADO com convite vencido é apresentado como CONVITE_EXPIRADO', () => {
    expect(
      situacaoApresentada(
        { estado: 'CONVIDADO', conviteExpiraEm: new Date('2026-10-02T11:59:59Z') },
        agora,
      ),
    ).toBe('CONVITE_EXPIRADO');
  });

  it('no instante exato da expiração o convite já está expirado', () => {
    expect(situacaoApresentada({ estado: 'CONVIDADO', conviteExpiraEm: agora }, agora)).toBe(
      'CONVITE_EXPIRADO',
    );
  });

  it('CONVIDADO com convite vigente continua CONVIDADO', () => {
    expect(
      situacaoApresentada(
        { estado: 'CONVIDADO', conviteExpiraEm: new Date('2026-10-02T12:00:01Z') },
        agora,
      ),
    ).toBe('CONVIDADO');
  });

  it('CONVIDADO sem convite vigente registrado é CONVITE_EXPIRADO (preserva cadastro para reenvio)', () => {
    expect(situacaoApresentada({ estado: 'CONVIDADO', conviteExpiraEm: null }, agora)).toBe(
      'CONVITE_EXPIRADO',
    );
  });

  it('outros estados ignoram a data do convite', () => {
    const vencido = new Date('2020-01-01T00:00:00Z');

    for (const estado of ['ATIVO', 'SUSPENSO', 'ARQUIVADO'] as const) {
      expect(situacaoApresentada({ estado, conviteExpiraEm: vencido }, agora)).toBe(estado);
    }
  });
});

describe('validarPapeis', () => {
  it('exige ao menos um papel', () => {
    expect(() => validarPapeis([])).toThrow(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.PAPEL_OBRIGATORIO }) as Error,
    );
  });

  it('recusa papel fora do catálogo padrão do MVP-1', () => {
    expect(() => validarPapeis(['gestor_financeiro'])).toThrow(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.PAPEL_INVALIDO }) as Error,
    );
    expect(() => validarPapeis(['contador', 'inventado'])).toThrow(
      expect.objectContaining({ codigo: CODIGOS_DE_ERRO.PAPEL_INVALIDO }) as Error,
    );
  });

  it('colapsa duplicatas preservando a ordem', () => {
    expect(validarPapeis(['auxiliar', 'contador', 'auxiliar'])).toEqual(['auxiliar', 'contador']);
  });
});

describe('podePerderAdministracao', () => {
  it('bloqueia quando não restaria nenhum administrador ativo', () => {
    expect(podePerderAdministracao(0)).toBe(false);
  });

  it('permite quando resta ao menos um administrador ativo', () => {
    expect(podePerderAdministracao(1)).toBe(true);
    expect(podePerderAdministracao(5)).toBe(true);
  });
});
