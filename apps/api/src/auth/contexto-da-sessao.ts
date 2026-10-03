/** Tenant e autor saem sempre da sessão validada, nunca do corpo da requisição. */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import type { RequisicaoAutenticada } from './sessao.guard';

export const tenantDa = (requisicao: RequisicaoAutenticada): string => {
  const tenantId = requisicao.sessao?.tenantId;

  if (tenantId === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TENANT_DIVERGENTE, 'Sessão sem escritório associado.');
  }

  return tenantId;
};

export const autorDa = (requisicao: RequisicaoAutenticada): Readonly<{ usuarioId: string }> => {
  const usuarioId = requisicao.sessao?.usuarioId;

  if (usuarioId === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TENANT_DIVERGENTE, 'Sessão sem usuário associado.');
  }

  return { usuarioId };
};
