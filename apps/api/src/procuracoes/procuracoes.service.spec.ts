import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  comContextoHumano: vi.fn(),
  carregarUsuarioAdminDaProcuracao: vi.fn(),
  carregarProcuracaoRfb: vi.fn(),
  exigirCarteiraDaProcuracao: vi.fn(),
  exigirCarteiraOuAdminDaProcuracao: vi.fn(),
  carregarOperacaoIdempotenteDeProcuracao: vi.fn(),
  registrarTentativaRecusadaDeProcuracao: vi.fn(),
  gravarTesteLocalDaProcuracao: vi.fn(),
}));
vi.mock('@contaia/db', async () => {
  const real =
    await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  return {
    ...real,
    comContextoHumano: mocks.comContextoHumano,
    carregarUsuarioAdminDaProcuracao: mocks.carregarUsuarioAdminDaProcuracao,
    carregarProcuracaoRfb: mocks.carregarProcuracaoRfb,
    exigirCarteiraDaProcuracao: mocks.exigirCarteiraDaProcuracao,
    exigirCarteiraOuAdminDaProcuracao: mocks.exigirCarteiraOuAdminDaProcuracao,
    carregarOperacaoIdempotenteDeProcuracao:
      mocks.carregarOperacaoIdempotenteDeProcuracao,
    registrarTentativaRecusadaDeProcuracao:
      mocks.registrarTentativaRecusadaDeProcuracao,
    gravarTesteLocalDaProcuracao: mocks.gravarTesteLocalDaProcuracao,
  };
});

import { ProcuracoesService } from './procuracoes.service';

const sessao = {
  tenantId: 'tenant-1',
  usuarioId: 'usuario-1',
  permissoes: [
    'procuracoes.registro.administrar',
    'procuracoes.registro.consultar',
  ],
};
const cliente = { query: vi.fn() };
const pool = { instancia: {} };
const storage = { enviar: vi.fn(), obter: vi.fn() };
const duble = { executar: vi.fn() };

describe('ProcuracoesService', () => {
  let service: ProcuracoesService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProcuracoesService(
      pool as never,
      storage as never,
      duble as never,
    );
    mocks.comContextoHumano.mockImplementation(async (_pool, _ctx, fn) =>
      fn(cliente),
    );
    mocks.carregarUsuarioAdminDaProcuracao.mockResolvedValue(true);
  });

  it('rejeita data civil impossível antes de abrir transação', async () => {
    await expect(
      service.criar(
        sessao,
        'empresa-1',
        {
          validFrom: '2026-02-30',
          validUntil: '2026-03-31',
          powers: ['RFB_CNPJ_STATUS_READ'],
        },
        'corr-0001',
      ),
    ).rejects.toMatchObject({
      codigo: CODIGOS_DE_ERRO.PROCURACAO_DADOS_INVALIDOS,
    });
    expect(mocks.comContextoHumano).not.toHaveBeenCalled();
  });

  it('bloqueia criação sem permissão antes de consultar banco', async () => {
    await expect(
      service.criar(
        { ...sessao, permissoes: ['procuracoes.registro.consultar'] },
        'empresa-1',
        {
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          powers: ['RFB_CNPJ_STATUS_READ'],
        },
        'corr-0002',
      ),
    ).rejects.toBeInstanceOf(ErroDeDominio);
    expect(mocks.comContextoHumano).not.toHaveBeenCalled();
  });

  it('bloqueia consulta de resumo sem permissão antes da transação', async () => {
    await expect(
      service.resumo({ ...sessao, permissoes: [] }, 'corr-0003'),
    ).rejects.toMatchObject({ codigo: CODIGOS_DE_ERRO.SEM_AUTORIZACAO });
    expect(mocks.comContextoHumano).not.toHaveBeenCalled();
  });

  it('audita tentativa com poder ausente e não chama o dublê', async () => {
    mocks.carregarProcuracaoRfb.mockResolvedValue({
      empresaId: 'empresa-1',
      empresaCnpj: '11222333000181',
      powers: [],
      status: 'ACTIVE',
      archivedAt: null,
    });
    mocks.exigirCarteiraDaProcuracao.mockResolvedValue(true);
    await expect(
      service.operar(
        { ...sessao, permissoes: ['procuracoes.registro.operar'] },
        'proc-1',
        { power: 'RFB_CNPJ_STATUS_READ', idempotencyKey: 'req-0001' },
        'corr-0004',
      ),
    ).rejects.toMatchObject({
      codigo: CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
    });
    expect(mocks.registrarTentativaRecusadaDeProcuracao).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({
        resultado: 'RECUSADA',
        motivo: CODIGOS_DE_ERRO.PROCURACAO_ESTADO_INVALIDO,
      }),
    );
    expect(duble.executar).not.toHaveBeenCalled();
  });

  it('persiste falha de comunicação no teste local', async () => {
    mocks.carregarProcuracaoRfb.mockResolvedValue({
      empresaId: 'empresa-1',
      empresaCnpj: '11222333000181',
      powers: ['RFB_CNPJ_STATUS_READ'],
      statusPersistido: 'DRAFT',
      revision: 2,
      evidence: { sha256: 'a'.repeat(64) },
    });
    mocks.exigirCarteiraOuAdminDaProcuracao.mockResolvedValue(true);
    duble.executar.mockRejectedValue(new Error('socket unavailable'));
    mocks.gravarTesteLocalDaProcuracao.mockResolvedValue(true);
    await expect(
      service.testar(
        { ...sessao, permissoes: ['procuracoes.registro.testar'] },
        'proc-2',
        { expectedRevision: 2, power: 'RFB_CNPJ_STATUS_READ' },
        'corr-0005',
      ),
    ).resolves.toMatchObject({
      configuracaoTestadaLocalmente: false,
      code: 'DUBLE_INDISPONIVEL',
    });
    expect(mocks.gravarTesteLocalDaProcuracao).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ sucesso: false }),
    );
  });
});
