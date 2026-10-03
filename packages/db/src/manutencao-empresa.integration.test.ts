/**
 * Manutenção da empresa cliente (SPEC-003 §9, categoria Banco).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 *
 * O que estas provas defendem, em ordem de gravidade: o histórico de um
 * escritório não vaza para o outro; o histórico é append-only no banco, não só
 * na interface; alteração e evento são atômicos; endereço e empresa são
 * arquivados, nunca apagados; e a finalidade do endereço é única por empresa.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import {
  carregarEmpresa,
  criarEmpresa,
  salvarIdentificacaoDaEmpresa,
} from './repositorios/empresa.js';
import {
  aplicarTrocaDeFinalidade,
  arquivarEndereco,
  atualizarEndereco,
  carregarEndereco,
  camposComHistorico,
  definirSituacaoDaEmpresa,
  inserirEndereco,
  listarEnderecosDaEmpresa,
  listarHistorico,
  registrarEventos,
  situacaoDaEmpresa,
} from './repositorios/manutencao-empresa.js';

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
let usuarioA = '';
let usuarioB = '';

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

/**
 * As suítes de banco rodam em paralelo sobre o mesmo PostgreSQL e limpam por
 * CNPJ: repetir um CNPJ de outra suíte faz um `limpar()` apagar a fixture da
 * outra no meio da execução — foi o que aconteceu com a `escritorio.rls`.
 * Em vez de escolher mais números mágicos e torcer, cada execução gera os seus
 * a partir de um sufixo único e limpa exclusivamente pelas próprias razões
 * sociais, que carregam o mesmo sufixo.
 */
const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const CNPJ_ESCRITORIO_A = `91${SUFIXO}000151`;
const CNPJ_ESCRITORIO_B = `92${SUFIXO}000152`;
const CNPJ_EMPRESA = `93${SUFIXO}000153`;

const RAZOES = [
  `Escritório Manutenção A ${SUFIXO}`,
  `Escritório Manutenção B ${SUFIXO}`,
];

const endereco = (
  finalidade: 'FISCAL' | 'COBRANCA' | 'CORRESPONDENCIA' | 'OUTRO',
  descricao: string | null = null,
) =>
  ({
    finalidade,
    descricao,
    cep: '74000000',
    logradouro: 'Rua Um',
    numero: '10',
    complemento: null,
    bairro: 'Centro',
    municipio: 'Goiânia',
    uf: 'GO',
  }) as const;

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    // Só pelas razões sociais desta execução: filtrar também por CNPJ
    // alcançaria tenant de outra suíte se algum dia houvesse coincidência.
    `select id from app.tenant where razao_social = any($1)`,
    [RAZOES],
  );

  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // A trigger append-only recusa DELETE até para o dono da tabela — é o
  // comportamento que as provas acima exigem. Limpar fixture é a única exceção
  // legítima, e ela desliga a trigger explicitamente em vez de enfraquecê-la.
  await poolAdmin.query(
    'alter table app.empresa_evento_de_historico disable trigger empresa_evento_de_historico_append_only',
  );

  try {
    await poolAdmin.query(
      'delete from app.empresa_evento_de_historico where tenant_id = any($1)',
      [ids],
    );
  } finally {
    await poolAdmin.query(
      'alter table app.empresa_evento_de_historico enable trigger empresa_evento_de_historico_append_only',
    );
  }
  await poolAdmin.query('delete from app.empresa_endereco where tenant_id = any($1)', [ids]);
  await poolAdmin.query(
    'delete from app.empresa_cnae_secundario where tenant_id = any($1)',
    [ids],
  );
  await poolAdmin.query('delete from app.empresa where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.usuario where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [ids]);
};

