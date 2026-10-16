import { createHash } from 'node:crypto';

export const TIPOS_MANIFESTACAO_CONCLUSIVA = ['210200', '210220', '210240'] as const;
export type TipoManifestacaoConclusiva = (typeof TIPOS_MANIFESTACAO_CONCLUSIVA)[number];
export const MOTIVOS_REJEICAO_MANIFESTACAO = ['TIPO_INCORRETO','DADOS_INSUFICIENTES','EXIGE_INVESTIGACAO','DOCUMENTO_NAO_ACIONAVEL','OUTRO'] as const;
export type MotivoRejeicaoManifestacao = (typeof MOTIVOS_REJEICAO_MANIFESTACAO)[number];

export const validarJustificativaManifestacao = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? '';
  return normalized.length >= 15 && normalized.length <= 255 ? normalized : null;
};

export const chaveIdempotenteManifestacao = (input: Readonly<{ empresaId: string; chaveAcesso: string; tipo: TipoManifestacaoConclusiva; sequencia: number }>): string =>
  createHash('sha256').update(`${input.empresaId}:${input.chaveAcesso}:${input.tipo}:${input.sequencia}`).digest('hex');

const serializarCanonico=(value:unknown):string=>JSON.stringify(value,(key,entry:unknown)=>{
  if(entry!==null&&typeof entry==='object'&&!Array.isArray(entry))return Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b)));
  return entry;
})??'null';
export const hashPayloadManifestacao=(payload:Readonly<Record<string,unknown>>):string=>createHash('sha256').update(serializarCanonico(payload)).digest('hex');

export const ordenarInboxManifestacao = <T extends Readonly<{ prazoRestanteMs: number; risco: number; totalCentavos: bigint; chaveAcesso: string }>>(items: readonly T[]): T[] =>
  [...items].sort((a,b) => a.prazoRestanteMs-b.prazoRestanteMs || b.risco-a.risco || (a.totalCentavos===b.totalCentavos?0:a.totalCentavos>b.totalCentavos?-1:1) || a.chaveAcesso.localeCompare(b.chaveAcesso));

export const elegivelManifestacao = (input: Readonly<{ especie:string; modelo:string; estado:string; destinatario:string|null; cnpjEmpresa:string; prazoVigente:boolean; jaManifestado:boolean; impeditivoConhecido:boolean; tipoProposto:string|null }>): boolean =>
  input.especie==='NFE_55' && input.modelo==='55' && input.estado==='PROCESSADO' && input.destinatario===input.cnpjEmpresa && input.prazoVigente && !input.jaManifestado && !input.impeditivoConhecido && !!input.tipoProposto && TIPOS_MANIFESTACAO_CONCLUSIVA.includes(input.tipoProposto as TipoManifestacaoConclusiva);
