/**
 * Casos de uso de Notificações (SPEC-006). Mesmo padrão de `PendenciasService`.
 *
 * O sino é do usuário (SPEC-009): notificação de pendência só das empresas da
 * carteira dele e notificação consolidada de carteira só para o destinatário.
 * `marcarComoLida`/`marcarVariasComoLidas` não recebem `empresaId` — a rota HTTP
 * não é aninhada em empresa — e o repositório aplica o mesmo escopo do sino.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import {
  comContextoHumano,
  contarNaoLidas,
  listarHistoricoDeNotificacoes,
  listarPainel,
  marcarComoLida,
  marcarVariasComoLidas,
  type NotificacaoPersistida,
  type PaginaDeNotificacoes,
} from '@contaia/db';
import { Injectable } from '@nestjs/common';

import { PoolDoBanco } from '../banco/pool.provider';

export type Autor = Readonly<{ usuarioId: string }>;

export type PainelDeNotificacoes = Readonly<{
  notificacoes: readonly NotificacaoPersistida[];
  naoLidas: number;
}>;

@Injectable()
export class NotificacoesService {
  constructor(private readonly pool: PoolDoBanco) {}

  async consultarPainel(tenantId: string, usuarioId: string): Promise<PainelDeNotificacoes> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) => {
      const [notificacoes, naoLidas] = await Promise.all([
        listarPainel(cliente, tenantId, usuarioId),
        contarNaoLidas(cliente, tenantId, usuarioId),
      ]);

      return { notificacoes, naoLidas };
    });
  }

  async consultarHistorico(
    tenantId: string,
    usuarioId: string,
    limite: number,
    deslocamento: number,
  ): Promise<PaginaDeNotificacoes> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, (cliente) =>
      listarHistoricoDeNotificacoes(cliente, tenantId, usuarioId, limite, deslocamento),
    );
  }

  async marcarComoLida(
    tenantId: string,
    notificacaoId: string,
    autor: Autor,
  ): Promise<NotificacaoPersistida> {
    const marcada = await comContextoHumano(
      this.pool.instancia,
      { tenantId, usuarioId: autor.usuarioId },
      (cliente) =>
      marcarComoLida(cliente, tenantId, notificacaoId, autor.usuarioId),
    );

    if (marcada === null) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.NOTIFICACAO_NAO_ENCONTRADA,
        'Notificação não encontrada.',
      );
    }

    return marcada;
  }

  async marcarVariasComoLidas(
    tenantId: string,
    ids: readonly string[],
    autor: Autor,
  ): Promise<Readonly<{ marcadas: number }>> {
    const marcadas = await comContextoHumano(
      this.pool.instancia,
      { tenantId, usuarioId: autor.usuarioId },
      (cliente) =>
      marcarVariasComoLidas(cliente, tenantId, ids, autor.usuarioId),
    );

    return { marcadas };
  }
}