beforeAll(async () => {
  await limpar();

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, $3, 'ATIVO'), ($2, $4, 'ATIVO')
     returning id`,
    [CNPJ_ESCRITORIO_A, CNPJ_ESCRITORIO_B, RAZOES[0], RAZOES[1]],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  const usuarios = await poolAdmin.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $3, 'a@local', 'Admin A', 'ATIVO'),
            ($2, $4, 'b@local', 'Admin B', 'ATIVO')
     returning id`,
    [tenantA, tenantB, `sub-manutencao-a-${SUFIXO}`, `sub-manutencao-b-${SUFIXO}`],
  );

  usuarioA = usuarios.rows[0]?.id ?? '';
  usuarioB = usuarios.rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolApp.end();
  await limpar();
  await poolAdmin.end();
});

const criarEmpresaAtiva = async (
  tenantId: string,
  cnpj: string = CNPJ_EMPRESA,
): Promise<string> =>
  comTenant(tenantId, async (cliente) => {
    const empresaId = await criarEmpresa(cliente, tenantId, cnpj);

    await cliente.query(
      `update app.empresa set status = 'ATIVA', razao_social = 'Empresa Manutenção'
        where tenant_id = $1 and id = $2`,
      [tenantId, empresaId],
    );

    return empresaId;
  });

const evento = (empresaId: string, usuarioId: string, campo = 'razaoSocial') =>
  ({
    empresaId,
    aba: 'DADOS_CADASTRAIS',
    acao: 'ALTERACAO',
    campo,
    valorAnterior: 'Antes',
    valorNovo: 'Depois',
    vigencia: null,
    justificativa: null,
    usuarioId,
  }) as const;

const filtroVazio = {
  aba: null,
  empresaId: null,
  inicio: null,
  fim: null,
  usuarioId: null,
  campo: null,
  limite: 50,
  deslocamento: 0,
} as const;

describe('isolamento do histórico (I-1, I-2)', () => {
  it('não devolve evento de outro escritório', async () => {
    const empresaA = await criarEmpresaAtiva(tenantA, '06990590000123');
    const empresaB = await criarEmpresaAtiva(tenantB, '06990590000123');

    await comTenant(tenantA, (cliente) =>
      registrarEventos(cliente, tenantA, [evento(empresaA, usuarioA, 'soDoTenantA')]),
    );
    await comTenant(tenantB, (cliente) =>
      registrarEventos(cliente, tenantB, [evento(empresaB, usuarioB, 'soDoTenantB')]),
    );

    const doA = await comTenant(tenantA, (cliente) =>
      listarHistorico(cliente, tenantA, filtroVazio),
    );

    expect(doA.eventos.map((item) => item.campo)).toContain('soDoTenantA');
    expect(doA.eventos.map((item) => item.campo)).not.toContain('soDoTenantB');
  });

  it('sem contexto de tenant não retorna histórico', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '07526557000100');

    await comTenant(tenantA, (cliente) =>
      registrarEventos(cliente, tenantA, [evento(empresaId, usuarioA, 'invisivel')]),
    );

    const semContextoDeTenant = await comTenant(null, (cliente) =>
      listarHistorico(cliente, tenantA, filtroVazio),
    );

    expect(semContextoDeTenant.eventos).toEqual([]);
    expect(semContextoDeTenant.total).toBe(0);
  });
});

