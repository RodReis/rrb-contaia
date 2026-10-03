import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeValidacao } from '../erros.js';
import {
  decidirAcessoEmpresarial,
  empresaAceitaVinculo,
  planejarAlteracao,
  planejarOperacao,
  usuarioPodeReceberCarteira,
} from './carteira.js';
import type { EmpresaParaCarteira, UsuarioParaCarteira } from './carteira.js';

const usuario = (id: string, sobre: Partial<UsuarioParaCarteira> = {}): UsuarioParaCarteira => ({
  id,
  estado: 'ATIVO',
  revisao: 0,
  empresasVinculadas: [],
  ...sobre,
});

const empresa = (id: string, sobre: Partial<EmpresaParaCarteira> = {}): EmpresaParaCarteira => ({
  id,
  status: 'ATIVA',
  situacao: 'ativo',
  ...sobre,
});

const revisoes = (...ids: string[]): Record<string, number> =>
  Object.fromEntries(ids.map((id) => [id, 0]));

describe('quem pode entrar na carteira', () => {
  it('aceita convidado, ativo e suspenso; recusa arquivado', () => {
    expect(usuarioPodeReceberCarteira('CONVIDADO')).toBe(true);
    expect(usuarioPodeReceberCarteira('ATIVO')).toBe(true);
    expect(usuarioPodeReceberCarteira('SUSPENSO')).toBe(true);
    expect(usuarioPodeReceberCarteira('ARQUIVADO')).toBe(false);
  });

  it('empresa só recebe vínculo quando ativa e não arquivada', () => {
    expect(empresaAceitaVinculo(empresa('e1'))).toBe(true);
    expect(empresaAceitaVinculo(empresa('e1', { situacao: 'arquivado' }))).toBe(false);
    expect(empresaAceitaVinculo(empresa('e1', { status: 'CADASTRO_INCOMPLETO' }))).toBe(false);
  });
});

