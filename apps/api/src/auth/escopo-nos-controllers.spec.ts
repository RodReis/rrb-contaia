/**
 * "Sem carteira, nenhuma empresa" (SPEC-007 §3.1): quem não é administrador
 * recebe resposta vazia ou negada sem que o serviço de dados sequer seja
 * chamado — a prova é que o dublê do serviço não foi tocado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, type PapelPadrao } from '@contaia/domain';

import { EmpresaController } from '../empresa/empresa.controller';
import { HistoricoController } from '../empresa/manutencao.controller';
import { NotificacoesController } from '../notificacoes/notificacoes.controller';
import { PendenciasController } from '../pendencias/pendencias.controller';
import type { RequisicaoAutenticada } from './sessao.guard';

const requisicao = (papeis: readonly PapelPadrao[]): RequisicaoAutenticada =>
  ({
    sessao: { papeis, tenantId: 'tenant-1', usuarioId: 'usuario-1' },
  }) as unknown as RequisicaoAutenticada;

const SEM_CARTEIRA = requisicao(['contador']);
const ADMIN = requisicao(['admin_escritorio']);

const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('EmpresaController sem carteira', () => {
  const servico = {
    listar: vi.fn(),
    consultarCnpj: vi.fn(),
    criar: vi.fn(),
  };
  const pendencias = { contarPorEmpresas: vi.fn() };
  const controller = new EmpresaController(servico as never, pendencias as never);

  beforeEach(() => vi.clearAllMocks());

  it('lista devolve zero empresas sem consultar o serviço', async () => {
    const resposta = await controller.listar(SEM_CARTEIRA, {});

    // O marcador deixa a tela distinguir "sem carteira" de "carteira ainda vazia".
    expect(resposta).toEqual({ empresas: [], total: 0, escopoDeEmpresas: 'NENHUMA' });
    expect(servico.listar).not.toHaveBeenCalled();
  });

  it('administrador não recebe o marcador de escopo: para ele a lista vazia é carteira vazia', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    pendencias.contarPorEmpresas.mockResolvedValue(new Map());

    expect(await controller.listar(ADMIN, {})).not.toHaveProperty('escopoDeEmpresas');
  });

  it('consulta de CNPJ e criação são negadas com SEM_ALCADA', async () => {
    expect(await codigoDe(() => controller.consultarCnpj(SEM_CARTEIRA, '12345678000195'))).toBe(
      CODIGOS_DE_ERRO.SEM_ALCADA,
    );
    expect(
      await codigoDe(() => controller.criar(SEM_CARTEIRA, { cnpj: '12345678000195' })),
    ).toBe(CODIGOS_DE_ERRO.SEM_ALCADA);
    expect(servico.consultarCnpj).not.toHaveBeenCalled();
    expect(servico.criar).not.toHaveBeenCalled();
  });

  it('administrador continua listando pelo serviço', async () => {
    servico.listar.mockResolvedValue({ empresas: [], total: 0 });
    pendencias.contarPorEmpresas.mockResolvedValue(new Map());

    await controller.listar(ADMIN, {});

    expect(servico.listar).toHaveBeenCalledTimes(1);
  });
});

describe('Central de Pendências, Histórico e Notificações sem carteira', () => {
  it('central de pendências vem vazia', async () => {
    const servico = { consultarCentral: vi.fn() };
    const controller = new PendenciasController(servico as never);

    expect(await controller.consultarCentral(SEM_CARTEIRA, {})).toEqual({
      pendencias: [],
      total: 0,
    });
    expect(servico.consultarCentral).not.toHaveBeenCalled();
  });

  it('histórico de empresas e seus campos vêm vazios', async () => {
    const servico = { consultarHistorico: vi.fn(), camposDoHistorico: vi.fn() };
    const controller = new HistoricoController(servico as never);

    expect(await controller.listar(SEM_CARTEIRA, {})).toEqual({ eventos: [], total: 0 });
    expect(await controller.campos(SEM_CARTEIRA, {})).toEqual([]);
    expect(servico.consultarHistorico).not.toHaveBeenCalled();
    expect(servico.camposDoHistorico).not.toHaveBeenCalled();
  });

  it('painel e histórico de notificações vêm vazios; marcar como lida responde como inexistente', async () => {
    const servico = {
      consultarPainel: vi.fn(),
      consultarHistorico: vi.fn(),
      marcarComoLida: vi.fn(),
      marcarVariasComoLidas: vi.fn(),
    };
    const controller = new NotificacoesController(servico as never);

    expect(await controller.consultarPainel(SEM_CARTEIRA)).toEqual({
      notificacoes: [],
      naoLidas: 0,
    });
    expect(await controller.consultarHistorico(SEM_CARTEIRA, {})).toEqual({
      notificacoes: [],
      total: 0,
    });
    expect(
      await codigoDe(() => controller.marcarComoLida(SEM_CARTEIRA, 'qualquer-id')),
    ).toBe(CODIGOS_DE_ERRO.NOTIFICACAO_NAO_ENCONTRADA);
    expect(
      await controller.marcarVariasComoLidas(SEM_CARTEIRA, {
        ids: ['00000000-0000-7000-8000-000000000001'],
      }),
    ).toEqual({ marcadas: 0 });

    for (const chamada of Object.values(servico)) {
      expect(chamada).not.toHaveBeenCalled();
    }
  });
});
