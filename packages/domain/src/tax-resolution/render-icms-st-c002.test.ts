import { describe, expect, it } from 'vitest';
import { renderIcmsStC002, type IcmsStC002Input } from './render-icms-st-c002.js';

const input: IcmsStC002Input = {
  competence: '2019-02', returnDate: '2019-02-03', efdDate: null, returnDocumentNumber: '123',
  returnAccessKey: '1'.repeat(44), returnModel: '55', returnSeries: '1', returnCfop: '1202', ncm: '12345678',
  itemNumber: 1, productCode: 'SKU-1', productDescription: 'Produto', unit: 'UN', quantity: '1.25',
  unitPrice: '10.5', total: '13.13', originalDocumentNumber: '456', originalAccessKey: '2'.repeat(44),
  originalDate: '2018-02-01', reversedRestitutionCents: 125, reversedComplementCents: 0,
};

describe('linha demonstrativa C002 F32', () => {
  it('serializa campos oficiais, competência/data civil e estorno em centavos', () => {
    expect(renderIcmsStC002(input)).toBe(`|C002|201902|20190203||123|${'1'.repeat(44)}|55|1|1202|12345678|1|SKU-1|Produto|UN|1,25|10,5|13,13|456|${'2'.repeat(44)}|20180201|1,25|0,00|`);
  });

  it('não produz linha parcial para evidência inválida ou incompleta', () => {
    expect(renderIcmsStC002({ ...input, returnAccessKey: '1' })).toBeNull();
    expect(renderIcmsStC002({ ...input, total: '13.131' })).toBeNull();
    expect(renderIcmsStC002({ ...input, productDescription: 'Produto|adulterado' })).toBeNull();
  });
});