describe('planejarOperacao', () => {
  it('adiciona várias empresas a vários colaboradores e abre nova revisão por colaborador', () => {
    const plano = planejarOperacao({
      operacao: 'ADICIONAR',
      usuarios: [usuario('u1'), usuario('u2', { revisao: 4 })],
      empresas: [empresa('e1'), empresa('e2')],
      revisoesEsperadas: { u1: 0, u2: 4 },
    });

    expect(plano.efeitos).toEqual([
      { usuarioId: 'u1', adicionadas: ['e1', 'e2'], removidas: [], revisaoNova: 1 },
      { usuarioId: 'u2', adicionadas: ['e1', 'e2'], removidas: [], revisaoNova: 5 },
    ]);
    expect(plano.semEfeito).toBe(false);
  });

  it('permite que a mesma empresa pertença a vários colaboradores', () => {
    const plano = planejarOperacao({
      operacao: 'ADICIONAR',
      usuarios: [usuario('u1', { empresasVinculadas: ['e1'] }), usuario('u2')],
      empresas: [empresa('e1')],
      revisoesEsperadas: revisoes('u1', 'u2'),
    });

    expect(plano.efeitos.map((e) => e.usuarioId)).toEqual(['u2']);
  });

  it('repetir adição existente não gera efeito nem muda a revisão', () => {
    const plano = planejarOperacao({
      operacao: 'ADICIONAR',
      usuarios: [usuario('u1', { revisao: 3, empresasVinculadas: ['e1'] })],
      empresas: [empresa('e1')],
      revisoesEsperadas: { u1: 3 },
    });

    expect(plano.efeitos).toEqual([]);
    expect(plano.semEfeito).toBe(true);
  });

  it('remove só o que existe e ignora vínculo ausente', () => {
    const plano = planejarOperacao({
      operacao: 'REMOVER',
      usuarios: [
        usuario('u1', { revisao: 2, empresasVinculadas: ['e1', 'e2'] }),
        usuario('u2', { revisao: 7 }),
      ],
      empresas: [empresa('e1'), empresa('e3')],
      revisoesEsperadas: { u1: 2, u2: 7 },
    });

    expect(plano.efeitos).toEqual([
      { usuarioId: 'u1', adicionadas: [], removidas: ['e1'], revisaoNova: 3 },
    ]);
  });

  it('remover vínculo ausente de todos é operação sem efeito', () => {
    const plano = planejarOperacao({
      operacao: 'REMOVER',
      usuarios: [usuario('u1')],
      empresas: [empresa('e1')],
      revisoesEsperadas: { u1: 0 },
    });

    expect(plano.semEfeito).toBe(true);
  });

  it('remover vínculo de empresa arquivada é tolerado: o vínculo já foi encerrado', () => {
    const plano = planejarOperacao({
      operacao: 'REMOVER',
      usuarios: [usuario('u1')],
      empresas: [empresa('e1', { situacao: 'arquivado' })],
      revisoesEsperadas: { u1: 0 },
    });

    expect(plano.semEfeito).toBe(true);
  });

  it('lote com empresa arquivada é rejeitado por inteiro, listando o problema', () => {
    const chamada = () =>
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1')],
        empresas: [empresa('e1'), empresa('e2', { situacao: 'arquivado' })],
        revisoesEsperadas: revisoes('u1'),
      });

    expect(chamada).toThrow(ErroDeValidacao);
    try {
      chamada();
    } catch (erro) {
      expect((erro as ErroDeValidacao).campos).toEqual([
        { campo: 'empresas.e2', codigo: CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA },
      ]);
    }
  });

  it('empresa ainda com cadastro incompleto não entra em lote', () => {
    expect(() =>
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1')],
        empresas: [empresa('e1', { status: 'CADASTRO_INCOMPLETO' })],
        revisoesEsperadas: revisoes('u1'),
      }),
    ).toThrow(ErroDeValidacao);
  });

  it('usuário arquivado rejeita o lote inteiro, mesmo com colaboradores válidos', () => {
    try {
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1'), usuario('u2', { estado: 'ARQUIVADO' })],
        empresas: [empresa('e1')],
        revisoesEsperadas: revisoes('u1', 'u2'),
      });
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeValidacao);
      expect((erro as ErroDeValidacao).campos).toEqual([
        { campo: 'usuarios.u2', codigo: CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE },
      ]);
    }
  });

  it('acumula todos os problemas do lote, não só o primeiro', () => {
    try {
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1', { estado: 'ARQUIVADO' })],
        empresas: [empresa('e1', { situacao: 'arquivado' })],
        revisoesEsperadas: revisoes('u1'),
      });
      expect.unreachable();
    } catch (erro) {
      expect((erro as ErroDeValidacao).campos).toHaveLength(2);
    }
  });

  it('exige ao menos um colaborador e uma empresa', () => {
    expect(() =>
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [],
        empresas: [empresa('e1')],
        revisoesEsperadas: {},
      }),
    ).toThrow(ErroDeValidacao);
    expect(() =>
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1')],
        empresas: [],
        revisoesEsperadas: revisoes('u1'),
      }),
    ).toThrow(ErroDeValidacao);
  });

  it('revisão desatualizada vira conflito e vale antes de qualquer outra validação', () => {
    expect(() =>
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1', { revisao: 5 }), usuario('u2', { estado: 'ARQUIVADO' })],
        empresas: [empresa('e1')],
        revisoesEsperadas: { u1: 4, u2: 0 },
      }),
    ).toThrow(ErroDeConflito);
  });

  it('colaborador sem revisão informada é conflito: o cliente não viu o estado atual', () => {
    expect(() =>
      planejarOperacao({
        operacao: 'ADICIONAR',
        usuarios: [usuario('u1')],
        empresas: [empresa('e1')],
        revisoesEsperadas: {},
      }),
    ).toThrow(ErroDeConflito);
  });

  it('ignora duplicatas na seleção', () => {
    const plano = planejarOperacao({
      operacao: 'ADICIONAR',
      usuarios: [usuario('u1'), usuario('u1')],
      empresas: [empresa('e1'), empresa('e1')],
      revisoesEsperadas: revisoes('u1'),
    });

    expect(plano.efeitos).toEqual([
      { usuarioId: 'u1', adicionadas: ['e1'], removidas: [], revisaoNova: 1 },
    ]);
  });
});

