/**
 * Cartão geral e autorização em lote do Signer na API (SPEC-012 §3.1, §5.2) sobre o PostgreSQL real,
 * pelo papel `contaia_app` com contexto humano: a carteira e a RLS decidem o que aparece.
 */
import {
  abrirIncidente,
  comContexto,
  criarPool,
  criarPoolDaAplicacao,
  encerrarIncidente,
} from '@contaia/db';
import { CODIGOS_DE_ERRO, contextoDeServico } from '@contaia/domain';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SessaoDoCofre } from '../certificados/visoes';
import { SignerService } from './signer.service';

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();

/** As tabelas do monitor são globais e outras suítes as usam em paralelo: lock consultivo de sessão. */
const CHAVE_DA_TRAVA_DO_MONITOR = 7_012_001;
let trava: PoolClient | null = null;

const sufixo = `${String(process.pid).padStart(6, '0').slice(-6)}${String(Date.now()).slice(-6)}`;
let tenantId = '';
let usuarioId = '';
let empresaNaCarteira = '';
let empresaFora = '';
let sessao: SessaoDoCofre;

const cliente = { diagnosticar: vi.fn(), estados: vi.fn(), historico: vi.fn() };
const servico = new SignerService({ instancia: app } as never, cliente as never, { add: vi.fn() } as never);

const comoMonitor = <T>(executar: (c: PoolClient) => Promise<T>): Promise<T> =>
  comContexto(
    app,
    contextoDeServico({ identidadeTecnica: 'workers-monitor-signer', finalidade: 'MONITORAMENTO_DO_SIGNER', correlationId: 'api-teste' }),
    executar,
  );

const limparGlobais = async (): Promise<void> => {
  const c = await admin.connect();

  try {
    await c.query('set session_replication_role = replica');
    await c.query('delete from app.signer_verificacao');
    await c.query('delete from app.signer_incidente_evento');
  } finally {
    await c.query('reset session_replication_role');
    c.release();
  }
};

const unico = async (sql: string, parametros: unknown[]): Promise<string> =>
  (await admin.query<{ id: string }>(sql, parametros)).rows[0]!.id;

/** Semeia a verificação com o instante pedido (a trilha é append-only: só INSERT, nunca UPDATE). */
const verificar = async (resultado: 'OK' | 'FALHA', latenciaMs: number | null, minutosAtras: number): Promise<Date> => {
  const instante = new Date(Date.now() - minutosAtras * 60_000);

  await admin.query(
    'insert into app.signer_verificacao (resultado, latencia_ms, correlation_id, verificado_em) values ($1, $2, $3, $4)',
    [resultado, latenciaMs, 'api-teste', instante],
  );

  return instante;
};

