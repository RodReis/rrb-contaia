/**
 * Papéis padrão do MVP-1 (SPEC-007 §3.1).
 *
 * O que cada papel concede está em `../papeis/papeis-padrao.ts`, em chaves do
 * catálogo (SPEC-008). Permissões são aditivas: a ação vale se qualquer papel do
 * usuário, padrão ou personalizado, a concede.
 */

export const PAPEIS_PADRAO = [
  'admin_escritorio',
  'contador',
  'auxiliar',
  'auditor_readonly',
] as const;

export type PapelPadrao = (typeof PAPEIS_PADRAO)[number];

/**
 * Escopo de empresas até a fatia de carteira (decisão do PI): o administrador
 * responde pelo escritório inteiro; os demais papéis não enxergam empresa
 * alguma enquanto não houver atribuição. Nunca existe liberação temporária de
 * toda a base para quem não é administrador — papel personalizado incluído.
 */
export const escopoDeEmpresas = (papeis: readonly PapelPadrao[]): 'TODAS' | 'NENHUMA' =>
  papeis.includes('admin_escritorio') ? 'TODAS' : 'NENHUMA';

export const ehPapelPadrao = (valor: unknown): valor is PapelPadrao =>
  typeof valor === 'string' && (PAPEIS_PADRAO as readonly string[]).includes(valor);
