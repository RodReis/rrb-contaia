/**
 * Banco do plano de contas e da importação por CSV (SPEC-013 §3.6–§3.12, §4, §6.3, §9).
 *
 * Roda como `contaia_app` (sem BYPASSRLS) sobre o PostgreSQL real: RLS por tenant/empresa,
 * chave natural, FKs compostas, append-only, privilégios por coluna, versão otimista do plano,
 * staging com valor cru e a pendência "plano de contas incompleto". O semeador (superusuário)
 * só prepara o que a aplicação não pode gravar (ex.: conta já arquivada).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { contextoTecnico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto } from './contexto.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;

type Executar<T> = (cliente: PoolClient) => Promise<T>;

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

/** Humano do tenant A (padrão: o da carteira de A1). */
const como = <T>(usuarioId: string, executar: Executar<T>, tenantId: string = c.tenantA): Promise<T> =>
  comoUsuario(app, tenantId, usuarioId, executar);

/** Worker de validação da empresa (contexto técnico). */
const comoWorker = <T>(empresaId: string, executar: Executar<T>, tenantId: string = c.tenantA): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'workers-plano-contas',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId,
      empresaId,
      correlationId: 'teste-plano-contas',
    }),
    executar,
  );

const codigoPg = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();

    return 'nao_lancou';
  } catch (erro) {
    return (erro as { code?: string }).code ?? 'sem_codigo';
  }
};

const idDe = async (cliente: Pick<PoolClient, 'query'>, sql: string, parametros: unknown[]): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(sql, parametros);

  return rows[0]!.id;
};

const SQL_CONTA = `insert into app.conta_contabil (tenant_id, empresa_id, codigo, nome, tipo, natureza, conta_pai)
  values ($1, $2, $3, $4, 'sintetica', 'devedora', $5) returning id`;

const inserirConta = (
  cliente: Pick<PoolClient, 'query'>,
  empresaId: string,
  codigo: string,
  contaPai: string | null = null,
  tenantId: string = c.tenantA,
): Promise<string> => idDe(cliente, SQL_CONTA, [tenantId, empresaId, codigo, `Conta ${codigo}`, contaPai]);

const SQL_TENTATIVA = `insert into app.importacao_plano_contas
   (tenant_id, empresa_id, hash_arquivo, mapeamento, arquivo_nome, arquivo_tamanho, arquivo_chave,
    usuario_iniciador_id, correlation_id)
 values ($1, $2, $3, $4::jsonb, 'plano.csv', 120, $5, $6, 'teste-plano-contas')
 returning id`;

const MAPEAMENTO = { codigo: 'Codigo', nome: 'Nome', tipo: 'Tipo', natureza: 'Natureza', contaPai: 'Pai' };

const inserirTentativa = (
  cliente: Pick<PoolClient, 'query'>,
  empresaId: string,
  opcoes: Readonly<{ hash?: string; mapeamento?: object; tenantId?: string; usuarioId?: string }> = {},
): Promise<string> =>
  idDe(cliente, SQL_TENTATIVA, [
    opcoes.tenantId ?? c.tenantA,
    empresaId,
    opcoes.hash ?? hex64(),
    JSON.stringify(opcoes.mapeamento ?? MAPEAMENTO),
    `plano-contas/${randomUUID()}.csv`,
    opcoes.usuarioId ?? c.usuarios.naCarteira,
  ]);

const SQL_LINHA = `insert into app.importacao_plano_contas_linha
   (tenant_id, empresa_id, tentativa_id, numero_linha, codigo, nome, tipo, natureza, conta_pai, status, acao,
    codigo_de_erro, campo, mensagem)
 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
 returning id`;

type Linha = Readonly<{
  numero: number;
  codigo?: string | null;
  nome?: string | null;
  tipo?: string | null;
  natureza?: string | null;
  contaPai?: string | null;
  status?: 'VALIDA' | 'REJEITADA';
  acao?: 'INCLUIR' | 'ATUALIZAR' | null;
  codigoDeErro?: string | null;
  campo?: string | null;
}>;

