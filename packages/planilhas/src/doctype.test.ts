import { describe, expect, it } from 'vitest';

import { lerAba } from './ler-aba.ts';
import { NS, entradaXmlGrande, xlsx, xlsxCru } from './testes/construtores.ts';
import { esperarErro } from './testes/esperar.ts';

const cronometrar = (fn: () => unknown): number => {
  const inicio = performance.now();
  try {
    fn();
  } catch {
    // o código é conferido à parte
  }
  return performance.now() - inicio;
};

describe('DOCTYPE precoce', () => {
  it('DOCTYPE não terminado numa parte grande → DTD_PROIBIDO rápido (não espera o fim do subconjunto)', () => {
    const sst = entradaXmlGrande('xl/sharedStrings.xml', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "', 'a', 100, '">');
    const bytes = xlsxCru([sst]);
    esperarErro(() => lerAba(bytes, 1), 'ARQUIVO_CORROMPIDO', 'DTD_PROIBIDO');
    expect(cronometrar(() => lerAba(bytes, 1))).toBeLessThan(2_000);
  });

  it('qualquer capitalização de <!doctype é recusada', () => {
    const sst = `<?xml version="1.0"?><!doctype x><sst xmlns="${NS}"/>`;
    esperarErro(() => lerAba(xlsx({ sstXml: sst }), 1), 'ARQUIVO_CORROMPIDO', 'DTD_PROIBIDO');
  });

  it('<!DOCTYPE partido entre dois pedaços de 1 MiB também é pego', () => {
    const cabeca = `<?xml version="1.0"?><!--${' '.repeat(1024 * 1024 - 32)}-->`;
    const sst = `${cabeca}<!DOCTYPE x [<!ENTITY a "b">]><sst xmlns="${NS}"/>`;
    expect(Buffer.byteLength(cabeca)).toBe(1024 * 1024 - 4); // '<!DOCTYPE' cruza a fronteira do pedaço
    esperarErro(() => lerAba(xlsx({ sstXml: sst }), 1), 'ARQUIVO_CORROMPIDO', 'DTD_PROIBIDO');
  });
});
