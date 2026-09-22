/**
 * Casos de uso de Notificações (SPEC-006). Mesmo padrão de `PendenciasService`.
 *
 * `marcarComoLida`/`marcarVariasComoLidas` não recebem `empresaId`: a rota
 * HTTP de notificações não é aninhada em empresa (diferente de pendências) e
 * o repositório já isola por `id`/`tenant_id` com a RLS forçada.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import {
  comContextoDeTenant,
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

  async consultarPainel(tenantId: string): Promise<PainelDeNotificacoes> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const [notificacoes, naoLidas] = await Promise.all([
        listarPainel(cliente, tenantId),
        contarNaoLidas(cliente, tenantId),
      ]);

      return { notificacoes, naoLidas };
    });
  }

  async consultarHistorico(
    tenantId: string,
    limite: number,
    deslocamento: number,
  ): Promise<PaginaDeNotificacoes> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarHistoricoDeNotificacoes(cliente, tenantId, limite, deslocamento),
    );
  }

  async marcarComoLida(
    tenantId: string,
    notificacaoId: string,
    autor: Autor,
  ): Promise<NotificacaoPersistida> {
    const marcada = await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
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
    const marcadas = await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      marcarVariasComoLidas(cliente, tenantId, ids, autor.usuarioId),
    );

    return { marcadas };
  }
}
