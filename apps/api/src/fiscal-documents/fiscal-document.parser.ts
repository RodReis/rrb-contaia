import { createHash } from 'node:crypto';
import { parsearDocumentoFiscal as parse, type EspecieFiscal } from '@contaia/shared/fiscal-document-parser';
export { TAMANHO_MAXIMO_XML_FISCAL } from '@contaia/shared/fiscal-document-parser';
export type { EspecieFiscal, FalhaParseFiscal } from '@contaia/shared/fiscal-document-parser';
export type DocumentoFiscalParseado = ReturnType<typeof parse> & Readonly<{ hashSha256: string }>;

export const parsearDocumentoFiscal = (bytes: Buffer, especieEsperada: EspecieFiscal, dataEmissao: string | null = null): DocumentoFiscalParseado => ({
  ...parse(bytes, especieEsperada, dataEmissao),
  hashSha256: createHash('sha256').update(bytes).digest('hex'),
});
