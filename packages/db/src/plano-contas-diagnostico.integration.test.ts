/**
 * Diagnóstico acionável da tentativa (SPEC-013 §3.10, §7): o código estável do último evento de
 * falha técnica ou de rejeição do arquivo, lido da trilha append-only pelo papel `contaia_app`, com
 * a RLS valendo. Nunca a mensagem crua: o evento só guarda o código.
 */
import { createHash, randomUUID } from 'node:crypto';

import { contextoTecnico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContexto } from './contexto.js';
import { buscarDiagnosticoDaTentativa } from './repositorios/plano-contas-consultas.js';
import { criarTentativa, registrarEvento, type NovoEvento } from './repositorios/plano-contas.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';
import { comoUsuario } from './testes/suporte.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;

const como = <T>(executar: (cliente: PoolClient) => Promise<T>, tenantId: string = c.tenantA): Promise<T> =>
  comoUsuario(app, tenantId, c.usuarios.naCarteira, executar);

const comoWorker = <T>(executar: (cliente: PoolClient) => Promise<T>): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'workers-plano-contas',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: c.tenantA,
      empresaId: c.empresaA1,
      correlationId: 'teste-diagnostico',
    }),
    executar,
  );

let instante = Date.parse('2026-10-08T12:00:00.000Z');
const agora = (): Date => new Date((instante += 1000));

const novaTentativa = async (): Promise<string> =>
  (
    await como((cliente) =>
      criarTentativa(cliente, {
        tenantId: c.tenantA,
        empresaId: c.empresaA1,
        hashArquivo: createHash('sha256').update(randomUUID()).digest('hex'),
        mapeamento: { codigo: 'codigo' },
        arquivoNome: 'plano.csv',
        arquivoTamanho: 10,
        arquivoChave: `${c.tenantA}/${c.empresaA1}/plano-contas/${randomUUID()}.csv`,
        usuarioIniciadorId: c.usuarios.naCarteira,
        correlationId: 'teste-diagnostico',
        agora: agora(),
      }),
    )
  ).id;

const evento = (tentativaId: string, dados: Pick<NovoEvento, 'acao' | 'estadoNovo' | 'codigo'>): Promise<void> =>
  comoWorker((cliente) =>
    registrarEvento(cliente, {
      ...dados,
      empresaId: c.empresaA1,
      tentativaId,
      estadoAnterior: 'VALIDANDO',
      usuarioId: null,
      totais: null,
      correlationId: 'teste-diagnostico',
      agora: agora(),
    }),
  );

beforeAll(async () => {
  c = await montarCenario(admin);
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('buscarDiagnosticoDaTentativa', () => {
  it('sem evento de falha nem de rejeição com código → nulo', async () => {
    const tentativaId = await novaTentativa();
    await evento(tentativaId, { acao: 'INICIAR_VALIDACAO', estadoNovo: 'VALIDANDO', codigo: null });
    // Rejeição por conteúdo das linhas: sem código de arquivo.
    await evento(tentativaId, { acao: 'VALIDACAO_REJEITADA', estadoNovo: 'REJEITADA', codigo: null });

    await expect(como((cliente) => buscarDiagnosticoDaTentativa(cliente, c.empresaA1, tentativaId))).resolves.toBeNull();
  });

  it('rejeição do arquivo → o código estável do evento', async () => {
    const tentativaId = await novaTentativa();
    await evento(tentativaId, { acao: 'VALIDACAO_REJEITADA', estadoNovo: 'REJEITADA', codigo: 'ARQUIVO_VAZIO' });

    await expect(como((cliente) => buscarDiagnosticoDaTentativa(cliente, c.empresaA1, tentativaId))).resolves.toEqual({
      acao: 'VALIDACAO_REJEITADA',
      codigo: 'ARQUIVO_VAZIO',
    });
  });

  it('vale o ÚLTIMO evento de falha ou rejeição com código', async () => {
    const tentativaId = await novaTentativa();
    await evento(tentativaId, { acao: 'FALHA_TECNICA', estadoNovo: 'FALHA', codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
    await evento(tentativaId, { acao: 'FALHA_TECNICA', estadoNovo: 'FALHA', codigo: 'FALHA_NA_APLICACAO' });
    await evento(tentativaId, { acao: 'CANCELAR', estadoNovo: 'CANCELADA', codigo: 'IGNORADO' });

    await expect(como((cliente) => buscarDiagnosticoDaTentativa(cliente, c.empresaA1, tentativaId))).resolves.toEqual({
      acao: 'FALHA_TECNICA',
      codigo: 'FALHA_NA_APLICACAO',
    });
  });

  it('outra empresa da carteira ou outro tenant não lê o diagnóstico', async () => {
    const tentativaId = await novaTentativa();
    await evento(tentativaId, { acao: 'FALHA_TECNICA', estadoNovo: 'FALHA', codigo: 'FALHA_NA_VALIDACAO' });

    await expect(como((cliente) => buscarDiagnosticoDaTentativa(cliente, c.empresaA2, tentativaId))).resolves.toBeNull();
    await expect(
      comoUsuario(app, c.tenantB, c.usuarios.deB, (cliente) => buscarDiagnosticoDaTentativa(cliente, c.empresaA1, tentativaId)),
    ).resolves.toBeNull();
  });
});
