/**
 * O processador do job registra a FALHA ENQUANTO o job ainda está ativo, na última tentativa
 * (SPEC-013 §6.4: "esgotamento termina em FALHA acionável"). No BullMQ 6, o evento `failed` só
 * dispara depois de o job ter sido finalizado; registrar lá deixava a tentativa presa em
 * VALIDANDO quando o processo morria ou o banco ainda estava fora.
 */
import { DelayedError, UnrecoverableError } from 'bullmq';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { identificadoresDoJob } from './consumidor.js';
import { ErroDoArmazenamento } from './leitura-s3.js';
import { processarJobDeValidacao, type JobDeValidacao } from './processador.js';
import type * as ModuloDaValidacao from './validacao.js';
import { processarValidacao, registrarFalhaDaValidacao } from './validacao.js';

vi.mock('./validacao.js', async (original) => ({
  ...(await original<typeof ModuloDaValidacao>()),
  processarValidacao: vi.fn(),
  registrarFalhaDaValidacao: vi.fn(),
}));

const processar = vi.mocked(processarValidacao);
const registrarFalha = vi.mocked(registrarFalhaDaValidacao);

const dados = {
  tenantId: '0198f3c2-0000-7000-8000-000000000001',
  empresaId: '0198f3c2-0000-7000-8000-000000000002',
  tentativaId: '0198f3c2-0000-7000-8000-000000000003',
  correlationId: 'corr-plano-0001',
} as const;

const deps = { pool: {} as Pool, ler: vi.fn(), agora: () => new Date('2026-10-08T12:00:00Z'), esperaParaRegistrarFalhaMs: 15_000 };

const job = (attemptsMade: number, attempts = 3) => {
  const moveToDelayed = vi.fn<JobDeValidacao['moveToDelayed']>(async () => undefined);

  return { data: dados, attemptsMade, opts: { attempts }, moveToDelayed } satisfies JobDeValidacao;
};

beforeEach(() => {
  processar.mockReset();
  registrarFalha.mockReset();
});

describe('processarJobDeValidacao', () => {
  it('sucesso: devolve o resultado da validação, sem tocar a FALHA', async () => {
    processar.mockResolvedValue({ desfecho: 'JA_PROCESSADA' });

    await expect(processarJobDeValidacao(deps, job(0), 'token')).resolves.toEqual({ desfecho: 'JA_PROCESSADA' });
    expect(registrarFalha).not.toHaveBeenCalled();
  });

  it('falha transitória numa tentativa que não é a última: relança e NÃO registra FALHA', async () => {
    const erro = new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL');
    processar.mockRejectedValue(erro);

    await expect(processarJobDeValidacao(deps, job(1), 'token')).rejects.toBe(erro);
    expect(registrarFalha).not.toHaveBeenCalled();
  });

  it('falha transitória na última tentativa: registra FALHA com o código estável e só então relança o erro original', async () => {
    const erro = new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL');
    const ordem: string[] = [];
    processar.mockRejectedValue(erro);
    registrarFalha.mockImplementation(async () => {
      ordem.push('falha');

      return true;
    });

    await expect(processarJobDeValidacao(deps, job(2), 'token')).rejects.toBe(erro);
    expect(registrarFalha).toHaveBeenCalledWith(deps, dados, 'ARMAZENAMENTO_INDISPONIVEL');
    expect(ordem).toEqual(['falha']);
  });

  it('irrecuperável já na primeira tentativa: registra FALHA antes de o job falhar', async () => {
    const erro = new UnrecoverableError('ORIGINAL_NAO_ENCONTRADO');
    processar.mockRejectedValue(erro);
    registrarFalha.mockResolvedValue(true);

    await expect(processarJobDeValidacao(deps, job(0), 'token')).rejects.toBe(erro);
    expect(registrarFalha).toHaveBeenCalledWith(deps, dados, 'ORIGINAL_NAO_ENCONTRADO');
  });

  it.each(['PAYLOAD_INVALIDO', 'TENTATIVA_NAO_ENCONTRADA'])('irrecuperável %s: não há tentativa a marcar', async (codigo) => {
    processar.mockRejectedValue(new UnrecoverableError(codigo));

    await expect(processarJobDeValidacao(deps, job(0), 'token')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(registrarFalha).not.toHaveBeenCalled();
  });

  it('sem `attempts` nas opções vale uma tentativa: a primeira já é a última', async () => {
    processar.mockRejectedValue(new Error('x'));
    registrarFalha.mockResolvedValue(true);
    const semOpcoes = { ...job(0), opts: {} };

    await expect(processarJobDeValidacao(deps, semOpcoes, 'token')).rejects.toThrow('x');
    expect(registrarFalha).toHaveBeenCalledWith(deps, dados, 'FALHA_NA_VALIDACAO');
  });

  it('banco fora ao registrar a FALHA: o job volta adiado (sem gastar tentativa) e DelayedError sai no lugar do erro', async () => {
    processar.mockRejectedValue(new ErroDoArmazenamento('ARMAZENAMENTO_INDISPONIVEL'));
    registrarFalha.mockRejectedValue(new Error('ECONNREFUSED'));
    const ultimo = job(2);
    const antes = Date.now();

    await expect(processarJobDeValidacao(deps, ultimo, 'token-1')).rejects.toBeInstanceOf(DelayedError);

    expect(ultimo.moveToDelayed).toHaveBeenCalledTimes(1);
    const [quando, token] = ultimo.moveToDelayed.mock.calls[0]!;
    expect(token).toBe('token-1');
    expect(quando).toBeGreaterThanOrEqual(antes + 15_000);
    expect(quando).toBeLessThan(antes + 15_000 + 5_000);
  });
});

describe('identificadoresDoJob: o que vai para a fila morta', () => {
  it('só os quatro identificadores do comando, como texto curto; nada arbitrário do payload', () => {
    expect(identificadoresDoJob({ ...dados, mapeamento: { codigo: 'x' }, conteudo: 'SENHA-SENTINELA' })).toEqual(dados);
    expect(identificadoresDoJob({ tentativaId: 'nao-e-uuid', extra: 1, tenantId: 'x'.repeat(500) })).toEqual({ tentativaId: 'nao-e-uuid' });
    expect(identificadoresDoJob(null)).toEqual({});
    expect(identificadoresDoJob('texto')).toEqual({});
  });
});
