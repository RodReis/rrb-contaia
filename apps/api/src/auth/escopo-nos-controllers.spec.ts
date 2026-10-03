/**
 * Listagens empresariais só devolvem o que a carteira de quem pergunta alcança
 * (SPEC-009 §3.5), e a orientação de ausência de alçada aparece só quando a
 * carteira está vazia — nunca por causa do papel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PapelPadrao } from '@contaia/domain';

import { EmpresaController } from '../empresa/empresa.controller';
import { HistoricoController } from '../empresa/manutencao.controller';
import { NotificacoesController } from '../notificacoes/notificacoes.controller';
import { PendenciasController } from '../pendencias/pendencias.controller';
import type { RequisicaoAutenticada } from './sessao.guard';

const requisicao = (papeis: readonly PapelPadrao[]): RequisicaoAutenticada =>
  ({
    sessao: { papeis, tenantId: 'tenant-1', usuarioId: 'usuario-1' },
    header: () => undefined,
  }) as unknown as RequisicaoAutenticada;

const CONTADOR = requisicao(['contador']);
const ADMIN = requisicao(['admin_escritorio']);

const comCarteira = (possui: boolean) => ({ possuiCarteira: vi.fn().mockResolvedValue(possui) });
// Sino e Central reconciliam o cofre ao consultar (SPEC-011); aqui só importa que não derrube a tela.
const cofre = { reconciliarDaCarteira: vi.fn().mockResolvedValue(undefined) };

describe('EmpresaController', () => {
  const servico = { listar: vi.fn(), consultarCnpj: vi.fn(), criar: vi.fn() };
  const pendencias = { contarPorEmpresas: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    pendencias.contarPorEmpresas.mockResolvedValue(new Map());
  });

  it('lista sempre pela carteira de quem pergunta — inclusive o administrador', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    const controller = new EmpresaController(
      servico as never,
      pendencias as never,
      comCarteira(true) as never,
    );

    await controller.listar(ADMIN, {});

    expect(servico.listar).toHaveBeenCalledWith(
      'tenant-1',
      'usuario-1',
      expect.objectContaining({ carteiraDoUsuarioId: 'usuario-1' }),
    );
  });

  it('só o administrador vê também as empresas arquivadas do tenant, sem vínculo', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    const controller = new EmpresaController(
      servico as never,
      pendencias as never,
      comCarteira(true) as never,
    );

    await controller.listar(ADMIN, {});
    await controller.listar(CONTADOR, {});

    expect(servico.listar).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      'usuario-1',
      expect.objectContaining({ veArquivadasDoTenant: true }),
    );
    expect(servico.listar).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      'usuario-1',
      expect.objectContaining({ veArquivadasDoTenant: false }),
    );
  });

  it('carteira vazia devolve o marcador de ausência de alçada aos papéis que não são admin', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    const controller = new EmpresaController(
      servico as never,
      pendencias as never,
      comCarteira(false) as never,
    );

    expect(await controller.listar(CONTADOR, {})).toEqual({
      empresas: [],
      total: 0,
      escopoDeEmpresas: 'NENHUMA',
    });
  });

  it('admin com carteira vazia não recebe o marcador: precisa do convite para cadastrar a primeira empresa', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    const controller = new EmpresaController(
      servico as never,
      pendencias as never,
      comCarteira(false) as never,
    );

    expect(await controller.listar(ADMIN, {})).not.toHaveProperty('escopoDeEmpresas');
  });

  it('carteira com empresas e lista vazia por filtro não recebe o marcador', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    const controller = new EmpresaController(
      servico as never,
      pendencias as never,
      comCarteira(true) as never,
    );

    expect(await controller.listar(CONTADOR, {})).not.toHaveProperty('escopoDeEmpresas');
  });

  it('só o administrador criador é autoatribuído à empresa criada', async () => {
    servico.criar.mockResolvedValue({});
    const controller = new EmpresaController(
      servico as never,
      pendencias as never,
      comCarteira(true) as never,
    );

    await controller.criar(ADMIN, { cnpj: '12345678000195' });
    await controller.criar(CONTADOR, { cnpj: '12345678000195' });

    expect(servico.criar).toHaveBeenNthCalledWith(1, 'tenant-1', '12345678000195', {
      usuarioId: 'usuario-1',
      autoatribuir: true,
    });
    expect(servico.criar).toHaveBeenNthCalledWith(2, 'tenant-1', '12345678000195', {
      usuarioId: 'usuario-1',
      autoatribuir: false,
    });
  });
});

describe('Central de Pendências, Histórico e Notificações', () => {
  it('central de pendências filtra pela carteira e orienta só quando ela está vazia', async () => {
    const servico = { consultarCentral: vi.fn().mockResolvedValue({ pendencias: [], total: 0 }) };

    const semCarteira = new PendenciasController(servico as never, comCarteira(false) as never, cofre as never);
    expect(await semCarteira.consultarCentral(CONTADOR, {})).toEqual({
      pendencias: [],
      total: 0,
      escopoDeEmpresas: 'NENHUMA',
    });
    expect(servico.consultarCentral).toHaveBeenCalledWith('tenant-1', 'usuario-1', expect.anything());

    const comEmpresas = new PendenciasController(servico as never, comCarteira(true) as never, cofre as never);
    expect(await comEmpresas.consultarCentral(ADMIN, {})).not.toHaveProperty('escopoDeEmpresas');
  });

  it('histórico de empresas filtra pela carteira do usuário', async () => {
    const servico = { consultarHistorico: vi.fn().mockResolvedValue({ eventos: [], total: 0 }) };
    const controller = new HistoricoController(servico as never);

    await controller.listar(ADMIN, {});

    expect(servico.consultarHistorico).toHaveBeenCalledWith(
      'tenant-1',
      'usuario-1',
      expect.objectContaining({ carteiraDoUsuarioId: 'usuario-1' }),
    );
  });

  it('sino é do usuário: aviso de carteira aparece mesmo com a carteira vazia', async () => {
    const aviso = { id: 'n-1', tipo: 'CARTEIRA_ALTERADA' };
    const servico = {
      consultarPainel: vi.fn().mockResolvedValue({ notificacoes: [aviso], naoLidas: 1 }),
      consultarHistorico: vi.fn().mockResolvedValue({ notificacoes: [aviso], total: 1 }),
    };
    const controller = new NotificacoesController(servico as never, comCarteira(false) as never, cofre as never);

    expect(await controller.consultarPainel(CONTADOR)).toEqual({
      notificacoes: [aviso],
      naoLidas: 1,
    });
    expect(await controller.consultarHistorico(CONTADOR, {})).toEqual({
      notificacoes: [aviso],
      total: 1,
    });
    expect(servico.consultarPainel).toHaveBeenCalledWith('tenant-1', 'usuario-1');
  });

  it('sino vazio com carteira vazia devolve a orientação de ausência de alçada', async () => {
    const servico = {
      consultarPainel: vi.fn().mockResolvedValue({ notificacoes: [], naoLidas: 0 }),
      consultarHistorico: vi.fn().mockResolvedValue({ notificacoes: [], total: 0 }),
    };
    const controller = new NotificacoesController(servico as never, comCarteira(false) as never, cofre as never);

    expect(await controller.consultarPainel(CONTADOR)).toEqual({
      notificacoes: [],
      naoLidas: 0,
      escopoDeEmpresas: 'NENHUMA',
    });
    expect(await controller.consultarHistorico(CONTADOR, {})).toEqual({
      notificacoes: [],
      total: 0,
      escopoDeEmpresas: 'NENHUMA',
    });
  });

  it('sino e Central mantêm o cofre em dia para o usuário da sessão antes de ler', async () => {
    cofre.reconciliarDaCarteira.mockClear();
    const sino = {
      consultarPainel: vi.fn().mockResolvedValue({ notificacoes: [], naoLidas: 0 }),
      consultarHistorico: vi.fn().mockResolvedValue({ notificacoes: [], total: 0 }),
    };
    const central = { consultarCentral: vi.fn().mockResolvedValue({ pendencias: [], total: 0 }) };

    await new NotificacoesController(sino as never, comCarteira(true) as never, cofre as never).consultarPainel(CONTADOR);
    await new NotificacoesController(sino as never, comCarteira(true) as never, cofre as never).consultarHistorico(CONTADOR, {});
    await new PendenciasController(central as never, comCarteira(true) as never, cofre as never).consultarCentral(CONTADOR, {});

    expect(cofre.reconciliarDaCarteira).toHaveBeenCalledTimes(3);
    expect(cofre.reconciliarDaCarteira).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', usuarioId: 'usuario-1' },
      expect.any(String),
    );
  });

  it('marcar leitura delega ao serviço com o usuário da sessão', async () => {
    const servico = {
      marcarComoLida: vi.fn().mockResolvedValue({}),
      marcarVariasComoLidas: vi.fn().mockResolvedValue({ marcadas: 1 }),
    };
    const controller = new NotificacoesController(servico as never, comCarteira(true) as never, cofre as never);

    await controller.marcarComoLida(CONTADOR, 'n-1');
    await controller.marcarVariasComoLidas(CONTADOR, {
      ids: ['00000000-0000-7000-8000-000000000001'],
    });

    expect(servico.marcarComoLida).toHaveBeenCalledWith('tenant-1', 'n-1', {
      usuarioId: 'usuario-1',
    });
    expect(servico.marcarVariasComoLidas).toHaveBeenCalledWith(
      'tenant-1',
      ['00000000-0000-7000-8000-000000000001'],
      { usuarioId: 'usuario-1' },
    );
  });
});
