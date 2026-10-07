/**
 * Permissões do módulo `certificados` do catálogo (SPEC-011 §3.2). A interface
 * decide o que oferecer a partir daqui, mas quem nega é sempre a API.
 *
 * As chaves são comparadas como texto: a sessão devolve as permissões efetivas e
 * esta tela não depende de o tipo `ChaveDePermissao` já listá-las.
 */
import type { Sessao } from '../usuarios/api';

export const CONSULTA_DO_COFRE = 'certificados.cofre.consultar';
export const CADASTRO_NO_COFRE = 'certificados.cofre.criar';
export const SUBSTITUICAO_NO_COFRE = 'certificados.cofre.substituir';
export const CONSULTA_DO_HISTORICO_DE_CERTIFICADOS = 'certificados.historico.consultar';
// Signer isolado (SPEC-012 §3.9): consultar estado e histórico, e disparar o teste manual.
export const CONSULTA_DO_SIGNER = 'certificados.signer.consultar';
export const TESTE_DO_SIGNER = 'certificados.signer.testar';

export const concede = (sessao: Sessao, chave: string): boolean => {
  const concedidas: readonly string[] = sessao.permissoes;

  return concedidas.includes(chave);
};
