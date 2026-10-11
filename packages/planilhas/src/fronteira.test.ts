import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type Manifesto = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const manifesto = (caminho: string): Manifesto => JSON.parse(readFileSync(new URL(caminho, import.meta.url), 'utf8')) as Manifesto;
const dependencias = (m: Manifesto): Record<string, string> => ({ ...m.dependencies, ...m.devDependencies });

describe('fronteira do pacote', () => {
  it('o web nunca depende do leitor de planilhas (Node-only)', () => {
    expect(Object.keys(dependencias(manifesto('../../../apps/web/package.json')))).not.toContain('@contaia/planilhas');
  });

  it('domínio e shared não dependem do pacote (a dependência é só planilhas → shared/domain)', () => {
    for (const caminho of ['../../domain/package.json', '../../shared/package.json']) {
      expect(Object.keys(dependencias(manifesto(caminho)))).not.toContain('@contaia/planilhas');
    }
  });

  it('só saxes e ssf como parsing, com versão fixa; nenhuma biblioteca de planilha pronta', () => {
    const deps = dependencias(manifesto('../package.json'));
    expect(deps['saxes']).toBe('6.0.0');
    expect(deps['ssf']).toBe('0.11.2');
    for (const proibida of ['xlsx', 'exceljs', 'hucre', 'fflate', 'fast-xml-parser', 'node-xlsx', 'read-excel-file', 'xlsx-populate']) {
      expect(Object.keys(deps)).not.toContain(proibida);
    }
  });
});
