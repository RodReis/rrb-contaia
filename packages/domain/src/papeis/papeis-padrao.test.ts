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
const PLANO_CONTAS_TODAS = [
  'empresas.plano_contas.consultar',
  'empresas.plano_contas.importar',
  'empresas.plano_contas.confirmar_importacao',
  'empresas.plano_contas.baixar_relatorio',
];
// SPEC-013: auxiliar e auditor consultam e baixam o relatório, mas não importam nem confirmam.
const PLANO_CONTAS_LEITURA = [
  'empresas.plano_contas.consultar',
  'empresas.plano_contas.baixar_relatorio',
];
const ESTRUTURA_CONTABIL_TODAS = [
  'contabil.estrutura_contabil.consultar',
  'contabil.estrutura_contabil.manter_plano_contas',
  'contabil.estrutura_contabil.manter_centros_custo',
  'contabil.estrutura_contabil.arquivar',
  'contabil.estrutura_contabil.reativar',
];
const ESTRUTURA_CONTABIL_LEITURA = ['contabil.estrutura_contabil.consultar'];
const LANCAMENTOS_TODAS = ['contabil.lancamentos.consultar','contabil.lancamentos.preparar_rascunho','contabil.lancamentos.efetivar','contabil.lancamentos.cancelar_estornar'];
const LANCAMENTOS_PREPARO = ['contabil.lancamentos.consultar','contabil.lancamentos.preparar_rascunho'];
const LANCAMENTOS_LEITURA = ['contabil.lancamentos.consultar'];
const RAZAO_VERIFICACAO = ['contabil.razao.consultar','contabil.razao.verificar_integridade'];
const RAZAO_LEITURA = ['contabil.razao.consultar'];
const AUTOMATIZACAO_TODAS = ['contabil.automatizacao.consultar','contabil.automatizacao.simular','contabil.automatizacao.processar_origens','contabil.automatizacao.manter_regras','contabil.automatizacao.publicar'];
const AUTOMATIZACAO_OPERACAO = ['contabil.automatizacao.consultar','contabil.automatizacao.simular','contabil.automatizacao.processar_origens'];
const AUTOMATIZACAO_LEITURA = ['contabil.automatizacao.consultar'];
// SPEC-014 §3.12: só admin_escritorio importa e confirma (o `dp` entra no MVP-3). Contador e
// auditor consultam e baixam; o auxiliar e os demais papéis padrão não têm acesso nesta fatia.
const EMPREGADOS_TODAS = [
  'empresas.empregados.consultar',
  'empresas.empregados.importar',
  'empresas.empregados.confirmar_importacao',
  'empresas.empregados.baixar_relatorio',
];
const EMPREGADOS_LEITURA = ['empresas.empregados.consultar', 'empresas.empregados.baixar_relatorio'];
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
  'certificados.signer.consultar',
  'certificados.signer.testar',
];

// SPEC-016 §3.7: admin_escritorio, contador e auditor_readonly consultam as regras publicadas e
// simulam; o auxiliar e os demais papéis não recebem acesso por padrão.
const FISCAL = ['fiscal.motor_tributario.consultar', 'fiscal.motor_tributario.simular'];
const OBRIGACOES = [
  'obrigacoes.agenda.consultar',
  'obrigacoes.agenda.baixar',
  'obrigacoes.agenda.reabrir',
  'obrigacoes.agenda.reprocessar',
];

