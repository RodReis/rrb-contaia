import { describe, expect, it } from 'vitest';
import { localizarDevolucaoEfd } from './efd-return.js';

const outputKey = '5'.repeat(44);
const returnKey = '6'.repeat(44);
const file = (reference = outputKey) => Buffer.from([
  '|0190|UN|Unidade|',
  '|0200|SKU-1|Peça||SKU-OLD|UN|00|87082999|||||1234567|',
  '|C100|0|0|PART|55|00|1|789|' + returnKey + '|03022019|04022019|10,00|',
  '|C113|0|1|PART|55|1||123|15012017|' + reference + '|00|',
  '|C170|1|SKU-1|Peça|1,00000|UN|10,00|0|0|00|1202|NAT|0|0|0|0|0|0|0|',
  '|C990|5|',
].join('\r\n'));

describe('leitura rastreável de devolução em EFD', () => {
  it('extrai somente identidade, quantidade e referência C113; sem derivar tributo', () => {
    expect(localizarDevolucaoEfd(file(), { accessKey: returnKey, itemNumber: '1', originalOutputAccessKey: outputKey }))
      .toMatchObject({
        accessKey: returnKey, documentNumber: '789', series: '1', date: '2019-02-03', efdDate: '2019-02-04', itemNumber: '1',
        productCode: 'SKU-1', ncm: '87082999', cest: '1234567', unit: 'UN', quantity: '1.00000',
        total: '10.00', cfop: '1202', referencedOutputKeys: [outputKey],
      });
  });

  it('rejeita chave original divergente e registro solicitado inexistente', () => {
    expect(() => localizarDevolucaoEfd(file('7'.repeat(44)), {
      accessKey: returnKey, itemNumber: '1', originalOutputAccessKey: outputKey,
    })).toThrow('EFD_RETURN_AMBIGUOUS');
    expect(() => localizarDevolucaoEfd(file(), {
      accessKey: '8'.repeat(44), itemNumber: '1', originalOutputAccessKey: outputKey,
    })).toThrow('EFD_RETURN_NOT_FOUND');
  });

  it('rejeita TXT truncado e excesso de tamanho', () => {
    expect(() => localizarDevolucaoEfd(Buffer.from('|C100|0'), {
      accessKey: returnKey, itemNumber: '1', originalOutputAccessKey: outputKey,
    })).toThrow('EFD_LAYOUT_INVALID');
    expect(() => localizarDevolucaoEfd(Buffer.alloc(10 * 1024 * 1024 + 1), {
      accessKey: returnKey, itemNumber: '1', originalOutputAccessKey: outputKey,
    })).toThrow('EFD_FILE_INVALID');
  });
});
