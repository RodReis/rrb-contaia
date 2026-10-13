/**
 * Permissões do módulo `fiscal` do catálogo (SPEC-016 §3.7). A interface decide o que oferecer a
 * partir daqui, mas quem nega é sempre a API. As chaves são comparadas como texto: a sessão devolve
 * as permissões efetivas. O administrador da plataforma (`super_admin`) não tem sessão de escritório,
 * então a ausência de sessão não é recusa: a tela segue e a API decide.
 */
import type { Sessao } from '../usuarios/api';

export const CONSULTA_DO_MOTOR = 'fiscal.motor_tributario.consultar';
export const SIMULACAO_DO_MOTOR = 'fiscal.motor_tributario.simular';

export const concede = (sessao: Sessao, chave: string): boolean => {
  const concedidas: readonly string[] = sessao.permissoes;

  return concedidas.includes(chave);
};