const inserirLinha = (
  cliente: Pick<PoolClient, 'query'>,
  empresaId: string,
  tentativaId: string,
  linha: Linha,
  tenantId: string = c.tenantA,
): Promise<string> => {
  const valida = (linha.status ?? 'VALIDA') === 'VALIDA';

  return idDe(cliente, SQL_LINHA, [
    tenantId,
    empresaId,
    tentativaId,
    linha.numero,
    linha.codigo === undefined ? `C${linha.numero}` : linha.codigo,
    linha.nome === undefined ? `Conta ${linha.numero}` : linha.nome,
    linha.tipo === undefined ? 'sintetica' : linha.tipo,
    linha.natureza === undefined ? 'devedora' : linha.natureza,
    linha.contaPai ?? null,
    linha.status ?? 'VALIDA',
    linha.acao === undefined ? (valida ? 'INCLUIR' : null) : linha.acao,
    linha.codigoDeErro === undefined ? (valida ? null : 'VALOR_FORA_DO_DOMINIO') : linha.codigoDeErro,
    linha.campo ?? null,
    valida ? null : 'Valor fora do domínio.',
  ]);
};

const SQL_EVENTO = `insert into app.importacao_plano_contas_evento
   (tenant_id, empresa_id, tentativa_id, acao, estado_anterior, estado_novo, usuario_id, correlation_id)
 values ($1, $2, $3, 'CRIACAO', null, 'RECEBIDA', $4, 'teste-plano-contas')
 returning id`;

const inserirEvento = (
  cliente: Pick<PoolClient, 'query'>,
  empresaId: string,
  tentativaId: string,
  tenantId: string = c.tenantA,
): Promise<string> => idDe(cliente, SQL_EVENTO, [tenantId, empresaId, tentativaId, c.usuarios.naCarteira]);

const SQL_NOTIFICACAO = `insert into app.importacao_plano_contas_notificacao
   (tenant_id, empresa_id, tentativa_id, usuario_id)
 values ($1, $2, $3, $4)
 returning id`;

const inserirNotificacao = (
  cliente: Pick<PoolClient, 'query'>,
  empresaId: string,
  tentativaId: string,
  usuarioId: string = c.usuarios.naCarteira,
  tenantId: string = c.tenantA,
): Promise<string> => idDe(cliente, SQL_NOTIFICACAO, [tenantId, empresaId, tentativaId, usuarioId]);

const contar = async (cliente: PoolClient, tabela: string, id: string): Promise<number> => {
  const { rows } = await cliente.query<{ n: string }>(`select count(*)::text as n from app.${tabela} where id = $1`, [
    id,
  ]);

  return Number(rows[0]?.n);
};

/** Um conjunto completo de linhas do tenant A, empresa A1, gravado pela própria aplicação. */
type LinhasDeA1 = Readonly<{
  conta: string;
  tentativa: string;
  linha: string;
  evento: string;
  notificacao: string;
  versao: string;
}>;

let deA1: LinhasDeA1;

const TABELAS = [
  'conta_contabil',
  'importacao_plano_contas',
  'importacao_plano_contas_linha',
  'importacao_plano_contas_evento',
  'importacao_plano_contas_notificacao',
  'empresa_plano_versao',
] as const;

const idDaTabela = (tabela: (typeof TABELAS)[number]): string =>
  ({
    conta_contabil: deA1.conta,
    importacao_plano_contas: deA1.tentativa,
    importacao_plano_contas_linha: deA1.linha,
    importacao_plano_contas_evento: deA1.evento,
    importacao_plano_contas_notificacao: deA1.notificacao,
    empresa_plano_versao: deA1.versao,
  })[tabela];

