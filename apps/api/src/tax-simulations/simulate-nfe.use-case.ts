/**
 * Simulação por NF-e de teste (SPEC-016 §3.6): cada item da nota vira simulações do MESMO caso de
 * uso do formulário (`simulateManual`), uma por tributo. O valor declarado no XML é comparado com o
 * calculado e nunca sobrescrito, sem dizer qual dos dois é juridicamente correto. Só o que o XML não
 * traz, ou não mapeia de forma inequívoca, aceita complemento. Função pura sobre dados já extraídos:
 * não vê o arquivo, o banco nem o relógio.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, type TaxRegime, type TaxRuleCriteria } from '@contaia/domain';
import type {
  ManualTaxSimulation,
  NfeComparisonDto,
  NfeComplement,
  NfeComplementRequiredDto,
  NfeExtractionDto,
  NfeItemExtractionDto,
  NfeItemResultDto,
  NfeSimulationDto,
  NfeSimulationResultDto,
  NfeTaxLineDto,
} from '@contaia/shared';

import { simulateManual, type TaxRuleLookup } from './simulate-manual.use-case';

type TributoDaNfe = NfeTaxLineDto['taxType'];

const TRIBUTOS: readonly TributoDaNfe[] = ['IBS_UF', 'IBS_MUN', 'CBS'];

const CAMPO_DECLARADO = { IBS_UF: 'ibsUf', IBS_MUN: 'ibsMun', CBS: 'cbs' } as const;

const entradaInvalida = (mensagem: string): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT, mensagem);

/** O complemento só preenche lacuna: o que o XML já informa não é reescrito pelo navegador. */
const conferirComplemento = (extracao: NfeExtractionDto, complemento: NfeComplement): void => {
  if (complemento.regime !== undefined && extracao.regime !== null) {
    throw entradaInvalida('O regime já é informado de forma inequívoca pelo XML e não pode ser complementado.');
  }

  const porNumero = new Map(extracao.items.map((item) => [String(item.number), item]));
  for (const numero of Object.keys(complemento.itemBases ?? {})) {
    const item = porNumero.get(numero);
    if (item === undefined) {
      throw entradaInvalida(`O item ${numero} do complemento não existe na NF-e.`);
    }
    if (item.ibsCbs !== null) {
      throw entradaInvalida(`O item ${numero} já traz a base de IBS/CBS no XML e não pode ser complementado.`);
    }
  }
};

const pendencias = (extracao: NfeExtractionDto, complemento: NfeComplement | null): readonly NfeComplementRequiredDto[] => [
  ...(complemento === null ? [{ field: 'operationType', reason: 'NOT_IN_XML' } as const] : []),
  ...(extracao.regime === null && complemento?.regime === undefined
    ? [{ field: 'regime', reason: 'AMBIGUOUS_IN_XML' } as const]
    : []),
  ...extracao.items
    .filter((item) => item.ibsCbs === null && complemento?.itemBases?.[String(item.number)] === undefined)
    .map((item) => ({ field: `itemBases.${item.number}`, reason: 'NOT_IN_XML' }) as const),
];

/** Uma consulta por critério e uma descrição por regra: 990 itens não viram milhares de leituras. */
const comMemoria = (origem: TaxRuleLookup): TaxRuleLookup => {
  const candidatas = new Map<string, ReturnType<TaxRuleLookup['findApplicable']>>();
  const descricoes = new Map<string, ReturnType<TaxRuleLookup['describe']>>();

  return {
    findApplicable: (criteria: TaxRuleCriteria) => {
      const chave = `${criteria.taxType}|${criteria.regime}|${criteria.operationType}|${criteria.factDate}`;
      const existente = candidatas.get(chave);
      if (existente !== undefined) {
        return existente;
      }
      const consulta = origem.findApplicable(criteria);
      candidatas.set(chave, consulta);

      return consulta;
    },
    describe: (ruleId: string) => {
      const existente = descricoes.get(ruleId);
      if (existente !== undefined) {
        return existente;
      }
      const descricao = origem.describe(ruleId);
      descricoes.set(ruleId, descricao);

      return descricao;
    },
  };
};

