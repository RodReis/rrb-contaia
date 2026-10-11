import { describe, expect, it } from 'vitest';

import { dataCivilDoIso, dataCivilDoSerial, ehFormatoDeData, formatoDoEstilo, renderizarNumero } from './formatos-de-numero.ts';

describe('dataCivilDoSerial — aritmética UTC, sistemas 1900 e 1904', () => {
  it('sistema 1900 com o bug do Lotus', () => {
    expect(dataCivilDoSerial(1, false)).toBe('1900-01-01');
    expect(dataCivilDoSerial(59, false)).toBe('1900-02-28');
    expect(dataCivilDoSerial(60, false)).toBeUndefined();
    expect(dataCivilDoSerial(61, false)).toBe('1900-03-01');
    expect(dataCivilDoSerial(45000, false)).toBe('2023-03-15');
    expect(dataCivilDoSerial(45000.75, false)).toBe('2023-03-15');
    expect(dataCivilDoSerial(2958465, false)).toBe('9999-12-31');
  });

  it('sistema 1904', () => {
    expect(dataCivilDoSerial(0, true)).toBe('1904-01-01');
    expect(dataCivilDoSerial(1, true)).toBe('1904-01-02');
    expect(dataCivilDoSerial(45000, true)).toBe('2027-03-16');
  });

  it('fora do calendário não tem data civil', () => {
    expect(dataCivilDoSerial(0, false)).toBeUndefined();
    expect(dataCivilDoSerial(-1, false)).toBeUndefined();
    expect(dataCivilDoSerial(2958466, false)).toBeUndefined();
    expect(dataCivilDoSerial(2958465, true)).toBeUndefined();
    expect(dataCivilDoSerial(Number.NaN, false)).toBeUndefined();
  });

  it('arredonda a hora como a exibição (23:59:59,9999 vira o dia seguinte)', () => {
    expect(dataCivilDoSerial(45000 + 86_399.99995 / 86_400, false)).toBe('2023-03-16');
  });

  it('independe do fuso do processo', () => {
    const fuso = process.env['TZ'];
    process.env['TZ'] = 'America/Sao_Paulo';
    try {
      expect(dataCivilDoSerial(45000, false)).toBe('2023-03-15');
    } finally {
      if (fuso === undefined) delete process.env['TZ'];
      else process.env['TZ'] = fuso;
    }
  });
});

describe('renderizarNumero — valor exibido pelo numFmt', () => {
  it('máscaras e General', () => {
    expect(renderizarNumero(52998224725, '000"."000"."000-00', false)).toBe('529.982.247-25');
    expect(renderizarNumero(123, '00000', false)).toBe('00123');
    expect(renderizarNumero(123, 'General', false)).toBe('123');
    expect(renderizarNumero(0.1 + 0.2, 'General', false)).toBe('0.3');
    expect(renderizarNumero(123, '@', false)).toBe('123');
  });

  it('formato inválido, forjado ou longo cai para General', () => {
    expect(renderizarNumero(42, '0;0;0;0;0', false)).toBe('42');
    expect(renderizarNumero(42, '"abc', false)).toBe('42');
    expect(renderizarNumero(42, '0'.repeat(300), false)).toBe('42');
  });

  it('datas', () => {
    expect(renderizarNumero(45000, 'dd/mm/yyyy', false)).toBe('15/03/2023');
    expect(renderizarNumero(45000, 'dd/mm/yyyy', true)).toBe('16/03/2027');
  });
});

describe('formatoDoEstilo — numFmt embutido e personalizado', () => {
  it('14 (data curta do sistema) e 22 viram pt-BR', () => {
    expect(formatoDoEstilo(14, new Map())).toBe('dd/mm/yyyy');
    expect(formatoDoEstilo(22, new Map())).toBe('dd/mm/yyyy hh:mm');
  });

  it('personalizado vence o embutido; desconhecido é General', () => {
    expect(formatoDoEstilo(164, new Map([[164, '00000']]))).toBe('00000');
    expect(formatoDoEstilo(1, new Map())).toBe('0');
    expect(formatoDoEstilo(999, new Map())).toBe('General');
  });

  it('ehFormatoDeData', () => {
    expect(ehFormatoDeData('dd/mm/yyyy')).toBe(true);
    expect(ehFormatoDeData('[$-416]dd/mm/yyyy')).toBe(true);
    expect(ehFormatoDeData('000"."000"."000-00')).toBe(false);
    expect(ehFormatoDeData('0;0;0;0;0')).toBe(false);
    expect(ehFormatoDeData('0'.repeat(300))).toBe(false);
  });
});

describe('dataCivilDoIso — ODS office:date-value e XLSX t="d"', () => {
  it('aceita data real (com ou sem hora) e recusa data impossível', () => {
    expect(dataCivilDoIso('2023-03-15')).toBe('2023-03-15');
    expect(dataCivilDoIso('2023-03-15T18:00:00')).toBe('2023-03-15');
    expect(dataCivilDoIso('0050-01-01')).toBe('0050-01-01');
    expect(dataCivilDoIso('2023-02-29')).toBeUndefined();
    expect(dataCivilDoIso('2023-13-01')).toBeUndefined();
    expect(dataCivilDoIso('0000-01-01')).toBeUndefined();
    expect(dataCivilDoIso('15/03/2023')).toBeUndefined();
  });
});
