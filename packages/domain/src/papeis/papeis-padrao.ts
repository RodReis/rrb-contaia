/**
 * Papéis padrão expressos em chaves do catálogo (SPEC-007 §3.1 + SPEC-008).
 *
 * A matriz da F7 (capacidade × ação) passa a ser lida como conjunto de chaves:
 * o comportamento dos quatro papéis não muda, só ganha a granularidade do
 * catálogo. Um papel personalizado nasce como cópia destas matrizes, sem a área
 * exclusiva, e nunca mais se liga a elas.
 */
import {
  CHAVES_DO_CATALOGO,
  CHAVES_EXCLUSIVAS,
  chavesDoModulo,
  type ChaveDePermissao,
  type ChaveDoCatalogo,
} from './catalogo.js';
import type { PapelPadrao } from '../usuarios/papeis.js';

const consultas = (moduloId: string): readonly ChaveDePermissao[] =>
  chavesDoModulo(moduloId).filter(
    (chave) => chave.endsWith('.consultar') || /\.(visualizar|baixar)$/.test(chave),
  );

const CADASTRO_DE_EMPRESAS_SEM_ARQUIVAR: readonly ChaveDePermissao[] = [
  'empresas.cadastro.consultar',
  'empresas.cadastro.criar',
  'empresas.cadastro.editar',
];

// SPEC-013: consulta e relatório, sem importar nem confirmar. O helper `consultas()` não
// reconhece `baixar_relatorio`, então a leitura do plano de contas é declarada à mão.
const PLANO_DE_CONTAS_LEITURA: readonly ChaveDePermissao[] = [
  'empresas.plano_contas.consultar',
  'empresas.plano_contas.baixar_relatorio',
];
const ESTRUTURA_CONTABIL_LEITURA: readonly ChaveDePermissao[] = ['contabil.estrutura_contabil.consultar'];
const ESTRUTURA_CONTABIL_TODAS: readonly ChaveDePermissao[] = [
  ...ESTRUTURA_CONTABIL_LEITURA,
  'contabil.estrutura_contabil.manter_plano_contas',
  'contabil.estrutura_contabil.manter_centros_custo',
  'contabil.estrutura_contabil.arquivar',
  'contabil.estrutura_contabil.reativar',
];
const LANCAMENTOS_LEITURA: readonly ChaveDePermissao[] = ['contabil.lancamentos.consultar'];
const LANCAMENTOS_PREPARO: readonly ChaveDePermissao[] = [...LANCAMENTOS_LEITURA, 'contabil.lancamentos.preparar_rascunho'];
const LANCAMENTOS_TODAS: readonly ChaveDePermissao[] = [...LANCAMENTOS_PREPARO, 'contabil.lancamentos.efetivar', 'contabil.lancamentos.cancelar_estornar'];
const RAZAO_LEITURA: readonly ChaveDePermissao[] = ['contabil.razao.consultar'];
const RAZAO_VERIFICACAO: readonly ChaveDePermissao[] = [...RAZAO_LEITURA, 'contabil.razao.verificar_integridade'];
const FECHAMENTO_LEITURA: readonly ChaveDePermissao[] = ['contabil.fechamento.consultar'];
const FECHAMENTO_OPERACAO: readonly ChaveDePermissao[] = [...FECHAMENTO_LEITURA, 'contabil.fechamento.fechar_competencia'];
const ABERTURA_LEITURA: readonly ChaveDePermissao[] = ['contabil.saldos_abertura.consultar'];
const ABERTURA_PREPARO: readonly ChaveDePermissao[] = [...ABERTURA_LEITURA, 'contabil.saldos_abertura.preparar'];
const ABERTURA_TODAS: readonly ChaveDePermissao[] = [...ABERTURA_PREPARO, 'contabil.saldos_abertura.aprovar'];
const AUTOMATIZACAO_LEITURA: readonly ChaveDePermissao[] = ['contabil.automatizacao.consultar'];
const AUTOMATIZACAO_OPERACAO: readonly ChaveDePermissao[] = [...AUTOMATIZACAO_LEITURA, 'contabil.automatizacao.simular', 'contabil.automatizacao.processar_origens'];
const AUTOMATIZACAO_TODAS: readonly ChaveDePermissao[] = [...AUTOMATIZACAO_OPERACAO, 'contabil.automatizacao.manter_regras', 'contabil.automatizacao.publicar'];

// SPEC-014 §3.12: contador e auditor consultam e baixam; só o admin importa e confirma (o papel
// `dp` entra no MVP-3). O auxiliar e os demais papéis padrão não têm acesso nesta fatia.
const EMPREGADOS_LEITURA: readonly ChaveDePermissao[] = [
  'empresas.empregados.consultar',
  'empresas.empregados.baixar_relatorio',
];

