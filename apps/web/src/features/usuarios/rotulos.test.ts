import { PAPEIS_PADRAO } from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import {
  ROTULO_DO_EVENTO,
  ROTULO_DO_PAPEL,
  SITUACAO,
  TIPOS_DE_EVENTO,
  acoesDaLinha,
  ehEventoDePapel,
} from './rotulos';

describe('rótulos em PT-BR', () => {
  it('todo papel padrão tem rótulo legível, nunca o identificador técnico', () => {
    for (const papel of PAPEIS_PADRAO) {
      expect(ROTULO_DO_PAPEL[papel]).toBeTruthy();
      expect(ROTULO_DO_PAPEL[papel]).not.toContain('_');
    }

    expect(ROTULO_DO_PAPEL.auditor_readonly).toBe('Auditor (somente leitura)');
  });

  it('os quinze eventos de auditoria têm rótulo (dez de usuários, cinco de papéis)', () => {
    expect(Object.keys(ROTULO_DO_EVENTO)).toHaveLength(15);
    expect([...TIPOS_DE_EVENTO].sort()).toEqual(Object.keys(ROTULO_DO_EVENTO).sort());
    expect(ROTULO_DO_EVENTO.CONVITE_EXPIRADO).toBe('Convite expirado');
    expect(ROTULO_DO_EVENTO.PAPEL_MATRIZ_ALTERADA).toBe('Permissões do papel alteradas');
    expect(ROTULO_DO_EVENTO.PAPEL_REATIVADO).toBe('Papel reativado');
  });

  it('só os eventos PAPEL_* nomeiam um papel em vez de um usuário', () => {
    const dePapel = TIPOS_DE_EVENTO.filter(ehEventoDePapel);

    expect(dePapel).toEqual([
      'PAPEL_CRIADO',
      'PAPEL_DADOS_ALTERADOS',
      'PAPEL_MATRIZ_ALTERADA',
      'PAPEL_ARQUIVADO',
      'PAPEL_REATIVADO',
    ]);
    expect(ehEventoDePapel('SUSPENSO')).toBe(false);
  });
});

describe('SITUACAO', () => {
  it('cada situação tem rótulo textual: a cor nunca é o único sinal', () => {
    for (const situacao of Object.values(SITUACAO)) {
      expect(situacao.rotulo.length).toBeGreaterThan(2);
    }

    expect(SITUACAO.CONVITE_EXPIRADO.rotulo).toBe('Convite expirado');
    expect(SITUACAO.ATIVO.tom).toBe('conforme');
  });
});

describe('acoesDaLinha', () => {
  it('convidado e convite expirado permitem editar e reenviar', () => {
    expect(acoesDaLinha('CONVIDADO')).toEqual(['editar', 'reenviar']);
    expect(acoesDaLinha('CONVITE_EXPIRADO')).toEqual(['editar', 'reenviar']);
  });

  it('ativo permite editar, suspender e arquivar', () => {
    expect(acoesDaLinha('ATIVO')).toEqual(['editar', 'suspender', 'arquivar']);
  });

  it('suspenso permite editar, reativar e arquivar', () => {
    expect(acoesDaLinha('SUSPENSO')).toEqual(['editar', 'reativar', 'arquivar']);
  });

  it('arquivado só volta por novo convite', () => {
    expect(acoesDaLinha('ARQUIVADO')).toEqual(['novo-convite']);
  });
});
