/**
 * Casos de uso da Central de Pendências (SPEC-005). O caso de uso controla a
 * transação; o repositório persiste; nenhuma regra de prioridade mora aqui —
 * isso já está na consulta SQL de `listarCentral` (packages/db).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import {
  comContextoHumano,
  contarAbertasPorEmpresa,
  dispensar,
  listarCentral,
  type PaginaDePendencias,
  type PendenciaPersistida,
} from '@contaia/db';
import { Injectable } from '@nestjs/common';

import { PoolDoBanco } from '../banco/pool.provider';
import type { FiltroDaCentralDto } from './pendencias.dto';

export type Autor = Readonly<{ usuarioId: string }>;

const hojeEmSaoPaulo = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Injeta `PoolDoBanco` (provider wrapper), não `Pool` cru — mesmo padrão de
// `DocumentosDaEmpresaService`. `comContextoHumano` recebe `this.pool.instancia`.
@Injectable()
export class PendenciasService {
  constructor(private readonly pool: PoolDoBanco) {}

  /** A Central cruza empresas, mas só as da carteira de quem consulta (SPEC-009 §3.5). */
  async consultarCentral(
    tenantId: string,
    usuarioId: string,
    filtro: FiltroDaCentralDto,
  ): Promise<PaginaDePendencias> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, (cliente) =>
      listarCentral(cliente, { ...filtro, carteiraDoUsuarioId: usuarioId }, hojeEmSaoPaulo()),
    );
  }

  async contarPorEmpresas(
    tenantId: string,
    usuarioId: string,
    empresaIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, (cliente) =>
      contarAbertasPorEmpresa(cliente, empresaIds),
    );
  }

  async dispensar(
    tenantId: string,
    empresaId: string,
    pendenciaId: string,
    autor: Autor,
    justificativa: string,
  ): Promise<PendenciaPersistida> {
    const resolvida = await comContextoHumano(
      this.pool.instancia,
      { tenantId, usuarioId: autor.usuarioId },
      (cliente) =>
      dispensar(cliente, tenantId, empresaId, pendenciaId, autor.usuarioId, justificativa),
    );

    if (resolvida === null) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.PENDENCIA_NAO_ENCONTRADA,
        'Pendência não encontrada ou já resolvida.',
      );
    }

    return resolvida;
  }
}
