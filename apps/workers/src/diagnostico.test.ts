import { ErroDoClienteDoSigner } from '@contaia/signer-client';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { deveIrParaDlq, motivoDaFalha, processarDiagnostico } from './diagnostico.js';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const dados = {
  tenantId: TENANT,
  empresaId: EMPRESA,
  finalidade: 'DFE_TESTE',
  correlationId: 'corr-0001-abcd',
  origem: 'AUTOMATICO',
} as const;

const resposta = { operacaoId: 'op-1', reutilizado: false, resultado: 'SUCESSO', codigo: null } as const;

describe('processarDiagnostico: o worker chama o Signer e decide o que é retry (SPEC-012 §3.8)', () => {
  it('chama o diagnóstico com o comando validado e devolve a resposta', async () => {
    const cliente = { diagnosticar: vi.fn().mockResolvedValue(resposta) };

    await expect(processarDiagnostico(dados, cliente)).resolves.toEqual(resposta);
    expect(cliente.diagnosticar).toHaveBeenCalledWith(dados);
  });

  it('payload inválido não adianta repetir: erro irrecuperável, sem chamar o Signer', async () => {
    const cliente = { diagnosticar: vi.fn() };

    await expect(processarDiagnostico({ ...dados, finalidade: 'LIVRE' }, cliente)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processarDiagnostico({ ...dados, url: 'https://evil.example' }, cliente)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(cliente.diagnosticar).not.toHaveBeenCalled();
  });

  it('a fila só carrega diagnóstico AUTOMÁTICO e sem pessoa: o teste manual não passa por ela (quem a alcançar não forja autoria)', async () => {
    const cliente = { diagnosticar: vi.fn() };

    await expect(processarDiagnostico({ ...dados, origem: 'MANUAL' }, cliente)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      processarDiagnostico({ ...dados, usuarioOriginadorId: '0198f3c2-0000-7000-8000-000000000003' }, cliente),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(cliente.diagnosticar).not.toHaveBeenCalled();
  });

  it('falha transitória do Signer volta como está, para o BullMQ repetir com backoff', async () => {
    const erro = new ErroDoClienteDoSigner('SIGNER_DESTINO_INDISPONIVEL', 504, 'corr-0001-abcd', true);
    const cliente = { diagnosticar: vi.fn().mockRejectedValue(erro) };

    await expect(processarDiagnostico(dados, cliente)).rejects.toBe(erro);
  });

  it('falha definitiva (certificado vencido, contexto, alçada) vira irrecuperável com o código', async () => {
    const cliente = {
      diagnosticar: vi.fn().mockRejectedValue(new ErroDoClienteDoSigner('SIGNER_CERTIFICADO_VENCIDO', 409, 'corr-0001-abcd', false)),
    };

    const erro = await processarDiagnostico(dados, cliente).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnrecoverableError);
    expect((erro as Error).message).toBe('SIGNER_CERTIFICADO_VENCIDO');
  });

  it('erro desconhecido é tratado como transitório (a causa pode ser rede)', async () => {
    const erro = new Error('algo');
    const cliente = { diagnosticar: vi.fn().mockRejectedValue(erro) };

    await expect(processarDiagnostico(dados, cliente)).rejects.toBe(erro);
  });
});

describe('DLQ: quando o job vai para a fila morta', () => {
  const job = (tentativas: number, limite: number) => ({ attemptsMade: tentativas, opts: { attempts: limite } });

  it('erro irrecuperável vai direto, na primeira tentativa', () => {
    expect(deveIrParaDlq(job(1, 5), new UnrecoverableError('SIGNER_CONTEXTO_INVALIDO'))).toBe(true);
  });

  it('transitório só vai quando esgota as tentativas', () => {
    expect(deveIrParaDlq(job(1, 5), new Error('x'))).toBe(false);
    expect(deveIrParaDlq(job(4, 5), new Error('x'))).toBe(false);
    expect(deveIrParaDlq(job(5, 5), new Error('x'))).toBe(true);
  });

  it('o motivo é o código estável quando existe, sem a mensagem crua', () => {
    expect(motivoDaFalha(new ErroDoClienteDoSigner('SIGNER_MTLS_RECUSADO', 502, null, true))).toBe('SIGNER_MTLS_RECUSADO');
    expect(motivoDaFalha(new UnrecoverableError('SIGNER_CERTIFICADO_VENCIDO'))).toBe('SIGNER_CERTIFICADO_VENCIDO');
    expect(motivoDaFalha(new Error('SENHA-SENTINELA-NAO-PODE-VAZAR'))).toBe('SIGNER_INDISPONIVEL');
  });
});
