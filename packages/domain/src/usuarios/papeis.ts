/**
 * Papéis padrão do MVP-1 e matriz de permissões (SPEC-007 §3.1).
 *
 * Função pura: a autorização do servidor e a interface leem a mesma matriz.
 * Permissões são aditivas: a ação vale se qualquer papel do usuário a concede.
 */

export const PAPEIS_PADRAO = [
  'admin_escritorio',
  'contador',
  'auxiliar',
  'auditor_readonly',
] as const;

export type PapelPadrao = (typeof PAPEIS_PADRAO)[number];

export type Capacidade =
  | 'CADASTRO_ESCRITORIO'
  | 'EMPRESAS'
  | 'DOCUMENTOS'
  | 'PENDENCIAS'
  | 'NOTIFICACOES'
  | 'HISTORICO'
  | 'USUARIOS';

/** `administrar` executa qualquer ação mutável já prevista para a capacidade. */
export type Acao = 'consultar' | 'criar' | 'editar' | 'arquivar' | 'administrar';

type AcoesPorPapel = Readonly<Partial<Record<PapelPadrao, readonly Acao[]>>>;

export const MATRIZ: Readonly<Record<Capacidade, AcoesPorPapel>> = {
  CADASTRO_ESCRITORIO: {
    admin_escritorio: ['consultar', 'editar'],
    auditor_readonly: ['consultar'],
  },
  EMPRESAS: {
    admin_escritorio: ['consultar', 'criar', 'editar', 'arquivar'],
    contador: ['consultar', 'criar', 'editar', 'arquivar'],
    auxiliar: ['consultar', 'criar', 'editar'],
    auditor_readonly: ['consultar'],
  },
  DOCUMENTOS: {
    admin_escritorio: ['administrar'],
    contador: ['administrar'],
    auxiliar: ['administrar'],
    auditor_readonly: ['consultar'],
  },
  PENDENCIAS: {
    admin_escritorio: ['administrar'],
    contador: ['administrar'],
    auxiliar: ['administrar'],
    auditor_readonly: ['consultar'],
  },
  NOTIFICACOES: {
    admin_escritorio: ['administrar'],
    contador: ['administrar'],
    auxiliar: ['administrar'],
    auditor_readonly: ['consultar'],
  },
  HISTORICO: {
    admin_escritorio: ['consultar'],
    contador: ['consultar'],
    auditor_readonly: ['consultar'],
  },
  USUARIOS: {
    admin_escritorio: ['administrar'],
    auditor_readonly: ['consultar'],
  },
};

const concede = (concedidas: readonly Acao[] | undefined, acao: Acao): boolean =>
  concedidas !== undefined && (concedidas.includes('administrar') || concedidas.includes(acao));

export const podeExecutar = (
  papeis: readonly PapelPadrao[],
  capacidade: Capacidade,
  acao: Acao,
): boolean => papeis.some((papel) => concede(MATRIZ[capacidade][papel], acao));

/**
 * Escopo de empresas até a fatia de carteira (decisão do PI): o administrador
 * responde pelo escritório inteiro; os demais papéis não enxergam empresa
 * alguma enquanto não houver atribuição. Nunca existe liberação temporária de
 * toda a base para quem não é administrador.
 */
export const escopoDeEmpresas = (papeis: readonly PapelPadrao[]): 'TODAS' | 'NENHUMA' =>
  papeis.includes('admin_escritorio') ? 'TODAS' : 'NENHUMA';

export const ehPapelPadrao = (valor: unknown): valor is PapelPadrao =>
  typeof valor === 'string' && (PAPEIS_PADRAO as readonly string[]).includes(valor);
