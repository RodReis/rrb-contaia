/**
 * Banco do Signer (SPEC-012 §4, §6.3, §9): RLS por tenant/empresa, append-only, idempotência,
 * estados e o monitor global. Roda como `contaia_app` (sem BYPASSRLS) sobre o PostgreSQL real.
 */
import { randomUUID } from 'node:crypto';

import { contextoDeServico, contextoTecnico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto, semContexto } from './contexto.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;
let certificadoA1: string;
let referenciaA1: string;
let certificadoB1: string;
let referenciaB1: string;

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const comoSigner = <T>(
  tenantId: string,
  empresaId: string,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'signer',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId,
      empresaId,
      correlationId: 'teste-signer-banco',
    }),
    executar,
  );

const comoMonitor = <T>(executar: (cliente: PoolClient) => Promise<T>): Promise<T> =>
  comContexto(
    app,
    contextoDeServico({
      identidadeTecnica: 'workers-monitor-signer',
      finalidade: 'MONITORAMENTO_DO_SIGNER',
      correlationId: 'teste-monitor',
    }),
    executar,
  );

const SQL_OPERACAO = `insert into app.signer_operacao
   (tenant_id, empresa_id, finalidade, tipo, chave_hmac, hash_conteudo, certificado_id,
    referencia_segredo, identidade_tecnica, correlation_id)
 values ($1, $2, 'DFE_TESTE', 'MTLS', $3, $4, $5, $6, 'worker', 'corr-0001')
 returning id`;

const inserirOperacao = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  chave = hex64(),
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(SQL_OPERACAO, [
    tenantId,
    empresaId,
    chave,
    hex64(),
    certificadoA1,
    referenciaA1,
  ]);

  return rows[0]!.id;
};

const SQL_EVENTO = `insert into app.signer_evento
   (tenant_id, empresa_id, finalidade, identidade_tecnica, iniciado_em, finalizado_em, latencia_ms,
    resultado, codigo, correlation_id, reutilizado)
 values ($1, $2, 'DFE_TESTE', 'worker', now(), now(), 12, 'SUCESSO', null, 'corr-0001', false)
 returning id`;

const limparGlobais = async (): Promise<void> => {
  const cliente = await admin.connect();

  try {
    await cliente.query(`set session_replication_role = replica`);
    await cliente.query(`delete from app.signer_verificacao`);
    await cliente.query(`delete from app.signer_incidente_evento`);
  } finally {
    await cliente.query(`reset session_replication_role`);
    cliente.release();
  }
};

