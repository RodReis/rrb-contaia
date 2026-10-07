/**
 * Casos de uso de Notificações (SPEC-006, categoria Regras).
 *
 * O repositório entra por dublê: o que se prova aqui é a decisão do caso de
 * uso — marcar como lida lança erro de domínio quando o repositório não
 * confirma, painel combina lista e contador, e lote retorna a quantidade
 * marcada. Persistência real e SQL têm provas próprias em `packages/db`.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  return {
    ...real,
    comContextoHumano: vi.fn(async (_pool, _entrada, executar) => executar({} as never)),
    listarPainel: vi.fn(),
    contarNaoLidas: vi.fn(),
    listarHistoricoDeNotificacoes: vi.fn(),
    marcarComoLida: vi.fn(),
    marcarVariasComoLidas: vi.fn(),
  };
});

import * as db from '@contaia/db';

import { NotificacoesService } from './notificacoes.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const NOTIFICACAO_ID = '00000000-0000-0000-0000-000000000002';
const USUARIO_ID = '00000000-0000-0000-0000-000000000003';

describe('NotificacoesService', () => {
  // `NotificacoesService` recebe `PoolDoBanco` (o provider wrapper), não `Pool`
  // cru — mesmo padrão de `PendenciasService`. O service usa `this.pool.instancia`.
  const poolDoBanco = { instancia: {} as never } as never;
  let service: NotificacoesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificacoesService(poolDoBanco);
  });

  it('consultarPainel combina lista e contador não lidas', async () => {
    vi.mocked(db.listarPainel).mockResolvedValue([]);
    vi.mocked(db.contarNaoLidas).mockResolvedValue(3);

    const resultado = await service.consultarPainel(TENANT_ID, USUARIO_ID);

    expect(resultado).toEqual({ notificacoes: [], naoLidas: 3 });
    expect(db.comContextoHumano).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT_ID, usuarioId: USUARIO_ID },
      expect.any(Function),
    );
  });

  it('consultarHistorico delega ao repositorio com limite e deslocamento', async () => {
    const pagina = { notificacoes: [], total: 0 };
    vi.mocked(db.listarHistoricoDeNotificacoes).mockResolvedValue(pagina);

    const resultado = await service.consultarHistorico(TENANT_ID, USUARIO_ID, 25, 0);

    expect(resultado).toEqual(pagina);
    expect(db.listarHistoricoDeNotificacoes).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      USUARIO_ID,
      25,
      0,
    );
  });

  it('marcarComoLida lança NOTIFICACAO_NAO_ENCONTRADA quando repositório retorna null', async () => {
    vi.mocked(db.marcarComoLida).mockResolvedValue(null);

    await expect(
      service.marcarComoLida(TENANT_ID, NOTIFICACAO_ID, { usuarioId: USUARIO_ID }),
    ).rejects.toThrow(ErroDeDominio);

    try {
      await service.marcarComoLida(TENANT_ID, NOTIFICACAO_ID, { usuarioId: USUARIO_ID });
      throw new Error('esperava erro de domínio');
    } catch (erro) {
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.NOTIFICACAO_NAO_ENCONTRADA);
    }
  });

  it('marcarComoLida retorna a notificação marcada quando o repositório confirma', async () => {
    const notificacaoMarcada = {
      id: NOTIFICACAO_ID,
      empresaId: 'empresa-1',
      empresaNome: 'Empresa Um',
      tipo: 'CADASTRAL',
      chave: 'campo:cnae',
      lida: true,
      lidaEm: '2026-09-22T00:00:00.000Z',
      criadoEm: '2026-09-01T00:00:00.000Z',
      adicionadas: null,
      removidas: null,
      duracaoMs: null,
    };
    vi.mocked(db.marcarComoLida).mockResolvedValue(notificacaoMarcada);

    const resultado = await service.marcarComoLida(TENANT_ID, NOTIFICACAO_ID, {
      usuarioId: USUARIO_ID,
    });

    expect(resultado).toEqual(notificacaoMarcada);
    expect(db.marcarComoLida).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      NOTIFICACAO_ID,
      USUARIO_ID,
    );
  });

  it('marcarVariasComoLidas retorna quantidade marcada', async () => {
    vi.mocked(db.marcarVariasComoLidas).mockResolvedValue(2);

    const resultado = await service.marcarVariasComoLidas(TENANT_ID, [NOTIFICACAO_ID], {
      usuarioId: USUARIO_ID,
    });

    expect(resultado).toEqual({ marcadas: 2 });
    expect(db.marcarVariasComoLidas).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      [NOTIFICACAO_ID],
      USUARIO_ID,
    );
  });
});
