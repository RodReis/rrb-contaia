/**
 * Escopo de empresas da sessão (SPEC-007 §3.1; decisão do PI).
 *
 * Até a fatia de carteira, o administrador responde pelo escritório inteiro e
 * os demais papéis não enxergam empresa alguma — nunca há liberação temporária
 * de toda a base. Dado de empresa sem alçada responde como inexistente (404)
 * ou vazio, para não revelar o que o usuário não pode ver.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { CODIGOS_DE_ERRO, ErroDeDominio, escopoDeEmpresas } from '@contaia/domain';

import type { RequisicaoAutenticada } from './sessao.guard';

export const escopoDaSessao = (requisicao: RequisicaoAutenticada): 'TODAS' | 'NENHUMA' =>
  escopoDeEmpresas(requisicao.sessao?.papeis ?? []);

/** Operação que cria ou consulta empresa sem ter ainda um `empresaId` para esconder. */
export const exigirAlcada = (requisicao: RequisicaoAutenticada): void => {
  if (escopoDaSessao(requisicao) === 'NENHUMA') {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.SEM_ALCADA,
      'Você ainda não tem empresas atribuídas à sua carteira.',
    );
  }
};

/** Rota por `:empresaId`: sem alçada, a empresa não existe para quem pergunta. */
@Injectable()
export class GuardDeEscopoDeEmpresa implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();

    if (requisicao.params['empresaId'] === undefined) {
      return true;
    }

    if (escopoDaSessao(requisicao) === 'NENHUMA') {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
    }

    return true;
  }
}
