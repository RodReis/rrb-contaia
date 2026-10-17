import { Injectable } from '@nestjs/common';
import { listarDashboardDaSaude, listarMotivosDaSaude, comContextoHumano, type FiltroDoDashboard } from '@contaia/db';
import { PoolDoBanco } from '../banco/pool.provider';

@Injectable()
export class DashboardService {
  constructor(private readonly pool: PoolDoBanco) {}
  consultar(tenantId: string, usuarioId: string, filtro: FiltroDoDashboard) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, (cliente) => listarDashboardDaSaude(cliente, tenantId, usuarioId, filtro));
  }
  motivos(tenantId: string, usuarioId: string, empresaId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, (cliente) => listarMotivosDaSaude(cliente, tenantId, usuarioId, empresaId));
  }
}
