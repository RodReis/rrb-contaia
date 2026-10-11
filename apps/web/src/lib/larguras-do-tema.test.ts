/**
 * O tema define `--spacing-xs..xl` e não a escala de containers do Tailwind: `max-w-md` resolve
 * pelo espaçamento (0,75 rem) e o controle colapsa — aconteceu no CNPJ e de novo no seletor de aba
 * da planilha. Largura mínima ou máxima só com valor explícito (`max-w-[28rem]`). O `w-*` fica de fora:
 * nele a escala de espaçamento é a intenção (o esmaecido da `RegiaoRolavel` usa `w-xl`).
 */
import { describe, expect, it } from 'vitest';

const fontes = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// Citado entre crases (comentário que explica a armadilha) não conta.
const LARGURA_PELA_ESCALA = /(?<![\w`:-])(?:[a-z-]+:)*(?:max-w|min-w)-(?:xs|sm|md|lg|xl)(?![\w[-])/gu;

describe('larguras com nome de espaçamento', () => {
  it('nenhum componente usa max-w/min-w com xs, sm, md, lg ou xl', () => {
    const achados = Object.entries(fontes)
      .filter(([caminho]) => !caminho.endsWith('.test.tsx'))
      .flatMap(([caminho, texto]) =>
        [...texto.matchAll(LARGURA_PELA_ESCALA)].map((achado) => `${caminho}: ${achado[0]}`),
      );

    expect(Object.keys(fontes).length).toBeGreaterThan(50);
    expect(achados).toEqual([]);
  });
});
