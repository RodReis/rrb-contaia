/**
 * Casos de uso da manutenção (SPEC-003 §9, categorias Regras e Integração).
 *
 * O banco entra por dublê: o que se prova aqui é a decisão do caso de uso —
 * CNPJ imutável, vigência futura rejeitada, empresa arquivada somente leitura,
 * e principalmente que **a CNPJá nunca aplica nada sozinha**. A persistência
 * real tem provas próprias em `packages/db`.
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import type { ErroDeDominio } from '@contaia/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManutencaoDaEmpresaService } from './manutencao.service';

const AUTOR = { usuarioId: '00000000-0000-7000-8000-00000000aaaa' } as const;
const TENANT = '00000000-0000-7000-8000-00000000bbbb';
const EMPRESA = '00000000-0000-7000-8000-00000000cccc';

const identificacao = {
  cnpj: '11222333000181',
  razaoSocial: 'Alfa Ltda',
  nomeFantasia: 'Alfa',
  logoArquivoId: null,
  telefone: '6230000000',
  email: 'contato@alfa.com.br',
} as const;

const dadosFiscais = {
  regimeTributario: 'SIMPLES_NACIONAL',
  enquadramentoSimples: 'NAO_MEI',
  cnaePrincipal: '6920601',
  cnaesSecundarios: [] as readonly string[],
  inscricaoEstadual: { situacao: 'ISENTO', numero: null },
  inscricaoMunicipal: { situacao: 'ISENTO', numero: null },
} as const;

const empresaPersistida = (situacao: 'ativo' | 'arquivado' = 'ativo') => ({
  id: EMPRESA,
  situacao,
  cadastro: {
    status: 'ATIVA' as const,
    identificacao,
    dadosFiscais,
    enderecoPrincipal: null,
    situacaoCadastralExterna: 'Ativa',
    validadoPorFonteExterna: true,
    versao: 1,
  },
});

// O `comContextoDeTenant` real abre transação no PostgreSQL; aqui ele só
// executa o callback com um cliente dublê, para provar a decisão sem banco.
const { estado } = vi.hoisted(() => ({
  estado: {
    empresa: null as ReturnType<typeof empresaPersistida> | null,
    enderecos: [] as unknown[],
    enderecoCarregado: null as Record<string, unknown> | null,
    eventos: [] as Record<string, unknown>[],
    identificacaoSalva: null as Record<string, unknown> | null,
    fiscaisSalvos: null as Record<string, unknown> | null,
    situacaoDefinida: null as string | null,
  },
}));

vi.mock('@contaia/db', () => ({
  FILTROS_DA_LISTA: ['ATIVA', 'CADASTRO_INCOMPLETO', 'ARQUIVADA'],
  comContextoDeTenant: async (
    _pool: unknown,
    _tenantId: string,
    executar: (cliente: unknown) => Promise<unknown>,
  ) => executar({}),
  carregarEmpresa: async () => estado.empresa,
  carregarEndereco: async () => estado.enderecoCarregado,
  listarEnderecosDaEmpresa: async () => estado.enderecos,
  inserirEndereco: async () => 'novo-endereco',
  atualizarEndereco: async () => undefined,
  aplicarTrocaDeFinalidade: async () => undefined,
  arquivarEndereco: async () => undefined,
  definirSituacaoDaEmpresa: async (
    _c: unknown,
    _t: string,
    _e: string,
    situacao: string,
  ) => {
    estado.situacaoDefinida = situacao;
  },
  registrarEventos: async (_c: unknown, _t: string, eventos: Record<string, unknown>[]) => {
    estado.eventos.push(...eventos);
  },
  salvarIdentificacaoDaEmpresa: async (
    _c: unknown,
    _t: string,
    _e: string,
    valor: Record<string, unknown>,
  ) => {
    estado.identificacaoSalva = valor;
  },
  salvarDadosFiscais: async (
    _c: unknown,
    _t: string,
    _e: string,
    valor: Record<string, unknown>,
  ) => {
    estado.fiscaisSalvos = valor;
  },
  listarHistorico: async () => ({ eventos: [], total: 0 }),
  camposComHistorico: async () => [],
}));

const criarServico = (consultar = vi.fn()) => {
  const empresas = {
    paraVisao: (id: string, cadastro: unknown) => ({ id, cadastro }),
    obter: async () => ({ id: EMPRESA, cadastro: estado.empresa?.cadastro }),
  };

  return new ManutencaoDaEmpresaService(
    { instancia: {} } as never,
    { consultar } as never,
    empresas as never,
  );
};

const codigoDo = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();
  } catch (erro) {
    return (erro as ErroDeDominio).codigo;
  }

  throw new Error('esperava um ErroDeDominio e nada foi lançado');
};

beforeEach(() => {
  estado.empresa = empresaPersistida();
  estado.enderecos = [];
  estado.enderecoCarregado = null;
  estado.eventos = [];
  estado.identificacaoSalva = null;
  estado.fiscaisSalvos = null;
  estado.situacaoDefinida = null;
});

describe('CNPJ imutável após a ativação (§3.2)', () => {
  it('rejeita a troca com código próprio', async () => {
    const servico = criarServico();

    expect(
      await codigoDo(() =>
        servico.salvarIdentificacao(TENANT, EMPRESA, AUTOR, {
          cnpj: '99888777000166',
          razaoSocial: 'Alfa Ltda',
          nomeFantasia: 'Alfa',
          telefone: null,
          email: null,
        }),
      ),
    ).toBe(CODIGOS_DE_ERRO.CNPJ_IMUTAVEL);

    expect(estado.identificacaoSalva).toBeNull();
    expect(estado.eventos).toEqual([]);
  });

  it('aceita o mesmo CNPJ e registra só o que mudou', async () => {
    const servico = criarServico();

    await servico.salvarIdentificacao(TENANT, EMPRESA, AUTOR, {
      cnpj: identificacao.cnpj,
      razaoSocial: 'Alfa Comércio Ltda',
      nomeFantasia: 'Alfa',
      telefone: identificacao.telefone,
      email: identificacao.email,
    });

    expect(estado.eventos).toHaveLength(1);
    expect(estado.eventos[0]).toMatchObject({
      campo: 'razaoSocial',
      valorAnterior: 'Alfa Ltda',
      valorNovo: 'Alfa Comércio Ltda',
      aba: 'DADOS_CADASTRAIS',
      usuarioId: AUTOR.usuarioId,
    });
  });
});

describe('empresa arquivada é somente consulta (§3.5)', () => {
  it('recusa editar identificação', async () => {
    estado.empresa = empresaPersistida('arquivado');
    const servico = criarServico();

    expect(
      await codigoDo(() =>
        servico.salvarIdentificacao(TENANT, EMPRESA, AUTOR, {
          razaoSocial: 'Outra Razão',
          nomeFantasia: 'Alfa',
          telefone: null,
          email: null,
        }),
      ),
    ).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);

    expect(estado.identificacaoSalva).toBeNull();
  });

  it('recusa incluir endereço', async () => {
    estado.empresa = empresaPersistida('arquivado');
    const servico = criarServico();

    expect(
      await codigoDo(() =>
        servico.criarEndereco(TENANT, EMPRESA, AUTOR, {
          finalidade: 'COBRANCA',
          descricao: null,
          cep: '74000000',
          logradouro: 'Rua Um',
          numero: '10',
          complemento: null,
          bairro: 'Centro',
          municipio: 'Goiânia',
          uf: 'GO',
        }),
      ),
    ).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
  });
});

describe('arquivamento e reativação (§3.5)', () => {
  it('exige justificativa para arquivar', async () => {
    const servico = criarServico();

    expect(await codigoDo(() => servico.arquivar(TENANT, EMPRESA, AUTOR, '   '))).toBe(
      CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA,
    );

    expect(estado.situacaoDefinida).toBeNull();
  });

  it('arquiva registrando autor e justificativa na aba de status', async () => {
    const servico = criarServico();

    await servico.arquivar(TENANT, EMPRESA, AUTOR, 'Encerrou as atividades.');

    expect(estado.situacaoDefinida).toBe('arquivado');
    expect(estado.eventos[0]).toMatchObject({
      aba: 'STATUS_DA_EMPRESA',
      acao: 'ARQUIVAMENTO',
      valorAnterior: 'ativo',
      valorNovo: 'arquivado',
      justificativa: 'Encerrou as atividades.',
      usuarioId: AUTOR.usuarioId,
    });
  });

  it('recusa reativar empresa que não está arquivada', async () => {
    const servico = criarServico();

    expect(
      await codigoDo(() => servico.reativar(TENANT, EMPRESA, AUTOR, 'Retomou.')),
    ).toBe(CODIGOS_DE_ERRO.EMPRESA_NAO_ARQUIVADA);
  });
});

describe('vigência de regime e CNAE (§3.2)', () => {
  const fiscaisComRegimeNovo = { ...dadosFiscais, regimeTributario: 'LUCRO_REAL' } as const;

  it('rejeita vigência futura sem gravar nem criar histórico', async () => {
    const servico = criarServico();
    const agora = new Date('2026-09-20T12:00:00Z');

    expect(
      await codigoDo(() =>
        servico.salvarFiscal(
          TENANT,
          EMPRESA,
          AUTOR,
          fiscaisComRegimeNovo,
          '2026-09-21',
          agora,
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.VIGENCIA_FUTURA);

    expect(estado.fiscaisSalvos).toBeNull();
    expect(estado.eventos).toEqual([]);
  });

  it('aceita vigência atual e a registra no evento', async () => {
    const servico = criarServico();

    await servico.salvarFiscal(
      TENANT,
      EMPRESA,
      AUTOR,
      fiscaisComRegimeNovo,
      '2026-09-20',
      new Date('2026-09-20T12:00:00Z'),
    );

    expect(estado.eventos[0]).toMatchObject({
      campo: 'regimeTributario',
      valorAnterior: 'SIMPLES_NACIONAL',
      valorNovo: 'LUCRO_REAL',
      vigencia: '2026-09-20',
      aba: 'DADOS_FISCAIS',
    });
  });

  it('não exige vigência quando regime e CNAE não mudam', async () => {
    const servico = criarServico();

    await expect(
      servico.salvarFiscal(
        TENANT,
        EMPRESA,
        AUTOR,
        { ...dadosFiscais, inscricaoMunicipal: { situacao: 'POSSUI', numero: '123' } },
        '',
        new Date('2026-09-20T12:00:00Z'),
      ),
    ).resolves.toBeDefined();
  });
});

describe('atualização pela CNPJá (§3.3)', () => {
  const dadosExternos = {
    razaoSocial: 'Alfa Comércio de Alimentos Ltda',
    nomeFantasia: 'Alfa',
    telefone: null,
    email: null,
    cnaePrincipal: '4711302',
    cnaesSecundarios: [] as readonly string[],
    situacaoCadastral: 'Ativa',
    optanteSimples: null,
    mei: null,
    endereco: {},
  };

  it('compara e devolve diferenças sem aplicar nada', async () => {
    const consultar = vi.fn().mockResolvedValue({ ok: true, dados: dadosExternos });
    const servico = criarServico(consultar);

    const comparacao = await servico.compararComAFonte(TENANT, EMPRESA);

    expect(comparacao.situacao).toBe('comparado');
    expect(comparacao.diferencas.map((item) => item.campo)).toEqual([
      'razaoSocial',
      'cnaePrincipal',
    ]);
    // O ponto desta prova: comparar não grava.
    expect(estado.identificacaoSalva).toBeNull();
    expect(estado.fiscaisSalvos).toBeNull();
    expect(estado.eventos).toEqual([]);
  });

  it('nunca oferece o CNPJ entre as diferenças', async () => {
    const consultar = vi.fn().mockResolvedValue({
      ok: true,
      dados: { ...dadosExternos, cnpj: '99888777000166' },
    });

    const comparacao = await criarServico(consultar).compararComAFonte(TENANT, EMPRESA);

    expect(comparacao.diferencas.some((item) => item.campo === 'cnpj')).toBe(false);
  });

  it('aplica somente os campos escolhidos pelo usuário', async () => {
    const consultar = vi.fn().mockResolvedValue({ ok: true, dados: dadosExternos });
    const servico = criarServico(consultar);

    await servico.aplicarDaFonte(TENANT, EMPRESA, AUTOR, ['razaoSocial']);

    expect(estado.identificacaoSalva).toMatchObject({
      razaoSocial: 'Alfa Comércio de Alimentos Ltda',
    });
    // `cnaePrincipal` estava entre as diferenças e não foi escolhido.
    expect(estado.fiscaisSalvos).toBeNull();
    expect(estado.eventos).toHaveLength(1);
    expect(estado.eventos[0]).toMatchObject({ campo: 'razaoSocial' });
  });

  it('ignora campo que não está entre as diferenças comparáveis', async () => {
    const consultar = vi.fn().mockResolvedValue({ ok: true, dados: dadosExternos });
    const servico = criarServico(consultar);

    await servico.aplicarDaFonte(TENANT, EMPRESA, AUTOR, ['cnpj', 'inventado']);

    expect(estado.identificacaoSalva).toBeNull();
    expect(estado.eventos).toEqual([]);
  });

  it('situação externa diferente de Ativa apenas alerta', async () => {
    const consultar = vi.fn().mockResolvedValue({
      ok: true,
      dados: { ...dadosExternos, situacaoCadastral: 'Baixada' },
    });

    const comparacao = await criarServico(consultar).compararComAFonte(TENANT, EMPRESA);

    expect(comparacao.alertaDeSituacaoExterna).toBe(true);
    // Alerta não arquiva nem bloqueia: a empresa segue editável.
    expect(estado.situacaoDefinida).toBeNull();
  });

  it('falha externa preserva os dados e não bloqueia a edição manual', async () => {
    const consultar = vi.fn().mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    const comparacao = await criarServico(consultar).compararComAFonte(TENANT, EMPRESA);

    expect(comparacao.situacao).toBe('sem_fonte');
    expect(comparacao.motivo).toBe('indisponivel');
    expect(comparacao.diferencas).toEqual([]);
    expect(estado.identificacaoSalva).toBeNull();
  });

  it('informa quando os dados já estão atualizados', async () => {
    const consultar = vi.fn().mockResolvedValue({
      ok: true,
      dados: {
        ...dadosExternos,
        razaoSocial: identificacao.razaoSocial,
        cnaePrincipal: dadosFiscais.cnaePrincipal,
      },
    });

    const comparacao = await criarServico(consultar).compararComAFonte(TENANT, EMPRESA);

    expect(comparacao.situacao).toBe('sem_diferencas');
    expect(comparacao.diferencas).toEqual([]);
  });
});

describe('endereços (§3.4)', () => {
  it('recusa finalidade já ocupada por endereço ativo', async () => {
    estado.enderecos = [{ id: 'a', finalidade: 'COBRANCA' }];
    const servico = criarServico();

    expect(
      await codigoDo(() =>
        servico.criarEndereco(TENANT, EMPRESA, AUTOR, {
          finalidade: 'COBRANCA',
          descricao: null,
          cep: '74000000',
          logradouro: 'Rua Um',
          numero: '10',
          complemento: null,
          bairro: 'Centro',
          municipio: 'Goiânia',
          uf: 'GO',
        }),
      ),
    ).toBe(CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA);
  });

  it('recusa arquivar o endereço Fiscal sem substituto', async () => {
    estado.enderecoCarregado = {
      id: 'a',
      finalidade: 'FISCAL',
      descricao: null,
      cep: '74000000',
      logradouro: 'Rua Um',
      numero: '10',
      complemento: null,
      bairro: 'Centro',
      municipio: 'Goiânia',
      uf: 'GO',
    };

    expect(
      await codigoDo(() =>
        criarServico().arquivarEndereco(TENANT, EMPRESA, 'a', AUTOR),
      ),
    ).toBe(CODIGOS_DE_ERRO.ENDERECO_FISCAL_OBRIGATORIO);
  });
});
