/**
 * O processador do job de empregados registra a FALHA ENQUANTO o job ainda está ativo, na última
 * tentativa (SPEC-014 §6.4: "esgotamento termina em FALHA acionável com correlationId"). A mecânica
 * é a comum das importações; aqui se prova que ela está ligada à validação de empregados e que o
 * que sai para o BullMQ (e daí para o Redis e a fila morta) é só código estável.
 */
import { OPCOES_DE_VALIDACAO_EMPREGADOS } from '@contaia/shared';
import { DelayedError, UnrecoverableError } from 'bullmq';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDoArmazenamento } from '../importacao/leitura-s3.js';
import type { JobDeValidacao } from '../importacao/processador.js';
import { identificadoresDoJob, processarJobDeValidacaoDeEmpregados } from './consumidor.js';
import type * as ModuloDaValidacao from './validacao.js';
import { motivoDaFalhaDaValidacao, processarValidacaoDeEmpregados, registrarFalhaDaValidacaoDeEmpregados } from './validacao.js';

vi.mock('./validacao.js', async (original) => ({
  ...(await original<typeof ModuloDaValidacao>()),
  processarValidacaoDeEmpregados: vi.fn(),
  registrarFalhaDaValidacaoDeEmpregados: vi.fn(),
}));

const processar = vi.mocked(processarValidacaoDeEmpregados);
const registrarFalha = vi.mocked(registrarFalhaDaValidacaoDeEmpregados);

const dados = {
  tenantId: '0198f3c2-0000-7000-8000-000000000001',
  empresaId: '0198f3c2-0000-7000-8000-000000000002',
  tentativaId: '0198f3c2-0000-7000-8000-000000000003',
  correlationId: 'corr-emp-0001',
} as const;

const deps = { pool: {} as Pool, ler: vi.fn(), agora: () => new Date('2026-10-08T12:00:00Z'), esperaParaRegistrarFalhaMs: 15_000 };
const TENTATIVAS = OPCOES_DE_VALIDACAO_EMPREGADOS.attempts;

const job = (attemptsMade: number, attempts: number = TENTATIVAS) => {
  const moveToDelayed = vi.fn<JobDeValidacao['moveToDelayed']>(async () => undefined);

  return { data: dados, attemptsMade, opts: { attempts }, moveToDelayed } satisfies JobDeValidacao;
};

beforeEach(() => {
  processar.mockReset();
  registrarFalha.mockReset();
});

describe('processarJobDeValidacaoDeEmpregados', () => {
  it('as opções do job são as da SPEC: 5 tentativas com backoff exponencial de 2000 ms', () => {
    expect(OPCOES_DE_VALIDACAO_EMPREGADOS).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 2000 } });
  });

  it('sucesso: devolve o resultado da validação, sem tocar a FALHA', async () => {
    processar.mockResolvedValue({ desfecho: 'JA_PROCESSADA' });

    await expect(processarJobDeValidacaoDeEmpregados(deps, job(0), 'token')).resolves.toEqual({ desfecho: 'JA_PROCESSADA' });
    expect(registrarFalha).not.toHaveBeenCalled();
  });

  it('falha transitória que não é a última: relança recuperável com o código e NÃO registra FALHA', async () => {
    processar.mockRejectedValue(new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL'));

    const lancado = await processarJobDeValidacaoDeEmpregados(deps, job(TENTATIVAS - 2), 'token').catch((e: unknown) => e);

    expect(lancado).not.toBeInstanceOf(UnrecoverableError);
    expect((lancado as Error).message).toBe('ARMAZENAMENTO_INDISPONIVEL');
    expect(registrarFalha).not.toHaveBeenCalled();
  });

  it('falha transitória na ÚLTIMA tentativa: registra a FALHA com o código estável e só então relança o código', async () => {
    processar.mockRejectedValue(new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL'));
    registrarFalha.mockResolvedValue(true);

    const lancado = await processarJobDeValidacaoDeEmpregados(deps, job(TENTATIVAS - 1), 'token').catch((e: unknown) => e);

    expect(registrarFalha).toHaveBeenCalledWith(deps, dados, 'ARMAZENAMENTO_INDISPONIVEL');
    expect(lancado).toBeInstanceOf(UnrecoverableError);
    expect(motivoDaFalhaDaValidacao(lancado as Error)).toBe('ARMAZENAMENTO_INDISPONIVEL');
  });

  it('ORIGINAL_NAO_ENCONTRADO é definitivo: FALHA já na primeira tentativa', async () => {
    processar.mockRejectedValue(new UnrecoverableError('ORIGINAL_NAO_ENCONTRADO'));
    registrarFalha.mockResolvedValue(true);

    const lancado = await processarJobDeValidacaoDeEmpregados(deps, job(0), 'token').catch((e: unknown) => e);

    expect(registrarFalha).toHaveBeenCalledWith(deps, dados, 'ORIGINAL_NAO_ENCONTRADO');
    expect(lancado).toBeInstanceOf(UnrecoverableError);
    expect((lancado as Error).message).toBe('ORIGINAL_NAO_ENCONTRADO');
  });

  it.each(['PAYLOAD_INVALIDO', 'TENTATIVA_NAO_ENCONTRADA'])('%s: não há tentativa a marcar', async (codigo) => {
    processar.mockRejectedValue(new UnrecoverableError(codigo));

    await expect(processarJobDeValidacaoDeEmpregados(deps, job(0), 'token')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(registrarFalha).not.toHaveBeenCalled();
  });

  it('o erro relançado é só o código: CPF/nome na mensagem do banco não chegam ao hash do job no Redis', async () => {
    const sentinela = 'Failing row contains (52998224725, Maria Souza Sentinela)';
    for (const feitas of [0, TENTATIVAS - 1]) {
      processar.mockRejectedValue(Object.assign(new Error(`new row violates check constraint; ${sentinela}`), { code: '23514', detail: sentinela }));
      registrarFalha.mockResolvedValue(true);

      const lancado = await processarJobDeValidacaoDeEmpregados(deps, job(feitas), 'token').catch((e: unknown) => e);

      expect((lancado as Error).message).toBe('FALHA_NA_VALIDACAO');
      expect(String((lancado as Error).stack)).not.toContain('Sentinela');
      expect(JSON.stringify(lancado)).not.toContain('Sentinela');
    }
  });

  it('banco fora ao registrar a FALHA: o job volta adiado (sem gastar tentativa) e DelayedError sai no lugar do erro', async () => {
    processar.mockRejectedValue(new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL'));
    registrarFalha.mockRejectedValue(new Error('ECONNREFUSED'));
    const ultimo = job(TENTATIVAS - 1);
    const antes = Date.now();

    await expect(processarJobDeValidacaoDeEmpregados(deps, ultimo, 'token-1')).rejects.toBeInstanceOf(DelayedError);

    expect(ultimo.moveToDelayed).toHaveBeenCalledTimes(1);
    const [quando, token] = ultimo.moveToDelayed.mock.calls[0]!;
    expect(token).toBe('token-1');
    expect(quando).toBeGreaterThanOrEqual(antes + 15_000);
  });
});

describe('identificadoresDoJob: o que vai para a fila morta', () => {
  it('só os quatro identificadores do comando; nada arbitrário do payload (nem CPF)', () => {
    expect(identificadoresDoJob({ ...dados, cpf: '52998224725', nome: 'Maria Souza' })).toEqual(dados);
  });
});