beforeAll(async () => {
  c = await montarCenario(admin);
  deA1 = await como(c.usuarios.naCarteira, async (cli) => {
    const tentativa = await inserirTentativa(cli, c.empresaA1);
    const { rows } = await cli.query<{ id: string }>(
      `insert into app.empresa_plano_versao (tenant_id, empresa_id) values ($1, $2)
       on conflict do nothing returning id`,
      [c.tenantA, c.empresaA1],
    );

    return {
      conta: await inserirConta(cli, c.empresaA1, `1-${c.sufixo}`),
      tentativa,
      linha: await inserirLinha(cli, c.empresaA1, tentativa, { numero: 1 }),
      evento: await inserirEvento(cli, c.empresaA1, tentativa),
      notificacao: await inserirNotificacao(cli, c.empresaA1, tentativa),
      versao: rows[0]!.id,
    };
  });
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('conta contábil: chave natural por empresa (SPEC-013 §3.6)', () => {
  it('(a) código repetido na mesma empresa falha com 23505; em outra empresa é outra conta', async () => {
    const codigo = `dup-${c.sufixo}`;
    await como(c.usuarios.duasEmpresas, (cli) => inserirConta(cli, c.empresaA1, codigo));

    expect(await codigoPg(() => como(c.usuarios.duasEmpresas, (cli) => inserirConta(cli, c.empresaA1, codigo)))).toBe(
      '23505',
    );
    expect(await codigoPg(() => como(c.usuarios.duasEmpresas, (cli) => inserirConta(cli, c.empresaA2, codigo)))).toBe(
      'nao_lancou',
    );
  });

  it('a conta-pai precisa existir na mesma empresa (checada no fim da transação)', async () => {
    const pai = `pai-${c.sufixo}`;
    // Filha antes do pai, na mesma transação: a ordem física das linhas não define a hierarquia.
    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, async (cli) => {
          await inserirConta(cli, c.empresaA1, `filha-${c.sufixo}`, pai);
          await inserirConta(cli, c.empresaA1, pai);
        }),
      ),
    ).toBe('nao_lancou');

    await como(c.usuarios.fora, (cli) => inserirConta(cli, c.empresaA2, `pai-a2-${c.sufixo}`));
    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) => inserirConta(cli, c.empresaA1, `orfa-${c.sufixo}`, `pai-a2-${c.sufixo}`)),
      ),
    ).toBe('23503');
  });

  it('(e) mudar o código é negado à aplicação e recusado pela trigger mesmo ao superusuário', async () => {
    const id = await como(c.usuarios.naCarteira, (cli) => inserirConta(cli, c.empresaA1, `imut-${c.sufixo}`));

    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) => cli.query(`update app.conta_contabil set codigo = 'x' where id = $1`, [id])),
      ),
    ).toBe('42501');
    expect(await codigoPg(() => admin.query(`update app.conta_contabil set codigo = 'x' where id = $1`, [id]))).toBe(
      '23001',
    );
  });

  it('(e) conta arquivada não é reativada nem atualizada', async () => {
    const id = await inserirConta(admin, c.empresaA1, `arq-${c.sufixo}`);
    await admin.query(`update app.conta_contabil set arquivada = true, arquivada_em = now() where id = $1`, [id]);

    const atualizar = (definicao: string) =>
      codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) => cli.query(`update app.conta_contabil set ${definicao} where id = $1`, [id])),
      );

    expect(await atualizar(`arquivada = false, arquivada_em = null`)).toBe('23001');
    expect(await atualizar(`nome = 'Outro nome'`)).toBe('23001');
  });

  it('defeito 6: a aplicação atualiza nome, tipo, natureza, pai e atualizado_em; a versão da conta sobe', async () => {
    const id = await como(c.usuarios.naCarteira, (cli) => inserirConta(cli, c.empresaA1, `upd-${c.sufixo}`));
    const { rows } = await como(c.usuarios.naCarteira, (cli) =>
      cli.query<{ versao: string }>(
        `update app.conta_contabil
            set nome = 'Novo', tipo = 'analitica', natureza = 'credora', atualizado_em = '2026-10-08T12:00:00Z'
          where id = $1 returning versao::text`,
        [id],
      ),
    );

    expect(rows[0]?.versao).toBe('2');
    const colunas = await admin.query<{ coluna: string }>(
      `select column_name as coluna from information_schema.column_privileges
        where table_schema = 'app' and table_name = 'conta_contabil' and grantee = 'contaia_app'
          and privilege_type = 'UPDATE' order by 1`,
    );
    expect(colunas.rows.map((linha) => linha.coluna)).toEqual([
      'arquivada',
      'arquivada_em',
      'atualizado_em',
      'conta_pai',
      'natureza',
      'nome',
      'tipo',
    ]);
  });
});

