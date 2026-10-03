import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeValidacao } from '@contaia/domain';

import { analisar } from '../escritorio/escritorio.dto';
import {
  aceiteDoConviteSchema,
  conviteSchema,
  edicaoSchema,
  filtroDeEventosSchema,
  filtroDeUsuariosSchema,
  novoConviteSchema,
} from './usuarios.dto';

const BASE = { nome: 'Ana Souza', email: 'ana@x.com', papeis: ['contador'] };

describe('conviteSchema', () => {
  it('aceita o mínimo: nome, e-mail e papéis; telefone e CRC viram null', () => {
    expect(analisar(conviteSchema, BASE)).toEqual({ ...BASE, telefone: null, crc: null });
  });

  it('exige nome, e-mail e a lista de papéis (a regra do papel obrigatório é do domínio)', () => {
    for (const faltando of ['nome', 'email', 'papeis']) {
      const corpo: Record<string, unknown> = { ...BASE };
      delete corpo[faltando];

      expect(() => analisar(conviteSchema, corpo)).toThrow(ErroDeValidacao);
    }
  });

  it('impõe teto de tamanho em todo texto', () => {
    expect(() => analisar(conviteSchema, { ...BASE, nome: 'x'.repeat(121) })).toThrow(
      ErroDeValidacao,
    );
    expect(() => analisar(conviteSchema, { ...BASE, email: `${'a'.repeat(250)}@x.com` })).toThrow(
      ErroDeValidacao,
    );
    expect(() => analisar(conviteSchema, { ...BASE, crc: 'x'.repeat(41) })).toThrow(ErroDeValidacao);
  });

  it('recusa tipos errados e papéis que não são lista de texto', () => {
    expect(() => analisar(conviteSchema, { ...BASE, papeis: 'contador' })).toThrow(ErroDeValidacao);
    expect(() => analisar(conviteSchema, { ...BASE, papeis: [1] })).toThrow(ErroDeValidacao);
    expect(() => analisar(conviteSchema, null)).toThrow(ErroDeValidacao);
  });

  it('informa o campo que falhou', () => {
    try {
      analisar(conviteSchema, { ...BASE, nome: '' });
    } catch (erro) {
      expect((erro as ErroDeValidacao).campos).toEqual([
        { campo: 'nome', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO },
      ]);
    }
  });
});

describe('edicaoSchema e novoConviteSchema', () => {
  it('edição aceita e-mail opcional (a regra de só CONVIDADO é do caso de uso)', () => {
    expect(analisar(edicaoSchema, { nome: 'Ana', papeis: ['auxiliar'] })).toEqual({
      nome: 'Ana',
      papeis: ['auxiliar'],
      telefone: null,
      crc: null,
    });
    expect(analisar(edicaoSchema, { nome: 'Ana', papeis: ['auxiliar'], email: 'a@x.com' })).toMatchObject({
      email: 'a@x.com',
    });
  });

  it('novo convite não aceita trocar o e-mail: o campo é descartado', () => {
    const resultado = analisar(novoConviteSchema, {
      nome: 'Ana',
      papeis: ['auxiliar'],
      email: 'outro@x.com',
    });

    expect(resultado).not.toHaveProperty('email');
  });
});

describe('filtroDeUsuariosSchema', () => {
  it('usa 25 por página e começa no zero', () => {
    expect(analisar(filtroDeUsuariosSchema, {})).toEqual({ limite: 25, deslocamento: 0 });
  });

  it('aceita busca, estado e papel válidos', () => {
    expect(
      analisar(filtroDeUsuariosSchema, {
        busca: 'ana',
        estado: 'SUSPENSO',
        papel: 'auditor_readonly',
        limite: '10',
        deslocamento: '20',
      }),
    ).toEqual({ busca: 'ana', estado: 'SUSPENSO', papel: 'auditor_readonly', limite: 10, deslocamento: 20 });
  });

  it('recusa estado e papel fora do catálogo e limite acima de 100', () => {
    expect(() => analisar(filtroDeUsuariosSchema, { estado: 'EXCLUIDO' })).toThrow(ErroDeValidacao);
    expect(() => analisar(filtroDeUsuariosSchema, { papel: 'gestor_financeiro' })).toThrow(
      ErroDeValidacao,
    );
    expect(() => analisar(filtroDeUsuariosSchema, { limite: '101' })).toThrow(ErroDeValidacao);
  });
});

describe('filtroDeEventosSchema', () => {
  it('converte as datas civis do filtro em intervalo [de, até) no fuso de São Paulo', () => {
    const filtro = analisar(filtroDeEventosSchema, { de: '2026-10-01', ate: '2026-10-02' });

    // 01/10 00:00 BRT = 03:00Z; o limite superior é o início do dia seguinte ao "até".
    expect(filtro.de?.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(filtro.ate?.toISOString()).toBe('2026-10-03T03:00:00.000Z');
  });

  it('aceita filtros por usuário afetado, autor e tipo', () => {
    const filtro = analisar(filtroDeEventosSchema, {
      usuarioAfetadoId: '01927b5c-8e1a-7c3d-9a1b-0123456789ab',
      autorId: '01927b5c-8e1a-7c3d-9a1b-0123456789ac',
      tipo: 'SUSPENSO',
    });

    expect(filtro.tipo).toBe('SUSPENSO');
  });

  it('recusa data que não existe no calendário em vez de virar Invalid Date (500) ou outro dia', () => {
    for (const impossivel of ['2026-13-01', '2026-02-31', '2026-00-10', '2026-04-31']) {
      expect(() => analisar(filtroDeEventosSchema, { de: impossivel })).toThrow(ErroDeValidacao);
      expect(() => analisar(filtroDeEventosSchema, { ate: impossivel })).toThrow(ErroDeValidacao);
    }

    expect(analisar(filtroDeEventosSchema, { de: '2028-02-29' }).de).toBeInstanceOf(Date);
  });

  it('recusa tipo desconhecido, data malformada e id que não é identificador', () => {
    expect(() => analisar(filtroDeEventosSchema, { tipo: 'APAGADO' })).toThrow(ErroDeValidacao);
    expect(() => analisar(filtroDeEventosSchema, { de: '01/10/2026' })).toThrow(ErroDeValidacao);
    expect(() => analisar(filtroDeEventosSchema, { usuarioAfetadoId: 'nao-e-id' })).toThrow(
      ErroDeValidacao,
    );
  });
});

describe('aceiteDoConviteSchema', () => {
  it('exige token e senha, com tetos de tamanho', () => {
    expect(analisar(aceiteDoConviteSchema, { token: 'a'.repeat(43), senha: 'senha-longa-123' })).toEqual({
      token: 'a'.repeat(43),
      senha: 'senha-longa-123',
    });
    expect(() => analisar(aceiteDoConviteSchema, { token: 'x' })).toThrow(ErroDeValidacao);
    expect(() => analisar(aceiteDoConviteSchema, { token: 'x', senha: 's'.repeat(257) })).toThrow(
      ErroDeValidacao,
    );
  });
});
