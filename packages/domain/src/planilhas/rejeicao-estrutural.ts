/**
 * Rejeição estrutural de célula (SPEC-015 §3.5): fórmula ou mescla em coluna mapeada rejeita só a
 * linha. O texto é fixo: nunca repete o valor da célula, que pode ser CPF ou nome.
 */
import type { CodigoDeRejeicaoEstrutural } from './tipos.js';

export const CODIGOS_DE_REJEICAO_ESTRUTURAL = [
  'CELULA_COM_FORMULA',
  'CELULA_MESCLADA',
] as const satisfies readonly CodigoDeRejeicaoEstrutural[];

export const MENSAGEM_DA_REJEICAO_ESTRUTURAL: Readonly<Record<CodigoDeRejeicaoEstrutural, string>> = {
  CELULA_COM_FORMULA:
    'A célula desta coluna contém uma fórmula, e fórmulas não são executadas. Substitua a fórmula pelo valor e reenvie a planilha.',
  CELULA_MESCLADA:
    'A célula desta coluna está mesclada, e o valor não é replicado para as outras linhas. Desfaça a mescla, preencha a célula e reenvie a planilha.',
};

/** Rejeição já ligada ao campo do contrato (a letra da coluna vira o campo no normalizador). */
export interface RejeicaoEstruturalDaLinha<Campo extends string> {
  readonly codigo: CodigoDeRejeicaoEstrutural;
  readonly campo: Campo;
}

/**
 * Letra da coluna afetada → campo do contrato, para as linhas que a leitura marcou. Compartilhada
 * pelos normalizadores dos dois domínios.
 */
export const rejeicaoEstruturalDaLinha = <Campo extends string>(
  rejeicoes: ReadonlyMap<number, { readonly codigo: CodigoDeRejeicaoEstrutural; readonly letra: string }> | undefined,
  numeroDaLinha: number,
  campoDaLetra: ReadonlyMap<string, Campo>,
): RejeicaoEstruturalDaLinha<Campo> | undefined => {
  const rejeicao = rejeicoes?.get(numeroDaLinha);
  const campo = rejeicao === undefined ? undefined : campoDaLetra.get(rejeicao.letra);
  return rejeicao === undefined || campo === undefined ? undefined : { codigo: rejeicao.codigo, campo };
};
