/**
 * Casos de uso da Central de Pendências (SPEC-005). O caso de uso controla a
 * transação; o repositório persiste; nenhuma regra de prioridade mora aqui —
 * isso já está na consulta SQL de `listarCentral` (packages/db).
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import {
  comContextoDeTenant,
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
// `DocumentosDaEmpresaService`. `comContextoDeTenant` recebe `this.pool.instancia`.
@Injectable()
export class PendenciasService {
  constructor(private readonly pool: PoolDoBanco) {}

  async consultarCentral(tenantId: string, filtro: FiltroDaCentralDto): Promise<PaginaDePendencias> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarCentral(cliente, filtro, hojeEmSaoPaulo()),
    );
  }

  async contarPorEmpresas(
    tenantId: string,
    empresaIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
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
    const resolvida = await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
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
