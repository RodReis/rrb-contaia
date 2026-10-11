/**
 * Data civil (I-11): dia do calendário sem hora nem fuso, no formato `aaaa-mm-dd`.
 *
 * `lerDataCivil` é a única porta de entrada de datas vindas de arquivo. Aceita só duas grafias
 * sem ambiguidade, `dd/mm/aaaa` e `aaaa-mm-dd`, e só dias que existem no calendário gregoriano
 * (ano bissexto incluído). Ano de 2 dígitos, número serial do Excel, outros separadores e
 * `mm/dd/aaaa` não são interpretados: voltam `null` e a linha é rejeitada com código estável.
 */

export type DataCivil = string;

const BRASILEIRA = /^(\d{2})\/(\d{2})\/(\d{4})$/u;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/u;

const ehBissexto = (ano: number): boolean => (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;

const diasDoMes = (ano: number, mes: number): number =>
  mes === 2 ? (ehBissexto(ano) ? 29 : 28) : [4, 6, 9, 11].includes(mes) ? 30 : 31;

const montar = (ano: number, mes: number, dia: number): DataCivil | null => {
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > diasDoMes(ano, mes)) {
    return null;
  }
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};

export const lerDataCivil = (texto: string): DataCivil | null => {
  const aparado = texto.trim();

  const brasileira = BRASILEIRA.exec(aparado);
  if (brasileira) {
    return montar(Number(brasileira[3]), Number(brasileira[2]), Number(brasileira[1]));
  }

  const iso = ISO.exec(aparado);
  return iso ? montar(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
};
