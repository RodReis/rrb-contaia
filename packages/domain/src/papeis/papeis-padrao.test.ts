import { describe, expect, it } from 'vitest';

import { PAPEIS_PADRAO, type PapelPadrao } from '../usuarios/papeis.js';
import { CHAVES_DO_CATALOGO, CHAVES_EXCLUSIVAS } from './catalogo.js';
import {
  moldeDoPapelPadrao,
  permissoesDoPapelPadrao,
  permissoesDosPapeisPadrao,
  uniaoDePermissoes,
} from './papeis-padrao.js';

const ordenadas = (chaves: readonly string[]): string[] => [...chaves].sort();

const DOCUMENTOS_TODAS = [
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
];
const DOCUMENTOS_LEITURA = [
  'documentos.exigencias.consultar',
  'documentos.arquivos.consultar',
  'documentos.arquivos.visualizar',
  'documentos.arquivos.baixar',
  'documentos.analise.consultar',
  'documentos.historico.consultar',
];
const OPERACAO = [
  ...DOCUMENTOS_TODAS,
  'pendencias.pendencias.consultar',
  'pendencias.pendencias.abrir_origem',
  'notificacoes.sino.consultar',
  'notificacoes.sino.marcar_lida',
];

const CERTIFICADOS_TODAS = [
  'certificados.cofre.consultar',
  'certificados.cofre.criar',
  'certificados.cofre.substituir',
  'certificados.cofre.editar',
  'certificados.cofre.desativar',
  'certificados.historico.consultar',
];

// Matriz da SPEC-007 §3.1 lida em chaves, escrita à mão: o teste não lê a constante de produção.
const ESPERADO: Readonly<Record<PapelPadrao, readonly string[]>> = {
  admin_escritorio: [
    ...CHAVES_DO_CATALOGO,
    'usuarios.usuarios_e_papeis.consultar',
    'usuarios.usuarios_e_papeis.administrar',
  ],
  contador: [
    'empresas.cadastro.consultar',
    'empresas.cadastro.criar',
    'empresas.cadastro.editar',
    'empresas.cadastro.arquivar',
    'empresas.cadastro.reativar',
    'empresas.historico.consultar',
    ...OPERACAO,
    ...CERTIFICADOS_TODAS,
    'historico.global.consultar',
  ],
  // SPEC-011 §3.2: o auxiliar consulta o cofre e não muta; sem histórico de certificados.
  auxiliar: [
    'empresas.cadastro.consultar',
    'empresas.cadastro.criar',
    'empresas.cadastro.editar',
    ...OPERACAO,
    'certificados.cofre.consultar',
  ],
  auditor_readonly: [
    'escritorio.dados.consultar',
    'empresas.cadastro.consultar',
    'empresas.historico.consultar',
    ...DOCUMENTOS_LEITURA,
    'pendencias.pendencias.consultar',
    'notificacoes.sino.consultar',
    'certificados.cofre.consultar',
    'certificados.historico.consultar',
    'historico.global.consultar',
    'usuarios.usuarios_e_papeis.consultar',
  ],
};

describe('papéis padrão em chaves do catálogo', () => {
  for (const papel of PAPEIS_PADRAO) {
    it(`${papel} concede exatamente o previsto na SPEC-007`, () => {
      expect(ordenadas(permissoesDoPapelPadrao(papel))).toEqual(ordenadas(ESPERADO[papel]));
    });
  }

  it('só o administrador exerce a área exclusiva; o auditor apenas a consulta', () => {
    const exclusivas = new Set<string>(CHAVES_EXCLUSIVAS);
    const concedidas = (papel: PapelPadrao): string[] =>
      permissoesDoPapelPadrao(papel).filter((chave) => exclusivas.has(chave));

    expect(concedidas('admin_escritorio')).toHaveLength(2);
    expect(concedidas('auditor_readonly')).toEqual(['usuarios.usuarios_e_papeis.consultar']);
    expect(concedidas('contador')).toEqual([]);
    expect(concedidas('auxiliar')).toEqual([]);
  });

  it('toda ação concedida vem com Consultar da funcionalidade', () => {
    for (const papel of PAPEIS_PADRAO) {
      const concedidas = new Set<string>(permissoesDoPapelPadrao(papel));

      for (const chave of concedidas) {
        const [modulo, funcionalidade] = chave.split('.');

        expect(concedidas.has(`${modulo}.${funcionalidade}.consultar`)).toBe(true);
      }
    }
  });
});

describe('molde de papel personalizado (SPEC-008 §3.1)', () => {
  it('copia a matriz do padrão sem a área exclusiva, mesmo partindo do administrador', () => {
    const molde = moldeDoPapelPadrao('admin_escritorio');

    expect([...molde]).toEqual([...CHAVES_DO_CATALOGO]);
    expect(molde.some((chave) => chave.startsWith('usuarios.'))).toBe(false);
  });

  it('o molde do auditor deixa de fora a consulta de usuários', () => {
    expect(moldeDoPapelPadrao('auditor_readonly')).not.toContain(
      'usuarios.usuarios_e_papeis.consultar',
    );
  });

  it('o molde é uma cópia: alterá-lo não altera o padrão', () => {
    const molde = [...moldeDoPapelPadrao('contador')];

    molde.pop();

    expect(permissoesDoPapelPadrao('contador')).toContain('historico.global.consultar');
  });
});

describe('união aditiva (SPEC-008 §3.4)', () => {
  it('auxiliar + auditor edita empresa, mas não arquiva', () => {
    const uniao = permissoesDosPapeisPadrao(['auxiliar', 'auditor_readonly']);

    expect(uniao).toContain('empresas.cadastro.editar');
    expect(uniao).not.toContain('empresas.cadastro.arquivar');
  });

  it('retirar de um conjunto não nega o que outro ainda concede', () => {
    const personalizado = ['empresas.cadastro.consultar'] as const;
    const padrao = permissoesDoPapelPadrao('contador');

    expect(uniaoDePermissoes(personalizado, padrao)).toContain('empresas.cadastro.arquivar');
  });

  it('sem papéis nada é concedido', () => {
    expect(permissoesDosPapeisPadrao([])).toEqual([]);
    expect(uniaoDePermissoes()).toEqual([]);
  });
});