describe('tentativa de importação: idempotência e estado (SPEC-013 §3.7, §3.11)', () => {
  it('(g) mesmo hash e mesmo mapeamento na mesma empresa → 23505; mapeamento diferente é nova tentativa', async () => {
    const hash = hex64();
    await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash }));

    expect(
      await codigoPg(() => como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash }))),
    ).toBe('23505');
    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          inserirTentativa(cli, c.empresaA1, { hash, mapeamento: { ...MAPEAMENTO, contaPai: 'Superior' } }),
        ),
      ),
    ).toBe('nao_lancou');
  });

  it('(g) depois de FALHA ou CANCELADA o mesmo hash e mapeamento abre nova tentativa; REJEITADA continua fechando', async () => {
    const fechar = async (estado: 'FALHA' | 'CANCELADA' | 'REJEITADA'): Promise<string> => {
      const hash = hex64();
      const id = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash }));
      await admin.query(
        `update app.importacao_plano_contas
            set estado = $2, finalizado_em = now(),
                usuario_cancelador_id = case when $2 = 'CANCELADA' then usuario_iniciador_id end
          where id = $1`,
        [id, estado],
      );

      return codigoPg(() => como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1, { hash })));
    };

    expect(await fechar('FALHA')).toBe('nao_lancou');
    expect(await fechar('CANCELADA')).toBe('nao_lancou');
    expect(await fechar('REJEITADA')).toBe('23505');
  });

  it('defeito 1: a tentativa tem UNIQUE (id, empresa_id, tenant_id) para as FKs compostas das filhas', async () => {
    const { rows } = await admin.query<{ definicao: string }>(
      `select pg_get_constraintdef(oid) as definicao from pg_constraint
        where conrelid = 'app.importacao_plano_contas'::regclass and contype = 'u'`,
    );

    expect(rows.map((linha) => linha.definicao)).toContain('UNIQUE (id, empresa_id, tenant_id)');
  });

  it('a filha não aponta para a tentativa de outra empresa (FK composta)', async () => {
    const tentativaA1 = await inserirTentativa(admin, c.empresaA1);

    expect(await codigoPg(() => inserirLinha(admin, c.empresaA2, tentativaA1, { numero: 1 }))).toBe('23503');
    expect(await codigoPg(() => inserirEvento(admin, c.empresaA2, tentativaA1))).toBe('23503');
    expect(await codigoPg(() => inserirNotificacao(admin, c.empresaA2, tentativaA1, c.usuarios.fora))).toBe('23503');
  });

  it('defeito 5: a aplicação atualiza só as colunas de ciclo de vida da tentativa', async () => {
    const { rows } = await admin.query<{ coluna: string }>(
      `select column_name as coluna from information_schema.column_privileges
        where table_schema = 'app' and table_name = 'importacao_plano_contas' and grantee = 'contaia_app'
          and privilege_type = 'UPDATE' order by 1`,
    );

    expect(rows.map((linha) => linha.coluna)).toEqual([
      'estado',
      'finalizado_em',
      'iniciado_em',
      'mapeamento',
      'plano_versao_na_validacao',
      'reutilizada_por_idempotencia',
      'totais',
      'usuario_cancelador_id',
      'usuario_confirmador_id',
    ]);

    const id = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));
    await comoWorker(c.empresaA1, (cli) =>
      cli.query(
        `update app.importacao_plano_contas
            set estado = 'VALIDANDO', iniciado_em = now(), plano_versao_na_validacao = 0
          where id = $1`,
        [id],
      ),
    );
    await comoWorker(c.empresaA1, (cli) =>
      cli.query(
        `update app.importacao_plano_contas
            set estado = 'AGUARDANDO_CONFIRMACAO', totais = '{"lidas":1,"novas":1,"atualizadas":0,"rejeitadas":0}'
          where id = $1`,
        [id],
      ),
    );
    await como(c.usuarios.naCarteira, (cli) =>
      cli.query(
        `update app.importacao_plano_contas
            set estado = 'CANCELADA', usuario_cancelador_id = $2, finalizado_em = now()
          where id = $1`,
        [id, c.usuarios.naCarteira],
      ),
    );

    expect(
      await codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          cli.query(`update app.importacao_plano_contas set hash_arquivo = $2 where id = $1`, [id, hex64()]),
        ),
      ),
    ).toBe('42501');
  });

  it('o mapeamento só muda enquanto RECEBIDA', async () => {
    const id = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));
    const trocarMapeamento = (coluna: string) =>
      codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          cli.query(`update app.importacao_plano_contas set mapeamento = $2::jsonb where id = $1`, [
            id,
            JSON.stringify({ ...MAPEAMENTO, codigo: coluna }),
          ]),
        ),
      );
    const mudarEstado = (estado: string) =>
      comoWorker(c.empresaA1, (cli) =>
        cli.query(`update app.importacao_plano_contas set estado = $2 where id = $1`, [id, estado]),
      );

    expect(await trocarMapeamento('Conta')).toBe('nao_lancou');

    await mudarEstado('VALIDANDO');
    expect(await trocarMapeamento('Outra')).toBe('23001');

    await mudarEstado('AGUARDANDO_CONFIRMACAO');
    expect(await trocarMapeamento('Mais outra')).toBe('23001');
  });

  it('estado terminal não reabre; o reuso idempotente ainda pode ser marcado', async () => {
    const id = await inserirTentativa(admin, c.empresaA1);
    await admin.query(
      `update app.importacao_plano_contas
          set estado = 'REJEITADA', finalizado_em = now(), iniciado_em = now() where id = $1`,
      [id],
    );
    const atualizar = (definicao: string) =>
      codigoPg(() =>
        como(c.usuarios.naCarteira, (cli) =>
          cli.query(`update app.importacao_plano_contas set ${definicao} where id = $1`, [id]),
        ),
      );

    expect(await atualizar(`estado = 'VALIDANDO', finalizado_em = null`)).toBe('23001');
    expect(await atualizar(`reutilizada_por_idempotencia = true`)).toBe('nao_lancou');
  });
});

