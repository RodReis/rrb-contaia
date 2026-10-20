import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { comContextoHumano, getDfeCaptureCompany, listarDocumentosFiscais, obterDocumentoFiscal, registrarEventoDocumentoFiscal, listarResumoCienciasDaEmissao, obterCienciaDaEmissao, listarHistoricoDaCiencia, listarTentativasDaCiencia, retomarCienciaDaEmissao, listarItensParaResolucaoTributaria, persistirSnapshotsResolucaoTributaria, listarSnapshotsResolucaoTributaria, obterRegimeTributarioHistorico, registrarEventoResolucaoTributaria, listarFilaResolucaoTributaria } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, decimalDeclaradoParaCentavos, resolveEntryTax, statusSubstituicaoTributariaComEvidencia, validateIcmsStDeclaredEvidence, type CuratedTaxPackage } from '@contaia/domain';
import { FISCAL_DOCUMENTS_JOB, FISCAL_DOCUMENTS_JOB_OPTIONS, FiscalDocumentCommandSchema } from '@contaia/shared';
import { CuratedTaxPackageSchema } from '@contaia/shared';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { FISCAL_DOCUMENTS_API_QUEUE } from './fiscal-documents.queue';
import { noCatalogoTributario } from '../tax-rules/catalogo-contexto';

const versaoParser = 'f18-1.0.0';
const chaveMascarada = (value: string | null) => value ? `${value.slice(0, 4)}…${value.slice(-4)}` : null;

export const statusImportacaoPeloCfop = (cfop: string | null): boolean | null => {
  if (cfop === null || !/^\d{4}$/u.test(cfop)) return null;
  return cfop.startsWith('3');
};

export const statusMonofasicoPelosCst = (tributos: readonly Readonly<{ codigo: string; situacao: string | null }>[]): boolean | null => {
  const situacoes = tributos.filter((tributo) => tributo.codigo === 'PIS' || tributo.codigo === 'COFINS')
    .map((tributo) => tributo.situacao).filter((situacao): situacao is string => situacao !== null);
  if (situacoes.some((situacao) => situacao === '04')) return true;
  if (situacoes.length >= 2 && situacoes.every((situacao) => /^\d{2}$/u.test(situacao) && situacao !== '04')) return false;
  return null;
};

export const statusDevolucaoTransferenciaPeloCfop = (cfop: string | null): boolean | null => {
  if (cfop === null || !/^\d{4}$/u.test(cfop)) return null;
  const operacao = Number(cfop.slice(1));
  if ((operacao >= 201 && operacao <= 208) || (operacao >= 410 && operacao <= 411) ||
      (operacao >= 503 && operacao <= 505) || operacao === 553 || operacao === 555 || operacao === 556 ||
      (operacao >= 660 && operacao <= 662) || (operacao >= 901 && operacao <= 925)) return true;
  if (operacao === 101 || operacao === 102) return false;
  return null;
};

export const statusStContribuicoesPelosCst = (tributos: readonly Readonly<{ codigo: string; situacao: string | null }>[]): boolean | null => {
  const situacoes = tributos.filter((tributo) => tributo.codigo === 'PIS' || tributo.codigo === 'COFINS')
    .map((tributo) => tributo.situacao).filter((situacao): situacao is string => situacao !== null);
  if (situacoes.some((situacao) => situacao === '05')) return true;
  if (situacoes.length >= 2 && situacoes.every((situacao) => /^\d{2}$/u.test(situacao) && situacao !== '05')) return false;
  return null;
};

export const statusBeneficioPeloCBenef = (codigo: string | null): boolean | null => {
  if (codigo === null || codigo.trim() === '' || codigo.trim().toUpperCase() === 'SEM CBENEF') return null;
  return true;
};

@Injectable()
export class FiscalDocumentsService {
  constructor(private readonly pool: PoolDoBanco, private readonly storage: StorageService,
    @Inject(FISCAL_DOCUMENTS_API_QUEUE) private readonly queue: Queue | null) {}

