export const FONTES_DA_SAUDE = [
  'PENDENCIAS',
  'CERTIFICADOS',
  'CAPTURA',
  'MANIFESTACOES',
  'OBRIGACOES',
] as const;

export type FonteDaSaude = (typeof FONTES_DA_SAUDE)[number];
export type CorDaSaude = 'VERMELHO' | 'AMARELO' | 'VERDE';

export type SinalDeSaude = Readonly<{
  fonte: FonteDaSaude;
  codigo: string;
  gravidade: Exclude<CorDaSaude, 'VERDE'>;
  origemId: string;
  descricao: string;
  dataReferencia: string | null;
  atualizadoEm: Date | null;
}>;

export type MotivoDeSaude = SinalDeSaude & Readonly<{ identidade: string }>;

export type ResultadoDaSaude = Readonly<{
  cor: CorDaSaude;
  motivos: readonly MotivoDeSaude[];
  motivoPrioritario: MotivoDeSaude | null;
  proximaDataRelevante: string | null;
  atualizadoEm: Date | null;
  contagensPorFonte: Readonly<Record<FonteDaSaude, number>>;
  contagensPorGravidade: Readonly<Record<CorDaSaude, number>>;
}>;

export type EntradaDaProjecao = Readonly<{
  sinais: readonly SinalDeSaude[];
  fontesIncompletas: readonly FonteDaSaude[];
}>;

const ORDEM_DA_FONTE: readonly FonteDaSaude[] = [
  'OBRIGACOES', 'CAPTURA', 'CERTIFICADOS', 'MANIFESTACOES', 'PENDENCIAS',
];

const ORDEM_DA_GRAVIDADE: Readonly<Record<CorDaSaude, number>> = {
  VERMELHO: 0,
  AMARELO: 1,
  VERDE: 2,
};


const identidadeDoSinal = (sinal: SinalDeSaude): string =>
  `${sinal.fonte}:${sinal.codigo}:${sinal.origemId}`;

const dataValida = (valor: string | null): boolean => {
  if (valor === null || !/^\d{4}-\d{2}-\d{2}$/u.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
};

export const projetarSaudeEmpresa = (entrada: EntradaDaProjecao): ResultadoDaSaude => {
  const porIdentidade = new Map<string, MotivoDeSaude>();

  for (const sinal of entrada.sinais) {
    const identidade = identidadeDoSinal(sinal);
    if (!porIdentidade.has(identidade)) porIdentidade.set(identidade, { ...sinal, identidade });
  }

  for (const fonte of new Set(entrada.fontesIncompletas)) {
    const sinal: SinalDeSaude = {
      fonte,
      codigo: 'FONTE_INCOMPLETA',
      gravidade: 'AMARELO',
      origemId: fonte,
      descricao: 'Dados incompletos ou desatualizados; estado da fonte não confirmado.',
      dataReferencia: null,
      atualizadoEm: null,
    };
    const identidade = identidadeDoSinal(sinal);
    if (!porIdentidade.has(identidade)) porIdentidade.set(identidade, { ...sinal, identidade });
  }

  const fonteIndex = new Map(ORDEM_DA_FONTE.map((fonte, index) => [fonte, index]));
  const motivos = [...porIdentidade.values()].sort((a, b) =>
    ORDEM_DA_GRAVIDADE[a.gravidade] - ORDEM_DA_GRAVIDADE[b.gravidade]
    || Number(fonteIndex.get(a.fonte)) - Number(fonteIndex.get(b.fonte))
    || (a.dataReferencia ?? '9999-12-31').localeCompare(b.dataReferencia ?? '9999-12-31')
    || a.codigo.localeCompare(b.codigo)
    || a.origemId.localeCompare(b.origemId),
  );

  const contagensPorFonte = Object.fromEntries(FONTES_DA_SAUDE.map((fonte) => [
    fonte,
    motivos.filter((motivo) => motivo.fonte === fonte).length,
  ])) as Record<FonteDaSaude, number>;
  const contagensPorGravidade = {
    VERMELHO: motivos.filter((motivo) => motivo.gravidade === 'VERMELHO').length,
    AMARELO: motivos.filter((motivo) => motivo.gravidade === 'AMARELO').length,
    VERDE: 0,
  };
  const motivoPrioritario = motivos[0] ?? null;
  const datas = motivos.map(({ dataReferencia }) => dataReferencia).filter(dataValida).sort();
  const instantes = motivos.map(({ atualizadoEm }) => atualizadoEm).filter((data): data is Date => data !== null);

  return {
    cor: motivoPrioritario?.gravidade ?? 'VERDE',
    motivos,
    motivoPrioritario,
    proximaDataRelevante: datas[0] ?? null,
    atualizadoEm: instantes.length === 0 ? null : new Date(Math.max(...instantes.map((data) => data.getTime()))),
    contagensPorFonte,
    contagensPorGravidade,
  };
};
