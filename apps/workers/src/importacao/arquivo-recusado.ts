/** Defeitos do arquivo inteiro (iguais nos importadores): a tentativa termina REJEITADA, sem staging. */
import { CODIGOS_DE_ERRO } from '@contaia/domain';

export const CODIGOS_DE_ARQUIVO_RECUSADO = [
  CODIGOS_DE_ERRO.ARQUIVO_VAZIO,
  CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
  CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
  CODIGOS_DE_ERRO.CABECALHO_INVALIDO,
  CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
] as const;
export type CodigoDeArquivoRecusado = (typeof CODIGOS_DE_ARQUIVO_RECUSADO)[number];

export const ehCodigoDeArquivoRecusado = (codigo: string): codigo is CodigoDeArquivoRecusado =>
  (CODIGOS_DE_ARQUIVO_RECUSADO as readonly string[]).includes(codigo);