// Matriz da SPEC-007 §3.1 lida em chaves, escrita à mão: o teste não lê a constante de produção.
const ESPERADO: Readonly<Record<PapelPadrao, readonly string[]>> = {
  admin_escritorio: [
    ...CHAVES_DO_CATALOGO,
    'usuarios.auditoria_payload.revelar',
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
    ...PLANO_CONTAS_TODAS,
    ...ESTRUTURA_CONTABIL_TODAS,
    ...LANCAMENTOS_TODAS,
    ...RAZAO_VERIFICACAO,
    ...AUTOMATIZACAO_TODAS,
    ...EMPREGADOS_LEITURA,
    ...OPERACAO,
    ...CERTIFICADOS_TODAS,
    'procuracoes.registro.consultar',
    ...FISCAL,
    ...OBRIGACOES,
    'historico.global.consultar',
  ],
  // SPEC-011 §3.2: o auxiliar consulta o cofre e não muta; sem histórico de certificados.
  auxiliar: [
    'empresas.cadastro.consultar',
    'empresas.cadastro.criar',
    'empresas.cadastro.editar',
    ...PLANO_CONTAS_LEITURA,
    ...ESTRUTURA_CONTABIL_LEITURA,
    ...LANCAMENTOS_PREPARO,
    ...RAZAO_LEITURA,
    ...AUTOMATIZACAO_OPERACAO,
    ...OPERACAO,
    ...OBRIGACOES,
    'certificados.cofre.consultar',
    'procuracoes.registro.consultar',
  ],
  auditor_readonly: [
    'escritorio.dados.consultar',
    'empresas.cadastro.consultar',
    'empresas.historico.consultar',
    ...PLANO_CONTAS_LEITURA,
    ...ESTRUTURA_CONTABIL_LEITURA,
    ...LANCAMENTOS_LEITURA,
    ...RAZAO_LEITURA,
    ...AUTOMATIZACAO_LEITURA,
    ...EMPREGADOS_LEITURA,
    ...DOCUMENTOS_LEITURA,
    'pendencias.pendencias.consultar',
    'notificacoes.sino.consultar',
    'certificados.cofre.consultar',
    'certificados.historico.consultar',
    // SPEC-012: o auditor lê o painel do Signer e não testa.
    'certificados.signer.consultar',
    'procuracoes.registro.consultar',
    ...FISCAL,
    'obrigacoes.agenda.consultar',
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

  it('só o administrador exerce permissões exclusivas; o auditor mantém apenas consulta de usuários', () => {
    const exclusivas = new Set<string>(CHAVES_EXCLUSIVAS);
    const concedidas = (papel: PapelPadrao): string[] =>
      permissoesDoPapelPadrao(papel).filter((chave) => exclusivas.has(chave));

    expect(concedidas('admin_escritorio')).toHaveLength(3);
    expect(concedidas('auditor_readonly')).toEqual(['usuarios.usuarios_e_papeis.consultar']);
    expect(concedidas('contador')).toEqual([]);
    expect(concedidas('auxiliar')).toEqual([]);
  });

  it('motor tributário (SPEC-016 §3.7): admin, contador e auditor consultam e simulam; auxiliar nada', () => {
    const concedidas = (papel: PapelPadrao): string[] =>
      permissoesDoPapelPadrao(papel).filter((chave) => chave.startsWith('fiscal.'));

    expect(ordenadas(concedidas('admin_escritorio'))).toEqual(ordenadas(FISCAL));
    expect(ordenadas(concedidas('contador'))).toEqual(ordenadas(FISCAL));
    expect(ordenadas(concedidas('auditor_readonly'))).toEqual(ordenadas(FISCAL));
    expect(concedidas('auxiliar')).toEqual([]);
  });

  it('empregados (SPEC-014 §3.12): admin tudo; contador e auditor só consultam e baixam; auxiliar nada', () => {
    const concedidas = (papel: PapelPadrao): string[] =>
      permissoesDoPapelPadrao(papel).filter((chave) => chave.startsWith('empresas.empregados.'));

    expect(ordenadas(concedidas('admin_escritorio'))).toEqual(ordenadas(EMPREGADOS_TODAS));
    expect(ordenadas(concedidas('contador'))).toEqual(ordenadas(EMPREGADOS_LEITURA));
    expect(ordenadas(concedidas('auditor_readonly'))).toEqual(ordenadas(EMPREGADOS_LEITURA));
    expect(concedidas('auxiliar')).toEqual([]);
  });

  it('o contador continua importando e confirmando o plano de contas (F13 não muda)', () => {
    const chaves = permissoesDoPapelPadrao('contador');

    for (const chave of PLANO_CONTAS_TODAS) {
      expect(chaves).toContain(chave);
    }
  });

  it('o molde de papel personalizado herda o recorte de empregados do papel padrão', () => {
    expect(moldeDoPapelPadrao('contador')).not.toContain('empresas.empregados.importar');
    expect(moldeDoPapelPadrao('contador')).toContain('empresas.empregados.consultar');
    expect(moldeDoPapelPadrao('auxiliar').some((c) => c.startsWith('empresas.empregados.'))).toBe(false);
  });

  it('toda ação concedida vem com Consultar da funcionalidade', () => {
    for (const papel of PAPEIS_PADRAO) {
      const concedidas = new Set<string>(permissoesDoPapelPadrao(papel));

      for (const chave of concedidas) {
        const [modulo, funcionalidade] = chave.split('.');

        if (chave !== 'usuarios.auditoria_payload.revelar') {
          expect(concedidas.has(`${modulo}.${funcionalidade}.consultar`)).toBe(true);
        }
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
