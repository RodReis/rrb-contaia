export const FAIXAS_DE_CONFIANCA = ['PRONTA_PARA_REVISAO', 'ATENCAO', 'INCONCLUSIVA'] as const;
export type FaixaDeConfianca = (typeof FAIXAS_DE_CONFIANCA)[number];

export const classificarFaixaDeConfianca = (confianca: number): FaixaDeConfianca | 'ABSTER_SE' => {
  if (!Number.isFinite(confianca) || confianca < 0 || confianca > 1) return 'ABSTER_SE';
  if (confianca >= 0.85) return 'PRONTA_PARA_REVISAO';
  if (confianca >= 0.5) return 'ATENCAO';
  return 'INCONCLUSIVA';
};

export type EvidenciaConclusivaDeOperacao = Readonly<{
  tipo: 'NAO_SOLICITADA' | 'PARTICIPACAO_SEM_REALIZACAO';
  referencias: readonly string[];
}>;

export type EntradaDaMatrizFiscal = Readonly<{
  fornecedorAprovado: boolean | null;
  dentroDoLimite: boolean | null;
  valorEmCentavos: bigint | null;
  comprasAnteriores12Meses: number | null;
  totalHistoricoEmCentavos: bigint | null;
  evidenciaConclusiva?: EvidenciaConclusivaDeOperacao | null;
  conflito: boolean;
}>;

export type DecisaoDaMatrizFiscal = Readonly<{
  tipo: '210200' | '210220' | '210240' | 'ABSTER_SE';
  confianca: number;
  motivo: string;
  riscos: readonly string[];
  lacunas: readonly string[];
}>;

/**
 * Matriz conservadora aprovada para F20: 210200 exige fornecedor aprovado,
 * limite respeitado e recorrência observada (3 compras em 12 meses), sem valor
 * acima de 3x a média histórica. Os tipos negativos exigem evidência positiva
 * explícita; ausência de pedido/cadastro nunca serve como essa evidência.
 */
export const decidirPropostaDeManifestacao = (entrada: EntradaDaMatrizFiscal): DecisaoDaMatrizFiscal => {
  const referencias = entrada.evidenciaConclusiva?.referencias.map((referencia) => referencia.trim()).filter(Boolean) ?? [];
  const referenciaValida = entrada.evidenciaConclusiva?.tipo === 'NAO_SOLICITADA'
    ? referencias.some((referencia) => /^operacao:nao-solicitada:[A-Za-z0-9_-]{1,128}$/u.test(referencia))
    : entrada.evidenciaConclusiva?.tipo === 'PARTICIPACAO_SEM_REALIZACAO'
      ? referencias.some((referencia) => /^operacao:participacao-confirmada:[A-Za-z0-9_-]{1,128}$/u.test(referencia))
        && referencias.some((referencia) => /^operacao:nao-realizada:[A-Za-z0-9_-]{1,128}$/u.test(referencia))
      : false;
  if (entrada.evidenciaConclusiva && !referenciaValida) {
    return { tipo: 'ABSTER_SE', confianca: 0, motivo: 'A evidência conclusiva não possui referência verificável; nenhuma proposta foi emitida.', riscos: ['EVIDENCIA_CONCLUSIVA_INVALIDA'], lacunas: ['EVIDENCIA_CONCLUSIVA_SEM_REFERENCIA'] };
  }
  if (!entrada.conflito && referenciaValida && entrada.evidenciaConclusiva?.tipo === 'NAO_SOLICITADA') {
    return { tipo: '210220', confianca: 0.85, motivo: 'Há evidência explícita e rastreável de que a operação não foi solicitada; proposta sujeita à revisão humana.', riscos: [], lacunas: [] };
  }
  if (!entrada.conflito && referenciaValida && entrada.evidenciaConclusiva?.tipo === 'PARTICIPACAO_SEM_REALIZACAO') {
    return { tipo: '210240', confianca: 0.85, motivo: 'Há evidência explícita de participação e de que a operação não se realizou como descrita; proposta sujeita à revisão humana.', riscos: [], lacunas: [] };
  }

  const riscos: string[] = [];
  const lacunas: string[] = [];
  if (entrada.fornecedorAprovado === false) riscos.push('FORNECEDOR_NAO_APROVADO');
  if (entrada.dentroDoLimite === false) riscos.push('VALOR_ACIMA_DO_LIMITE');
  if (entrada.fornecedorAprovado === null) lacunas.push('FORNECEDOR_SEM_EVIDENCIA_DE_APROVACAO');
  if (entrada.dentroDoLimite === null) lacunas.push('LIMITE_MONETARIO_INDISPONIVEL');
  if (entrada.comprasAnteriores12Meses === null || entrada.totalHistoricoEmCentavos === null || entrada.valorEmCentavos === null) {
    lacunas.push('HISTORICO_DE_COMPRAS_INDISPONIVEL');
  } else if (entrada.comprasAnteriores12Meses < 3 || entrada.totalHistoricoEmCentavos <= 0n) {
    lacunas.push('HISTORICO_INSUFICIENTE_PARA_PADRAO');
  } else if (entrada.valorEmCentavos * BigInt(entrada.comprasAnteriores12Meses) > entrada.totalHistoricoEmCentavos * 3n) {
    riscos.push('VALOR_ACIMA_DE_TRES_VEZES_A_MEDIA_HISTORICA');
  }
  if (entrada.conflito) riscos.push('SINAIS_CONTRADITORIOS');

  const historicoCompativel = entrada.comprasAnteriores12Meses !== null
    && entrada.comprasAnteriores12Meses >= 3
    && entrada.totalHistoricoEmCentavos !== null
    && entrada.totalHistoricoEmCentavos > 0n
    && entrada.valorEmCentavos !== null
    && entrada.valorEmCentavos * BigInt(entrada.comprasAnteriores12Meses) <= entrada.totalHistoricoEmCentavos * 3n;
  const confirmacaoCompativel = entrada.fornecedorAprovado === true
    && entrada.dentroDoLimite === true
    && historicoCompativel
    && !entrada.conflito;

  if (confirmacaoCompativel) {
    return { tipo: '210200', confianca: 0.85, motivo: 'Fornecedor aprovado, valor dentro do limite e recorrência dentro do padrão observado; proposta não comprova recebimento e exige revisão humana.', riscos: [], lacunas: ['RECEBIMENTO_DA_OPERACAO_NAO_VERIFICADO'] };
  }
  return { tipo: 'ABSTER_SE', confianca: 0, motivo: 'Os sinais disponíveis não sustentam proposta conclusiva; ausência de cadastro ou de histórico não comprova operação não solicitada ou não realizada.', riscos, lacunas };
};

/** Converte texto decimal do PostgreSQL em centavos sem arredondar nem usar ponto flutuante. */
export const valorMonetarioParaCentavos = (valor: string): bigint | null => {
  if (valor.length > 64 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(valor)) return null;
  const [inteiro, fracaoBruta = ''] = valor.split('.');
  if (inteiro === undefined || fracaoBruta.slice(2).replaceAll('0', '').length > 0) return null;
  const centavosFracao = fracaoBruta.slice(0, 2).padEnd(2, '0');

  try {
    return BigInt(inteiro) * 100n + BigInt(centavosFracao);
  } catch {
    return null;
  }
};
