/**
 * Isolamento e persistência da empresa cliente (SPEC-002 §10, categoria Banco).
 *
 * Roda com a role `contaia_app`, que não tem BYPASSRLS: é o caminho de
 * aplicação real, não o do superusuário do Compose.
 *
 * O que estas provas defendem, em ordem de gravidade: um escritório não
 * enxerga empresa do outro; o mesmo CNPJ pode existir em escritórios distintos
 * (§4.5); dentro de um escritório não pode duplicar; e a ativação é atômica e
 * idempotente.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import {
  carregarEmpresa,
  criarEmpresa,
  empresaComCnpj,
  listarEmpresas,
  marcarEmpresaComoAtiva,
  salvarDadosFiscais,
  salvarEnderecoDaEmpresa,
  salvarIdentificacaoDaEmpresa,
} from './repositorios/empresa.js';
import { criarUsuario } from './repositorios/usuarios.js';

const urlDaAplicacao = (): string => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

const poolAdmin = criarPool();
let poolApp: Pool;
let tenantA = '';
let tenantB = '';

const comTenant = async <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => {
  const cliente = await poolApp.connect();

  try {
    await cliente.query('begin');

    if (tenantId !== null) {
      await cliente.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    }

    const resultado = await executar(cliente);
    await cliente.query('commit');

    return resultado;
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

/** CNPJs exclusivos desta suíte, para não colidir com dado de outra origem. */
const CNPJ_ESCRITORIO_A = '34238864000168';
const CNPJ_ESCRITORIO_B = '42591651000143';
/** O CNPJ da empresa cliente é o mesmo nos dois escritórios, de propósito. */
const CNPJ_EMPRESA = '11222333000181';
const CNPJ_OUTRA_EMPRESA = '19131243000197';

const RAZOES = ['Escritório Empresa A', 'Escritório Empresa B'];

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    `select id from app.tenant where cnpj = any($1) or razao_social = any($2)`,
    [[CNPJ_ESCRITORIO_A, CNPJ_ESCRITORIO_B], RAZOES],
  );

  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // Vínculo de carteira e usuário de fixture precisam sair antes da empresa (FK composta).
  await poolAdmin.query('delete from app.carteira_vinculo where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.usuario where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.empresa_endereco where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.empresa_cnae_secundario where tenant_id = any($1)', [
    ids,
  ]);
  await poolAdmin.query('delete from app.empresa where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [ids]);
};