describe('decidirAcessoEmpresarial', () => {
  const base = {
    empresaDoTenant: true,
    usuarioAtivo: true,
    vinculoAtivo: true,
    permissaoConcedida: true,
    empresaArquivada: false,
    administrador: false,
  } as const;

  it('libera só com vínculo e permissão ao mesmo tempo', () => {
    expect(decidirAcessoEmpresarial(base)).toBe('PERMITIDO');
  });

  it('empresa de outro tenant ou inexistente responde como inexistente', () => {
    expect(
      decidirAcessoEmpresarial({ ...base, empresaDoTenant: false, vinculoAtivo: false }),
    ).toBe('EMPRESA_INEXISTENTE');
  });

  it('usuário que não está ativo não acessa nenhuma empresa, mesmo com vínculo preservado', () => {
    expect(decidirAcessoEmpresarial({ ...base, usuarioAtivo: false })).toBe('USUARIO_INATIVO');
  });

  it('papel autorizado não substitui o vínculo de carteira', () => {
    expect(decidirAcessoEmpresarial({ ...base, vinculoAtivo: false })).toBe('FORA_DA_CARTEIRA');
  });

  it('admin alcança empresa arquivada sem vínculo: é a única porta para reativá-la', () => {
    expect(
      decidirAcessoEmpresarial({
        ...base,
        vinculoAtivo: false,
        empresaArquivada: true,
        administrador: true,
      }),
    ).toBe('PERMITIDO');
  });

  it('a exceção do admin não vale para empresa ativa nem para quem não é admin', () => {
    expect(
      decidirAcessoEmpresarial({ ...base, vinculoAtivo: false, administrador: true }),
    ).toBe('FORA_DA_CARTEIRA');
    expect(
      decidirAcessoEmpresarial({ ...base, vinculoAtivo: false, empresaArquivada: true }),
    ).toBe('FORA_DA_CARTEIRA');
  });

  it('a exceção do admin não dispensa a permissão do papel', () => {
    expect(
      decidirAcessoEmpresarial({
        ...base,
        vinculoAtivo: false,
        empresaArquivada: true,
        administrador: true,
        permissaoConcedida: false,
      }),
    ).toBe('SEM_PERMISSAO');
  });

  it('vínculo não substitui a permissão do papel', () => {
    expect(decidirAcessoEmpresarial({ ...base, permissaoConcedida: false })).toBe(
      'SEM_PERMISSAO',
    );
  });
});

describe('planejarAlteracao', () => {
  it('soma adições e remoções do mesmo colaborador em uma única revisão', () => {
    const plano = planejarAlteracao({
      usuarios: [usuario('u1', { revisao: 2, empresasVinculadas: ['e1'] })],
      empresas: [empresa('e1'), empresa('e2')],
      adicionar: ['e2'],
      remover: ['e1'],
      revisoesEsperadas: { u1: 2 },
    });

    expect(plano.efeitos).toEqual([
      { usuarioId: 'u1', adicionadas: ['e2'], removidas: ['e1'], revisaoNova: 3 },
    ]);
  });

  it('recusa a mesma empresa nos dois lados', () => {
    try {
      planejarAlteracao({
        usuarios: [usuario('u1')],
        empresas: [empresa('e1')],
        adicionar: ['e1'],
        remover: ['e1'],
        revisoesEsperadas: revisoes('u1'),
      });
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeValidacao);
      expect((erro as ErroDeValidacao).campos[0]?.campo).toBe('empresas.e1');
    }
  });

  it('empresa pedida que não foi carregada derruba o lote como inexistente', () => {
    try {
      planejarAlteracao({
        usuarios: [usuario('u1')],
        empresas: [empresa('e1')],
        adicionar: ['e1', 'e9'],
        remover: [],
        revisoesEsperadas: revisoes('u1'),
      });
      expect.unreachable();
    } catch (erro) {
      expect((erro as ErroDeValidacao).campos).toEqual([
        { campo: 'empresas.e9', codigo: CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA },
      ]);
    }
  });

  it('sem nada a adicionar nem remover é erro de entrada', () => {
    expect(() =>
      planejarAlteracao({
        usuarios: [usuario('u1')],
        empresas: [],
        adicionar: [],
        remover: [],
        revisoesEsperadas: revisoes('u1'),
      }),
    ).toThrow(ErroDeValidacao);
  });
});
