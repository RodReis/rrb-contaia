import { z } from 'zod';

const uuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const token=z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);
export const MANIFESTATION_CONCLUSIVA_QUEUE='fiscal-manifestation';
export const MANIFESTATION_CONCLUSIVA_DLQ='fiscal-manifestation-dead';
export const MANIFESTATION_CONCLUSIVA_JOB='transmit-manifestation';
export const ManifestacaoConclusivaCommandSchema=z.strictObject({tenantId:uuid,companyId:uuid,manifestationId:uuid,correlationId:token});
export type ManifestacaoConclusivaCommand=z.infer<typeof ManifestacaoConclusivaCommandSchema>;
export const ComandoManifestarConclusivaSchema=z.strictObject({
 tenantId:uuid,empresaId:uuid,cnpj:z.string().regex(/^\d{14}$/u),chaveAcesso:z.string().regex(/^\d{44}$/u),tipoEvento:z.enum(['210200','210220','210240']),
 sequencia:z.number().int().min(1).max(99),xJust:z.string().min(15).max(255).nullable(),chaveIdempotente:token,correlationId:token,usuarioOriginadorId:uuid,
});
export type ComandoManifestarConclusiva=z.infer<typeof ComandoManifestarConclusivaSchema>;
export type RespostaManifestacaoConclusiva=Readonly<{tipo:'ACEITO'|'DUPLICIDADE'|'REJEITADO'|'INCERTO';codigo:string|null;protocolo:string|null;chaveAcesso:string;cnpj:string;tipoEvento:'210200'|'210220'|'210240';sequencia:number;ambiente:'HOMOLOGACAO';recebidoEm:string|null}>;
export const ComandoConsultarManifestacaoConclusivaSchema=z.strictObject({tenantId:uuid,empresaId:uuid,cnpj:z.string().regex(/^\d{14}$/u),chaveAcesso:z.string().regex(/^\d{44}$/u),tipoEvento:z.enum(['210200','210220','210240']),sequencia:z.number().int().min(1).max(99),chaveIdempotente:token,correlationId:token,usuarioOriginadorId:uuid});
export type ComandoConsultarManifestacaoConclusiva=z.infer<typeof ComandoConsultarManifestacaoConclusivaSchema>;
export type RespostaConsultaManifestacaoConclusiva=Readonly<{tipo:'ENCONTRADO'|'NAO_ENCONTRADO'|'INCERTO';codigo:string|null;protocolo:string|null;chaveAcesso:string;cnpj:string;tipoEvento:'210200'|'210220'|'210240';sequencia:number;ambiente:'HOMOLOGACAO';recebidoEm:string|null}>;