beforeAll(async () => {
  // Resíduo de execução anterior faria o INSERT violar unicidade e a suíte
  // inteira seria pulada sem falha explícita.
  await limpar();

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, $3, 'ATIVO'), ($2, $4, 'ATIVO')
     returning id`,
    [CNPJ_ESCRITORIO_A, CNPJ_ESCRITORIO_B, RAZOES[0], RAZOES[1]],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolApp.end();
  await limpar();
  await poolAdmin.end();
});

const identificacaoCompleta = {
  cnpj: CNPJ_EMPRESA,
  razaoSocial: 'Padaria Aurora Comércio de Alimentos LTDA',
  nomeFantasia: 'Padaria Aurora',
  logoArquivoId: null,
  telefone: '1133224455',
  email: 'contato@padariaaurora.com.br',
} as const;

const fiscaisCompletos = {
  regimeTributario: 'SIMPLES_NACIONAL',
  enquadramentoSimples: 'NAO_MEI',
  cnaePrincipal: '1091102',
  cnaesSecundarios: ['4721102', '4729699'],
  inscricaoEstadual: { situacao: 'POSSUI', numero: '123456789' },
  inscricaoMunicipal: { situacao: 'ISENTO', numero: null },
} as const;

const enderecoCompleto = {
  cep: '01310100',
  logradouro: 'Avenida Paulista',
  numero: '1000',
  complemento: 'Conjunto 101',
  bairro: 'Bela Vista',
  municipio: 'São Paulo',
  uf: 'SP',
} as const;

describe('isolamento entre escritórios (invariantes I-2 e §4.5)', () => {
  it('sem contexto de tenant não retorna nada', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, CNPJ_OUTRA_EMPRESA),
    );

    const linhas = await comTenant(null, async (cliente) => {
      const { rows } = await cliente.query('select id from app.empresa');

      return rows;
    });

    expect(linhas).toEqual([]);

    // O próprio tenant enxerga o que criou — o vazio acima é da RLS, não de
    // um insert que silenciosamente falhou.
    const visivel = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(visivel?.id).toBe(empresaId);
  });

  it('o escritório B não carrega, não lista nem descobre a empresa do A', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, CNPJ_EMPRESA),
    );

    // Carregar com o id em mãos não revela nada: nem "existe e é de outro".
    const carregada = await comTenant(tenantB, async (cliente) =>
      carregarEmpresa(cliente, tenantB, empresaId),
    );

    expect(carregada).toBeNull();

    const lista = await comTenant(tenantB, async (cliente) =>
      listarEmpresas(cliente, tenantB, {
        // O que se prova aqui é o isolamento de tenant, não a carteira: qualquer id serve.
        carteiraDoUsuarioId: '00000000-0000-7000-8000-000000000000',
        veArquivadasDoTenant: false,
        busca: null,
        status: null,
        limite: 50,
        deslocamento: 0,
      }),
    );

    expect(lista.empresas.map((empresa) => empresa.id)).not.toContain(empresaId);
  });

  it('o mesmo CNPJ pode existir em escritórios distintos, sem vazamento', async () => {
    const noB = await comTenant(tenantB, async (cliente) =>
      criarEmpresa(cliente, tenantB, CNPJ_EMPRESA),
    );

    const doB = await comTenant(tenantB, async (cliente) =>
      carregarEmpresa(cliente, tenantB, noB),
    );

    expect(doB?.cadastro.identificacao?.cnpj).toBe(CNPJ_EMPRESA);

    // Cada escritório vê exatamente uma empresa com aquele CNPJ: a sua.
    const doAOutro = await comTenant(tenantA, async (cliente) =>
      empresaComCnpj(cliente, tenantA, CNPJ_EMPRESA),
    );
    const doBProprio = await comTenant(tenantB, async (cliente) =>
      empresaComCnpj(cliente, tenantB, CNPJ_EMPRESA),
    );

    expect(doAOutro?.id).not.toBe(doBProprio?.id);
  });

  it('não permite duas empresas com o mesmo CNPJ dentro do mesmo escritório', async () => {
    await expect(
      comTenant(tenantA, async (cliente) => criarEmpresa(cliente, tenantA, CNPJ_EMPRESA)),
    ).rejects.toThrow(/empresa_cnpj_por_tenant_idx|duplicate key/u);
  });

  it('escrita com tenant divergente do contexto é barrada pela política', async () => {
    await expect(
      comTenant(tenantB, async (cliente) =>
        // Tenta gravar linha do A estando no contexto do B.
        cliente.query(`insert into app.empresa (tenant_id, cnpj) values ($1, $2)`, [
          tenantA,
          '27865757000102',
        ]),
      ),
    ).rejects.toThrow(/row-level security|violates/u);
  });
});

describe('persistência por etapa e retomada', () => {
  it('salva cada etapa e recompõe o cadastro completo', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '27865757000102'),
    );

    await comTenant(tenantA, async (cliente) => {
      await salvarIdentificacaoDaEmpresa(
        cliente,
        tenantA,
        empresaId,
        { ...identificacaoCompleta, cnpj: '27865757000102' },
        { situacaoCadastralExterna: 'Ativa', validado: true },
      );
      await salvarDadosFiscais(cliente, tenantA, empresaId, fiscaisCompletos);
      await salvarEnderecoDaEmpresa(cliente, tenantA, empresaId, enderecoCompleto);
    });

    const persistida = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(persistida?.cadastro.identificacao?.nomeFantasia).toBe('Padaria Aurora');
    expect(persistida?.cadastro.dadosFiscais?.regimeTributario).toBe('SIMPLES_NACIONAL');
    expect(persistida?.cadastro.dadosFiscais?.cnaesSecundarios).toEqual([
      '4721102',
      '4729699',
    ]);
    expect(persistida?.cadastro.enderecoPrincipal?.municipio).toBe('São Paulo');
    expect(persistida?.cadastro.situacaoCadastralExterna).toBe('Ativa');
    expect(persistida?.cadastro.validadoPorFonteExterna).toBe(true);
    expect(persistida?.cadastro.status).toBe('CADASTRO_INCOMPLETO');
  });

  it('empresa recém-criada tem dados fiscais nulos, para o wizard abrir na etapa certa', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '42591651000143'),
    );

    const nova = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(nova?.cadastro.dadosFiscais).toBeNull();
    expect(nova?.cadastro.enderecoPrincipal).toBeNull();
  });

  it('regravar o endereço substitui o principal em vez de criar um segundo', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '05570714000159'),
    );

    await comTenant(tenantA, async (cliente) => {
      await salvarEnderecoDaEmpresa(cliente, tenantA, empresaId, enderecoCompleto);
      await salvarEnderecoDaEmpresa(cliente, tenantA, empresaId, {
        ...enderecoCompleto,
        municipio: 'Campinas',
        cep: '13010000',
      });
    });

    const { rows } = await poolAdmin.query<{ total: string }>(
      `select count(*)::text as total from app.empresa_endereco
        where empresa_id = $1 and principal and situacao = 'ativo'`,
      [empresaId],
    );

    expect(rows[0]?.total).toBe('1');

    const atual = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(atual?.cadastro.enderecoPrincipal?.municipio).toBe('Campinas');
  });

  it('substituir CNAEs secundários arquiva os anteriores, sem exclusão física', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '07526557000100'),
    );

    await comTenant(tenantA, async (cliente) => {
      await salvarDadosFiscais(cliente, tenantA, empresaId, fiscaisCompletos);
      await salvarDadosFiscais(cliente, tenantA, empresaId, {
        ...fiscaisCompletos,
        cnaesSecundarios: ['5611201'],
      });
    });

    const atual = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(atual?.cadastro.dadosFiscais?.cnaesSecundarios).toEqual(['5611201']);

    // Trilha preservada: o que saiu foi arquivado, não apagado (I-7).
    const { rows } = await poolAdmin.query<{ total: string }>(
      `select count(*)::text as total from app.empresa_cnae_secundario
        where empresa_id = $1 and situacao = 'arquivado'`,
      [empresaId],
    );

    expect(Number(rows[0]?.total ?? '0')).toBeGreaterThan(0);
  });

  it('enquadramento e número de inscrição não são gravados quando não se aplicam', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '02558157000162'),
    );

    await comTenant(tenantA, async (cliente) =>
      salvarDadosFiscais(cliente, tenantA, empresaId, {
        ...fiscaisCompletos,
        regimeTributario: 'LUCRO_REAL',
        // O formulário mandou enquadramento fora do Simples e número com
        // situação ISENTO: o repositório precisa descartar os dois, senão o
        // CHECK do banco recusa a linha inteira.
        enquadramentoSimples: 'MEI',
        inscricaoEstadual: { situacao: 'ISENTO', numero: '999' },
      }),
    );

    const atual = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(atual?.cadastro.dadosFiscais?.enquadramentoSimples).toBeNull();
    expect(atual?.cadastro.dadosFiscais?.inscricaoEstadual.numero).toBeNull();
  });
});

describe('ativação', () => {
  it('leva a empresa para ATIVA e é idempotente na repetição', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '33014556000196'),
    );

    await comTenant(tenantA, async (cliente) =>
      marcarEmpresaComoAtiva(cliente, tenantA, empresaId),
    );

    const primeira = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(primeira?.cadastro.status).toBe('ATIVA');

    await comTenant(tenantA, async (cliente) =>
      marcarEmpresaComoAtiva(cliente, tenantA, empresaId),
    );

    const segunda = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    // Repetir não incrementa versão: a segunda chamada não teve efeito algum.
    expect(segunda?.cadastro.status).toBe('ATIVA');
    expect(segunda?.cadastro.versao).toBe(primeira?.cadastro.versao);
  });

  it('o escritório B não consegue ativar empresa do A', async () => {
    const empresaId = await comTenant(tenantA, async (cliente) =>
      criarEmpresa(cliente, tenantA, '60746948000112'),
    );

    await comTenant(tenantB, async (cliente) =>
      marcarEmpresaComoAtiva(cliente, tenantB, empresaId),
    );

    const intacta = await comTenant(tenantA, async (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    expect(intacta?.cadastro.status).toBe('CADASTRO_INCOMPLETO');
  });
});

describe('listagem, busca e filtros', () => {
  // A listagem só devolve o que a carteira de quem pergunta alcança (SPEC-009): o listador
  // recebe vínculo com toda empresa ativa do escritório A que as provas anteriores criaram.
  let listadorA = '';

  beforeAll(async () => {
    listadorA = await comTenant(tenantA, async (cliente) =>
      criarUsuario(cliente, tenantA, {
        subOidc: 'sub-listador-empresa-a',
        email: 'listador.empresa.a@empresa.local',
        nome: 'Listador A',
        telefone: null,
        crc: null,
      }),
    );

    await poolAdmin.query(
      `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id)
       select tenant_id, $1, id from app.empresa
        where tenant_id = $2 and situacao = 'ativo'`,
      [listadorA, tenantA],
    );
  });

  it('filtra por status e conta o total do universo', async () => {
    const lista = await comTenant(tenantA, async (cliente) =>
      listarEmpresas(cliente, tenantA, {
        carteiraDoUsuarioId: listadorA,
        veArquivadasDoTenant: false,
        busca: null,
        status: 'ATIVA',
        limite: 50,
        deslocamento: 0,
      }),
    );

    expect(lista.empresas.every((empresa) => empresa.status === 'ATIVA')).toBe(true);
    expect(lista.total).toBe(lista.empresas.length);
  });

  it('busca por nome fantasia, razão social e CNPJ', async () => {
    for (const busca of ['Aurora', 'Padaria Aurora Comércio', CNPJ_EMPRESA]) {
      const lista = await comTenant(tenantA, async (cliente) =>
        listarEmpresas(cliente, tenantA, {
          carteiraDoUsuarioId: listadorA,
          veArquivadasDoTenant: false,
          busca,
          status: null,
          limite: 50,
          deslocamento: 0,
        }),
      );

      expect(lista.empresas.length).toBeGreaterThan(0);
    }
  });

  it('trata curinga digitado pelo usuário como texto literal', async () => {
    const lista = await comTenant(tenantA, async (cliente) =>
      listarEmpresas(cliente, tenantA, {
        carteiraDoUsuarioId: listadorA,
        veArquivadasDoTenant: false,
        busca: '%',
        status: null,
        limite: 50,
        deslocamento: 0,
      }),
    );

    // Se `%` virasse curinga, a busca devolveria a base inteira do tenant.
    expect(lista.total).toBe(0);
  });

  it('pagina no servidor, preservando o total', async () => {
    const primeira = await comTenant(tenantA, async (cliente) =>
      listarEmpresas(cliente, tenantA, {
        carteiraDoUsuarioId: listadorA,
        veArquivadasDoTenant: false,
        busca: null,
        status: null,
        limite: 2,
        deslocamento: 0,
      }),
    );

    const segunda = await comTenant(tenantA, async (cliente) =>
      listarEmpresas(cliente, tenantA, {
        carteiraDoUsuarioId: listadorA,
        veArquivadasDoTenant: false,
        busca: null,
        status: null,
        limite: 2,
        deslocamento: 2,
      }),
    );

    expect(primeira.empresas.length).toBeLessThanOrEqual(2);
    expect(primeira.total).toBe(segunda.total);
    expect(primeira.total).toBeGreaterThan(2);

    const idsDaPrimeira = primeira.empresas.map((empresa) => empresa.id);
    expect(segunda.empresas.some((empresa) => idsDaPrimeira.includes(empresa.id))).toBe(false);
  });
});
