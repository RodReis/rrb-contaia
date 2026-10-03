import { describe, expect, it } from 'vitest';

import { catalogoDePapeis, permissoesDe } from './permissoes';

describe('permissoesDe', () => {
  it('lista, por capacidade, as ações que a união dos papéis concede', () => {
    const permissoes = permissoesDe(['auxiliar', 'auditor_readonly']);

    expect(permissoes.EMPRESAS).toEqual(['consultar', 'criar', 'editar']);
    expect(permissoes.DOCUMENTOS).toEqual(['consultar', 'criar', 'editar', 'arquivar', 'administrar']);
    expect(permissoes.USUARIOS).toEqual(['consultar']);
    expect(permissoes.HISTORICO).toEqual(['consultar']);
  });

  it('sem papéis nada é concedido, mas todas as capacidades aparecem', () => {
    const permissoes = permissoesDe([]);

    expect(Object.keys(permissoes).sort()).toEqual(
      [
        'CADASTRO_ESCRITORIO',
        'DOCUMENTOS',
        'EMPRESAS',
        'HISTORICO',
        'NOTIFICACOES',
        'PENDENCIAS',
        'USUARIOS',
      ].sort(),
    );
    expect(Object.values(permissoes).every((acoes) => acoes.length === 0)).toBe(true);
  });
});

describe('catalogoDePapeis (aba "Papéis e permissões", somente leitura)', () => {
  it('traz os quatro papéis padrão, na ordem do catálogo, com suas permissões', () => {
    const catalogo = catalogoDePapeis();

    expect(catalogo.map((item) => item.papel)).toEqual([
      'admin_escritorio',
      'contador',
      'auxiliar',
      'auditor_readonly',
    ]);
    expect(catalogo[1]?.permissoes.USUARIOS).toEqual([]);
    expect(catalogo[1]?.permissoes.EMPRESAS).toEqual(['consultar', 'criar', 'editar', 'arquivar']);
    expect(catalogo[3]?.permissoes.EMPRESAS).toEqual(['consultar']);
  });
});
