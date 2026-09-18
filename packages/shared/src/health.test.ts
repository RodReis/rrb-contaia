import { describe, expect, it } from 'vitest';
import { health } from './health.js';

describe('contrato de health', () => {
  it('devolve serviço e status ok para cada serviço', () => {
    expect(health('api')).toEqual({ service: 'api', status: 'ok' });
    expect(health('web')).toEqual({ service: 'web', status: 'ok' });
    expect(health('workers')).toEqual({ service: 'workers', status: 'ok' });
    expect(health('signer')).toEqual({ service: 'signer', status: 'ok' });
  });
});
