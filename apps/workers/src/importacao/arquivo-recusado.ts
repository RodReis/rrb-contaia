/** Defeitos do arquivo inteiro (iguais nos importadores): a tentativa termina REJEITADA, sem staging. */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

export const CODIGOS_DE_ARQUIVO_RECUSADO = [
  CODIGOS_DE_ERRO.ARQUIVO_VAZIO,
  CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
  CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
  CODIGOS_DE_ERRO.CABECALHO_INVALIDO,
  CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
  // SPEC-015: planilha que o leitor recusa ou cuja aba/cabeçalho não pode ser mapeado.
  CODIGOS_DE_ERRO.FORMATO_XLS_NAO_SUPORTADO,
  CODIGOS_DE_ERRO.FORMATO_XLSM_NAO_SUPORTADO,
  CODIGOS_DE_ERRO.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO,
  CODIGOS_DE_ERRO.ARQUIVO_CORROMPIDO,
  CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO,
  CODIGOS_DE_ERRO.ABA_INEXISTENTE,
  CODIGOS_DE_ERRO.ABA_SEM_DADOS,
  CODIGOS_DE_ERRO.CABECALHO_MESCLADO,
  CODIGOS_DE_ERRO.LIMITE_DE_PROCESSAMENTO_EXCEDIDO,
] as const;
export type CodigoDeArquivoRecusado = (typeof CODIGOS_DE_ARQUIVO_RECUSADO)[number];

export const ehCodigoDeArquivoRecusado = (codigo: string): codigo is CodigoDeArquivoRecusado =>
  (CODIGOS_DE_ARQUIVO_RECUSADO as readonly string[]).includes(codigo);

export type ArquivoRecusado = Readonly<{ tipo: 'ARQUIVO_RECUSADO'; codigo: CodigoDeArquivoRecusado }>;

/** Roda a análise pura; defeito do arquivo inteiro (erro de domínio com código de recusa) vira `ARQUIVO_RECUSADO`. */
export const recusandoDefeitoDoArquivo = <T>(analisar: () => T): T | ArquivoRecusado => {
  try {
    return analisar();
  } catch (erro) {
    if (erro instanceof ErroDeDominio && ehCodigoDeArquivoRecusado(erro.codigo)) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: erro.codigo };
    }

    throw erro;
  }
};