beforeAll(async () => {
  trava = await admin.connect();
  await trava.query('select pg_advisory_lock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);

  tenantId = await unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
    `Painel ${sufixo}`,
    `P${sufixo}`.slice(0, 14).padEnd(14, '0'),
  ]);
  usuarioId = await unico(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, 'Colaborador', 'ATIVO') returning id`,
    [tenantId, `sub-${sufixo}`, `painel.${sufixo}@signer.local`],
  );
  const novaEmpresa = (rotulo: string): Promise<string> =>
    unico(
      `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
      [tenantId, `${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'), `Empresa ${rotulo}`],
    );
  empresaNaCarteira = await novaEmpresa('N');
  empresaFora = await novaEmpresa('F');
  await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
    tenantId,
    usuarioId,
    empresaNaCarteira,
  ]);

  sessao = { tenantId, usuarioId, papeis: ['contador'], permissoes: ['certificados.signer.consultar'] };
  await limparGlobais();
}, 60_000);

afterAll(async () => {
  await limparGlobais();
  const c = await admin.connect();

  try {
    await c.query('set session_replication_role = replica');
    for (const { tabela } of (
      await c.query<{ tabela: string }>(
        `select table_name as tabela from information_schema.columns where table_schema = 'app' and column_name = 'tenant_id'`,
      )
    ).rows) {
      await c.query(`delete from app.${tabela} where tenant_id = $1`, [tenantId]);
    }
    await c.query('delete from app.tenant where id = $1', [tenantId]);
  } finally {
    await c.query('reset session_replication_role');
    c.release();
  }
  await trava?.query('select pg_advisory_unlock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  trava?.release();
  await Promise.all([admin.end(), app.end()]);
});

describe('cartão geral do serviço', () => {
  it('sem nenhuma verificação não afirma operacional: degradado e desatualizado', async () => {
    await limparGlobais();

    expect(await servico.painelDoServico(sessao, 'corr-painel-0001')).toEqual({
      estado: 'DEGRADADO',
      desatualizado: true,
      ultimaVerificacaoEm: null,
      ultimaLatenciaMs: null,
      incidenteAberto: false,
    });
  });

  it('verificação válida recente: operacional, com a latência da última resposta válida', async () => {
    await limparGlobais();
    const instante = await verificar('OK', 9, 1);

    const painel = await servico.painelDoServico(sessao, 'corr-painel-0002');

    expect(painel).toMatchObject({ estado: 'OPERACIONAL', desatualizado: false, ultimaLatenciaMs: 9, incidenteAberto: false });
    expect(painel.ultimaVerificacaoEm).toBe(instante.toISOString());
  });

  it('a latência mostrada é a da última resposta VÁLIDA, não a de uma falha recente', async () => {
    await limparGlobais();
    await verificar('OK', 11, 2);
    await verificar('FALHA', null, 1);

    expect(await servico.painelDoServico(sessao, 'corr-painel-0003')).toMatchObject({
      estado: 'DEGRADADO',
      ultimaLatenciaMs: 11,
    });
  });

  it('incidente aberto é indisponível; encerrado, volta ao que a última verificação diz', async () => {
    await limparGlobais();
    await verificar('FALHA', null, 3);
    const incidente = await comoMonitor((c) => abrirIncidente(c));

    expect((await servico.painelDoServico(sessao, 'corr-painel-0004')).estado).toBe('INDISPONIVEL');

    await comoMonitor((c) => encerrarIncidente(c, incidente, 60_000));
    await verificar('OK', 7, 0);

    expect((await servico.painelDoServico(sessao, 'corr-painel-0005')).estado).toBe('OPERACIONAL');
  });

  it('o monitor parado (última verificação muito antiga) não afirma operacional', async () => {
    await limparGlobais();
    await verificar('OK', 5, 30);

    expect(await servico.painelDoServico(sessao, 'corr-painel-0006')).toMatchObject({
      estado: 'DEGRADADO',
      desatualizado: true,
    });
  });
});

describe('estados em lote: só empresas da carteira', () => {
  it('empresa da carteira segue ao Signer, com o tenant da sessão e sem repetir ids', async () => {
    cliente.estados.mockResolvedValue({ empresas: [] });

    await servico.estados(sessao, [empresaNaCarteira, empresaNaCarteira], 'corr-lote-0001');

    expect(cliente.estados).toHaveBeenCalledWith({
      tenantId,
      empresaIds: [empresaNaCarteira],
      correlationId: 'corr-lote-0001',
    });
  });

  it('uma empresa fora da carteira recusa o lote inteiro, sem chamar o Signer', async () => {
    cliente.estados.mockClear();

    const erro = await servico.estados(sessao, [empresaNaCarteira, empresaFora], 'corr-lote-0002').catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA });
    expect(cliente.estados).not.toHaveBeenCalled();
  });

  it('empresa inexistente (ou de outro tenant) também recusa', async () => {
    cliente.estados.mockClear();

    const erro = await servico
      .estados(sessao, ['0198f3c2-0000-7000-0000-0000000000aa'], 'corr-lote-0003')
      .catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA });
    expect(cliente.estados).not.toHaveBeenCalled();
  });
});
