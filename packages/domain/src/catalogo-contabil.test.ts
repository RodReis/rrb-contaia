import { describe, expect, it } from 'vitest';
import { statusDaConta, validarHierarquia, type ItemHierarquico } from './catalogo-contabil.js';

const item = (code: string, parentCode: string | null, type: ItemHierarquico['type'] = 'SYNTHETIC'): ItemHierarquico =>
  ({ code, parentCode, type, archived: false });

describe('catálogo contábil', () => {
  it('recusa pai ausente/arquivado, ciclo indireto e analítica com filhos', () => {
    expect(validarHierarquia(item('2', '9'), [item('1', null)])).toBe('ACCOUNTING_CATALOG_PARENT_INVALID');
    expect(validarHierarquia(item('1', '2'), [item('2', '1')])).toBe('ACCOUNTING_CATALOG_CYCLE');
    expect(validarHierarquia(item('1', null, 'ANALYTICAL'), [item('2', '1')])).toBe('ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE');
  });

  it('mantém legado sem classe como incompleto, sem inferência', () => {
    expect(statusDaConta(null, false)).toBe('INCOMPLETE');
    expect(statusDaConta('OTHER', false)).toBe('ACTIVE');
    expect(statusDaConta(null, true)).toBe('ARCHIVED');
  });

  it('bloqueia filha com classe diferente da classe do pai', () => {
    const pai = { ...item('1', null), accountClass: 'ASSET' as const };
    const filha = { ...item('1.1', '1', 'ANALYTICAL'), accountClass: 'EXPENSE' as const };
    expect(validarHierarquia(filha, [pai])).toBe('ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE');
  });

  it('bloqueia reclassificar o pai quando filha existente passaria a divergir', () => {
    const pai = { ...item('1', null), accountClass: 'EXPENSE' as const };
    const filha = { ...item('1.1', '1', 'ANALYTICAL'), accountClass: 'ASSET' as const };
    expect(validarHierarquia(pai, [filha])).toBe('ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE');
  });
});
