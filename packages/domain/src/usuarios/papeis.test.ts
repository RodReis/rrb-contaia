import { describe, expect, it } from 'vitest';

import {
  PAPEIS_PADRAO,
  ehPapelPadrao,
  escopoDeEmpresas,
  podeExecutar,
  type Acao,
  type Capacidade,
  type PapelPadrao,
} from './papeis.js';

const TODAS_AS_ACOES: readonly Acao[] = ['consultar', 'criar', 'editar', 'arquivar', 'administrar'];

// Matriz da SPEC-007 §3.1, escrita à mão: o teste não lê a constante de produção.
// `administrar` expande para todas as ações mutáveis da capacidade.
const ESPERADO: Readonly<Record<Capacidade, Readonly<Record<PapelPadrao, readonly Acao[]>>>> = {
  CADASTRO_ESCRITORIO: {
    admin_escritorio: ['consultar', 'editar'],
    contador: [],
    auxiliar: [],
    auditor_readonly: ['consultar'],
  },
  EMPRESAS: {
    admin_escritorio: ['consultar', 'criar', 'editar', 'arquivar'],
    contador: ['consultar', 'criar', 'editar', 'arquivar'],
    auxiliar: ['consultar', 'criar', 'editar'],
    auditor_readonly: ['consultar'],
  },
  DOCUMENTOS: {
    admin_escritorio: TODAS_AS_ACOES,
    contador: TODAS_AS_ACOES,
    auxiliar: TODAS_AS_ACOES,
    auditor_readonly: ['consultar'],
  },
  PENDENCIAS: {
    admin_escritorio: TODAS_AS_ACOES,
    contador: TODAS_AS_ACOES,
    auxiliar: TODAS_AS_ACOES,
    auditor_readonly: ['consultar'],
  },
  NOTIFICACOES: {
    admin_escritorio: TODAS_AS_ACOES,
    contador: TODAS_AS_ACOES,
    auxiliar: TODAS_AS_ACOES,
    auditor_readonly: ['consultar'],
  },
  HISTORICO: {
    admin_escritorio: ['consultar'],
    contador: ['consultar'],
    auxiliar: [],
    auditor_readonly: ['consultar'],
  },
  USUARIOS: {
    admin_escritorio: TODAS_AS_ACOES,
    contador: [],
    auxiliar: [],
    auditor_readonly: ['consultar'],
  },
};

const CAPACIDADES = Object.keys(ESPERADO) as Capacidade[];

describe('matriz de papéis padrão (SPEC-007 §3.1)', () => {
  it('só os quatro papéis do MVP-1 existem', () => {
    expect([...PAPEIS_PADRAO]).toEqual([
      'admin_escritorio',
      'contador',
      'auxiliar',
      'auditor_readonly',
    ]);
  });

  for (const capacidade of CAPACIDADES) {
    for (const papel of PAPEIS_PADRAO) {
      for (const acao of TODAS_AS_ACOES) {
        const permitido = ESPERADO[capacidade][papel].includes(acao);

        it(`${papel} ${permitido ? 'pode' : 'não pode'} ${acao} em ${capacidade}`, () => {
          expect(podeExecutar([papel], capacidade, acao)).toBe(permitido);
        });
      }
    }
  }
});

describe('permissões aditivas', () => {
  it('auxiliar + auditor edita empresa, mas não arquiva', () => {
    const papeis: PapelPadrao[] = ['auxiliar', 'auditor_readonly'];

    expect(podeExecutar(papeis, 'EMPRESAS', 'editar')).toBe(true);
    expect(podeExecutar(papeis, 'EMPRESAS', 'arquivar')).toBe(false);
  });

  it('auditor + contador arquiva empresa', () => {
    expect(podeExecutar(['auditor_readonly', 'contador'], 'EMPRESAS', 'arquivar')).toBe(true);
  });

  it('contador + auxiliar continua sem acesso a usuários', () => {
    expect(podeExecutar(['contador', 'auxiliar'], 'USUARIOS', 'consultar')).toBe(false);
  });

  it('sem papéis nada é permitido', () => {
    for (const capacidade of CAPACIDADES) {
      for (const acao of TODAS_AS_ACOES) {
        expect(podeExecutar([], capacidade, acao)).toBe(false);
      }
    }
  });
});

describe('escopoDeEmpresas (decisão do PI: admin vê tudo, demais veem zero até a carteira)', () => {
  it('admin enxerga todas', () => {
    expect(escopoDeEmpresas(['admin_escritorio'])).toBe('TODAS');
  });

  it('admin combinado com outro papel continua enxergando todas', () => {
    expect(escopoDeEmpresas(['auxiliar', 'admin_escritorio'])).toBe('TODAS');
  });

  it('contador, auxiliar e auditor não enxergam nenhuma', () => {
    expect(escopoDeEmpresas(['contador'])).toBe('NENHUMA');
    expect(escopoDeEmpresas(['auxiliar'])).toBe('NENHUMA');
    expect(escopoDeEmpresas(['auditor_readonly'])).toBe('NENHUMA');
  });

  it('sem papéis não enxerga nenhuma', () => {
    expect(escopoDeEmpresas([])).toBe('NENHUMA');
  });
});

describe('ehPapelPadrao', () => {
  it('aceita os quatro papéis', () => {
    for (const papel of PAPEIS_PADRAO) {
      expect(ehPapelPadrao(papel)).toBe(true);
    }
  });

  it('recusa papéis de outros MVPs e valores inválidos', () => {
    expect(ehPapelPadrao('gestor_financeiro')).toBe(false);
    expect(ehPapelPadrao('dp')).toBe(false);
    expect(ehPapelPadrao('cliente_portal')).toBe(false);
    expect(ehPapelPadrao('')).toBe(false);
    expect(ehPapelPadrao(null)).toBe(false);
    expect(ehPapelPadrao(1)).toBe(false);
  });
});