describe('histórico append-only (I-6)', () => {
  it('recusa UPDATE em evento já gravado', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '08561701000101');

    await comTenant(tenantA, (cliente) =>
      registrarEventos(cliente, tenantA, [evento(empresaId, usuarioA, 'imutavel')]),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `update app.empresa_evento_de_historico set valor_novo = 'adulterado'
            where tenant_id = $1 and campo = 'imutavel'`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow();
  });

  it('recusa DELETE em evento já gravado', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '10573521000191');

    await comTenant(tenantA, (cliente) =>
      registrarEventos(cliente, tenantA, [evento(empresaId, usuarioA, 'indelevel')]),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `delete from app.empresa_evento_de_historico
            where tenant_id = $1 and campo = 'indelevel'`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('atomicidade entre alteração e evento (§4.2)', () => {
  it('falha ao registrar auditoria desfaz a alteração principal', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '11395486000144');

    await expect(
      comTenant(tenantA, async (cliente) => {
        await cliente.query(
          `update app.empresa set razao_social = 'Alterada na transação'
            where tenant_id = $1 and id = $2`,
          [tenantA, empresaId],
        );

        // Usuário inexistente viola a FK e derruba a transação inteira: é o
        // mesmo caminho de uma falha real ao gravar o evento.
        await registrarEventos(cliente, tenantA, [
          {
            ...evento(empresaId, usuarioA),
            usuarioId: '00000000-0000-7000-8000-000000000000',
          },
        ]);
      }),
    ).rejects.toThrow();

    const { rows } = await poolAdmin.query<{ razao_social: string | null }>(
      `select razao_social from app.empresa where id = $1`,
      [empresaId],
    );

    expect(rows[0]?.razao_social).toBe('Empresa Manutenção');
  });
});

describe('endereços com finalidade (§3.4)', () => {
  it('recusa finalidade repetida entre endereços ativos', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '13347016000117');

    await comTenant(tenantA, (cliente) =>
      inserirEndereco(cliente, tenantA, empresaId, endereco('COBRANCA')),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        inserirEndereco(cliente, tenantA, empresaId, endereco('COBRANCA')),
      ),
    ).rejects.toThrow();
  });

  it('recusa endereço OUTRO sem descrição', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '14572457000180');

    await expect(
      comTenant(tenantA, (cliente) =>
        inserirEndereco(cliente, tenantA, empresaId, endereco('OUTRO')),
      ),
    ).rejects.toThrow();
  });

  it('mantém o endereço Fiscal como o padrão e troca os dois na mesma transação', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '15139629000194');

    const fiscalId = await comTenant(tenantA, (cliente) =>
      inserirEndereco(cliente, tenantA, empresaId, endereco('FISCAL')),
    );
    const cobrancaId = await comTenant(tenantA, (cliente) =>
      inserirEndereco(cliente, tenantA, empresaId, endereco('COBRANCA')),
    );

    await comTenant(tenantA, (cliente) =>
      aplicarTrocaDeFinalidade(cliente, tenantA, empresaId, [
        { id: fiscalId, finalidade: 'COBRANCA', principal: false },
        { id: cobrancaId, finalidade: 'FISCAL', principal: true },
      ]),
    );

    const enderecos = await comTenant(tenantA, (cliente) =>
      listarEnderecosDaEmpresa(cliente, tenantA, empresaId),
    );

    const fiscal = enderecos.find((item) => item.finalidade === 'FISCAL');
    expect(fiscal?.id).toBe(cobrancaId);
    expect(fiscal?.principal).toBe(true);
    expect(enderecos.find((item) => item.id === fiscalId)?.finalidade).toBe('COBRANCA');
    // Exatamente um padrão, sempre (§3.4).
    expect(enderecos.filter((item) => item.principal)).toHaveLength(1);
  });

  it('arquiva o endereço em vez de apagar (I-7)', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '16404287000155');

    const enderecoId = await comTenant(tenantA, (cliente) =>
      inserirEndereco(cliente, tenantA, empresaId, endereco('CORRESPONDENCIA')),
    );

    await comTenant(tenantA, (cliente) =>
      arquivarEndereco(cliente, tenantA, empresaId, enderecoId),
    );

    const ativos = await comTenant(tenantA, (cliente) =>
      listarEnderecosDaEmpresa(cliente, tenantA, empresaId),
    );

    expect(ativos.some((item) => item.id === enderecoId)).toBe(false);

    const { rows } = await poolAdmin.query<{ situacao: string }>(
      `select situacao from app.empresa_endereco where id = $1`,
      [enderecoId],
    );

    expect(rows[0]?.situacao).toBe('arquivado');
  });

  it('libera a finalidade depois do arquivamento', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '17155730000164');

    const primeiro = await comTenant(tenantA, (cliente) =>
      inserirEndereco(cliente, tenantA, empresaId, endereco('COBRANCA')),
    );

    await comTenant(tenantA, (cliente) =>
      arquivarEndereco(cliente, tenantA, empresaId, primeiro),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        inserirEndereco(cliente, tenantA, empresaId, endereco('COBRANCA')),
      ),
    ).resolves.toEqual(expect.any(String));
  });
});

