import { describe, expect, it } from 'vitest';

import { filtroDaCentralSchema } from './pendencias.dto';

describe('filtroDaCentralSchema — plano de contas (SPEC-013 §3.10)', () => {
  it('aceita a origem PLANO_CONTAS e o tipo PLANO_CONTAS_INCOMPLETO', () => {
    const filtro = filtroDaCentralSchema.parse({
      origem: 'PLANO_CONTAS',
      tipo: 'PLANO_CONTAS_INCOMPLETO',
    });

    expect(filtro.origem).toBe('PLANO_CONTAS');
    expect(filtro.tipo).toBe('PLANO_CONTAS_INCOMPLETO');
  });

  it('continua recusando origem e tipo desconhecidos', () => {
    expect(filtroDaCentralSchema.safeParse({ origem: 'PLANO' }).success).toBe(false);
    expect(filtroDaCentralSchema.safeParse({ tipo: 'PLANO_CONTAS' }).success).toBe(false);
  });
});
