import { describe, expect, it } from 'vitest';

import { classifyCaptureFailure, decideCaptureEligibility, evaluateBatch, nextAllowedAt } from './policy.js';

const NOW = new Date('2026-10-14T14:00:00.000Z');

const ready = () => ({
  companyActive: true,
  cnpjActive: true,
  certificateAvailable: true,
  signerAvailable: true,
  state: 'READY' as const,
  nextAllowedAt: NOW,
  blockedUntil: null,
  now: NOW,
});

describe('decideCaptureEligibility (SPEC-017 §3.2, §3.7)', () => {
  it('permite CNPJ ativo e pronto quando o limite temporal foi alcançado', () => {
    expect(decideCaptureEligibility(ready())).toEqual({ eligible: true });
  });

  it.each([
    ['empresa inativa', { companyActive: false }, 'DFE_CAPTURE_NOT_READY'],
    ['certificado ausente', { certificateAvailable: false }, 'DFE_CERTIFICATE_UNAVAILABLE'],
    ['Signer indisponível', { signerAvailable: false }, 'DFE_SIGNER_UNAVAILABLE'],
    ['captura concorrente', { state: 'CAPTURING' as const }, 'DFE_CAPTURE_ALREADY_QUEUED'],
  ])('recusa %s com código estável', (_label, change, code) => {
    expect(decideCaptureEligibility({ ...ready(), ...change })).toEqual({ eligible: false, code, availableAt: null });
  });

  it('não antecipa tempoMedio nem bloqueio 656', () => {
    const next = new Date('2026-10-14T14:05:00.000Z');
    const blocked = new Date('2026-10-14T15:00:00.000Z');

    expect(decideCaptureEligibility({ ...ready(), state: 'WAITING', nextAllowedAt: next })).toEqual({
      eligible: false,
      code: 'DFE_QUERY_TOO_EARLY',
      availableAt: next,
    });
    expect(decideCaptureEligibility({ ...ready(), state: 'BLOCKED_656', blockedUntil: blocked })).toEqual({
      eligible: false,
      code: 'DFE_CONSUMO_INDEVIDO',
      availableAt: blocked,
    });
  });
});

describe('nextAllowedAt (SPEC-017 §3.7)', () => {
  it('soma duração inteira não negativa ao término da chamada', () => {
    expect(nextAllowedAt(NOW, 120_000)).toEqual(new Date('2026-10-14T14:02:00.000Z'));
    expect(nextAllowedAt(NOW, 0)).toEqual(NOW);
  });

  it.each([-1, 1.5, Number.NaN])('recusa tempoMedio inválido: %s', (durationMs) => {
    expect(() => nextAllowedAt(NOW, durationMs)).toThrow('DFE_RESPONSE_INVALID');
  });
});

describe('evaluateBatch (SPEC-017 §3.5–§3.6)', () => {
  it('aceita lote ordenado com até 50 itens e cursor coerente', () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      nsu: String(index + 11).padStart(15, '0'),
      accessKey: String(index + 1).padStart(44, '1'),
      kind: index % 2 === 0 ? ('NFE_55' as const) : ('CTE' as const),
      rawContent: `<doc>${index}</doc>`,
    }));

    expect(evaluateBatch({ previousLastNsu: '000000000000010', returnedLastNsu: '000000000000060', maxNsu: '000000000000060', items })).toEqual({ ok: true });
  });

  it('recusa lote com mais de 50 itens', () => {
    const items = Array.from({ length: 51 }, (_, index) => ({ nsu: String(index + 1), accessKey: null, kind: 'NFE_55' as const, rawContent: 'x' }));
    expect(evaluateBatch({ previousLastNsu: '0', returnedLastNsu: '51', maxNsu: '51', items })).toEqual({ ok: false, code: 'DFE_BATCH_INVALID' });
  });

  it('recusa lote fora de ordem, espécie não suportada e cursor incoerente', () => {
    expect(evaluateBatch({ previousLastNsu: '10', returnedLastNsu: '12', maxNsu: '12', items: [
      { nsu: '12', accessKey: null, kind: 'NFE_55', rawContent: 'a' },
      { nsu: '11', accessKey: null, kind: 'CTE', rawContent: 'b' },
    ] })).toEqual({ ok: false, code: 'DFE_BATCH_INVALID' });
    expect(evaluateBatch({ previousLastNsu: '10', returnedLastNsu: '11', maxNsu: '11', items: [
      { nsu: '11', accessKey: null, kind: 'NFSE' as never, rawContent: 'x' },
    ] })).toEqual({ ok: false, code: 'DFE_BATCH_INVALID' });
    expect(evaluateBatch({ previousLastNsu: '10', returnedLastNsu: '09', maxNsu: '20', items: [] })).toEqual({ ok: false, code: 'DFE_RESPONSE_INVALID' });
    expect(evaluateBatch({ previousLastNsu: '10', returnedLastNsu: '12', maxNsu: '20', items: [
      { nsu: '11', accessKey: null, kind: 'NFE_55', rawContent: 'x' },
    ] })).toEqual({ ok: false, code: 'DFE_RESPONSE_INVALID' });
  });
});

describe('classifyCaptureFailure (SPEC-017 §3.7–§3.8)', () => {
  it('trata 656 como bloqueio de no mínimo uma hora e sem retry', () => {
    expect(classifyCaptureFailure({ kind: 'CONSUMO_INDEVIDO', providerRetryAt: null, now: NOW })).toEqual({
      retry: false,
      code: 'DFE_CONSUMO_INDEVIDO',
      blockedUntil: new Date('2026-10-14T15:00:00.000Z'),
    });
  });

  it('usa o maior prazo informado pelo provedor no 656', () => {
    const providerRetryAt = new Date('2026-10-14T16:00:00.000Z');
    expect(classifyCaptureFailure({ kind: 'CONSUMO_INDEVIDO', providerRetryAt, now: NOW }).blockedUntil).toEqual(providerRetryAt);
  });

  it.each(['TIMEOUT', 'SIGNER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'] as const)('classifica %s como transitória', (kind) => {
    expect(classifyCaptureFailure({ kind, providerRetryAt: null, now: NOW })).toMatchObject({ retry: true });
  });

  it.each(['CERTIFICATE_UNAVAILABLE', 'INVALID_RESPONSE', 'BATCH_CONFLICT'] as const)('classifica %s como definitiva', (kind) => {
    expect(classifyCaptureFailure({ kind, providerRetryAt: null, now: NOW })).toMatchObject({ retry: false });
  });
});