describe('arquivamento e reativação da empresa (§3.5)', () => {
  it('arquiva sem apagar e reativa preservando os dados', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '18236120000158');

    await comTenant(tenantA, (cliente) =>
      definirSituacaoDaEmpresa(cliente, tenantA, empresaId, 'arquivado'),
    );

    expect(
      await comTenant(tenantA, (cliente) =>
        situacaoDaEmpresa(cliente, tenantA, empresaId),
      ),
    ).toBe('arquivado');

    await comTenant(tenantA, (cliente) =>
      definirSituacaoDaEmpresa(cliente, tenantA, empresaId, 'ativo'),
    );

    const { rows } = await poolAdmin.query<{
      situacao: string;
      razao_social: string | null;
    }>(`select situacao, razao_social from app.empresa where id = $1`, [empresaId]);

    expect(rows[0]?.situacao).toBe('ativo');
    expect(rows[0]?.razao_social).toBe('Empresa Manutenção');
  });

  it('registra arquivamento e reativação na aba de status com justificativa', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '19255206000149');

    await comTenant(tenantA, (cliente) =>
      registrarEventos(cliente, tenantA, [
        {
          empresaId,
          aba: 'STATUS_DA_EMPRESA',
          acao: 'ARQUIVAMENTO',
          campo: 'situacao',
          valorAnterior: 'ativo',
          valorNovo: 'arquivado',
          vigencia: null,
          justificativa: 'Encerrou as atividades.',
          usuarioId: usuarioA,
        },
      ]),
    );

    const pagina = await comTenant(tenantA, (cliente) =>
      listarHistorico(cliente, tenantA, {
        ...filtroVazio,
        aba: 'STATUS_DA_EMPRESA',
        empresaId,
      }),
    );

    expect(pagina.eventos).toHaveLength(1);
    expect(pagina.eventos[0]?.justificativa).toBe('Encerrou as atividades.');
    expect(pagina.eventos[0]?.usuarioNome).toBe('Admin A');
  });
});

describe('consulta do histórico (§3.6)', () => {
  it('abre do evento mais recente para o mais antigo e filtra por campo', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '20147617000160');

    await comTenant(tenantA, async (cliente) => {
      await registrarEventos(cliente, tenantA, [
        { ...evento(empresaId, usuarioA, 'primeiroCampo'), valorNovo: 'um' },
      ]);
      await registrarEventos(cliente, tenantA, [
        { ...evento(empresaId, usuarioA, 'segundoCampo'), valorNovo: 'dois' },
      ]);
    });

    const todos = await comTenant(tenantA, (cliente) =>
      listarHistorico(cliente, tenantA, { ...filtroVazio, empresaId }),
    );

    expect(todos.eventos[0]?.campo).toBe('segundoCampo');
    expect(todos.eventos[1]?.campo).toBe('primeiroCampo');

    const filtrado = await comTenant(tenantA, (cliente) =>
      listarHistorico(cliente, tenantA, {
        ...filtroVazio,
        empresaId,
        campo: 'primeiroCampo',
      }),
    );

    expect(filtrado.total).toBe(1);
    expect(filtrado.eventos[0]?.campo).toBe('primeiroCampo');
  });

  it('oferece os campos já usados para alimentar o filtro', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '21255773000177');

    await comTenant(tenantA, (cliente) =>
      registrarEventos(cliente, tenantA, [evento(empresaId, usuarioA, 'campoParaFiltro')]),
    );

    const campos = await comTenant(tenantA, (cliente) =>
      camposComHistorico(cliente, tenantA, 'DADOS_CADASTRAIS'),
    );

    expect(campos).toContain('campoParaFiltro');
  });
});

