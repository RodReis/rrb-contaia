import { z } from 'zod';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const CODIGO = z.string().regex(/^[A-Z0-9_]{2,80}$/u);
export const filtroAgendaSchema = z.object({
  empresaId: z.string().uuid().optional(), codigo: CODIGO.optional(), competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u).optional(),
  estado: z.enum(['PENDENTE','BLOQUEADA_POR_DEPENDENCIA','ENTREGUE','VENCIDA','NAO_EXIGIVEL','COBERTURA_INCOMPLETA']).optional(),
  prioridade: z.enum(['NORMAL','ALTA','CRITICA']).optional(), limite: z.coerce.number().int().min(1).max(100).default(25), deslocamento: z.coerce.number().int().min(0).default(0),
});
export const regraSchema = z.object({ codigo: CODIGO, nome: z.string().trim().min(2).max(160), regimes: z.array(z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL'])).min(1), ufs: z.array(z.string().regex(/^[A-Z]{2}$/u)).default([]), cnaes: z.array(z.string().regex(/^\d{7}$/u)).default([]), periodicidade: z.literal('MENSAL'), diaNominal: z.number().int().min(1).max(31), ajustarDiaUtil: z.enum(['ANTECEDENTE','NENHUM']), exigeFeriadoEstadual: z.boolean(), exigeFeriadoMunicipal: z.boolean(), dependencias: z.array(CODIGO).default([]), vigenteDe: DATA, vigenteAte: DATA.nullable().default(null) });
export const baixaSchema = z.object({ versao: z.number().int().positive(), dataEntrega: DATA, referencia: z.string().trim().min(1).max(500) });
export const reaberturaSchema = z.object({ versao: z.number().int().positive(), motivo: z.string().trim().min(3).max(500) });
export const publicacaoSchema = z.object({ versao: z.number().int().positive() });
export const geracaoSchema = z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/u).transform(v=>v.slice(0,7)) });
export const feriadoSchema = z.object({ data: DATA, abrangencia: z.enum(['NACIONAL','ESTADUAL','MUNICIPAL']), uf: z.string().regex(/^[A-Z]{2}$/u).nullable(), municipio: z.string().trim().min(2).max(120).nullable(), nome: z.string().trim().min(2).max(160), fonte: z.string().trim().min(2).max(300), vigenteDe: DATA, vigenteAte: DATA.nullable() }).superRefine((v,ctx)=>{
  if(v.abrangencia==='NACIONAL' && (v.uf!==null||v.municipio!==null)) ctx.addIssue({code:'custom',message:'Feriado nacional não recebe UF ou município.'});
  if(v.abrangencia==='ESTADUAL' && (!v.uf||v.municipio!==null)) ctx.addIssue({code:'custom',message:'Feriado estadual exige UF e não recebe município.'});
  if(v.abrangencia==='MUNICIPAL' && (!v.uf||!v.municipio)) ctx.addIssue({code:'custom',message:'Feriado municipal exige UF e município.'});
});
export const coberturaCalendarioSchema = z.object({ abrangencia: z.enum(['ESTADUAL','MUNICIPAL']), uf: z.string().regex(/^[A-Z]{2}$/u), municipio: z.string().trim().min(2).max(120).nullable(), cobertoDe: DATA, cobertoAte: DATA, fonte: z.string().trim().min(2).max(300) }).superRefine((v,ctx)=>{
  if(v.cobertoAte<v.cobertoDe)ctx.addIssue({code:'custom',message:'O fim da cobertura não pode anteceder o início.'});
  if(v.abrangencia==='ESTADUAL'&&v.municipio!==null)ctx.addIssue({code:'custom',message:'Cobertura estadual não recebe município.'});
  if(v.abrangencia==='MUNICIPAL'&&v.municipio===null)ctx.addIssue({code:'custom',message:'Cobertura municipal exige município.'});
});
