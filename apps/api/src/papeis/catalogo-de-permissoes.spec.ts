import { describe, expect, it } from 'vitest';

import { CHAVES_DO_CATALOGO, CHAVES_EXCLUSIVAS } from '@contaia/domain';

import { catalogoDePermissoes } from './catalogo-de-permissoes';

describe('catalogoDePermissoes (visão para a interface)', () => {
  const catalogo = catalogoDePermissoes();

  it('expõe exatamente as chaves do catálogo, com rótulo em PT-BR e chave estável', () => {
    const chaves = catalogo.modulos.flatMap((modulo) =>
      modulo.funcionalidades.flatMap((funcionalidade) => funcionalidade.acoes.map((acao) => acao.chave)),
    );

    expect(chaves).toEqual([...CHAVES_DO_CATALOGO]);

    const rotulos = catalogo.modulos.flatMap((m) =>
      m.funcionalidades.flatMap((f) => f.acoes.map((a) => a.rotulo)),
    );

    expect(rotulos).toContain('Marcar como lida');
    expect(rotulos).toContain('Abrir origem');
    expect(rotulos.every((rotulo) => rotulo.length > 0)).toBe(true);
  });

  it('a área exclusiva vem separada e nunca entre os módulos editáveis', () => {
    const chaves = catalogo.areaExclusiva.funcionalidades.flatMap((f) => f.acoes.map((a) => a.chave));

    expect(chaves).toEqual([...CHAVES_EXCLUSIVAS]);
    expect(catalogo.modulos.some((modulo) => modulo.id === catalogo.areaExclusiva.id)).toBe(false);
    expect(catalogo.areaExclusiva.rotulo).toBe('Usuários e permissões');
  });

  it('os quatro papéis padrão chegam com as matrizes que o servidor aplica', () => {
    const porPapel = new Map(catalogo.papeisPadrao.map((p) => [p.papel, p.permissoes]));

    expect(porPapel.get('admin_escritorio')).toContain('usuarios.usuarios_e_papeis.administrar');
    expect(porPapel.get('contador')).not.toContain('usuarios.usuarios_e_papeis.consultar');
    expect(porPapel.get('auditor_readonly')).toContain('documentos.arquivos.baixar');
    expect(porPapel.get('auditor_readonly')).not.toContain('documentos.arquivos.enviar');
  });

  it('o cofre de certificados (SPEC-011) está no catálogo com a ação Desativar e papéis coerentes', () => {
    const cofre = catalogo.modulos.find((modulo) => modulo.id === 'certificados');
    const acoes = cofre?.funcionalidades.flatMap((f) => f.acoes.map((a) => [a.chave, a.rotulo]));
    const porPapel = new Map(catalogo.papeisPadrao.map((p) => [p.papel, p.permissoes]));

    expect(acoes).toContainEqual(['certificados.cofre.desativar', 'Desativar']);
    expect(porPapel.get('admin_escritorio')).toContain('certificados.cofre.desativar');
    expect(porPapel.get('contador')).toContain('certificados.cofre.substituir');
    expect(porPapel.get('auxiliar')).toEqual(expect.arrayContaining(['certificados.cofre.consultar']));
    expect(porPapel.get('auxiliar')).not.toContain('certificados.cofre.criar');
    expect(porPapel.get('auditor_readonly')).toContain('certificados.historico.consultar');
    expect(porPapel.get('auditor_readonly')).not.toContain('certificados.cofre.criar');
  });

  it('o plano de contas (SPEC-013 §3.12) está em Empresas com as quatro ações e os papéis coerentes', () => {
    const empresas = catalogo.modulos.find((modulo) => modulo.id === 'empresas');
    const plano = empresas?.funcionalidades.find((funcionalidade) => funcionalidade.id === 'plano_contas');
    const porPapel = new Map(catalogo.papeisPadrao.map((p) => [p.papel, p.permissoes]));
    const todas = [
      'empresas.plano_contas.consultar',
      'empresas.plano_contas.importar',
      'empresas.plano_contas.confirmar_importacao',
      'empresas.plano_contas.baixar_relatorio',
    ];
    const leitura = ['empresas.plano_contas.consultar', 'empresas.plano_contas.baixar_relatorio'];

    expect(plano?.rotulo).toBe('Plano de contas');
    expect(plano?.acoes.map((acao) => acao.chave)).toEqual(todas);
    expect(plano?.acoes.every((acao) => acao.rotulo.length > 0)).toBe(true);
    expect(porPapel.get('admin_escritorio')).toEqual(expect.arrayContaining(todas));
    expect(porPapel.get('contador')).toEqual(expect.arrayContaining(todas));
    for (const papel of ['auxiliar', 'auditor_readonly'] as const) {
      expect(porPapel.get(papel)).toEqual(expect.arrayContaining(leitura));
      expect(porPapel.get(papel)).not.toContain('empresas.plano_contas.importar');
      expect(porPapel.get(papel)).not.toContain('empresas.plano_contas.confirmar_importacao');
    }
  });
});
