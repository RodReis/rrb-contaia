import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FRAMEWORKS_PROIBIDOS = [
  '@nestjs/common',
  '@nestjs/core',
  'next',
  'react',
  'react-dom',
  'drizzle-orm',
  'pg',
  'express',
];

describe('fronteira do domínio', () => {
  const pacote = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

  it('não declara dependência de framework, ORM ou HTTP', () => {
    const declaradas = [
      ...Object.keys(pacote.dependencies ?? {}),
      ...Object.keys(pacote.peerDependencies ?? {}),
    ];

    for (const proibida of FRAMEWORKS_PROIBIDOS) {
      expect(declaradas).not.toContain(proibida);
    }
  });
});
