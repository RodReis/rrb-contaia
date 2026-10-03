/**
 * Contexto transacional de acesso (SPEC-010 §3.1–§3.2, §6).
 *
 * Roda com a role `contaia_app`. Prova que o contexto existe só dentro da
 * transação, que contexto inválido falha antes de qualquer consulta e que a
 * troca de finalidade é local, restaurada e exclusiva de requisição humana.
 */
import { contextoTecnico, ErroDeDominio, CODIGOS_DE_ERRO } from '@contaia/domain';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { obterUrlDaAplicacao } from './client.js';
import { comContexto, comContextoHumano, comFinalidade, semContexto } from './contexto.js';

const TENANT = '0197a1b2-0000-7000-8000-0000000000a1';
const USUARIO = '0197a1b2-0000-7000-8000-0000000000a2';
const EMPRESA = '0197a1b2-0000-7000-8000-0000000000a3';

// `max: 1`: toda operação reaproveita exatamente a mesma conexão.
const pool = new Pool({ connectionString: obterUrlDaAplicacao(), max: 1 });

const leitura = `select app.tenant_atual()::text as tenant, app.usuario_atual()::text as usuario,
                        app.empresa_tecnica_atual()::text as empresa,
                        app.origem_atual() as origem, app.finalidade_atual() as finalidade,
                        app.contexto_humano() as humano, app.contexto_tecnico() as tecnico`;

type Estado = {
  tenant: string | null;
  usuario: string | null;
  empresa: string | null;
  origem: string | null;
  finalidade: string | null;
  humano: boolean;
  tecnico: boolean;
};

const estadoAtual = async (cliente: { query: Pool['query'] }): Promise<Estado> => {
  const { rows } = await cliente.query<Estado>(leitura);
  const linha = rows[0];

  if (linha === undefined) {
    throw new Error('sem estado');
  }

  return linha;
};

const SEM_CONTEXTO: Estado = {
  tenant: null,
  usuario: null,
  empresa: null,
  origem: null,
  finalidade: null,
  humano: false,
  tecnico: false,
};

describe('contexto humano', () => {
  it('vale dentro da transação e some ao confirmar', async () => {
    const dentro = await comContextoHumano(pool, { tenantId: TENANT, usuarioId: USUARIO }, estadoAtual);
    const depois = await semContexto(pool, estadoAtual);

    expect(dentro).toEqual({
      tenant: TENANT,
      usuario: USUARIO,
      empresa: null,
      origem: 'HUMANA',
      finalidade: 'COMUM',
      humano: true,
      tecnico: false,
    });
    expect(depois).toEqual(SEM_CONTEXTO);
  });

  it('some também ao reverter', async () => {
    await expect(
      comContextoHumano(pool, { tenantId: TENANT, usuarioId: USUARIO }, async () => {
        throw new Error('falha do caso de uso');
      }),
    ).rejects.toThrow('falha do caso de uso');

    expect(await semContexto(pool, estadoAtual)).toEqual(SEM_CONTEXTO);
  });

  it.each([
    ['tenant que não é uuid', { tenantId: 'abc', usuarioId: USUARIO }],
    ['usuário ausente', { tenantId: TENANT, usuarioId: '' }],
  ])('recusa %s antes de abrir transação', async (_nome, entrada) => {
    let executou = false;

    await expect(
      comContextoHumano(pool, entrada, async () => {
        executou = true;
      }),
    ).rejects.toMatchObject({ codigo: CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO });
    expect(executou).toBe(false);
    expect(pool.waitingCount).toBe(0);
  });
});

describe('contexto técnico', () => {
  const tecnico = contextoTecnico({
    identidadeTecnica: 'worker-captura',
    finalidade: 'PROCESSAMENTO_DE_EMPRESA',
    tenantId: TENANT,
    empresaId: EMPRESA,
    correlationId: 'job-1',
  });

  it('carrega empresa e finalidade do trabalho, sem usuário', async () => {
    const dentro = await comContexto(pool, tecnico, estadoAtual);

    expect(dentro).toEqual({
      tenant: TENANT,
      usuario: null,
      empresa: EMPRESA,
      origem: 'TECNICA',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      humano: false,
      tecnico: true,
    });
    expect(await semContexto(pool, estadoAtual)).toEqual(SEM_CONTEXTO);
  });

  it('não troca de finalidade dentro da transação', async () => {
    await expect(
      comContexto(pool, tecnico, (cliente) => comFinalidade(cliente, 'ADMIN_ACESSO', async () => 1)),
    ).rejects.toBeInstanceOf(ErroDeDominio);
  });
});

describe('troca de finalidade na mesma transação', () => {
  it('eleva só no trecho e restaura a finalidade anterior', async () => {
    const resultado = await comContextoHumano(
      pool,
      { tenantId: TENANT, usuarioId: USUARIO },
      async (cliente) => {
        const antes = await estadoAtual(cliente);
        const elevada = await comFinalidade(cliente, 'ADMIN_ACESSO', () => estadoAtual(cliente));
        const depois = await estadoAtual(cliente);

        return { antes, elevada, depois };
      },
    );

    expect(resultado.antes.finalidade).toBe('COMUM');
    expect(resultado.elevada.finalidade).toBe('ADMIN_ACESSO');
    expect(resultado.elevada.usuario).toBe(USUARIO);
    expect(resultado.depois.finalidade).toBe('COMUM');
  });

  it('recusa finalidade que não é humana', async () => {
    await expect(
      comContextoHumano(pool, { tenantId: TENANT, usuarioId: USUARIO }, (cliente) =>
        comFinalidade(cliente, 'PROCESSAMENTO_DE_EMPRESA' as never, async () => 1),
      ),
    ).rejects.toMatchObject({ codigo: CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO });
  });

  it('recusa sem contexto algum', async () => {
    await expect(
      semContexto(pool, (cliente) => comFinalidade(cliente, 'ADMIN_ACESSO', async () => 1)),
    ).rejects.toMatchObject({ codigo: CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO });
  });
});

afterAll(async () => {
  await pool.end();
});
