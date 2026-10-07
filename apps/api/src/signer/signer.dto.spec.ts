import { describe, expect, it } from 'vitest';

import { estadosSchema, filtroDoHistoricoDoSignerSchema, testeManualSchema } from './signer.dto';

const A = '0198f3c2-0000-7000-0000-000000000001';
const B = '0198f3c2-0000-7000-4000-000000000002';

describe('DTOs do Signer na API', () => {
  it('estados: lista separada por vírgula vira array de ids (inclusive os do banco, de variante "errada")', () => {
    expect(estadosSchema.parse({ empresaIds: `${A},${B}` })).toEqual({ empresaIds: [A, B] });
  });

  it.each(['', ',', `${A},não-é-id`, `${A},../../x`])('estados recusa lista inválida: %j', (valor) => {
    expect(estadosSchema.safeParse({ empresaIds: valor }).success).toBe(false);
  });

  it('estados recusa mais de 50 empresas e a ausência do parâmetro', () => {
    const muitas = Array.from({ length: 51 }, (_, i) => `0198f3c2-0000-7000-8000-${String(i).padStart(12, '0')}`).join(',');

    expect(estadosSchema.safeParse({ empresaIds: muitas }).success).toBe(false);
    expect(estadosSchema.safeParse({}).success).toBe(false);
  });

  it('histórico: página começa em 1 e os filtros são opcionais', () => {
    expect(filtroDoHistoricoDoSignerSchema.parse({})).toEqual({ pagina: 1 });
    expect(filtroDoHistoricoDoSignerSchema.parse({ pagina: '3', finalidade: 'ESOCIAL_TESTE', resultado: 'FALHA' })).toEqual({
      pagina: 3,
      finalidade: 'ESOCIAL_TESTE',
      resultado: 'FALHA',
    });
  });

  it.each([{ pagina: '0' }, { pagina: 'x' }, { finalidade: 'LIVRE' }, { resultado: 'TALVEZ' }])(
    'histórico recusa filtro fora do contrato: %j',
    (consulta) => {
      expect(filtroDoHistoricoDoSignerSchema.safeParse(consulta).success).toBe(false);
    },
  );

  it('teste manual: a finalidade é opcional (sem ela, testa as duas) e fechada no catálogo', () => {
    expect(testeManualSchema.parse({})).toEqual({});
    expect(testeManualSchema.parse({ finalidade: 'DFE_TESTE' })).toEqual({ finalidade: 'DFE_TESTE' });
    expect(testeManualSchema.safeParse({ finalidade: 'LIVRE' }).success).toBe(false);
  });

  it('teste manual não aceita campo extra (nada de URL nem XML)', () => {
    expect(testeManualSchema.safeParse({ xml: '<a/>' }).success).toBe(false);
    expect(testeManualSchema.safeParse({ url: 'https://evil.example' }).success).toBe(false);
  });
});
