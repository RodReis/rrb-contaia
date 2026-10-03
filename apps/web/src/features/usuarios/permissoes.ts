/**
 * Leitura da permissão efetiva da sessão (SPEC-008 §3.4). A interface decide o
 * que oferecer a partir daqui, mas quem nega é sempre a API: esconder um botão
 * nunca é controle de acesso.
 */
import type { ChaveDePermissao } from '@contaia/domain';

import type { Sessao } from './api';

/** Verdadeiro só quando a sessão concede todas as chaves pedidas. */
export const pode = (sessao: Sessao, ...chaves: readonly ChaveDePermissao[]): boolean =>
  chaves.every((chave) => sessao.permissoes.includes(chave));

export const CONSULTA_DE_USUARIOS = 'usuarios.usuarios_e_papeis.consultar' as const;
export const ADMINISTRACAO_DE_USUARIOS = 'usuarios.usuarios_e_papeis.administrar' as const;
