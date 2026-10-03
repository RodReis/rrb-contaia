import { describe, expect, it } from 'vitest';

import { catalogoDeTeste } from './papeis.fixtures';
import {
  ESTADO_DO_PAPEL,
  contarPermissoesDoModulo,
  formatarInstante,
  resumirMatriz,
  rotuloDaChave,
  textoDeUsuarios,
} from './rotulos';

const CATALOGO = catalogoDeTeste();

describe('rotuloDaChave', () => {
  it('monta módulo › funcionalidade › ação pelo catálogo do servidor', () => {
    expect(rotuloDaChave(CATALOGO, 'documentos.arquivos.baixar')).toBe(
      'Documentos da empresa › Arquivos e versões › Baixar',
    );
    expect(rotuloDaChave(CATALOGO, 'notificacoes.sino.marcar_lida')).toBe(
      'Notificações de pendências › Sino e histórico › Marcar como lida',
    );
  });

  it('reconhece também a área exclusiva', () => {
    expect(rotuloDaChave(CATALOGO, 'usuarios.usuarios_e_papeis.administrar')).toBe(
      'Usuários e permissões › Usuários e papéis › Administrar',
    );
  });

  it('chave que não existe mais volta como veio, para a linha nunca sumir', () => {
    expect(rotuloDaChave(CATALOGO, 'empresas.cadastro.excluir')).toBe('empresas.cadastro.excluir');
  });
});

describe('resumirMatriz', () => {
  it('lista só o que a matriz concede, por módulo e funcionalidade, na ordem do catálogo', () => {
    expect(
      resumirMatriz(CATALOGO, [
        'historico.global.consultar',
        'empresas.cadastro.consultar',
        'empresas.cadastro.criar',
        'documentos.arquivos.consultar',
        'documentos.arquivos.baixar',
      ]),
    ).toEqual([
      {
        id: 'empresas',
        rotulo: 'Empresas',
        funcionalidades: [{ rotulo: 'Cadastro e ciclo de vida', acoes: ['Consultar', 'Criar'] }],
      },
      {
        id: 'documentos',
        rotulo: 'Documentos da empresa',
        funcionalidades: [{ rotulo: 'Arquivos e versões', acoes: ['Consultar', 'Baixar'] }],
      },
      {
        id: 'historico',
        rotulo: 'Histórico de Informações',
        funcionalidades: [{ rotulo: 'Histórico global', acoes: ['Consultar'] }],
      },
    ]);
  });

  it('matriz vazia não tem módulo algum', () => {
    expect(resumirMatriz(CATALOGO, [])).toEqual([]);
  });

  it('inclui a área exclusiva quando o papel padrão a exerce', () => {
    const modulos = resumirMatriz(CATALOGO, ['usuarios.usuarios_e_papeis.consultar']);

    expect(modulos.map((modulo) => modulo.rotulo)).toEqual(['Usuários e permissões']);
  });
});

describe('contarPermissoesDoModulo', () => {
  it('conta marcadas e total do módulo', () => {
    const documentos = CATALOGO.modulos.find((modulo) => modulo.id === 'documentos');

    expect(documentos).toBeDefined();
    expect(
      contarPermissoesDoModulo(documentos!, [
        'documentos.arquivos.consultar',
        'documentos.analise.consultar',
        'historico.global.consultar',
      ]),
    ).toEqual({ marcadas: 2, total: 12 });
  });
});

describe('textos', () => {
  it('formata data e hora em America/Sao_Paulo (I-11)', () => {
    // 2026-10-02T02:30Z = 01/10/2026 23:30 em São Paulo.
    expect(formatarInstante('2026-10-02T02:30:00.000Z')).toMatch(/01\/10\/2026.*23:30/u);
  });

  it('concorda a contagem de usuários', () => {
    expect(textoDeUsuarios(1)).toBe('1 usuário');
    expect(textoDeUsuarios(2)).toBe('2 usuários');
    expect(textoDeUsuarios(1200)).toBe('1.200 usuários');
  });

  it('cada estado do papel tem rótulo textual: a cor nunca é o único sinal', () => {
    expect(ESTADO_DO_PAPEL.ATIVO.rotulo).toBe('Ativo');
    expect(ESTADO_DO_PAPEL.ARQUIVADO.rotulo).toBe('Arquivado');
  });
});
