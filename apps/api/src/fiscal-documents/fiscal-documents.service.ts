import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { comContextoHumano, getDfeCaptureCompany, listarDocumentosFiscais, obterDocumentoFiscal, registrarEventoDocumentoFiscal } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { FISCAL_DOCUMENTS_JOB, FISCAL_DOCUMENTS_JOB_OPTIONS, FiscalDocumentCommandSchema } from '@contaia/shared';
import type { Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { FISCAL_DOCUMENTS_API_QUEUE } from './fiscal-documents.queue';

const versaoParser = 'f18-1.0.0';
const chaveMascarada = (value: string | null) => value ? `${value.slice(0, 4)}…${value.slice(-4)}` : null;

@Injectable()
export class FiscalDocumentsService {
  constructor(private readonly pool: PoolDoBanco, private readonly storage: StorageService,
    @Inject(FISCAL_DOCUMENTS_API_QUEUE) private readonly queue: Queue | null) {}

  async listar(tenantId: string, userId: string, companyId: string, correlationId: string, page: number, state: string | null = null) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const rows = await listarDocumentosFiscais(client, companyId, page, state);
      return {
        pagina: page,
        temProximaPagina: rows.length > 20,
        itens: rows.slice(0, 20).map((row) => ({ ...row, chave_acesso: chaveMascarada(row.chave_acesso) })),
      };
    });
  }

  private async detalhe(client: PoolClient, companyId: string, documentId: string) {
    return obterDocumentoFiscal(client, companyId, documentId);
  }

  async obter(tenantId: string, userId: string, companyId: string, documentId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const record = await this.detalhe(client, companyId, documentId);
      if (!record) throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INDISPONIVEL, 'Documento fiscal não encontrado.');
      const publicRecord = { ...record, tamanho_bytes: Number(record.tamanho_bytes) } as Record<string, unknown>;
      delete publicRecord['original_key'];
      return publicRecord;
    });
  }

  private async lerOriginal(tenantId: string, userId: string, companyId: string, documentId: string, correlationId: string) {
    const record = await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const document = await this.detalhe(client, companyId, documentId) as (Record<string, unknown> & { original_key: string; hash_sha256: string; origens: Array<{ staging_id: string }> }) | null;
      if (!document || !document.origens[0]) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_ORIGINAL_UNAVAILABLE, 'Original fiscal indisponível.');
      return document;
    });
    const stagingId = record.origens[0]?.staging_id;
    if (!stagingId) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_ORIGINAL_UNAVAILABLE, 'Origem fiscal indisponível.');
    let original: Awaited<ReturnType<StorageService['obter']>>;
    try { original = await this.storage.obter(record.original_key); }
    catch { throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_ORIGINAL_UNAVAILABLE, 'Original fiscal indisponível.'); }
    const hash = createHash('sha256').update(original.conteudo).digest('hex');
    const valido = hash === record.hash_sha256;
    await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, (client) =>
      registrarEventoDocumentoFiscal(client, { tenantId, empresaId: companyId, documentId, stagingId,
        tipo: valido ? 'INTEGRIDADE_VERIFICADA' : 'INTEGRIDADE_DIVERGENTE', codigo: valido ? 'OK' : 'FISCAL_DOCUMENT_INTEGRITY_MISMATCH',
        detalhe: valido ? 'Hash SHA-256 verificado.' : 'Hash SHA-256 divergente.', parserVersion: versaoParser, hashSha256: hash, atorId: userId, correlationId }));
    return { original, valido };
  }

  async verificarIntegridade(tenantId: string, userId: string, companyId: string, documentId: string, correlationId: string) {
    const { valido } = await this.lerOriginal(tenantId,userId,companyId,documentId,correlationId);
    if (!valido) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_INTEGRITY_MISMATCH, 'A verificação do arquivo original encontrou divergência.');
    return { documentId, estado: 'INTEGRO', verificadoEm: new Date().toISOString() };
  }

  async original(tenantId: string, userId: string, companyId: string, documentId: string, correlationId: string) {
    const { original, valido } = await this.lerOriginal(tenantId,userId,companyId,documentId,correlationId);
    if (!valido) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_INTEGRITY_MISMATCH, 'O arquivo original não pode ser disponibilizado porque sua integridade diverge.');
    return original;
  }

  async reprocessar(tenantId: string, userId: string, companyId: string, documentId: string, correlationId: string) {
    if (!this.queue) throw new ErroDeDominio(CODIGOS_DE_ERRO.FILA_INDISPONIVEL, 'Fila de documentos fiscais indisponível.');
    const origin = await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const record = await this.detalhe(client, companyId, documentId) as (Record<string, unknown> & { origens: Array<{ staging_id: string }> }) | null;
      if (!record?.origens[0]) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_ORIGINAL_UNAVAILABLE, 'Origem fiscal indisponível para reprocessamento.');
      return record.origens[0].staging_id;
    });
    const command = FiscalDocumentCommandSchema.parse({ tenantId, companyId, stagingId: origin, correlationId });
    const jobId = `fiscal-${origin}`;
    const current = await this.queue.getJob(jobId);
    if (current && ['waiting','active','delayed','waiting-children'].includes(await current.getState())) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_REPROCESS_ALREADY_QUEUED, 'Este documento já está na fila de reprocessamento.');
    }
    if (current) await current.remove();
    const queued = await this.queue.add(FISCAL_DOCUMENTS_JOB, command, { ...FISCAL_DOCUMENTS_JOB_OPTIONS, jobId });
    await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, (client) =>
      registrarEventoDocumentoFiscal(client, { tenantId, empresaId: companyId, documentId, stagingId: origin,
        tipo: 'REPROCESSAMENTO_SOLICITADO', codigo: 'FISCAL_REPROCESS_REQUESTED', detalhe: `Reprocessamento solicitado; job ${queued.id}.`,
        parserVersion: versaoParser, atorId: userId, correlationId }));
    return { documentId, status: 'QUEUED' as const };
  }
}
