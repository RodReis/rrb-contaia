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

const OPERACAO: readonly ChaveDePermissao[] = [
  ...chavesDoModulo('documentos'),
  ...chavesDoModulo('pendencias'),
  ...chavesDoModulo('notificacoes'),
];

const PERMISSOES_DO_PAPEL: Readonly<Record<PapelPadrao, readonly ChaveDePermissao[]>> = {
  admin_escritorio: [...CHAVES_DO_CATALOGO, ...CHAVES_EXCLUSIVAS],
  contador: [
    ...chavesDoModulo('empresas'),
    ...OPERACAO,
    ...chavesDoModulo('certificados'),
    'historico.global.consultar',
  ],
  // Consulta o cofre mas não muta (SPEC-011 §3.2); sem histórico de certificados.
  auxiliar: [
    ...CADASTRO_DE_EMPRESAS_SEM_ARQUIVAR,
    ...PLANO_DE_CONTAS_LEITURA,
    ...OPERACAO,
    'certificados.cofre.consultar',
  ],
  auditor_readonly: [
    'escritorio.dados.consultar',
    'empresas.cadastro.consultar',
    'empresas.historico.consultar',
    ...PLANO_DE_CONTAS_LEITURA,
    ...consultas('documentos'),
    ...consultas('pendencias'),
    ...consultas('notificacoes'),
    ...consultas('certificados'),
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
