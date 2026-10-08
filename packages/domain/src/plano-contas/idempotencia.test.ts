/**
 * Idempotência da importação do plano de contas (SPEC-013 §3.7, I-9).
 *
 * A identidade da tentativa é tenant + empresa + hash do arquivo + mapeamento confirmado.
 * Reenviar o mesmo conteúdo com o mesmo mapeamento reutiliza o resultado terminal existente
 * (CONCLUIDA, CONCLUIDA_COM_REJEICOES, REJEITADA); depois de FALHA ou CANCELADA abre nova tentativa.
 * Mesmo arquivo com mapeamento diferente é uma nova tentativa vinculada ao mesmo arquivo de
 * origem — nunca duplica aplicação nem notificação.
 */
import { describe, expect, it } from 'vitest';

import { decidirIdempotenciaDaImportacao } from './idempotencia.js';
import type { PedidoDeImportacao, TentativaExistente } from './idempotencia.js';

const pedido: PedidoDeImportacao = {
  tenantId: 'tenant-1',
  empresaId: 'empresa-1',
  hashArquivo: 'hash-a',
  mapeamento: 'mapa-1',
};

const tentativa = (parcial: Partial<TentativaExistente> = {}): TentativaExistente => ({
  id: 'tentativa-1',
  tenantId: 'tenant-1',
  empresaId: 'empresa-1',
  hashArquivo: 'hash-a',
  mapeamento: 'mapa-1',
  estado: 'CONCLUIDA',
  ...parcial,
});

describe('decidirIdempotenciaDaImportacao (SPEC-013 §3.7, I-9)', () => {
  it('sem tentativa anterior inicia uma nova', () => {
    expect(decidirIdempotenciaDaImportacao(null, pedido)).toEqual({ tipo: 'NOVA' });
  });

  it.each(['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA'] as const)(
    'mesmo hash e mapeamento com resultado terminal %s reutiliza o resultado existente',
    (estado) => {
      expect(decidirIdempotenciaDaImportacao(tentativa({ estado }), pedido)).toEqual({
        tipo: 'REUTILIZAR',
        tentativaId: 'tentativa-1',
      });
    },
  );

  it.each(['FALHA', 'CANCELADA'] as const)(
    'mesmo hash e mapeamento depois de %s abre uma nova tentativa (nova validação é possível)',
    (estado) => {
      expect(decidirIdempotenciaDaImportacao(tentativa({ estado }), pedido)).toEqual({ tipo: 'NOVA' });
    },
  );

  it.each(['RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO'] as const)(
    'mesmo hash e mapeamento com estado não terminal %s informa processamento em andamento',
    (estado) => {
      expect(decidirIdempotenciaDaImportacao(tentativa({ estado }), pedido)).toEqual({
        tipo: 'EM_ANDAMENTO',
        tentativaId: 'tentativa-1',
      });
    },
  );

  it('mesmo arquivo com mapeamento diferente é uma nova tentativa', () => {
    expect(
      decidirIdempotenciaDaImportacao(tentativa({ mapeamento: 'mapa-2' }), pedido),
    ).toEqual({ tipo: 'NOVA' });
  });

  it('hash de arquivo diferente é uma nova tentativa, mesmo com o mesmo mapeamento', () => {
    expect(
      decidirIdempotenciaDaImportacao(tentativa({ hashArquivo: 'hash-b' }), pedido),
    ).toEqual({ tipo: 'NOVA' });
  });

  it.each([
    ['tenant', { tenantId: 'tenant-2' }],
    ['empresa', { empresaId: 'empresa-2' }],
  ])('divergência de %s nunca reutiliza, mesmo com mesmo hash e mapeamento', (_campo, divergencia) => {
    expect(decidirIdempotenciaDaImportacao(tentativa(divergencia), pedido)).toEqual({ tipo: 'NOVA' });
  });
});
