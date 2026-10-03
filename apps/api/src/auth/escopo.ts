/**
 * Alçada por empresa (SPEC-009 §3.5).
 *
 * Toda rota com `:empresaId` valida, no servidor e a cada requisição, o tenant da
 * sessão, o usuário ativo e o vínculo de carteira — nessa ordem, depois do
 * `GuardDeAcao`, que já conferiu a permissão do papel. A carteira define EM QUAIS
 * empresas o usuário atua; o papel, O QUE ele faz; uma não substitui a outra.
 * Vale também para o `admin_escritorio`: na operação de uma empresa ele está
 * limitado à própria carteira, e a Central de Carteiras é a área administrativa.
 *
 * Empresa do mesmo tenant fora da carteira responde 403 com nome e CNPJ; empresa
 * de outro tenant ou inexistente responde 404, sem revelar que existe. A única
 * exceção é o administrador diante de empresa ARQUIVADA, que ele alcança sem vínculo
 * para poder reativá-la (o arquivamento encerra os vínculos de todos).
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { CarteiraService } from '../carteira/carteira.service';
import { autorDa, tenantDa } from './contexto-da-sessao';
import type { RequisicaoAutenticada } from './sessao.guard';

@Injectable()
export class GuardDeEscopoDeEmpresa implements CanActivate {
  constructor(private readonly carteira: CarteiraService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const empresaId = requisicao.params['empresaId'];

    if (empresaId === undefined) {
      return true;
    }

    await this.carteira.exigirAcessoAEmpresa(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      String(empresaId),
      (requisicao.sessao?.papeis ?? []).includes('admin_escritorio'),
    );

    return true;
  }
}