describe('staging da validação (SPEC-013 §3.4, §6.4)', () => {
  it('defeito 9: linha rejeitada guarda o valor cru, inclusive ausente ou fora do domínio', async () => {
    const tentativa = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));

    expect(
      await codigoPg(() =>
        comoWorker(c.empresaA1, async (cli) => {
          await inserirLinha(cli, c.empresaA1, tentativa, {
            numero: 2,
            codigo: null,
            nome: null,
            tipo: null,
            natureza: null,
            status: 'REJEITADA',
            codigoDeErro: 'CAMPO_OBRIGATORIO_AUSENTE',
            campo: 'codigo',
          });
          await inserirLinha(cli, c.empresaA1, tentativa, {
            numero: 3,
            tipo: 'Analítica???',
            natureza: 'qualquer',
            status: 'REJEITADA',
            campo: 'tipo',
          });
        }),
      ),
    ).toBe('nao_lancou');
  });

  it('linha válida exige valores no domínio e ação; rejeitada exige código de erro', async () => {
    const tentativa = await inserirTentativa(admin, c.empresaA1);

    expect(await codigoPg(() => inserirLinha(admin, c.empresaA1, tentativa, { numero: 1, tipo: 'xpto' }))).toBe(
      '23514',
    );
    expect(await codigoPg(() => inserirLinha(admin, c.empresaA1, tentativa, { numero: 2, acao: null }))).toBe('23514');
    expect(
      await codigoPg(() =>
        inserirLinha(admin, c.empresaA1, tentativa, { numero: 3, status: 'REJEITADA', codigoDeErro: null }),
      ),
    ).toBe('23514');
  });

  it('a mesma linha da mesma tentativa não duplica: 23505, e ON CONFLICT DO NOTHING é idempotente', async () => {
    const tentativa = await inserirTentativa(admin, c.empresaA1);
    await comoWorker(c.empresaA1, (cli) => inserirLinha(cli, c.empresaA1, tentativa, { numero: 7 }));

    expect(
      await codigoPg(() => comoWorker(c.empresaA1, (cli) => inserirLinha(cli, c.empresaA1, tentativa, { numero: 7 }))),
    ).toBe('23505');

    const repetida = await comoWorker(c.empresaA1, (cli) =>
      cli.query(
        `insert into app.importacao_plano_contas_linha
           (tenant_id, empresa_id, tentativa_id, numero_linha, codigo, nome, tipo, natureza, status, acao)
         values ($1, $2, $3, 7, 'C7', 'Conta 7', 'sintetica', 'devedora', 'VALIDA', 'INCLUIR')
         on conflict (tentativa_id, numero_linha) do nothing`,
        [c.tenantA, c.empresaA1, tentativa],
      ),
    );
    expect(repetida.rowCount).toBe(0);
  });
});

