import { describe, expect, it } from 'vitest';
import { FISCAL_RISK_JOB_OPTIONS, FiscalRiskCommandSchema, PropostaDeManifestacaoSchema } from './fiscal-risk.js';

const proposta = {
  tipo_manifestacao: '210240',
  confianca: 0.71,
  justificativa: 'Há divergência entre o histórico disponível e a operação descrita.',
  riscos: [{ codigo: 'HISTORICO_DIVERGENTE', severidade: 'media', evidencias: ['historico:ultimos-12-meses'] }],
  evidencias: ['documento:valor-total', 'configuracao:limite-vigente'],
  lacunas: ['pedido:indisponivel'],
};

describe('contratos de classificação fiscal F20', () => {
  it('aceita proposta fechada, com riscos, evidências e lacunas separados', () => {
    expect(PropostaDeManifestacaoSchema.parse(proposta)).toEqual(proposta);
  });

  it('recusa campo extra, score fora da faixa, severidade desconhecida e evidência vazia', () => {
    expect(PropostaDeManifestacaoSchema.safeParse({ ...proposta, aprovado: true }).success).toBe(false);
    expect(PropostaDeManifestacaoSchema.safeParse({ ...proposta, confianca: 1.01 }).success).toBe(false);
    expect(PropostaDeManifestacaoSchema.safeParse({ ...proposta, riscos: [{ codigo: 'R', severidade: 'critica', evidencias: [] }] }).success).toBe(false);
    expect(PropostaDeManifestacaoSchema.safeParse({ ...proposta, evidencias: [' '] }).success).toBe(false);
  });

  it('aceita somente identidade versionada com UUIDs e correlação', () => {
    const command = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      companyId: '00000000-0000-4000-8000-000000000002',
      documentId: '00000000-0000-4000-8000-000000000003',
      configurationId: '00000000-0000-4000-8000-000000000004',
      executionId: '00000000-0000-4000-8000-000000000005',
      correlationId: 'corr-f20-0001',
    };
    expect(FiscalRiskCommandSchema.parse(command)).toEqual(command);
    expect(FiscalRiskCommandSchema.safeParse({ ...command, documentVersion: 2 }).success).toBe(false);
    expect(FiscalRiskCommandSchema.safeParse({ ...command, companyId: 'external' }).success).toBe(false);
  });

  it('limita execução automática a três tentativas com backoff exponencial', () => {
    expect(FISCAL_RISK_JOB_OPTIONS.attempts).toBe(3);
    expect(FISCAL_RISK_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 1_000 });
    expect(FISCAL_RISK_JOB_OPTIONS.removeOnFail).toBe(false);
  });
});
