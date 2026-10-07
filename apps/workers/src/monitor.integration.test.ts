/**
 * Monitor de saúde do Signer (SPEC-012 §3.10) sobre o PostgreSQL real, sob o contexto de serviço:
 * três falhas consecutivas abrem UM incidente e notificam cada administrador; novas falhas não
 * duplicam; a primeira verificação válida encerra e notifica os mesmos administradores.
 */
import { randomUUID } from 'node:crypto';

import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import { ErroDoClienteDoSigner } from '@contaia/signer-client';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { verificarSaude } from './monitor.js';

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();

/** Mesma chave das outras suítes que tocam as tabelas globais do monitor: serializa entre arquivos. */
const CHAVE_DA_TRAVA_DO_MONITOR = 7_012_001;
let trava: PoolClient | null = null;

const sufixo = `${String(process.pid).padStart(6, '0').slice(-6)}${String(Date.now()).slice(-5)}`;
let tenantComCertificado = '';
let tenantSemCertificado = '';

const saude = vi.fn();
const cliente = { saude };

const verificar = () => verificarSaude({ pool: app, cliente, agora: () => new Date() });

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

const notificacoes = async (tenantId: string) =>
  (await admin.query<{ tipo: string; duracao_ms: string | null }>(
    'select tipo, duracao_ms::text from app.signer_notificacao where tenant_id = $1 order by sequencia',
    [tenantId],
  )).rows;

