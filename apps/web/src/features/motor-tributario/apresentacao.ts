/**
 * Como o motor tributário aparece na tela (SPEC-016 §5): rótulos em PT-BR, tom do estado e
 * formatos. Datas de vigência e de emissão são datas civis `YYYY-MM-DD` (I-11): formatam-se por
 * texto, sem passar por `Date`, que erraria o dia por fuso (FRONTEND.md §12).
 */
import { TAX_REGIMES, TAX_RULE_STATUSES, TAX_TYPES, type TaxRegime, type TaxRuleStatus, type TaxType } from '@contaia/domain';
import { TAX_OPERATION_TYPES, type TaxOperationType } from '@contaia/shared';

import type { TomDoStatus } from '@/components/ui/status-badge';

export const ROTULO_DO_TRIBUTO: Readonly<Record<TaxType, string>> = {
  ICMS: 'ICMS',
  PIS: 'PIS',
  COFINS: 'COFINS',
  IBS_UF: 'IBS · Estados',
  IBS_MUN: 'IBS · Municípios',
  CBS: 'CBS',
};

export const ROTULO_DO_REGIME: Readonly<Record<TaxRegime, string>> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

export const ROTULO_DA_OPERACAO: Readonly<Record<TaxOperationType, string>> = {
  VENDA_MERCADORIA: 'Venda de mercadoria',
  PRESTACAO_SERVICO: 'Prestação de serviço',
  COMPRA_INSUMO: 'Compra de insumo',
  DEVOLUCAO_VENDA: 'Devolução de venda',
  TRANSFERENCIA_ENTRE_ESTABELECIMENTOS: 'Transferência entre estabelecimentos',
};

/** Todo estado tem texto além da cor (PATTERNS.md §7, item 6). */
export const APRESENTACAO_DO_ESTADO: Readonly<Record<TaxRuleStatus, Readonly<{ rotulo: string; tom: TomDoStatus }>>> = {
  DRAFT: { rotulo: 'Rascunho', tom: 'neutro' },
  PUBLISHED: { rotulo: 'Publicada', tom: 'conforme' },
  ARCHIVED: { rotulo: 'Arquivada', tom: 'neutro' },
};

/** Opções de seleção na ordem do contrato (SPEC-016 §3.1). */
export const OPCOES_DE_TRIBUTO = TAX_TYPES.map((valor) => ({ valor, rotulo: ROTULO_DO_TRIBUTO[valor] }));
export const OPCOES_DE_REGIME = TAX_REGIMES.map((valor) => ({ valor, rotulo: ROTULO_DO_REGIME[valor] }));
export const OPCOES_DE_OPERACAO = TAX_OPERATION_TYPES.map((valor) => ({ valor, rotulo: ROTULO_DA_OPERACAO[valor] }));
export const OPCOES_DE_ESTADO = TAX_RULE_STATUSES.map((valor) => ({ valor, rotulo: APRESENTACAO_DO_ESTADO[valor].rotulo }));

const DATA_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** `2026-06-15` → `15/06/2026`; o que não é data civil volta como veio, sem inventar uma data. */
export const formatarDataCivil = (data: string): string => {
  const partes = DATA_CIVIL.exec(data);

  return partes === null ? data : `${partes[3]}/${partes[2]}/${partes[1]}`;
};

const formatadorDeInstante = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instante ISO em `dd/MM/yyyy HH:mm` no horário de Brasília (auditoria usa UTC, a tela mostra BRT). */
export const formatarInstante = (iso: string): string => {
  const partes = Object.fromEntries(
    formatadorDeInstante.formatToParts(new Date(iso)).map((parte) => [parte.type, parte.value]),
  );

  return `${partes['day']}/${partes['month']}/${partes['year']} ${partes['hour']}:${partes['minute']}`;
};

export const formatarVigencia = (de: string, ate: string | null): string => {
  if (ate === null) {
    return `A partir de ${formatarDataCivil(de)}, sem data final`;
  }

  return de === ate ? `Somente em ${formatarDataCivil(de)}` : `${formatarDataCivil(de)} a ${formatarDataCivil(ate)}`;
};

/** O denominador de toda fração da memória divide 10^8 (base × redução × alíquota em centésimos). */
const ESCALA_DA_FRACAO = 100_000_000n;
const CASAS_DA_ESCALA = 8;

const formatadorDeInteiro = new Intl.NumberFormat('pt-BR');

/**
 * Fração exata da memória de cálculo em decimal (`60003/50` → `1.200,06`), por aritmética inteira:
 * a tela não arredonda nem converte para float o que a API guardou como numerador/denominador. Só
 * a fração que não termina em decimal (inexistente nesta regra de cálculo) fica como `a/b`.
 */
export const formatarFracaoExata = (fracao: Readonly<{ numerator: string; denominator: string }>): string => {
  const numerador = BigInt(fracao.numerator);
  const denominador = BigInt(fracao.denominator);

  if (denominador === 0n || ESCALA_DA_FRACAO % denominador !== 0n) {
    return `${fracao.numerator}/${fracao.denominator}`;
  }

  const escalado = numerador * (ESCALA_DA_FRACAO / denominador);
  const inteiro = formatadorDeInteiro.format(escalado / ESCALA_DA_FRACAO);
  const decimais = String(escalado % ESCALA_DA_FRACAO)
    .padStart(CASAS_DA_ESCALA, '0')
    .replace(/0+$/u, '');

  return decimais.length === 0 ? inteiro : `${inteiro},${decimais}`;
};

/** Percentual como o XML o traz (`0.9000`): só exibição, nunca entra em cálculo. */
export const formatarPercentualDeclarado = (percentual: string | null): string =>
  percentual === null ? 'não informado' : `${percentual.replace('.', ',')}%`;