  async listarCiencias(tenantId:string,userId:string,companyId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId)throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      return {itens:await listarResumoCienciasDaEmissao(client,companyId)};
    });
  }

  async obterCiencia(tenantId:string,userId:string,companyId:string,id:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId)throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const ciencia=await obterCienciaDaEmissao(client,companyId,id);
      if(!ciencia)throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_ACCESS_DENIED,'Ciência não encontrada.');
      const [historico,tentativas]=await Promise.all([listarHistoricoDaCiencia(client,companyId,id),listarTentativasDaCiencia(client,companyId,id)]);
      return {ciencia,historico,tentativas};
    });
  }

  async retomarCiencia(tenantId:string,userId:string,companyId:string,id:string,correlationId:string){
    const item=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId)throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      return retomarCienciaDaEmissao(client,{tenantId,empresaId:companyId,id,correlationId});
    });
    return {acknowledgementId:item.id,status:'SCHEDULED' as const};
  }

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

  async resolverTratamentoTributario(tenantId: string, userId: string, companyId: string, documentId: string,
    correlationId: string, input: Readonly<{ expectedDocumentRevision: string; packageId?: string | undefined; resaleItemNumbers: readonly number[]; idempotencyKey: string; reprocessingReason?: string | undefined }>) {
    const publishedPackages = await noCatalogoTributario(this.pool.instancia,correlationId,(client) =>
      client.query<{ id: string; content: Record<string,unknown>; content_sha256: string }>(
        'select id,content,content_sha256 from app.tax_package_list(false) where status=\'PUBLISHED\'',
      ));
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const authorizedDocument = await obterDocumentoFiscal(client, companyId, documentId);
      if (!authorizedDocument) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_ACCESS_DENIED, 'Documento fiscal não encontrado.');
      const source = await listarItensParaResolucaoTributaria(client, companyId, documentId);
      if (!source || source.estado !== 'PROCESSADO') throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_ACCESS_DENIED, 'Apenas NF-e processada pode receber resolução tributária.');
      const destinatario = authorizedDocument.partes.find((parte: { papel: string; identificador: string | null }) => parte.papel === 'DESTINATARIO')?.identificador?.replace(/\D/gu, '');
      const emitente = authorizedDocument.partes.find((parte: { papel: string; identificador: string | null }) => parte.papel === 'EMITENTE')?.identificador?.replace(/\D/gu, '');
      if (source.especie !== 'NFE_55' || source.modelo !== '55' || !destinatario || !emitente ||
          destinatario !== company.cnpj.replace(/\D/gu, '') || emitente === destinatario) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_TREATMENT_DOCUMENT_NOT_ENTRY,
          'A resolução F26 só aceita NF-e modelo 55 de entrada endereçada à empresa selecionada.');
      }
      if (source.protocolo === null) throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_TREATMENT_DOCUMENT_UNAUTHORIZED,
        'A resolução F26 exige protocolo de autorização da NF-e.');
      const sourceItemNumbers = new Set(source.itens.map((item) => item.numero));
      if (input.resaleItemNumbers.some((number) => !sourceItemNumbers.has(number))) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_TREATMENT_DOCUMENT_CONFLICT, 'A declaração inclui item que não pertence à revisão atual da NF-e.');
      }
      const resaleItemNumbers = new Set(input.resaleItemNumbers);
      const regimeHistory = await obterRegimeTributarioHistorico(client, companyId, source.emitido_em);
      const regime = regimeHistory?.regime ?? null;
      const matchingPackages = publishedPackages.rows.flatMap((row) => {
        if (input.packageId !== undefined && row.id !== input.packageId) return [];
        const parsed = CuratedTaxPackageSchema.safeParse(row.content);
        if (!parsed.success) return [];
        const content = parsed.data as CuratedTaxPackage;
        const operationType = source.origem_uf === null || source.destino_uf === null ? null :
          source.origem_uf === source.destino_uf ? 'COMPRA_INTERNA_REVENDA' :
            source.origem_uf === 'EX' || source.destino_uf === 'EX' ? null : 'COMPRA_INTERESTADUAL_REVENDA';
        const matches = content.jurisdiction === 'GO' && source.modelo === '55' && typeof source.emitido_em === 'string' &&
          regime !== null && content.regimes.includes(regime as 'SIMPLES_NACIONAL'|'LUCRO_PRESUMIDO') &&
          content.document.direction === 'ENTRY' && content.document.purpose === 'RESALE' &&
          operationType !== null && content.operations.includes(operationType) &&
          content.validFrom <= source.emitido_em &&
          (content.validUntil === null || source.emitido_em <= content.validUntil);
        return matches ? [{ id: row.id, content, sha256: row.content_sha256 }] : [];
      });
      if (input.packageId !== undefined && matchingPackages.length !== 1) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_PACKAGE_NOT_APPLICABLE,
          'Pacote não publicado ou incompatível com a jurisdição, regime, documento ou data do fato.');
      }
      const selectedPackage = matchingPackages.length === 1 ? matchingPackages[0] ?? null : null;
      const items = source.itens.map((item) => {
        const tributosDoItem = source.tributos.filter((tributo) => tributo.numero_item === item.numero);
        const hasSubstitutionTax = statusSubstituicaoTributariaComEvidencia(tributosDoItem);
        const isImport = statusImportacaoPeloCfop(item.cfop);
        const isMonophase = statusMonofasicoPelosCst(tributosDoItem);
        const hasContributionSubstitution = statusStContribuicoesPelosCst(tributosDoItem);
        const hasUnmodeledBenefit = statusBeneficioPeloCBenef(item.codigo_beneficio);
        const isReturnOrTransfer = statusDevolucaoTransferenciaPeloCfop(item.cfop);
        const missingInputs = [
          ...(!regime ? ['REGIME_HISTORICO'] : []),
          ...(!resaleItemNumbers.has(item.numero) ? ['FINALIDADE_AQUISICAO'] : []),
          ...(!source.emitido_em ? ['DATA_FATO_GERADOR'] : []),
          ...(!source.origem_uf ? ['UF_ORIGEM'] : []),
          ...(!source.destino_uf ? ['UF_DESTINO'] : []),
          ...(!item.cfop ? ['CFOP'] : []),
          ...(!item.ncm ? ['NCM'] : []),
          ...(!item.cst_csosn ? ['CST_CSOSN'] : []),
          ...(hasSubstitutionTax === null ? ['ST_STATUS'] : []),
          ...(isImport === null ? ['IMPORT_STATUS'] : []),
          ...(isMonophase === null ? ['MONOPHASE_STATUS'] : []),
          ...(hasContributionSubstitution === true ? ['CONTRIBUTION_SUBSTITUTION_OUTSIDE_COVERAGE'] : []),
          ...(hasUnmodeledBenefit === null ? ['BENEFIT_STATUS'] : []),
          ...(isReturnOrTransfer === null ? ['RETURN_TRANSFER_STATUS'] : []),
        ];
        const facts = {
          itemNumber: item.numero, parserVersion: item.parser_version, factDate: source.emitido_em,
          regime, regimeEffectiveDate: regimeHistory?.vigente_desde ?? null,
          purpose: resaleItemNumbers.has(item.numero) ? 'RESALE' : null,
          model: source.modelo, status: source.estado, authorizedProtocolPresent: source.protocolo !== null,
          originUf: item.origem_uf, destinationUf: item.destino_uf, cfop: item.cfop, ncm: item.ncm, cest: item.cest ?? null,
          cstCsosn: item.cst_csosn, codigoBeneficio: item.codigo_beneficio,
          declaredValue: item.valor, missingInputs,
          packageSources: selectedPackage?.content.sources ?? [],
          tributos: tributosDoItem,
        };
        const resolverFacts = {
          factDate: source.emitido_em,
          regime,
          originUf: item.origem_uf, destinationUf: item.destino_uf,
          documentModel: source.modelo, authorized: source.protocolo !== null,
          operationType: item.origem_uf === null || item.destino_uf === null ? null :
            item.origem_uf === item.destino_uf ? 'COMPRA_INTERNA_REVENDA' :
              item.origem_uf === 'EX' || item.destino_uf === 'EX' ? null : 'COMPRA_INTERESTADUAL_REVENDA',
          purpose: resaleItemNumbers.has(item.numero) ? 'RESALE' : null, cfop: item.cfop, ncm: item.ncm, cst: item.cst_csosn,
          hasSubstitutionTax: hasContributionSubstitution === true ? true : hasSubstitutionTax,
          isImport, isMonophase,
          hasUnmodeledBenefit, isReturnOrTransfer,
          declaredCents: item.valor === null ? null : (() => {
            const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(item.valor!);
            return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null;
          })(),
        } as const;
        const icmsStEvidence = tributosDoItem.find((tributo) => tributo.codigo === 'ICMS_ST');
        const declaredStCents = decimalDeclaradoParaCentavos(icmsStEvidence?.valor ?? null);
        const decisions = (['ICMS','PIS','COFINS','IBS_UF','IBS_MUN','CBS'] as const).map((tax) => {
          const decision = resolveEntryTax(selectedPackage?.content ?? null, resolverFacts, tax, selectedPackage?.sha256 ?? null);
          if (decision.reasonCodes.includes('AMBIGUOUS_RULES')) {
            throw new ErroDeConflito(CODIGOS_DE_ERRO.TAX_TREATMENT_RULE_AMBIGUOUS,
              'Mais de uma regra tributária coincide com os fatos; nenhum snapshot foi concluído.');
          }
          const declaredStTotal = source.tributos.find((tributo) => tributo.escopo === 'DOCUMENTO' && tributo.codigo === 'ICMS_ST');
          const totalCents = decimalDeclaradoParaCentavos(declaredStTotal?.valor ?? null);
          const itemStTotal = source.itens.reduce((sum, current) => {
            const evidence = source.tributos.find((tributo) => tributo.numero_item === current.numero && tributo.codigo === 'ICMS_ST');
            return sum + (decimalDeclaradoParaCentavos(evidence?.valor ?? null) ?? 0);
          }, 0);
          const stChecks = tax === 'ICMS' && hasSubstitutionTax === true ? [
            ...validateIcmsStDeclaredEvidence({ cest: item.cest ?? null, ncm: item.ncm, taxableBaseCents: null, rateBasisPoints: null, retainedAmountCents: declaredStCents }, itemStTotal, totalCents),
          ] : [];
          const checksValid = stChecks.every((check) => check.status === 'VALID');
          const finalStatus = tax === 'ICMS' && hasSubstitutionTax === true && !checksValid ? 'INDETERMINATE' : decision.status;
          const finalReasons = [...decision.reasonCodes, ...stChecks.flatMap((check) => check.reasons),
              ...(matchingPackages.length > 1 ? ['CURATED_PACKAGE_AMBIGUOUS'] : []),
              ...(!selectedPackage && matchingPackages.length === 0 ? ['CURATED_PACKAGE_UNAVAILABLE'] : []),
              ...(!regime ? ['REGIME_HISTORY_UNAVAILABLE'] : []), ...(!resaleItemNumbers.has(item.numero) ? ['PURPOSE_UNAVAILABLE'] : [])];
          return {
            tax, status: finalStatus, creditEligibility: finalStatus === 'INDETERMINATE' ? 'INDETERMINATE' : decision.creditEligibility, ruleId: decision.ruleId,
            reasons: [...new Set(finalReasons)], checks: stChecks, declaredEvidence: tax === 'ICMS' && hasSubstitutionTax === true ? {
              cest: item.cest ?? null, ncm: item.ncm, taxGroup: item.cst_csosn,
              taxableBaseCents: decimalDeclaradoParaCentavos(icmsStEvidence?.base_calculo ?? null),
              ratePercent: icmsStEvidence?.aliquota ?? null, retainedAmountCents: declaredStCents,
              documentTotalCents: totalCents,
            } : null,
            missingInputs, sourceIds: decision.sourceIds, packageId: decision.packageId,
            packageSha256: decision.packageHash, rationale: decision.rationale,
          };
        });
        const hashFacts = {
          ...facts,
          regimeEffectiveDate: regimeHistory?.vigente_desde ?? null,
          purpose: resaleItemNumbers.has(item.numero) ? 'RESALE' : null,
          excludedCasesUnresolved: [
            ...(hasSubstitutionTax === null ? ['SUBSTITUICAO_TRIBUTARIA'] : []),
            ...(isImport === null ? ['IMPORTACAO'] : []),
            ...(isMonophase === null ? ['MONOFASICO'] : []),
            ...(hasContributionSubstitution === null ? ['SUBSTITUICAO_PIS_COFINS'] : []),
            ...(isReturnOrTransfer === null ? ['DEVOLUCAO_TRANSFERENCIA'] : []),
            ...(hasUnmodeledBenefit === null ? ['BENEFICIO_NAO_MODELADO'] : []),
          ],
          missingInputs,
        };
        const hashCanonical = JSON.stringify({ facts: hashFacts, decisions });
        return { itemNumber: item.numero, parserVersion: item.parser_version,
          inputSha256: createHash('sha256').update(hashCanonical).digest('hex'), facts, decisions };
      });
      const result = await persistirSnapshotsResolucaoTributaria(client, {
        tenantId, empresaId: companyId, documentId, actorId: userId, correlationId,
        idempotencyKey: input.idempotencyKey, expectedParserVersion: input.expectedDocumentRevision,
        reprocessingReason: input.reprocessingReason?.trim() || null, packageId: selectedPackage?.id ?? null,
        packageSha256: selectedPackage?.sha256 ?? null, items,
      });
      if (!result.reused) {
        const indeterminateCount = result.snapshots.filter((snapshot) =>
          Array.isArray(snapshot.decisions) && (snapshot.decisions as Array<{ status?: string }>).some((decision) => decision.status === 'INDETERMINATE'),
        ).length;
        await registrarEventoResolucaoTributaria(client, {
          tenantId,empresaId:companyId,documentId,actorId:userId,correlationId,
          action: result.revision > 1 ? 'REPROCESSED' : indeterminateCount > 0 ? 'ABSTAINED' : 'PROCESSED',
          revision:result.revision,packageId:selectedPackage?.id ?? null,itemCount:result.snapshots.length,
          indeterminateCount,idempotencyKey:`tax-resolution:${documentId}:${input.idempotencyKey}`,
        });
      }
      return result;
    });
  }

  async listarTratamentosTributarios(tenantId: string, userId: string, companyId: string, documentId: string, correlationId: string, revision?: number) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      const snapshots = await listarSnapshotsResolucaoTributaria(client, companyId, documentId, revision);
      return { itens: snapshots };
    });
  }

  async listarFilaTributaria(tenantId:string,userId:string,companyId:string,correlationId:string,page:number,filters:Readonly<{
    from:string|null;to:string|null;regime:'SIMPLES_NACIONAL'|'LUCRO_PRESUMIDO'|null;
    state:'SEM_PROCESSAMENTO'|'INDETERMINADO'|'RESOLVIDO'|null;hasIndeterminate:boolean|null;
  }>) {
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId)throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const result=await listarFilaResolucaoTributaria(client,companyId,page,filters);
      return {pagina:page,temProximaPagina:result.temProximaPagina,total:result.total,itens:result.items.map((row)=>({...row,chave_acesso:chaveMascarada(row.chave_acesso)}))};
    });
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