describe('isolamento (I-1, I-2) e ausência de DELETE (I-7)', () => {
  it('controle positivo: a carteira de A1 e o worker de A1 leem as seis tabelas', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.naCarteira, (cli) => contar(cli, tabela, idDaTabela(tabela)))).toBe(1);
      expect(await comoWorker(c.empresaA1, (cli) => contar(cli, tabela, idDaTabela(tabela)))).toBe(1);
    }
  });

  it('(b) o tenant B não enxerga conta, tentativa, linha, evento, notificação nem versão do A', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.deB, (cli) => contar(cli, tabela, idDaTabela(tabela)), c.tenantB)).toBe(0);
    }
  });

  it('(c) humano fora da carteira e worker de outra empresa não leem', async () => {
    for (const tabela of TABELAS) {
      expect(await como(c.usuarios.fora, (cli) => contar(cli, tabela, idDaTabela(tabela)))).toBe(0);
      expect(await comoWorker(c.empresaA2, (cli) => contar(cli, tabela, idDaTabela(tabela)))).toBe(0);
    }
  });

  it('(d) DELETE é negado em todas as tabelas; UPDATE é negado no evento e na linha', async () => {
    for (const tabela of TABELAS) {
      expect(
        await codigoPg(() =>
          como(c.usuarios.naCarteira, (cli) => cli.query(`delete from app.${tabela} where id = $1`, [idDaTabela(tabela)])),
        ),
      ).toBe('42501');
    }

    for (const tabela of ['importacao_plano_contas_evento', 'importacao_plano_contas_linha'] as const) {
      expect(
        await codigoPg(() =>
          como(c.usuarios.naCarteira, (cli) =>
            cli.query(`update app.${tabela} set id = id where id = $1`, [idDaTabela(tabela)]),
          ),
        ),
      ).toBe('42501');
    }
  });
});

describe('trilha append-only (I-6), defeito 3', () => {
  it('a aplicação grava e lê o evento, humano e worker', async () => {
    const tentativa = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));
    const humano = await como(c.usuarios.naCarteira, (cli) => inserirEvento(cli, c.empresaA1, tentativa));
    const worker = await comoWorker(c.empresaA1, (cli) => inserirEvento(cli, c.empresaA1, tentativa));

    expect(await como(c.usuarios.naCarteira, (cli) => contar(cli, 'importacao_plano_contas_evento', humano))).toBe(1);
    expect(await comoWorker(c.empresaA1, (cli) => contar(cli, 'importacao_plano_contas_evento', worker))).toBe(1);
  });

  it('nem o superusuário altera ou apaga evento: a trigger recusa', async () => {
    expect(
      await codigoPg(() =>
        admin.query(`update app.importacao_plano_contas_evento set correlation_id = 'x' where id = $1`, [deA1.evento]),
      ),
    ).toBe('23001');
    expect(
      await codigoPg(() => admin.query(`delete from app.importacao_plano_contas_evento where id = $1`, [deA1.evento])),
    ).toBe('23001');
  });

  it('o evento só tem políticas de SELECT e INSERT', async () => {
    const { rows } = await admin.query<{ comando: string }>(
      `select cmd as comando from pg_policies
        where schemaname = 'app' and tablename = 'importacao_plano_contas_evento' order by 1`,
    );

    expect(rows.map((linha) => linha.comando)).toEqual(['INSERT', 'SELECT']);
  });
});

