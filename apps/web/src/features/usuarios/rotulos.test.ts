import { PAPEIS_PADRAO } from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import {
  ROTULO_DA_ACAO,
  ROTULO_DA_CAPACIDADE,
  ROTULO_DO_EVENTO,
  ROTULO_DO_PAPEL,
  SITUACAO,
  acoesDaLinha,
  descreverPermissoes,
} from './rotulos';

describe('rótulos em PT-BR', () => {
  it('todo papel padrão tem rótulo legível, nunca o identificador técnico', () => {
    for (const papel of PAPEIS_PADRAO) {
      expect(ROTULO_DO_PAPEL[papel]).toBeTruthy();
      expect(ROTULO_DO_PAPEL[papel]).not.toContain('_');
    }

    expect(ROTULO_DO_PAPEL.auditor_readonly).toBe('Auditor (somente leitura)');
  });

  it('todas as capacidades e ações da matriz têm rótulo', () => {
    expect(Object.keys(ROTULO_DA_CAPACIDADE)).toHaveLength(7);
    expect(Object.keys(ROTULO_DA_ACAO)).toHaveLength(5);
    expect(ROTULO_DA_CAPACIDADE.HISTORICO).toBe('Histórico de Informações');
    expect(ROTULO_DA_ACAO.arquivar).toBe('Arquivar e reativar');
  });

  it('os dez eventos de auditoria têm rótulo', () => {
    expect(Object.keys(ROTULO_DO_EVENTO)).toHaveLength(10);
    expect(ROTULO_DO_EVENTO.CONVITE_EXPIRADO).toBe('Convite expirado');
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

describe('descreverPermissoes', () => {
  it('lista só as capacidades concedidas, com as ações por extenso', () => {
    expect(
      descreverPermissoes({
        CADASTRO_ESCRITORIO: [],
        EMPRESAS: ['consultar', 'criar', 'editar'],
        DOCUMENTOS: ['administrar'],
        PENDENCIAS: ['consultar'],
        NOTIFICACOES: [],
        HISTORICO: [],
        USUARIOS: [],
      }),
    ).toEqual([
      { capacidade: 'Empresas', acoes: ['Consultar', 'Criar', 'Editar'] },
      { capacidade: 'Documentos da empresa', acoes: ['Administrar'] },
      { capacidade: 'Central de Pendências', acoes: ['Consultar'] },
    ]);
  });

  it('papel sem nenhuma permissão devolve lista vazia', () => {
    expect(
      descreverPermissoes({
        CADASTRO_ESCRITORIO: [],
        EMPRESAS: [],
        DOCUMENTOS: [],
        PENDENCIAS: [],
        NOTIFICACOES: [],
        HISTORICO: [],
        USUARIOS: [],
      }),
    ).toEqual([]);
  });
});