describe('concorrência de edição (§5 e §7)', () => {
  const identificacao = {
    cnpj: CNPJ_EMPRESA,
    razaoSocial: 'Empresa Manutenção',
    nomeFantasia: null,
    logoArquivoId: null,
    telefone: null,
    email: null,
  } as const;

  const procedencia = { situacaoCadastralExterna: null, validado: false } as const;

  it('recusa a segunda escrita quando a versão já avançou', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '22333444000195');

    // A versão de partida é lida, não suposta: a fixture faz um UPDATE próprio
    // ao ativar a empresa, então ela não começa necessariamente em 1.
    const carregada = await comTenant(tenantA, (cliente) =>
      carregarEmpresa(cliente, tenantA, empresaId),
    );

    const versaoLida = carregada?.cadastro.versao ?? 0;

    // Ambos leem a mesma versão; o primeiro grava e ela avança.
    const primeiro = await comTenant(tenantA, (cliente) =>
      salvarIdentificacaoDaEmpresa(
        cliente,
        tenantA,
        empresaId,
        { ...identificacao, razaoSocial: 'Primeiro a salvar' },
        procedencia,
        versaoLida,
      ),
    );

    expect(primeiro).toBe(true);

    // O segundo ainda acha que está na versão anterior: precisa ser recusado, e
    // não sobrescrever em silêncio o que o primeiro gravou.
    const segundo = await comTenant(tenantA, (cliente) =>
      salvarIdentificacaoDaEmpresa(
        cliente,
        tenantA,
        empresaId,
        { ...identificacao, razaoSocial: 'Segundo a salvar' },
        procedencia,
        versaoLida,
      ),
    );

    expect(segundo).toBe(false);

    const { rows } = await poolAdmin.query<{ razao_social: string }>(
      'select razao_social from app.empresa where id = $1',
      [empresaId],
    );

    expect(rows[0]?.razao_social).toBe('Primeiro a salvar');
  });

  it('recusa a edição de endereço com versão desatualizada', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '23456789000199');

    const enderecoId = await comTenant(tenantA, (cliente) =>
      inserirEndereco(cliente, tenantA, empresaId, endereco('COBRANCA')),
    );

    const atual = await comTenant(tenantA, (cliente) =>
      carregarEndereco(cliente, tenantA, empresaId, enderecoId),
    );

    const versaoLida = atual?.versao ?? 0;

    const primeiro = await comTenant(tenantA, (cliente) =>
      atualizarEndereco(
        cliente,
        tenantA,
        empresaId,
        enderecoId,
        { ...endereco('COBRANCA'), numero: '111' },
        versaoLida,
      ),
    );

    expect(primeiro).toBe(true);

    const segundo = await comTenant(tenantA, (cliente) =>
      atualizarEndereco(
        cliente,
        tenantA,
        empresaId,
        enderecoId,
        { ...endereco('COBRANCA'), numero: '222' },
        versaoLida,
      ),
    );

    expect(segundo).toBe(false);

    const depois = await comTenant(tenantA, (cliente) =>
      carregarEndereco(cliente, tenantA, empresaId, enderecoId),
    );

    expect(depois?.numero).toBe('111');
  });

  it('o wizard da SPEC-002 continua salvando sem versão', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, '24680135000104');

    // Sem `versaoEsperada` não há compare-and-swap: é o caminho do cadastro em
    // formação, onde não existem dois editores simultâneos.
    const gravou = await comTenant(tenantA, (cliente) =>
      salvarIdentificacaoDaEmpresa(
        cliente,
        tenantA,
        empresaId,
        { ...identificacao, razaoSocial: 'Sem versão' },
        procedencia,
      ),
    );

    expect(gravou).toBe(true);
  });
});
