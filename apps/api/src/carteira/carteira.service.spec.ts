/**
 * Casos de uso da carteira (SPEC-009) sobre um repositório dublê: prova a decisão
 * do caso de uso — tudo ou nada, evento e notificação junto com o vínculo, 403
 * com nome e CNPJ — sem banco. SQL, RLS e concorrência real estão em `packages/db`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, ErroDeValidacao } from '@contaia/domain';

const db = vi.hoisted(() => ({
  comContextoHumano: vi.fn(
    async (_pool: unknown, _entrada: unknown, executar: (cliente: unknown) => Promise<unknown>) =>
      executar({}),
  ),
  carregarUsuariosDaOperacao: vi.fn(),
  carregarEmpresasDaOperacao: vi.fn(),
  aplicarEfeitos: vi.fn(),
  registrarEventoDeCarteira: vi.fn(),
  criarNotificacoesDeCarteira: vi.fn(),
  acessoAEmpresa: vi.fn(),
  empresasDaCarteira: vi.fn(),
}));

vi.mock('@contaia/db', () => db);

import { CarteiraService } from './carteira.service';

const TENANT = 'tenant-1';
const ADMIN = '00000000-0000-7000-8000-0000000000aa';
const U1 = '00000000-0000-7000-8000-000000000001';
const U2 = '00000000-0000-7000-8000-000000000002';
const E1 = '00000000-0000-7000-8000-0000000000e1';
const E2 = '00000000-0000-7000-8000-0000000000e2';

const usuario = (id: string, sobre: Record<string, unknown> = {}) => ({
  id,
  nome: `Colaborador ${id.slice(-1)}`,
  email: `${id}@x.local`,
  estado: 'ATIVO',
  revisao: 0,
  empresasVinculadas: [] as string[],
  ...sobre,
});

const empresa = (id: string, sobre: Record<string, unknown> = {}) => ({
  id,
  nome: `Empresa ${id.slice(-1)}`,
  cnpj: '11222333000181',
  status: 'ATIVA',
  situacao: 'ativo',
  ...sobre,
});

const servico = (): CarteiraService => new CarteiraService({ instancia: {} } as never);

const falha = async (executar: () => Promise<unknown>): Promise<unknown> => {
  try {
    await executar();
  } catch (erro) {
    return erro;
  }
  throw new Error('esperava falha');
};

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` não desfaz `mockRejectedValue`: sem o reset, a falha de um teste vaza para o seguinte.
  db.criarNotificacoesDeCarteira.mockReset();
  db.registrarEventoDeCarteira.mockResolvedValue('evento-1');
});

describe('alterar', () => {
  const entrada = {
    origem: 'LOTE' as const,
    usuarios: [
      { id: U1, revisao: 0 },
      { id: U2, revisao: 0 },
    ],
    adicionar: [E1, E2],
    remover: [],
  };

  it('aplica o lote, grava o evento e uma notificação consolidada por colaborador', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1), usuario(U2)]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1), empresa(E2)]);

    const resultado = await servico().alterar(TENANT, ADMIN, entrada);

    expect(resultado).toEqual({
      aplicado: true,
      afetados: [
        { usuarioId: U1, revisaoNova: 1 },
        { usuarioId: U2, revisaoNova: 1 },
      ],
    });
    expect(db.aplicarEfeitos).toHaveBeenCalledWith({}, TENANT, ADMIN, [
      { usuarioId: U1, adicionadas: [E1, E2], removidas: [], revisaoNova: 1 },
      { usuarioId: U2, adicionadas: [E1, E2], removidas: [], revisaoNova: 1 },
    ]);
    expect(db.registrarEventoDeCarteira).toHaveBeenCalledTimes(1);
    expect(db.registrarEventoDeCarteira.mock.calls[0]?.[2]).toMatchObject({
      origem: 'LOTE',
      autorId: ADMIN,
    });
    // Uma chamada com TODOS os afetados — o repositório cria uma notificação por colaborador.
    expect(db.criarNotificacoesDeCarteira).toHaveBeenCalledTimes(1);
    expect(db.criarNotificacoesDeCarteira.mock.calls[0]?.[3]).toHaveLength(2);
  });

  it('o evento guarda nome e CNPJ do momento, para o histórico não mudar com o cadastro', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1)]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1)]);

    await servico().alterar(TENANT, ADMIN, {
      origem: 'INDIVIDUAL',
      usuarios: [{ id: U1, revisao: 0 }],
      adicionar: [E1],
      remover: [],
    });

    expect(db.registrarEventoDeCarteira.mock.calls[0]?.[2].afetados[0]).toMatchObject({
      usuarioId: U1,
      usuarioNome: 'Colaborador 1',
      adicionadas: [{ id: E1, nome: 'Empresa 1', cnpj: '11222333000181' }],
      revisaoAnterior: 0,
      revisaoNova: 1,
    });
  });

  it('lote inválido não aplica nada: nem vínculo, nem evento, nem notificação', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1), usuario(U2)]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([
      empresa(E1),
      empresa(E2, { situacao: 'arquivado' }),
    ]);

    const erro = await falha(() => servico().alterar(TENANT, ADMIN, entrada));

    expect(erro).toBeInstanceOf(ErroDeValidacao);
    expect((erro as ErroDeValidacao).campos).toEqual([
      { campo: `empresas.${E2}`, codigo: CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA },
    ]);
    expect(db.aplicarEfeitos).not.toHaveBeenCalled();
    expect(db.registrarEventoDeCarteira).not.toHaveBeenCalled();
    expect(db.criarNotificacoesDeCarteira).not.toHaveBeenCalled();
  });

  it('usuário de outro tenant ou inexistente derruba o lote sem revelar a diferença', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1)]);

    const erro = await falha(() => servico().alterar(TENANT, ADMIN, entrada));

    expect(erro).toBeInstanceOf(ErroDeValidacao);
    expect((erro as ErroDeValidacao).campos).toEqual([
      { campo: `usuarios.${U2}`, codigo: CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO },
    ]);
    expect(db.aplicarEfeitos).not.toHaveBeenCalled();
  });

  it('empresa de outro tenant chega como não carregada e derruba o lote', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1), usuario(U2)]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1)]);

    const erro = await falha(() => servico().alterar(TENANT, ADMIN, entrada));

    expect((erro as ErroDeValidacao).campos).toEqual([
      { campo: `empresas.${E2}`, codigo: CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA },
    ]);
    expect(db.aplicarEfeitos).not.toHaveBeenCalled();
  });

  it('revisão desatualizada responde 409 e nada é aplicado', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1, { revisao: 3 }), usuario(U2)]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1), empresa(E2)]);

    const erro = await falha(() => servico().alterar(TENANT, ADMIN, entrada));

    expect(erro).toBeInstanceOf(ErroDeConflito);
    expect((erro as ErroDeConflito).codigo).toBe(CODIGOS_DE_ERRO.CARTEIRA_DESATUALIZADA);
    expect(db.aplicarEfeitos).not.toHaveBeenCalled();
  });

  it('operação sem efeito não gera evento, notificação nem nova revisão', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([
      usuario(U1, { revisao: 2, empresasVinculadas: [E1, E2] }),
    ]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1), empresa(E2)]);

    const resultado = await servico().alterar(TENANT, ADMIN, {
      origem: 'INDIVIDUAL',
      usuarios: [{ id: U1, revisao: 2 }],
      adicionar: [E1, E2],
      remover: [],
    });

    expect(resultado).toEqual({ aplicado: false, afetados: [] });
    expect(db.aplicarEfeitos).not.toHaveBeenCalled();
    expect(db.registrarEventoDeCarteira).not.toHaveBeenCalled();
    expect(db.criarNotificacoesDeCarteira).not.toHaveBeenCalled();
  });

  it('falha ao gravar o evento ou a notificação propaga e deixa a transação desfazer tudo', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1)]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1)]);
    db.criarNotificacoesDeCarteira.mockRejectedValue(new Error('notificação falhou'));

    await expect(
      servico().alterar(TENANT, ADMIN, {
        origem: 'INDIVIDUAL',
        usuarios: [{ id: U1, revisao: 0 }],
        adicionar: [E1],
        remover: [],
      }),
    ).rejects.toThrow('notificação falhou');
    // Tudo acontece dentro do mesmo `comContextoHumano`: uma única transação.
    expect(db.comContextoHumano).toHaveBeenCalledTimes(1);
  });

  it('adição e remoção juntas geram um único evento por operação', async () => {
    db.carregarUsuariosDaOperacao.mockResolvedValue([usuario(U1, { empresasVinculadas: [E1] })]);
    db.carregarEmpresasDaOperacao.mockResolvedValue([empresa(E1), empresa(E2)]);

    await servico().alterar(TENANT, ADMIN, {
      origem: 'INDIVIDUAL',
      usuarios: [{ id: U1, revisao: 0 }],
      adicionar: [E2],
      remover: [E1],
    });

    expect(db.registrarEventoDeCarteira).toHaveBeenCalledTimes(1);
    expect(db.aplicarEfeitos.mock.calls[0]?.[3]).toEqual([
      { usuarioId: U1, adicionadas: [E2], removidas: [E1], revisaoNova: 1 },
    ]);
  });
});

describe('exigirAcessoAEmpresa', () => {
  it('permite quando há vínculo ativo', async () => {
    db.acessoAEmpresa.mockResolvedValue({
      nome: 'Alfa',
      cnpj: '11222333000181',
      vinculado: true,
      arquivada: false,
    });

    await expect(servico().exigirAcessoAEmpresa(TENANT, U1, E1, false)).resolves.toBeUndefined();
  });

  it('empresa do tenant fora da carteira responde 403 com nome e CNPJ, e nada além', async () => {
    db.acessoAEmpresa.mockResolvedValue({
      nome: 'Alfa',
      cnpj: '11222333000181',
      vinculado: false,
      arquivada: false,
    });

    const erro = (await falha(() => servico().exigirAcessoAEmpresa(TENANT, U1, E1, false))) as ErroDeDominio;

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA);
    expect(erro.message).toContain('Alfa');
    expect(erro.message).toContain('11.222.333/0001-81');
    expect(erro.detalhes).toEqual({ empresa: { nome: 'Alfa', cnpj: '11.222.333/0001-81' } });
  });

  it('admin alcança empresa ARQUIVADA sem vínculo; empresa ativa continua exigindo vínculo', async () => {
    db.acessoAEmpresa.mockResolvedValue({
      nome: 'Alfa',
      cnpj: '11222333000181',
      vinculado: false,
      arquivada: true,
    });

    await expect(servico().exigirAcessoAEmpresa(TENANT, U1, E1, true)).resolves.toBeUndefined();

    const semExcecao = (await falha(() =>
      servico().exigirAcessoAEmpresa(TENANT, U1, E1, false),
    )) as ErroDeDominio;
    expect(semExcecao.codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA);

    db.acessoAEmpresa.mockResolvedValue({
      nome: 'Alfa',
      cnpj: '11222333000181',
      vinculado: false,
      arquivada: false,
    });
    const ativa = (await falha(() =>
      servico().exigirAcessoAEmpresa(TENANT, U1, E1, true),
    )) as ErroDeDominio;
    expect(ativa.codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA);
  });

  it('empresa de outro tenant ou inexistente responde como não encontrada', async () => {
    db.acessoAEmpresa.mockResolvedValue(null);

    const erro = (await falha(() => servico().exigirAcessoAEmpresa(TENANT, U1, E1, false))) as ErroDeDominio;

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA);
    expect(erro.detalhes).toEqual({});
  });

  it('id sem forma de identificador nem chega ao banco', async () => {
    const erro = (await falha(() =>
      servico().exigirAcessoAEmpresa(TENANT, U1, "x'; drop table app.empresa;--", false),
    )) as ErroDeDominio;

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA);
    expect(db.acessoAEmpresa).not.toHaveBeenCalled();
  });
});

describe('possuiCarteira', () => {
  it('é verdadeiro com ao menos uma empresa e falso sem nenhuma', async () => {
    db.empresasDaCarteira.mockResolvedValueOnce([E1]).mockResolvedValueOnce([]);

    expect(await servico().possuiCarteira(TENANT, U1)).toBe(true);
    expect(await servico().possuiCarteira(TENANT, U1)).toBe(false);
  });
});
