import SSF from 'ssf';

import { LIMITES } from './limites.ts';

/**
 * Valor exibido de célula numérica do XLSX: `ssf` (o formatador do SheetJS, função pura) aplica o
 * `numFmt`. Formato inválido/forjado (o `ssf` lança) ou longo demais cai para a renderização
 * `General` do valor guardado — não rejeita o arquivo (decisão a confirmar pelo PI).
 */
const GERAL = 'General';

// Data curta do sistema (14) e data e hora (22) dependem da localidade: exibição pt-BR.
const EMBUTIDOS_PT_BR: ReadonlyMap<number, string> = new Map([
  [14, 'dd/mm/yyyy'],
  [22, 'dd/mm/yyyy hh:mm'],
]);
const EMBUTIDOS = SSF.get_table();

export const formatoDoEstilo = (numFmtId: number, personalizados: ReadonlyMap<number, string>): string =>
  personalizados.get(numFmtId) ?? EMBUTIDOS_PT_BR.get(numFmtId) ?? EMBUTIDOS[numFmtId] ?? GERAL;

const formatoAceito = (formato: string): boolean => formato.length <= LIMITES.caracteresDoFormatoDeNumero;

const ehData = new Map<string, boolean>();

export const ehFormatoDeData = (formato: string): boolean => {
  if (!formatoAceito(formato)) return false;
  let resposta = ehData.get(formato);
  if (resposta === undefined) {
    try {
      resposta = SSF.is_date(formato);
    } catch {
      resposta = false;
    }
    ehData.set(formato, resposta);
  }
  return resposta;
};

/** O formato mostra dia ou ano (não é só hora): só então a célula tem data civil. */
export const formatoTemData = (formato: string): boolean =>
  /[dy]/iu.test(formato.replace(/"[^"]*"|\\.|\[[^\]]*\]/gu, ''));

export const renderizarNumero = (valor: number, formato: string, date1904: boolean): string => {
  if (formatoAceito(formato)) {
    try {
      return SSF.format(formato, valor, { date1904 });
    } catch {
      // formato inválido: cai para General
    }
  }
  return SSF.format(GERAL, valor);
};

const MAIOR_SERIAL = 2_958_465; // 31/12/9999 no sistema 1900
const SEGUNDOS_NO_DIA = 86_400;
const DIAS_ENTRE_1900_E_1904 = 1_462;
const MS_NO_DIA = 86_400_000;
const PRIMEIRO_DE_1900 = Date.UTC(1900, 0, 1);

/**
 * Serial do Excel → data civil `aaaa-mm-dd`, por aritmética UTC (nada de fuso do processo), com o
 * mesmo arredondamento de hora da exibição do `ssf` e o bug de 1900 do Lotus: o serial 60 é o
 * inexistente 29/02/1900 e o 0 é "00/01/1900" — nenhum dos dois tem data civil.
 */
export const dataCivilDoSerial = (serial: number, date1904: boolean): string | undefined => {
  if (!Number.isFinite(serial) || serial < 0 || serial > MAIOR_SERIAL) return undefined;
  let dia = Math.trunc(serial);
  const fracao = SEGUNDOS_NO_DIA * (serial - dia);
  const segundos = Math.floor(fracao);
  if (date1904) dia += DIAS_ENTRE_1900_E_1904;
  if (fracao - segundos > 0.9999 && segundos + 1 === SEGUNDOS_NO_DIA) dia += 1;
  if (dia === 0 || dia === 60) return undefined;
  if (dia > 60) dia -= 1;
  const data = new Date(PRIMEIRO_DE_1900 + (dia - 1) * MS_NO_DIA);
  const ano = data.getUTCFullYear();
  if (ano > 9999) return undefined;
  const mm = String(data.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(data.getUTCDate()).padStart(2, '0');
  return `${String(ano).padStart(4, '0')}-${mm}-${dd}`;
};

/** Prefixo `aaaa-mm-dd` de um valor ISO 8601 (ODS `office:date-value`, XLSX `t="d"`), se for data real. */
export const dataCivilDoIso = (valor: string): string | undefined => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/u.exec(valor);
  if (partes === null) return undefined;
  const [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const data = new Date(0);
  data.setUTCFullYear(ano, mes - 1, dia); // setUTCFullYear não desloca anos < 100 para 19xx
  const valida = ano >= 1 && data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
  return valida ? partes[0] : undefined;
};
