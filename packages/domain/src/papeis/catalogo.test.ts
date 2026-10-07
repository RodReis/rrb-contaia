import { describe, expect, it } from 'vitest';

import {
  CATALOGO,
  CHAVES_DO_CATALOGO,
  CHAVES_EXCLUSIVAS,
  chavesDoModulo,
  consultaImplicada,
  dependentesDeConsulta,
  ehChaveDoCatalogo,
  ehChaveExclusiva,
} from './catalogo.js';

// Catálogo da SPEC-008 §3.2, escrito à mão: o teste não lê a constante de produção.
const ESPERADO = [
  'escritorio.dados.consultar',
  'escritorio.dados.editar',
  'empresas.cadastro.consultar',
  'empresas.cadastro.criar',
  'empresas.cadastro.editar',
  'empresas.cadastro.arquivar',
  'empresas.cadastro.reativar',
  'empresas.historico.consultar',
  'documentos.exigencias.consultar',
  'documentos.exigencias.criar',
  'documentos.exigencias.dispensar',
  'documentos.arquivos.consultar',
  'documentos.arquivos.enviar',
  'documentos.arquivos.substituir',
  'documentos.arquivos.visualizar',
  'documentos.arquivos.baixar',
  'documentos.analise.consultar',
  'documentos.analise.aprovar',
  'documentos.analise.rejeitar',
  'documentos.historico.consultar',
  'pendencias.pendencias.consultar',
  'pendencias.pendencias.abrir_origem',
  'notificacoes.sino.consultar',
  'notificacoes.sino.marcar_lida',
  'certificados.cofre.consultar',
  'certificados.cofre.criar',
  'certificados.cofre.substituir',
  'certificados.cofre.editar',
  'certificados.cofre.desativar',
  'certificados.historico.consultar',
  // SPEC-012: painel do Signer dentro do Cofre; só o teste manual muta (diagnóstico, nunca assinatura).
  'certificados.signer.consultar',
  'certificados.signer.testar',
  'historico.global.consultar',
];

describe('catálogo de permissões (SPEC-008 §3.2)', () => {
  it('contém exatamente as capacidades entregues, na ordem do catálogo', () => {
    expect([...CHAVES_DO_CATALOGO]).toEqual(ESPERADO);
  });

  it('a área de usuários e papéis é exclusiva e fica fora do catálogo editável', () => {
    expect([...CHAVES_EXCLUSIVAS]).toEqual([
      'usuarios.usuarios_e_papeis.consultar',
      'usuarios.usuarios_e_papeis.administrar',
    ]);
    expect(CATALOGO.some((modulo) => modulo.id === 'usuarios')).toBe(false);
  });

  it('toda funcionalidade tem Consultar, para que o módulo possa ficar visível', () => {
    for (const modulo of CATALOGO) {
      for (const funcionalidade of modulo.funcionalidades) {
        expect(funcionalidade.acoes).toContain('consultar');
      }
    }
  });

  it('chave livre ou obsoleta não pertence ao catálogo', () => {
    expect(ehChaveDoCatalogo('empresas.cadastro.excluir')).toBe(false);
    expect(ehChaveDoCatalogo('financeiro.cobranca.consultar')).toBe(false);
    expect(ehChaveDoCatalogo(42)).toBe(false);
    expect(ehChaveDoCatalogo('usuarios.usuarios_e_papeis.administrar')).toBe(false);
  });

  it('reconhece a chave exclusiva', () => {
    expect(ehChaveExclusiva('usuarios.usuarios_e_papeis.administrar')).toBe(true);
    expect(ehChaveExclusiva('empresas.cadastro.criar')).toBe(false);
  });

  it('chavesDoModulo devolve só o módulo pedido', () => {
    expect(chavesDoModulo('notificacoes')).toEqual([
      'notificacoes.sino.consultar',
      'notificacoes.sino.marcar_lida',
    ]);
    expect(chavesDoModulo('inexistente')).toEqual([]);
  });
});

describe('dependência de Consultar (SPEC-008 §3.3)', () => {
  it('toda ação implica Consultar da própria funcionalidade', () => {
    expect(consultaImplicada('documentos.arquivos.baixar')).toBe('documentos.arquivos.consultar');
    expect(consultaImplicada('empresas.cadastro.reativar')).toBe('empresas.cadastro.consultar');
  });

  it('Consultar não implica nada', () => {
    expect(consultaImplicada('empresas.cadastro.consultar')).toBeNull();
  });

  it('Consultar de uma funcionalidade não arrasta outra do mesmo módulo', () => {
    expect(dependentesDeConsulta('documentos.arquivos.consultar')).toEqual([
      'documentos.arquivos.enviar',
      'documentos.arquivos.substituir',
      'documentos.arquivos.visualizar',
      'documentos.arquivos.baixar',
    ]);
  });

  it('ação que não é Consultar não tem dependentes', () => {
    expect(dependentesDeConsulta('documentos.arquivos.enviar')).toEqual([]);
  });
});
