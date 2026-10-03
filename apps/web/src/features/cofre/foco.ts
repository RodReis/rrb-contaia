/**
 * Foco e rolagem do formulário de envio. O foco vai para o primeiro campo
 * inválido na ordem visual (PATTERNS.md §6); a rolagem respeita a preferência
 * de movimento reduzido.
 */
import type { CampoDoEnvio } from './apresentacao';

const CONTROLE_DO_CAMPO = 'input:not([type="file"]), button, textarea';

export const focarCampo = (raiz: ParentNode, campo: CampoDoEnvio): void => {
  raiz.querySelector<HTMLElement>(`[data-campo="${campo}"] :is(${CONTROLE_DO_CAMPO})`)?.focus();
};

const prefereMovimentoReduzido = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** O jsdom não implementa `scrollIntoView`; no navegador ele sempre existe. */
export const rolarAte = (elemento: Element | null): void => {
  elemento?.scrollIntoView?.({
    behavior: prefereMovimentoReduzido() ? 'auto' : 'smooth',
    block: 'start',
  });
};