const comparar = (declaredCents: number | null | undefined, calculatedCents: number): NfeComparisonDto | null =>
  declaredCents === null || declaredCents === undefined
    ? null
    : {
        declaredCents,
        calculatedCents,
        differenceCents: calculatedCents - declaredCents,
        diverges: calculatedCents !== declaredCents,
      };

/** Tributos declarados no item; sem nenhum declarado (ou sem o grupo), simula os três. */
const tributosDoItem = (item: NfeItemExtractionDto): readonly TributoDaNfe[] => {
  const declarados = TRIBUTOS.filter((tributo) => (item.ibsCbs?.[CAMPO_DECLARADO[tributo]] ?? null) !== null);

  return declarados.length > 0 ? declarados : TRIBUTOS;
};

const simularItem = async (
  fonte: TaxRuleLookup,
  item: NfeItemExtractionDto,
  base: number,
  contexto: Readonly<{ factDate: string; regime: TaxRegime; operationType: ManualTaxSimulation['operationType'] }>,
): Promise<NfeItemResultDto> => {
  const taxes: NfeTaxLineDto[] = [];

  for (const taxType of tributosDoItem(item)) {
    try {
      const simulation = await simulateManual(fonte, { ...contexto, taxType, baseCents: base });
      taxes.push({
        taxType,
        simulation,
        comparison: comparar(item.ibsCbs?.[CAMPO_DECLARADO[taxType]]?.valueCents, simulation.memory.resultCents),
      });
    } catch (erro) {
      // A falha diz em qual item e tributo aconteceu, para o usuário agir sem abrir o XML.
      throw erro instanceof ErroDeDominio
        ? new ErroDeDominio(erro.codigo, erro.message, erro.campos, { ...erro.detalhes, item: item.number, taxType })
        : erro;
    }
  }

  return { number: item.number, baseCents: base, taxes };
};

const somar = (itens: readonly NfeItemResultDto[], taxType: TributoDaNfe): number =>
  itens.reduce(
    (total, item) =>
      total + item.taxes.filter((linha) => linha.taxType === taxType).reduce((parcial, linha) => parcial + linha.simulation.memory.resultCents, 0),
    0,
  );

const totalizar = (extracao: NfeExtractionDto, itens: readonly NfeItemResultDto[]): NfeSimulationResultDto['totals'] => {
  const ibsUfCents = somar(itens, 'IBS_UF');
  const ibsMunCents = somar(itens, 'IBS_MUN');
  const ibsCents = ibsUfCents + ibsMunCents;
  const cbsCents = somar(itens, 'CBS');

  return {
    calculated: { ibsUfCents, ibsMunCents, ibsCents, cbsCents },
    ibs: comparar(extracao.declaredTotals?.ibsCents, ibsCents),
    cbs: comparar(extracao.declaredTotals?.cbsCents, cbsCents),
  };
};

/** `complemento` nulo = só análise: devolve a extração e o que falta, sem calcular nada. */
export const simulateNfe = async (
  lookup: TaxRuleLookup,
  extraction: NfeExtractionDto,
  complement: NfeComplement | null,
): Promise<NfeSimulationDto> => {
  if (complement !== null) {
    conferirComplemento(extraction, complement);
  }

  const faltando = pendencias(extraction, complement);
  if (faltando.length > 0 || complement === null) {
    return { extraction, complementsRequired: faltando, result: null };
  }

  const regime = extraction.regime ?? complement.regime;
  if (regime === undefined) {
    throw entradaInvalida('O regime não pôde ser determinado.');
  }

  const fonte = comMemoria(lookup);
  const contexto = { factDate: extraction.issueDate, regime, operationType: complement.operationType };
  const itens: NfeItemResultDto[] = [];

  for (const item of extraction.items) {
    const base = item.ibsCbs?.baseCents ?? complement.itemBases?.[String(item.number)];
    if (base === undefined) {
      throw entradaInvalida(`O item ${item.number} não tem base de cálculo.`);
    }
    itens.push(await simularItem(fonte, item, base, contexto));
  }

  return {
    extraction,
    complementsRequired: [],
    result: { items: itens, totals: totalizar(extraction, itens) },
  };
};
