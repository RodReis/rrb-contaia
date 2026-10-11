import { describe, expect, it } from 'vitest';

import { lerDataCivil } from './data-civil.js';

describe('lerDataCivil', () => {
  it.each([
    ['15/03/1990', '1990-03-15'],
    ['01/01/2000', '2000-01-01'],
    ['1990-03-15', '1990-03-15'],
    ['31/12/1999', '1999-12-31'],
  ])('lê %s como %s', (texto, esperado) => {
    expect(lerDataCivil(texto)).toBe(esperado);
  });

  it('aceita 29/02 em ano bissexto e recusa em ano comum', () => {
    expect(lerDataCivil('29/02/2020')).toBe('2020-02-29');
    expect(lerDataCivil('2020-02-29')).toBe('2020-02-29');
    expect(lerDataCivil('29/02/2019')).toBeNull();
    expect(lerDataCivil('29/02/1900')).toBeNull(); // século não bissexto
    expect(lerDataCivil('29/02/2000')).toBe('2000-02-29'); // divisível por 400
  });

  it('apara espaços ao redor', () => {
    expect(lerDataCivil('  15/03/1990 ')).toBe('1990-03-15');
    expect(lerDataCivil('\t1990-03-15\n')).toBe('1990-03-15');
  });

  it.each([
    '31/02/2020', // dia inexistente
    '00/01/2020', // dia zero
    '15/00/2020', // mês zero
    '15/13/2020', // mês 13
    '2020-13-01',
    '2020-02-30',
    '31/04/2020',
    '1/2/20', // ano de 2 dígitos
    '01/02/20',
    '1/2/2020', // sem zero à esquerda: o formato é dd/mm/aaaa
    '43831', // serial do Excel colado
    '15-03-1990', // separador não suportado
    '15.03.1990',
    '03/15/1990', // mm/dd: mês 15 não existe
    '1990/03/15',
    '2020-3-5',
    '',
    '   ',
    '15/03/1990 10:00',
    '0000-01-01',
    '00/00/0000',
  ])('recusa %j', (texto) => {
    expect(lerDataCivil(texto)).toBeNull();
  });
});