const semearTenant = async (rotulo: string, comCertificado: boolean): Promise<string> => {
  const tenant = (
    await admin.query<{ id: string }>(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
      `Monitor ${rotulo} ${sufixo}`,
      `M${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
    ])
  ).rows[0]!.id;
  const usuario = (
    await admin.query<{ id: string }>(
      `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, 'Administrador', 'ATIVO') returning id`,
      [tenant, `sub-${rotulo}-${sufixo}`, `${rotulo}.${sufixo}@monitor.local`],
    )
  ).rows[0]!.id;
  await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`, [tenant, usuario]);

  if (comCertificado) {
    const empresa = (
      await admin.query<{ id: string }>(
        `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao) values ($1, $2, 'Empresa', 'ATIVA', 'ativo') returning id`,
        [tenant, `E${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0')],
      )
    ).rows[0]!.id;
    const referencia = randomUUID();
    await admin.query(
      `insert into app.empresa_certificado
         (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
          numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo, cadastrado_por)
       values ($1, $2, 1, 'VIGENTE', 'T', '00000000000000', 'AC', array['AC'], $3, $4, '2026-01-01', '2027-12-31', $5, $6, $5)`,
      [tenant, empresa, `serie-${referencia}`, `imp-${referencia}`, usuario, referencia],
    );
  }

  return tenant;
};

beforeAll(async () => {
  trava = await admin.connect();
  await trava.query('select pg_advisory_lock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  tenantComCertificado = await semearTenant('A', true);
  tenantSemCertificado = await semearTenant('B', false);
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
      await c.query(`delete from app.${tabela} where tenant_id = any($1)`, [[tenantComCertificado, tenantSemCertificado]]);
    }
    await c.query('delete from app.tenant where id = any($1)', [[tenantComCertificado, tenantSemCertificado]]);
  } finally {
    await c.query('reset session_replication_role');
    c.release();
  }
  await trava?.query('select pg_advisory_unlock($1)', [CHAVE_DA_TRAVA_DO_MONITOR]);
  trava?.release();
  await Promise.all([admin.end(), app.end()]);
});

beforeEach(async () => {
  saude.mockReset();
  await limparGlobais();
  await admin.query('delete from app.signer_notificacao where tenant_id = any($1)', [[tenantComCertificado, tenantSemCertificado]]);
});

const falha = (): void => saude.mockRejectedValueOnce(new ErroDoClienteDoSigner('SIGNER_INDISPONIVEL', null, null, true));
const ok = (estado: 'OPERACIONAL' | 'DEGRADADO' = 'OPERACIONAL'): void =>
  saude.mockResolvedValueOnce({ versaoDoContrato: 'v1', estado, verificadoEm: new Date().toISOString() });

describe('verificação de saúde a cada minuto', () => {
  it('uma resposta válida registra OK e não abre nada', async () => {
    ok();

    const resultado = await verificar();

    expect(resultado).toEqual({ resultado: 'OK', efeitos: [] });
    expect(await notificacoes(tenantComCertificado)).toEqual([]);
  });

  it('DEGRADADO ainda é resposta válida: o serviço respondeu', async () => {
    ok('DEGRADADO');

    expect((await verificar()).resultado).toBe('OK');
  });

  it('a resposta DEGRADADO fica registrada: o cartão não afirma operacional com o Vault fora', async () => {
    const ultima = async () =>
      (await admin.query<{ degradado: boolean }>('select degradado from app.signer_verificacao order by sequencia desc limit 1'))
        .rows[0]?.degradado;

    ok('DEGRADADO');
    await verificar();
    expect(await ultima()).toBe(true);

    ok('OPERACIONAL');
    await verificar();
    expect(await ultima()).toBe(false);
  });

  it('qualquer falha de chamada, de qualquer tipo, conta como FALHA', async () => {
    saude.mockRejectedValueOnce(new Error('qualquer coisa'));

    expect((await verificar()).resultado).toBe('FALHA');
  });

  it('resposta que não é o contrato de saúde não é resposta válida', async () => {
    saude.mockResolvedValueOnce({ qualquer: 'coisa' });

    expect((await verificar()).resultado).toBe('FALHA');
  });
});

describe('incidente (3 falhas consecutivas)', () => {
  it('duas falhas não abrem incidente', async () => {
    falha();
    falha();

    await verificar();
    const segunda = await verificar();

    expect(segunda.efeitos).toEqual([]);
    expect(await notificacoes(tenantComCertificado)).toEqual([]);
  });

  it('a terceira abre UM incidente e notifica o administrador do tenant com A1 vigente — e só ele', async () => {
    falha();
    falha();
    falha();

    await verificar();
    await verificar();
    const terceira = await verificar();

    expect(terceira.efeitos).toEqual(['ABRIR_INCIDENTE', 'NOTIFICAR_INDISPONIBILIDADE']);
    expect(await notificacoes(tenantComCertificado)).toEqual([{ tipo: 'INDISPONIBILIDADE', duracao_ms: null }]);
    expect(await notificacoes(tenantSemCertificado)).toEqual([]);
  });

  it('novas falhas do mesmo incidente não duplicam a notificação', async () => {
    for (let i = 0; i < 5; i += 1) {
      falha();
      await verificar();
    }

    expect(await notificacoes(tenantComCertificado)).toHaveLength(1);
  });

  it('a primeira verificação válida encerra o incidente e notifica os MESMOS administradores com a duração', async () => {
    for (let i = 0; i < 3; i += 1) {
      falha();
      await verificar();
    }
    await new Promise((resolver) => setTimeout(resolver, 60));
    ok();

    const recuperacao = await verificar();
    const itens = await notificacoes(tenantComCertificado);

    expect(recuperacao.efeitos).toEqual(['ENCERRAR_INCIDENTE', 'NOTIFICAR_RECUPERACAO']);
    expect(itens.map((n) => n.tipo)).toEqual(['INDISPONIBILIDADE', 'RECUPERACAO']);
    expect(Number(itens[1]!.duracao_ms)).toBeGreaterThanOrEqual(40);
    expect(await notificacoes(tenantSemCertificado)).toEqual([]);
  });

  it('um novo incidente depois da recuperação volta a notificar', async () => {
    for (let i = 0; i < 3; i += 1) {
      falha();
      await verificar();
    }
    ok();
    await verificar();
    for (let i = 0; i < 3; i += 1) {
      falha();
      await verificar();
    }

    expect((await notificacoes(tenantComCertificado)).map((n) => n.tipo)).toEqual([
      'INDISPONIBILIDADE',
      'RECUPERACAO',
      'INDISPONIBILIDADE',
    ]);
  });

  it('indisponibilidade do Signer NÃO cria item na Central de Pendências', async () => {
    for (let i = 0; i < 4; i += 1) {
      falha();
      await verificar();
    }

    const { rows } = await admin.query<{ n: string }>('select count(*)::text as n from app.empresa_pendencia where tenant_id = $1', [
      tenantComCertificado,
    ]);

    expect(Number(rows[0]!.n)).toBe(0);
  });
});