describe('notificação de conclusão (SPEC-013 §3.10), defeitos 2 e 4', () => {
  it('é da classe empresa: o worker e o contador da carteira a gravam; uma por tentativa e usuário', async () => {
    const tentativa = await como(c.usuarios.naCarteira, (cli) => inserirTentativa(cli, c.empresaA1));

    expect(
      await codigoPg(() => comoWorker(c.empresaA1, (cli) => inserirNotificacao(cli, c.empresaA1, tentativa))),
    ).toBe('nao_lancou');
    expect(
      await codigoPg(() =>
        como(c.usuarios.duasEmpresas, (cli) =>
          inserirNotificacao(cli, c.empresaA1, tentativa, c.usuarios.duasEmpresas),
        ),
      ),
    ).toBe('nao_lancou');
    expect(
      await codigoPg(() => comoWorker(c.empresaA1, (cli) => inserirNotificacao(cli, c.empresaA1, tentativa))),
    ).toBe('23505');
  });

  it('o destinatário marca como lida', async () => {
    const { rowCount } = await como(c.usuarios.naCarteira, (cli) =>
      cli.query(`update app.importacao_plano_contas_notificacao set lida = true, lida_em = now() where id = $1`, [
        deA1.notificacao,
      ]),
    );

    expect(rowCount).toBe(1);
  });
});

describe('versão otimista do plano (SPEC-013 §6.3), defeito 7', () => {
  it('nasce sob demanda, uma por empresa, e só sobe', async () => {
    const criar = (cli: PoolClient) =>
      cli.query(
        `insert into app.empresa_plano_versao (tenant_id, empresa_id) values ($1, $2)
         on conflict (empresa_id, tenant_id) do nothing`,
        [c.tenantA, c.empresaA2],
      );
    await comoWorker(c.empresaA2, criar);
    await como(c.usuarios.fora, criar);

    const lidas = await como(c.usuarios.fora, (cli) =>
      cli.query<{ versao: string }>(`select versao::text from app.empresa_plano_versao where empresa_id = $1`, [
        c.empresaA2,
      ]),
    );
    expect(lidas.rows).toEqual([{ versao: '0' }]);

    const subir = await como(c.usuarios.fora, (cli) =>
      cli.query<{ versao: string }>(
        `update app.empresa_plano_versao set versao = versao + 1 where empresa_id = $1 and versao = 0
         returning versao::text`,
        [c.empresaA2],
      ),
    );
    expect(subir.rows).toEqual([{ versao: '1' }]);

    expect(
      await codigoPg(() =>
        como(c.usuarios.fora, (cli) =>
          cli.query(`update app.empresa_plano_versao set versao = 0 where empresa_id = $1`, [c.empresaA2]),
        ),
      ),
    ).toBe('23001');
  });
});

