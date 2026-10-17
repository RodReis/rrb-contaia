/** Regras puras da agenda mínima de obrigações (SPEC-022/F22). */

export type AbrangenciaDoFeriado = 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL';
export type EstadoDaObrigacao =
  | 'PENDENTE'
  | 'BLOQUEADA_POR_DEPENDENCIA'
  | 'ENTREGUE'
  | 'VENCIDA'
  | 'NAO_EXIGIVEL'
  | 'COBERTURA_INCOMPLETA';
export type PrioridadeDaObrigacao = 'NORMAL' | 'ALTA' | 'CRITICA';

export type RegraDeObrigacao = Readonly<{
  codigo: string;
  nome: string;
  versao: number;
  regimes: readonly string[];
  ufs: readonly string[];
  cnaes: readonly string[];
  periodicidade: 'MENSAL';
  diaNominal: number;
  ajustarDiaUtil: 'ANTECEDENTE' | 'NENHUM';
  exigeFeriadoEstadual: boolean;
  exigeFeriadoMunicipal: boolean;
  dependencias: readonly string[];
  vigenteDe: string;
  vigenteAte: string | null;
}>;

export type Feriado = Readonly<{
  data: string;
  abrangencia: AbrangenciaDoFeriado;
  uf: string | null;
  municipio: string | null;
}>;

export type ContextoDaEmpresa = Readonly<{
  regime: string | null;
  uf: string | null;
  municipio: string | null;
  cnaes: readonly string[];
}>;

export type OcorrenciaCalculada = Readonly<{
  estado: EstadoDaObrigacao;
  motivo: string | null;
  vencimentoNominal: string | null;
  vencimentoAjustado: string | null;
  dependenciasPendentes: readonly string[];
}>;

const dataValida = (valor: string): boolean => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(valor);
  if (partes === null) return false;
  const [, ano, mes, dia] = partes;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  return data.toISOString().slice(0, 10) === valor;
};

const dataUtc = (valor: string): Date => {
  if (!dataValida(valor)) throw new Error(`Data civil inválida: ${valor}`);
  return new Date(`${valor}T00:00:00.000Z`);
};

const diaUtil = (data: string, regra: RegraDeObrigacao, feriados: readonly Feriado[], empresa: ContextoDaEmpresa) => {
  const dataObj = dataUtc(data);
  if (dataObj.getUTCDay() === 0 || dataObj.getUTCDay() === 6) return false;
  return !feriados.some((f) => {
    if (f.data !== data) return false;
    if (f.abrangencia === 'NACIONAL') return true;
    if (f.abrangencia === 'ESTADUAL') return f.uf === empresa.uf;
    return f.uf === empresa.uf && f.municipio?.toLocaleLowerCase('pt-BR') === empresa.municipio?.toLocaleLowerCase('pt-BR');
  });
};

export const calcularVencimento = (
  regra: RegraDeObrigacao,
  competencia: string,
  feriados: readonly Feriado[],
  empresa: ContextoDaEmpresa,
): Readonly<{ nominal: string; ajustado: string }> => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(competencia)) throw new Error('Competência mensal inválida.');
  if (!Number.isInteger(regra.diaNominal) || regra.diaNominal < 1 || regra.diaNominal > 31) throw new Error('Dia nominal inválido.');
  const [ano, mes] = competencia.split('-').map(Number) as [number, number];
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const nominal = `${competencia}-${String(Math.min(regra.diaNominal, ultimoDia)).padStart(2, '0')}`;
  const atual = dataUtc(nominal);
  if (regra.ajustarDiaUtil === 'ANTECEDENTE') {
    for (let i = 0; i < 15 && !diaUtil(atual.toISOString().slice(0, 10), regra, feriados, empresa); i += 1) {
      atual.setUTCDate(atual.getUTCDate() - 1);
    }
  }
  return { nominal, ajustado: atual.toISOString().slice(0, 10) };
};

export const calcularOcorrencia = (entrada: Readonly<{
  regra: RegraDeObrigacao;
  competencia: string;
  referencia: string;
  empresa: ContextoDaEmpresa;
  feriados: readonly Feriado[];
  coberturaEstadualCompleta?: boolean;
  coberturaMunicipalCompleta?: boolean;
  estadosDasDependencias: Readonly<Record<string, EstadoDaObrigacao>>;
}>): OcorrenciaCalculada => {
  const { regra, competencia, referencia, empresa, feriados } = entrada;
  if (!dataValida(referencia)) throw new Error('Data de referência inválida.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(competencia)) throw new Error('Competência mensal inválida.');
  if (!regra.regimes.includes(empresa.regime ?? '')) return { estado: 'NAO_EXIGIVEL', motivo: 'Regime tributário incompatível.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  if (regra.ufs.length > 0 && !regra.ufs.includes(empresa.uf ?? '')) return { estado: 'NAO_EXIGIVEL', motivo: 'UF incompatível.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  if (regra.cnaes.length > 0 && !regra.cnaes.some((cnae) => empresa.cnaes.includes(cnae))) return { estado: 'NAO_EXIGIVEL', motivo: 'CNAE incompatível.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  if (regra.exigeFeriadoEstadual && !empresa.uf) return { estado: 'COBERTURA_INCOMPLETA', motivo: 'UF não cadastrada para resolver o calendário estadual.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  if (regra.exigeFeriadoMunicipal && (!empresa.uf || !empresa.municipio)) return { estado: 'COBERTURA_INCOMPLETA', motivo: 'Município não cadastrado para resolver o calendário municipal.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  if (regra.exigeFeriadoEstadual && entrada.coberturaEstadualCompleta !== true) return { estado: 'COBERTURA_INCOMPLETA', motivo: 'Calendário estadual sem cobertura confirmada para a competência.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  if (regra.exigeFeriadoMunicipal && entrada.coberturaMunicipalCompleta !== true) return { estado: 'COBERTURA_INCOMPLETA', motivo: 'Calendário municipal sem cobertura confirmada para a competência.', vencimentoNominal: null, vencimentoAjustado: null, dependenciasPendentes: [] };
  const { nominal, ajustado } = calcularVencimento(regra, competencia, feriados, empresa);
  const dependenciasPendentes = regra.dependencias.filter((codigo) => !['ENTREGUE', 'NAO_EXIGIVEL'].includes(entrada.estadosDasDependencias[codigo] ?? 'PENDENTE'));
  const dias = Math.floor((dataUtc(ajustado).getTime() - dataUtc(referencia).getTime()) / 86_400_000);
  const estado: EstadoDaObrigacao = dependenciasPendentes.length ? 'BLOQUEADA_POR_DEPENDENCIA' : dias < 0 ? 'VENCIDA' : 'PENDENTE';
  return { estado, motivo: null, vencimentoNominal: nominal, vencimentoAjustado: ajustado, dependenciasPendentes };
};

export const prioridadeDoAlerta = (vencimento: string, referencia: string): PrioridadeDaObrigacao | null => {
  if (!dataValida(vencimento) || !dataValida(referencia)) throw new Error('Data civil inválida para calcular prioridade.');
  const dias = Math.floor((dataUtc(vencimento).getTime() - dataUtc(referencia).getTime()) / 86_400_000);
  if (dias > 3) return null;
  return dias <= 0 ? 'CRITICA' : 'ALTA';
};