const OBRIGACOES_OPERACAO: readonly ChaveDePermissao[] = [
  'obrigacoes.agenda.consultar', 'obrigacoes.agenda.baixar', 'obrigacoes.agenda.reabrir',
  'obrigacoes.agenda.reprocessar',
];

const OPERACAO: readonly ChaveDePermissao[] = [
  ...chavesDoModulo('documentos'),
  ...chavesDoModulo('pendencias'),
  ...chavesDoModulo('notificacoes'),
];

const PERMISSOES_DO_PAPEL: Readonly<Record<PapelPadrao, readonly ChaveDePermissao[]>> = {
  admin_escritorio: [...CHAVES_DO_CATALOGO, ...CHAVES_EXCLUSIVAS],
  // O módulo `empresas` inteiro, exceto `empregados`, que o contador só lê (SPEC-014 §3.12).
  contador: [
    ...chavesDoModulo('empresas').filter((chave) => !chave.startsWith('empresas.empregados.')),
    ...ESTRUTURA_CONTABIL_TODAS,
    ...LANCAMENTOS_TODAS,
    ...RAZAO_VERIFICACAO,
    ...FECHAMENTO_OPERACAO,
    ...ABERTURA_TODAS,
    ...AUTOMATIZACAO_TODAS,
    ...EMPREGADOS_LEITURA,
    ...OPERACAO,
    ...chavesDoModulo('certificados'),
    'procuracoes.registro.consultar',
    // SPEC-016 §3.7: contador consulta as regras publicadas e simula.
    ...chavesDoModulo('fiscal'),
    ...OBRIGACOES_OPERACAO,
    'historico.global.consultar',
  ],
  // Consulta o cofre mas não muta (SPEC-011 §3.2); sem histórico de certificados.
  auxiliar: [
    ...CADASTRO_DE_EMPRESAS_SEM_ARQUIVAR,
    ...PLANO_DE_CONTAS_LEITURA,
    ...ESTRUTURA_CONTABIL_LEITURA,
    ...LANCAMENTOS_PREPARO,
    ...RAZAO_LEITURA,
    ...FECHAMENTO_LEITURA,
    ...ABERTURA_PREPARO,
    ...AUTOMATIZACAO_OPERACAO,
    ...OPERACAO,
    ...OBRIGACOES_OPERACAO,
    'certificados.cofre.consultar',
    'procuracoes.registro.consultar',
  ],
  auditor_readonly: [
    ...ESTRUTURA_CONTABIL_LEITURA,
    ...LANCAMENTOS_LEITURA,
    ...RAZAO_LEITURA,
    ...FECHAMENTO_LEITURA,
    ...ABERTURA_LEITURA,
    ...AUTOMATIZACAO_LEITURA,
    'escritorio.dados.consultar',
    'empresas.cadastro.consultar',
    'empresas.historico.consultar',
    ...PLANO_DE_CONTAS_LEITURA,
    ...EMPREGADOS_LEITURA,
    ...consultas('documentos'),
    ...consultas('pendencias'),
    ...consultas('notificacoes'),
    'obrigacoes.agenda.consultar',
    ...consultas('certificados'),
    ...consultas('procuracoes'),
    // SPEC-016 §3.7: o auditor consulta e simula (simular não grava nada).
    ...chavesDoModulo('fiscal'),
    'historico.global.consultar',
    'usuarios.usuarios_e_papeis.consultar',
  ],
};

export const permissoesDoPapelPadrao = (papel: PapelPadrao): readonly ChaveDePermissao[] =>
  PERMISSOES_DO_PAPEL[papel];

/** União aditiva dos papéis padrão (SPEC-007 §3.1). */
export const permissoesDosPapeisPadrao = (
  papeis: readonly PapelPadrao[],
): readonly ChaveDePermissao[] => [...new Set(papeis.flatMap(permissoesDoPapelPadrao))];

/** Matriz inicial de um papel personalizado: a do padrão, sem a área exclusiva (§3.1, §3.3). */
export const moldeDoPapelPadrao = (papel: PapelPadrao): readonly ChaveDoCatalogo[] =>
  CHAVES_DO_CATALOGO.filter((chave) => PERMISSOES_DO_PAPEL[papel].includes(chave));

/** Permissão efetiva = união aditiva das matrizes de todos os papéis do usuário (§3.4). */
export const uniaoDePermissoes = (
  ...conjuntos: ReadonlyArray<readonly ChaveDePermissao[]>
): readonly ChaveDePermissao[] => [...new Set(conjuntos.flat())];