describe('pendência "plano de contas incompleto" (SPEC-013 §3.10), defeito 8', () => {
  const lerBackfill = async (): Promise<string> => {
    const sql = await readFile(new URL('../migrations/0015_importacao_plano_contas.sql', import.meta.url), 'utf8');
    const backfill = /WITH novas AS \([\s\S]*?FROM novas;/u.exec(sql)?.[0];

    expect(backfill).toBeDefined();

    return backfill ?? '';
  };

  const pendenciasDoPlano = async (cliente: PoolClient, empresaId: string): Promise<string[]> => {
    const { rows } = await cliente.query<{ tipo: string }>(
      `select origem || ':' || tipo || ':' || chave as tipo from app.empresa_pendencia
        where empresa_id = $1 and estado = 'ABERTA' and origem = 'PLANO_CONTAS'`,
      [empresaId],
    );

    return rows.map((linha) => linha.tipo);
  };

  it('(f) abre para empresa ATIVA sem conta, poupa a que tem conta e é idempotente', async () => {
    const backfill = await lerBackfill();
    const cliente = await admin.connect();

    // Numa transação revertida: o backfill varre o banco inteiro e não pode mexer nas empresas das
    // outras suítes que rodam em paralelo.
    try {
      await cliente.query('begin');
      // As outras suítes apagam as próprias empresas no `afterAll`: sem a trava, uma empresa lida
      // pelo backfill pode sumir antes da checagem da FK da pendência (23503 intermitente). SHARE
      // só segura escrita em `empresa` durante esta transação curta.
      await cliente.query('lock table app.empresa in share mode');
      const semConta = await idDe(
        cliente,
        `insert into app.empresa (tenant_id, cnpj, razao_social, status) values ($1, $2, 'Sem plano', 'ATIVA') returning id`,
        [c.tenantA, `P1${c.sufixo}`.slice(0, 14).padEnd(14, '0')],
      );
      const incompleta = await idDe(
        cliente,
        `insert into app.empresa (tenant_id, cnpj, razao_social) values ($1, $2, 'Incompleta') returning id`,
        [c.tenantA, `P2${c.sufixo}`.slice(0, 14).padEnd(14, '0')],
      );
      const comArquivada = await idDe(
        cliente,
        `insert into app.empresa (tenant_id, cnpj, razao_social, status) values ($1, $2, 'Só arquivada', 'ATIVA') returning id`,
        [c.tenantA, `P3${c.sufixo}`.slice(0, 14).padEnd(14, '0')],
      );
      await cliente.query(
        `insert into app.conta_contabil (tenant_id, empresa_id, codigo, nome, tipo, natureza, arquivada, arquivada_em)
         values ($1, $2, '1', 'Ativo', 'sintetica', 'devedora', true, now())`,
        [c.tenantA, comArquivada],
      );

      await cliente.query(backfill);
      await cliente.query(backfill);

      const esperado = ['PLANO_CONTAS:PLANO_CONTAS_INCOMPLETO:plano-contas:incompleto'];
      expect(await pendenciasDoPlano(cliente, semConta)).toEqual(esperado);
      expect(await pendenciasDoPlano(cliente, comArquivada)).toEqual(esperado);
      expect(await pendenciasDoPlano(cliente, incompleta)).toEqual([]);
      expect(await pendenciasDoPlano(cliente, c.empresaA1)).toEqual([]);

      const eventos = await cliente.query(
        `select 1 from app.empresa_evento_de_pendencia e join app.empresa_pendencia p on p.id = e.pendencia_id
          where p.empresa_id = $1 and p.chave = 'plano-contas:incompleto' and e.acao = 'CRIACAO'`,
        [semConta],
      );
      expect(eventos.rowCount).toBe(1);
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
  });

  it('a pendência aceita a origem e o tipo novos sem perder os anteriores', async () => {
    const inserir = (origem: string, tipo: string) =>
      admin.query(
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave) values ($1, $2, $3, $4, $5)`,
        [c.tenantA, c.empresaA2, origem, tipo, `chk:${origem}:${tipo}:${randomUUID()}`],
      );

    expect(await codigoPg(() => inserir('PLANO_CONTAS', 'PLANO_CONTAS_INCOMPLETO'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('CERTIFICADO', 'CERTIFICADO_AUSENTE'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('CADASTRAL', 'CAMPO_AUSENTE'))).toBe('nao_lancou');
    expect(await codigoPg(() => inserir('PLANO_CONTAS', 'PLANO_INVENTADO'))).toBe('23514');
    expect(await codigoPg(() => inserir('OUTRA', 'PLANO_CONTAS_INCOMPLETO'))).toBe('23514');
  });
});
