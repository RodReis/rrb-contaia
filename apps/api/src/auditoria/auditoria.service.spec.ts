import { ForbiddenException } from '@nestjs/common';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { AuditoriaService, construirFiltroSqlDeAuditoria } from './auditoria.service';

describe('AuditoriaService', () => {
  it('nega consulta e exportacao a papeis fora da alçada transversal', async () => {
    const service = new AuditoriaService({ instancia: {} as Pool } as never, {} as never, null);
    await expect(service.listar('tenant','usuario','corr',[],{pagina:1,limite:25})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.exportar('tenant','usuario','corr',['contador'],'JSON',{pagina:1,limite:25})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.revelar('tenant','usuario','corr',['auditor_readonly'],'123e4567-e89b-42d3-a456-426614174000','Auditoria de incidente aprovado')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('separa tenant, filtros e paginação em parâmetros SQL sem colisão', () => {
    const filtro = construirFiltroSqlDeAuditoria({ pagina: 2, limite: 10, inicio: '2026-10-01', empresaId: '123e4567-e89b-42d3-a456-426614174000' });
    expect(filtro.sql).toContain('e.tenant_id=$1');
    expect(filtro.sql).toContain('e.occurred_at >= $2::date');
    expect(filtro.sql).toContain('e.empresa_id = $3::uuid');
    expect(filtro.valores).toEqual(['2026-10-01','123e4567-e89b-42d3-a456-426614174000']);
  });
});
