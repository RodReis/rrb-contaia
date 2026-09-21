/**
 * Formatação de tamanho de arquivo para a interface.
 *
 * Devolve valor e unidade separados porque só o número vai para a mono com
 * `tabular-nums`: a unidade em fonte tabular ganha o avanço de um dígito e
 * abre um vão antes do "KB" (PATTERNS.md §3 — mono é para identificador e
 * valor, não para a unidade).
 */
export type TamanhoFormatado = Readonly<{ valor: string; unidade: 'KB' | 'MB' }>;

export const formatarTamanho = (bytes: number): TamanhoFormatado => {
  const mega = bytes / (1024 * 1024);

  return mega >= 1
    ? { valor: mega.toFixed(1).replace('.', ','), unidade: 'MB' }
    : { valor: String(Math.max(1, Math.round(bytes / 1024))), unidade: 'KB' };
};

/** Versão em texto corrido, para onde a tipografia não se aplica. */
export const tamanhoEmTexto = (bytes: number): string => {
  const { valor, unidade } = formatarTamanho(bytes);

  return `${valor} ${unidade}`;
};
