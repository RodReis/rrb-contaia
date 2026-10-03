/**
 * Central de Pendências cadastrais (SPEC-005).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 *
 * O que estas provas defendem, em ordem de gravidade: pendências de um
 * escritório não vazam para o outro; a reconciliação não duplica pendência
 * aberta da mesma causa e resolve a que sumiu; a dispensa grava justificativa
 * no evento; e a Central ordena vencidas antes das demais.
 */
import { reconciliarPendencias } from '@contaia/domain';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import { criarEmpresa } from './repositorios/empresa.js';
import {
  contarAbertasPorEmpresa,
  dispensar,
  listarAbertasDaEmpresa,
  listarCentral,
  reconciliar,
} from './repositorios/pendencias.js';

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

// Mesmo motivo das suítes de F3/F4: as suítes de banco rodam em paralelo sobre
// o mesmo PostgreSQL, então cada execução gera os próprios CNPJs e limpa
// exclusivamente pelas próprias razões sociais.
const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const CNPJ_ESCRITORIO_A = `91${SUFIXO}000181`;
const CNPJ_ESCRITORIO_B = `92${SUFIXO}000182`;
const CNPJ_EMPRESA = `93${SUFIXO}000183`;

const RAZOES = [`Escritório Pendências A ${SUFIXO}`, `Escritório Pendências B ${SUFIXO}`];

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    `select id from app.tenant where razao_social = any($1)`,
    [RAZOES],
  );

  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // A trigger append-only recusa DELETE até para o dono da tabela — é
  // exatamente o comportamento que as provas abaixo exigem. Limpar fixture é a
  // única exceção legítima, e ela desliga a trigger explicitamente em vez de
  // enfraquecê-la.
  await poolAdmin.query(
    'alter table app.empresa_evento_de_pendencia disable trigger empresa_evento_de_pendencia_append_only',
  );

  try {
    await poolAdmin.query(
      'delete from app.empresa_evento_de_pendencia where tenant_id = any($1)',
      [ids],
    );
    await poolAdmin.query('delete from app.empresa_pendencia where tenant_id = any($1)', [ids]);
  } finally {
    await poolAdmin.query(
      'alter table app.empresa_evento_de_pendencia enable trigger empresa_evento_de_pendencia_append_only',
    );
  }

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
     values ($1, $3, 'pendencias-a@local', 'Admin Pendências A', 'ATIVO'),
            ($2, $4, 'pendencias-b@local', 'Admin Pendências B', 'ATIVO')
     returning id`,
    [tenantA, tenantB, `sub-pendencias-a-${SUFIXO}`, `sub-pendencias-b-${SUFIXO}`],
  );

  usuarioA = usuarios.rows[0]?.id ?? '';

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
      `update app.empresa set status = 'ATIVA', razao_social = 'Empresa Pendências'
        where tenant_id = $1 and id = $2`,
      [tenantId, empresaId],
    );

    return empresaId;
  });

const causaPadrao = (chave = 'campo:cnae') =>
  ({
    origem: 'CADASTRAL',
    tipo: 'CAMPO_AUSENTE',
    chave,
    dataLimite: null,
  }) as const;

describe('reconciliação (secao 2)', () => {
  it('insere causa nova e não duplica em chamada repetida', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `94${SUFIXO}000184`);
    const causa = causaPadrao();

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causa], [], null),
    );
    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causa], [], null),
    );

    const abertas = await comTenant(tenantA, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, null),
    );

    expect(abertas).toHaveLength(1);
  });

  it('resolve pendência cuja causa sumiu', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `95${SUFIXO}000185`);
    const causa = causaPadrao('campo:telefone');

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causa], [], null),
    );
    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [], [causa.chave], null),
    );

    const abertas = await comTenant(tenantA, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, null),
    );

    expect(abertas).toEqual([]);
  });

  it('reconciliar por origem só resolve a causa da própria origem (achado CRITICAL)', async () => {
    // Prova direta do bug corrigido: o hook cadastral (que só conhece causas
    // `campo:*`) não pode resolver, por engano, uma pendência DOCUMENTAL
    // aberta — e vice-versa. Sem o filtro de `origem`, `reconciliar([], ...)`
    // com a lista de abertas SEM filtro resolveria as duas.
    const empresaId = await criarEmpresaAtiva(tenantA, `65${SUFIXO}000195`);
    const causaCadastral = causaPadrao('campo:origem-mista');
    const causaDocumental = {
      origem: 'DOCUMENTAL',
      tipo: 'DOCUMENTO_AUSENTE',
      chave: 'exigencia:origem-mista',
      dataLimite: null,
    } as const;

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causaCadastral, causaDocumental], [], null),
    );

    // Simula "cadastro corrigido": reconcilia só a origem CADASTRAL com uma
    // lista de causas vazia — a DOCUMENTAL não deve ser tocada.
    const abertasCadastrais = await comTenant(tenantA, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, 'CADASTRAL'),
    );
    const { paraResolver } = reconciliarPendencias([], abertasCadastrais);

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [], paraResolver, null),
    );

    const abertas = await comTenant(tenantA, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, null),
    );

    expect(abertas.map((pendencia) => pendencia.chave)).toEqual(['exigencia:origem-mista']);
  });
});

describe('reconciliação — histórico e atomicidade (secao 2)', () => {
  it('grava evento de CRIACAO ao abrir e de RESOLUCAO ao fechar a mesma pendência', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `62${SUFIXO}000192`);
    const causa = causaPadrao('campo:historico');

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causa], [], usuarioA),
    );

    const abertaId = await comTenant(tenantA, async (cliente) => {
      const resultado = await cliente.query<{ id: string }>(
        `select id from app.empresa_pendencia where empresa_id = $1 and chave = $2`,
        [empresaId, causa.chave],
      );
      return resultado.rows[0]?.id ?? '';
    });
    expect(abertaId).not.toBe('');

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [], [causa.chave], usuarioA),
    );

    const eventos = await comTenant(tenantA, (cliente) =>
      cliente.query<{ acao: string }>(
        `select acao from app.empresa_evento_de_pendencia
         where pendencia_id = $1 order by sequencia asc`,
        [abertaId],
      ),
    );

    expect(eventos.rows.map((linha) => linha.acao)).toEqual(['CRIACAO', 'RESOLUCAO']);
  });

  it('não deixa pendência nem evento parcial quando a reconciliação falha no meio do lote', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `63${SUFIXO}000193`);
    const causaValida = causaPadrao('campo:atomicidade-valida');
    const causaInvalida = {
      origem: 'CADASTRAL',
      tipo: 'TIPO_QUE_NAO_EXISTE',
      chave: 'campo:atomicidade-invalida',
      dataLimite: null,
    } as const;

    await expect(
      comTenant(tenantA, (cliente) =>
        reconciliar(cliente, tenantA, empresaId, [causaValida, causaInvalida], [], null),
      ),
    ).rejects.toThrow();

    const abertas = await comTenant(tenantA, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, null),
    );
    expect(abertas).toEqual([]);

    const eventos = await comTenant(tenantA, (cliente) =>
      cliente.query<{ id: string }>(
        `select ev.id from app.empresa_evento_de_pendencia ev
         join app.empresa_pendencia p on p.id = ev.pendencia_id
         where p.empresa_id = $1`,
        [empresaId],
      ),
    );
    expect(eventos.rows).toEqual([]);
  });

  it('duas reconciliações concorrentes com a mesma causa não duplicam a pendência aberta', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `64${SUFIXO}000194`);
    const causa = causaPadrao('campo:concorrencia');

    const executarEmTransacaoPropria = async (): Promise<void> => {
      const cliente = await poolApp.connect();
      try {
        await cliente.query('begin');
        await cliente.query('select set_config($1, $2, true)', ['app.tenant_id', tenantA]);
        await reconciliar(cliente, tenantA, empresaId, [causa], [], null);
        await cliente.query('commit');
      } catch (erro) {
        await cliente.query('rollback');
        throw erro;
      } finally {
        cliente.release();
      }
    };

    await Promise.all([executarEmTransacaoPropria(), executarEmTransacaoPropria()]);

    const abertas = await comTenant(tenantA, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, null),
    );
    expect(abertas).toHaveLength(1);
  });
});

describe('isolamento por tenant', () => {
  it('não vaza pendências entre tenants', async () => {
    const empresaA = await criarEmpresaAtiva(tenantA, `96${SUFIXO}000186`);
    const empresaB = await criarEmpresaAtiva(tenantB, `97${SUFIXO}000187`);

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaA, [causaPadrao('campo:cnae-iso')], [], null),
    );

    const contagemPeloB = await comTenant(tenantB, (cliente) =>
      contarAbertasPorEmpresa(cliente, [empresaA, empresaB]),
    );

    expect(contagemPeloB.get(empresaA)).toBeUndefined();
  });

  it('sem contexto de tenant não retorna nada', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `98${SUFIXO}000188`);

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causaPadrao('campo:sem-contexto')], [], null),
    );

    const semContexto = await comTenant(null, (cliente) =>
      listarAbertasDaEmpresa(cliente, empresaId, null),
    );

    expect(semContexto).toEqual([]);
  });
});

describe('dispensa (secao 4)', () => {
  it('resolve pendência aberta e grava justificativa no evento', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `99${SUFIXO}000189`);
    const causa = causaPadrao('campo:dispensa');

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causa], [], null),
    );

    const pagina = await comTenant(tenantA, (cliente) =>
      listarCentral(
        cliente,
        {
          empresaId,
          origem: null,
          tipo: null,
          estado: 'ABERTA',
          vencimento: null,
          limite: 10,
          deslocamento: 0,
        },
        '2026-09-21',
      ),
    );

    const pendenciaId = pagina.pendencias[0]?.id ?? '';
    expect(pendenciaId).not.toBe('');

    const dispensada = await comTenant(tenantA, (cliente) =>
      dispensar(cliente, tenantA, empresaId, pendenciaId, usuarioA, 'Não se aplica a esta empresa.'),
    );

    expect(dispensada?.estado).toBe('RESOLVIDA');

    const evento = await comTenant(tenantA, (cliente) =>
      cliente.query<{ acao: string; justificativa: string | null }>(
        `select acao, justificativa from app.empresa_evento_de_pendencia
         where pendencia_id = $1 and acao = 'DISPENSA'`,
        [pendenciaId],
      ),
    );

    expect(evento.rows[0]?.acao).toBe('DISPENSA');
    expect(evento.rows[0]?.justificativa).toBe('Não se aplica a esta empresa.');
  });
});

describe('Central (secao 3)', () => {
  it('ordena vencidas antes das demais', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `61${SUFIXO}000191`);

    const causaSemPrazo = causaPadrao('campo:sem-prazo');
    const causaVencida = {
      origem: 'DOCUMENTAL',
      tipo: 'DOCUMENTO_VENCIDO',
      chave: 'exigencia:vencida',
      dataLimite: '2020-01-01',
    } as const;

    await comTenant(tenantA, (cliente) =>
      reconciliar(cliente, tenantA, empresaId, [causaSemPrazo, causaVencida], [], null),
    );

    const pagina = await comTenant(tenantA, (cliente) =>
      listarCentral(
        cliente,
        {
          empresaId,
          origem: null,
          tipo: null,
          estado: 'ABERTA',
          vencimento: null,
          limite: 10,
          deslocamento: 0,
        },
        '2026-09-21',
      ),
    );

    expect(pagina.pendencias[0]?.chave).toBe('exigencia:vencida');
  });
});