const semearCertificado = async (
  tenantId: string,
  empresaId: string,
  responsavelId: string,
  sufixo: string,
): Promise<{ id: string; referencia: string }> => {
  const referencia = randomUUID();
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa_certificado
       (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
        numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo, cadastrado_por)
     values ($1, $2, 1, 'VIGENTE', 'Titular', '00000000000000', 'AC', array['AC'], $3, $4,
             '2026-01-01', '2027-01-01', $5, $6, $5)
     returning id`,
    [tenantId, empresaId, `serie-${sufixo}`, `imp-${sufixo}`, responsavelId, referencia],
  );

  return { id: rows[0]!.id, referencia };
};

/**
 * As tabelas do monitor são GLOBAIS e outras suítes (db e workers) também as usam, em paralelo:
 * um lock consultivo de sessão, mantido até o fim, serializa quem toca nelas.
 */
const CHAVE_DA_TRAVA_DO_MONITOR = 7_012_001;
let travaDoMonitor: PoolClient | null = null;

beforeAll(async () => {
  travaDoMonitor = await admin.connect();
  await travaDoMonitor.query('select pg_advisory_lock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  c = await montarCenario(admin);
  const a = await semearCertificado(c.tenantA, c.empresaA1, c.usuarios.admin, `a-${c.sufixo}`);
  certificadoA1 = a.id;
  referenciaA1 = a.referencia;
  const b = await semearCertificado(c.tenantB, c.empresaB1, c.usuarios.deB, `b-${c.sufixo}`);
  certificadoB1 = b.id;
  referenciaB1 = b.referencia;
  await limparGlobais();
}, 60_000);

afterAll(async () => {
  await limparGlobais();
  await limparCenario(admin, c);
  await travaDoMonitor?.query('select pg_advisory_unlock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  travaDoMonitor?.release();
  await Promise.all([admin.end(), app.end()]);
});

describe('signer_operacao: isolamento por tenant e empresa (I-1, I-2)', () => {
  it('o Signer grava e lê a operação da própria empresa', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1));
    const lidas = await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      cli.query('select id from app.signer_operacao where id = $1', [id]),
    );

    expect(lidas.rows).toHaveLength(1);
  });

  it('outra empresa do mesmo tenant não enxerga a operação', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1));
    const lidas = await comoSigner(c.tenantA, c.empresaA2, (cli) =>
      cli.query('select id from app.signer_operacao where id = $1', [id]),
    );

    expect(lidas.rows).toHaveLength(0);
  });

  it('outro tenant não enxerga a operação', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1));
    const lidas = await comoSigner(c.tenantB, c.empresaB1, (cli) =>
      cli.query('select id from app.signer_operacao where id = $1', [id]),
    );

    expect(lidas.rows).toHaveLength(0);
  });

  it('o contexto da empresa A2 não grava operação da empresa A1', async () => {
    await expect(
      comoSigner(c.tenantA, c.empresaA2, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1)),
    ).rejects.toThrow(/row-level security/iu);
  });

  it('sem contexto nada aparece e nada se grava', async () => {
    const lidas = await semContexto(app, (cli) => cli.query('select id from app.signer_operacao'));

    expect(lidas.rows).toHaveLength(0);
    await expect(
      semContexto(app, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1)),
    ).rejects.toThrow(/row-level security/iu);
  });

  it('a mesma chave idempotente em outra empresa viola a unicidade (vira conflito 409 no Signer)', async () => {
    const chave = hex64();
    await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1, chave));

    // Outro tenant, com certificado próprio: a RLS esconde a linha de A, mas a unicidade da chave
    // protegida é global e a colisão chega como 23505 (o Signer a traduz em 409, sem vazar a linha).
    await expect(
      comoSigner(c.tenantB, c.empresaB1, async (cli) => {
        await cli.query(SQL_OPERACAO, [c.tenantB, c.empresaB1, chave, hex64(), certificadoB1, referenciaB1]);
      }),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1, chave)),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a chave idempotente só existe como HMAC de 64 hex (nunca a chave em claro)', async () => {
    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1, 'chave-em-claro')),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('signer_operacao: transições (SPEC-012 §3.8)', () => {
  it('falha transitória admite nova tentativa na mesma operação, com a contagem subindo', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1));

    await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      cli.query(
        `update app.signer_operacao set estado = 'FALHA_TRANSITORIA', resultado_codigo = 'SIGNER_DESTINO_INDISPONIVEL',
           finalizado_em = now() where id = $1`,
        [id],
      ),
    );
    await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      cli.query(
        `update app.signer_operacao set estado = 'EM_ANDAMENTO', resultado_codigo = null, finalizado_em = null,
           tentativas = tentativas + 1 where id = $1`,
        [id],
      ),
    );
    const { rows } = await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      cli.query<{ tentativas: number }>('select tentativas from app.signer_operacao where id = $1', [id]),
    );

    expect(rows[0]?.tentativas).toBe(2);
  });

  it('resultado terminal não muda mais (reutilização segura)', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1));
    await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      cli.query(`update app.signer_operacao set estado = 'CONCLUIDA', finalizado_em = now() where id = $1`, [id]),
    );

    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) =>
        cli.query(`update app.signer_operacao set estado = 'RECUSADA', resultado_codigo = 'X' where id = $1`, [id]),
      ),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('o contexto da operação (hash, chave, certificado) é imutável', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => inserirOperacao(cli, c.tenantA, c.empresaA1));

    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) =>
        cli.query('update app.signer_operacao set hash_conteudo = $2 where id = $1', [id, hex64()]),
      ),
    ).rejects.toThrow(/permission denied/iu);
  });
});

describe('signer_evento: trilha append-only (I-6)', () => {
  it('registra e lê, mas a aplicação não altera nem apaga', async () => {
    const id = await comoSigner(c.tenantA, c.empresaA1, async (cli) => (await cli.query<{ id: string }>(SQL_EVENTO, [c.tenantA, c.empresaA1])).rows[0]!.id);

    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) => cli.query(`update app.signer_evento set codigo = 'X' where id = $1`, [id])),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) => cli.query('delete from app.signer_evento where id = $1', [id])),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('nem o dono da tabela altera: a trigger de histórico rejeita', async () => {
    const { rows } = await admin.query<{ id: string }>(SQL_EVENTO, [c.tenantA, c.empresaA1]);

    await expect(
      admin.query(`update app.signer_evento set codigo = 'X' where id = $1`, [rows[0]!.id]),
    ).rejects.toThrow();
  });

  it('o evento da empresa A1 é visível ao colaborador da carteira e invisível fora dela', async () => {
    await admin.query(SQL_EVENTO, [c.tenantA, c.empresaA1]);

    const dentro = await comoUsuario(app, c.tenantA, c.usuarios.naCarteira, (cli) =>
      cli.query('select id from app.signer_evento where empresa_id = $1', [c.empresaA1]),
    );
    const fora = await comoUsuario(app, c.tenantA, c.usuarios.fora, (cli) =>
      cli.query('select id from app.signer_evento where empresa_id = $1', [c.empresaA1]),
    );

    expect(dentro.rows.length).toBeGreaterThan(0);
    expect(fora.rows).toHaveLength(0);
  });
});

describe('estado corrente por finalidade, derivado de signer_evento (SPEC-012 §3.3, §5.2)', () => {
  const ESTADO_CORRENTE = `
    select distinct on (finalidade) finalidade, resultado
      from app.signer_evento
     where empresa_id = $1 and resultado in ('SUCESSO', 'FALHA')
     order by finalidade, iniciado_em desc, sequencia desc`;

  const registrar = (finalidade: string, resultado: string, minutosAtras: number): Promise<unknown> =>
    admin.query(
      `insert into app.signer_evento
         (tenant_id, empresa_id, finalidade, identidade_tecnica, iniciado_em, finalizado_em, latencia_ms,
          resultado, codigo, correlation_id)
       values ($1, $2, $3, 'worker', now() - ($4 || ' minutes')::interval, now() - ($4 || ' minutes')::interval,
               5, $5, $6, 'corr-estado')`,
      [c.tenantA, c.empresaA2, finalidade, String(minutosAtras), resultado, resultado === 'SUCESSO' ? null : 'SIGNER_DESTINO_INDISPONIVEL'],
    );

  it('o último SUCESSO/FALHA de cada finalidade vale; uma não contamina a outra', async () => {
    await registrar('DFE_TESTE', 'FALHA', 10);
    await registrar('DFE_TESTE', 'SUCESSO', 5);
    await registrar('ESOCIAL_TESTE', 'SUCESSO', 10);
    await registrar('ESOCIAL_TESTE', 'FALHA', 5);

    const { rows } = await comoSigner(c.tenantA, c.empresaA2, (cli) =>
      cli.query<{ finalidade: string; resultado: string }>(ESTADO_CORRENTE, [c.empresaA2]),
    );

    expect(rows).toEqual([
      { finalidade: 'DFE_TESTE', resultado: 'SUCESSO' },
      { finalidade: 'ESOCIAL_TESTE', resultado: 'FALHA' },
    ]);
  });

  it('recusa por erro do chamador não altera o estado de saúde da finalidade', async () => {
    await admin.query(
      `insert into app.signer_evento
         (tenant_id, empresa_id, finalidade, identidade_tecnica, iniciado_em, finalizado_em, latencia_ms,
          resultado, codigo, correlation_id)
       values ($1, $2, 'DFE_TESTE', 'worker', now(), now(), 1, 'RECUSA', 'SIGNER_XML_INVALIDO', 'corr-recusa')`,
      [c.tenantA, c.empresaA2],
    );

    const { rows } = await comoSigner(c.tenantA, c.empresaA2, (cli) =>
      cli.query<{ finalidade: string; resultado: string }>(ESTADO_CORRENTE, [c.empresaA2]),
    );

    expect(rows.find((linha) => linha.finalidade === 'DFE_TESTE')?.resultado).toBe('SUCESSO');
  });
});

describe('monitor global: contexto de serviço e funções estreitas (SPEC-012 §3.10)', () => {
  it('sem contexto de serviço as funções recusam (usuário humano e técnico incluídos)', async () => {
    await expect(
      comoUsuario(app, c.tenantA, c.usuarios.admin, (cli) => cli.query('select * from app.signer_estado_do_monitor()')),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      comoSigner(c.tenantA, c.empresaA1, (cli) => cli.query(`select app.signer_registrar_verificacao('FALHA', 10, 'x')`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      semContexto(app, (cli) => cli.query('select * from app.signer_estado_do_monitor()')),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('a aplicação não toca as tabelas globais diretamente', async () => {
    await expect(
      comoMonitor((cli) => cli.query('select * from app.signer_verificacao')),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      comoMonitor((cli) => cli.query('select * from app.signer_incidente_evento')),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('três falhas contam, abrem um incidente e notificam cada administrador com A1 vigente', async () => {
    await limparGlobais();

    for (let i = 0; i < 3; i += 1) {
      await comoMonitor((cli) => cli.query(`select app.signer_registrar_verificacao('FALHA', null, $1)`, [`m-${i}`]));
    }
    const estado = await comoMonitor((cli) =>
      cli.query<{ falhas_consecutivas: number; incidente_id: string | null }>('select * from app.signer_estado_do_monitor()'),
    );

    expect(estado.rows[0]).toMatchObject({ falhas_consecutivas: 3, incidente_id: null });

    const incidente = (
      await comoMonitor((cli) => cli.query<{ id: string }>('select app.signer_abrir_incidente() as id'))
    ).rows[0]!.id;
    const notificados = (
      await comoMonitor((cli) =>
        cli.query<{ n: number }>(`select app.signer_notificar_incidente($1, 'INDISPONIBILIDADE', null) as n`, [incidente]),
      )
    ).rows[0]!.n;

    // O banco de teste é compartilhado: outras suítes também deixam tenants com A1 vigente e admin.
    // O que se prova é o escopo certo — A recebe, B (com certificado, mas sem administrador) não.
    expect(notificados).toBeGreaterThanOrEqual(1);

    const repetido = (
      await comoMonitor((cli) =>
        cli.query<{ n: number }>(`select app.signer_notificar_incidente($1, 'INDISPONIBILIDADE', null) as n`, [incidente]),
      )
    ).rows[0]!.n;

    expect(repetido).toBe(0);

    const propria = await comoUsuario(app, c.tenantA, c.usuarios.admin, (cli) =>
      cli.query('select tipo from app.signer_notificacao where incidente_id = $1', [incidente]),
    );
    const alheia = await comoUsuario(app, c.tenantB, c.usuarios.deB, (cli) =>
      cli.query('select tipo from app.signer_notificacao where incidente_id = $1', [incidente]),
    );

    expect(propria.rows).toEqual([{ tipo: 'INDISPONIBILIDADE' }]);
    expect(alheia.rows).toHaveLength(0);
  });

  it('a recuperação encerra o incidente e notifica exatamente os mesmos administradores', async () => {
    await limparGlobais();
    await comoMonitor((cli) => cli.query(`select app.signer_registrar_verificacao('FALHA', null, 'a')`));
    const incidente = (
      await comoMonitor((cli) => cli.query<{ id: string }>('select app.signer_abrir_incidente() as id'))
    ).rows[0]!.id;
    const notificados = (
      await comoMonitor((cli) =>
        cli.query<{ n: number }>(`select app.signer_notificar_incidente($1, 'INDISPONIBILIDADE', null) as n`, [incidente]),
      )
    ).rows[0]!.n;

    await comoMonitor((cli) => cli.query(`select app.signer_registrar_verificacao('OK', 8, 'b')`));
    await comoMonitor((cli) => cli.query('select app.signer_encerrar_incidente($1, $2)', [incidente, 300_000]));
    const recuperados = (
      await comoMonitor((cli) =>
        cli.query<{ n: number }>(`select app.signer_notificar_incidente($1, 'RECUPERACAO', $2) as n`, [incidente, 300_000]),
      )
    ).rows[0]!.n;
    const estado = await comoMonitor((cli) =>
      cli.query<{ falhas_consecutivas: number; incidente_id: string | null }>('select * from app.signer_estado_do_monitor()'),
    );

    expect(notificados).toBeGreaterThanOrEqual(1);
    expect(recuperados).toBe(notificados);
    expect(estado.rows[0]).toMatchObject({ falhas_consecutivas: 0, incidente_id: null });

    const tipos = await comoUsuario(app, c.tenantA, c.usuarios.admin, (cli) =>
      cli.query('select tipo from app.signer_notificacao where incidente_id = $1 order by sequencia', [incidente]),
    );

    expect(tipos.rows).toEqual([{ tipo: 'INDISPONIBILIDADE' }, { tipo: 'RECUPERACAO' }]);
  });

  it('o administrador marca a própria notificação como lida; o colega de outro tenant não', async () => {
    const { rows } = await comoUsuario(app, c.tenantA, c.usuarios.admin, (cli) =>
      cli.query<{ id: string }>('select id from app.signer_notificacao limit 1'),
    );
    const id = rows[0]!.id;

    const outro = await comoUsuario(app, c.tenantB, c.usuarios.deB, (cli) =>
      cli.query('update app.signer_notificacao set lida = true, lida_em = now() where id = $1', [id]),
    );
    const dono = await comoUsuario(app, c.tenantA, c.usuarios.admin, (cli) =>
      cli.query('update app.signer_notificacao set lida = true, lida_em = now() where id = $1', [id]),
    );

    expect(outro.rowCount).toBe(0);
    expect(dono.rowCount).toBe(1);
  });
});
