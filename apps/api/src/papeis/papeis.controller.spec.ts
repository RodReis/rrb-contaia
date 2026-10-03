import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import type { RequisicaoAutenticada } from '../auth/sessao.guard';
import { PapeisController } from './papeis.controller';

const ID = '01927b5c-8e1a-7c3d-9a1b-0123456789ab';

const REQUISICAO = {
  sessao: { tenantId: 'tenant-1', usuarioId: 'autor-1', permissoes: [] },
} as unknown as RequisicaoAutenticada;

const DETALHE = { id: ID, nome: 'Revisor' };

const servicoDeTeste = () => ({
  listar: vi.fn(async () => ({ papeis: [], total: 0 })),
  obter: vi.fn(async () => DETALHE),
  criar: vi.fn(async () => DETALHE),
  editar: vi.fn(async () => DETALHE),
  arquivar: vi.fn(async () => DETALHE),
  reativar: vi.fn(async () => DETALHE),
});

const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('PapeisController', () => {
  it('o catálogo traz os módulos, a área exclusiva e os quatro papéis padrão', () => {
    const catalogo = new PapeisController(servicoDeTeste() as never).catalogo();

    expect(catalogo.modulos.map((m) => m.id)).toContain('documentos');
    expect(catalogo.areaExclusiva.id).toBe('usuarios');
    expect(catalogo.papeisPadrao.map((p) => p.papel)).toEqual([
      'admin_escritorio',
      'contador',
      'auxiliar',
      'auditor_readonly',
    ]);
  });

  it('listar valida o filtro e usa o tenant da sessão', async () => {
    const servico = servicoDeTeste();

    await new PapeisController(servico as never).listar(REQUISICAO, { estado: 'ATIVO', busca: 'rev' });

    expect(servico.listar).toHaveBeenCalledWith('tenant-1', {
      estado: 'ATIVO',
      busca: 'rev',
      limite: 25,
      deslocamento: 0,
    });
  });

  it('filtro inválido é 422 e o serviço não é chamado', async () => {
    const servico = servicoDeTeste();

    expect(
      await codigoDe(() => new PapeisController(servico as never).listar(REQUISICAO, { estado: 'X' })),
    ).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
    expect(servico.listar).not.toHaveBeenCalled();
  });

  it('criar usa tenant e autor da sessão, nunca do corpo', async () => {
    const servico = servicoDeTeste();

    await new PapeisController(servico as never).criar(REQUISICAO, {
      nome: 'Revisor',
      papelBase: 'auxiliar',
      permissoes: ['empresas.cadastro.consultar'],
      tenantId: 'tenant-malicioso',
      autorId: 'autor-malicioso',
    });

    expect(servico.criar).toHaveBeenCalledWith(
      'tenant-1',
      { usuarioId: 'autor-1' },
      { nome: 'Revisor', papelBase: 'auxiliar', permissoes: ['empresas.cadastro.consultar'] },
    );
  });

  it('editar, arquivar e reativar delegam com o autor da sessão e o corpo validado', async () => {
    const servico = servicoDeTeste();
    const controller = new PapeisController(servico as never);

    await controller.editar(REQUISICAO, ID, {
      nome: 'Revisor',
      permissoes: ['empresas.cadastro.consultar'],
      revisaoEsperada: 2,
    });
    await controller.arquivar(REQUISICAO, ID, { revisaoEsperada: 2 });
    await controller.reativar(REQUISICAO, ID, {
      revisaoEsperada: 3,
      permissoes: ['empresas.cadastro.consultar'],
    });

    expect(servico.editar).toHaveBeenCalledWith('tenant-1', { usuarioId: 'autor-1' }, ID, {
      nome: 'Revisor',
      permissoes: ['empresas.cadastro.consultar'],
      revisaoEsperada: 2,
      confirmaReducao: false,
    });
    expect(servico.arquivar).toHaveBeenCalledWith('tenant-1', { usuarioId: 'autor-1' }, ID, {
      revisaoEsperada: 2,
    });
    expect(servico.reativar).toHaveBeenCalledWith('tenant-1', { usuarioId: 'autor-1' }, ID, {
      revisaoEsperada: 3,
      permissoes: ['empresas.cadastro.consultar'],
      confirmaIncompatibilidades: false,
    });
  });

  it('corpo inválido é 422 e nenhum caso de uso é chamado', async () => {
    const servico = servicoDeTeste();
    const controller = new PapeisController(servico as never);

    expect(await codigoDe(() => controller.criar(REQUISICAO, { nome: 'X' }))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
    expect(await codigoDe(() => controller.arquivar(REQUISICAO, ID, {}))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
    expect(servico.criar).not.toHaveBeenCalled();
    expect(servico.arquivar).not.toHaveBeenCalled();
  });

  it('id malformado responde como papel inexistente, sem chegar ao banco', async () => {
    const servico = servicoDeTeste();
    const controller = new PapeisController(servico as never);

    expect(await codigoDe(() => controller.obter(REQUISICAO, 'nao-e-uuid'))).toBe(
      CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO,
    );
    expect(
      await codigoDe(() => controller.editar(REQUISICAO, "1'; drop table x;--", {})),
    ).toBe(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO);
    expect(servico.obter).not.toHaveBeenCalled();
    expect(servico.editar).not.toHaveBeenCalled();
  });

  it('sessão sem escritório não executa nada', async () => {
    const servico = servicoDeTeste();
    const semTenant = { sessao: {} } as unknown as RequisicaoAutenticada;

    expect(await codigoDe(() => new PapeisController(servico as never).obter(semTenant, ID))).toBe(
      CODIGOS_DE_ERRO.TENANT_DIVERGENTE,
    );
  });
});
