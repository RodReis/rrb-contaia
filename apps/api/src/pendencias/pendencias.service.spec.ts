/**
 * Casos de uso da Central de Pendências (SPEC-005 §7, categoria Regras).
 *
 * O repositório entra por dublê: o que se prova aqui é a decisão do caso de
 * uso — dispensa lança erro de domínio quando o repositório não confirma, e
 * consultas delegam ao repositório dentro do contexto de tenant. A
 * persistência real e a priorização SQL têm provas próprias em `packages/db`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  return {
    ...real,
    comContextoHumano: vi.fn(async (_pool, _entrada, executar) => executar({} as never)),
    listarCentral: vi.fn(),
    dispensar: vi.fn(),
    contarAbertasPorEmpresa: vi.fn(),
  };
});

import { comContextoHumano, contarAbertasPorEmpresa, dispensar, listarCentral } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { PendenciasService } from './pendencias.service';

describe('PendenciasService', () => {
  // `PendenciasService` recebe `PoolDoBanco` (o provider wrapper), não `Pool`
  // cru — mesmo padrão de `DocumentosDaEmpresaService` (apps/api/src/empresa/
  // documentos.service.ts). O service usa `this.pool.instancia` internamente.
  const poolDoBanco = { instancia: {} as never } as never;
  let service: PendenciasService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PendenciasService(poolDoBanco);
  });

  it('consultarCentral delega ao repositorio com o filtro padrao ABERTA', async () => {
    vi.mocked(listarCentral).mockResolvedValue({ pendencias: [], total: 0 });

    await service.consultarCentral('tenant-1', 'usuario-1', {
      empresaId: null,
      origem: null,
      tipo: null,
      estado: 'ABERTA',
      vencimento: null,
      limite: 25,
      deslocamento: 0,
    });

    expect(comContextoHumano).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: 'tenant-1', usuarioId: 'usuario-1' },
      expect.any(Function),
    );
    expect(listarCentral).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estado: 'ABERTA' }),
      expect.any(String),
    );
  });

  it('dispensar lanca PENDENCIA_NAO_ENCONTRADA quando o repositorio nao acha a pendencia aberta', async () => {
    vi.mocked(dispensar).mockResolvedValue(null);

    await expect(
      service.dispensar('tenant-1', 'empresa-1', 'pendencia-1', { usuarioId: 'user-1' }, 'motivo valido'),
    ).rejects.toThrow(ErroDeDominio);

    try {
      await service.dispensar('tenant-1', 'empresa-1', 'pendencia-1', { usuarioId: 'user-1' }, 'motivo valido');
      throw new Error('esperava erro de domínio');
    } catch (erro) {
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.PENDENCIA_NAO_ENCONTRADA);
    }
  });

  it('dispensar retorna a pendencia resolvida quando o repositorio confirma', async () => {
    const pendenciaResolvida = {
      id: 'pendencia-1',
      empresaId: 'empresa-1',
      origem: 'CADASTRAL',
      tipo: 'CAMPO_AUSENTE',
      chave: 'campo:cnae',
      estado: 'RESOLVIDA',
      dataLimite: null,
      criadoEm: '2026-09-01T00:00:00.000Z',
      resolvidoEm: '2026-09-21T00:00:00.000Z',
    };
    vi.mocked(dispensar).mockResolvedValue(pendenciaResolvida);

    const resultado = await service.dispensar(
      'tenant-1',
      'empresa-1',
      'pendencia-1',
      { usuarioId: 'user-1' },
      'motivo valido',
    );

    expect(resultado).toEqual(pendenciaResolvida);
    expect(dispensar).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'empresa-1',
      'pendencia-1',
      'user-1',
      'motivo valido',
    );
  });

  it('contarPorEmpresas delega ao repositorio', async () => {
    vi.mocked(contarAbertasPorEmpresa).mockResolvedValue(new Map([['empresa-1', 2]]));

    const resultado = await service.contarPorEmpresas('tenant-1', 'user-1', ['empresa-1']);

    expect(resultado.get('empresa-1')).toBe(2);
    expect(contarAbertasPorEmpresa).toHaveBeenCalledWith(expect.anything(), ['empresa-1']);
  });
});
