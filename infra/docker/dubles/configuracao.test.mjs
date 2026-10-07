import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lerConfiguracaoDoDuble } from './configuracao.mjs';

const completo = {
  DUBLE_NOME: 'duble-dfe',
  DUBLE_CERT_FILE: '/run/secrets/duble.crt.pem',
  DUBLE_KEY_FILE: '/run/secrets/duble.key.pem',
  DUBLE_CA_CLIENTES_FILE: '/run/secrets/ca-a1.pem',
};

describe('configuração do dublê (falha fechada)', () => {
  it('lê os quatro caminhos obrigatórios e usa a porta interna 8443 por padrão', () => {
    assert.deepEqual(lerConfiguracaoDoDuble(completo), {
      nome: 'duble-dfe',
      porta: 8443,
      arquivoDoCertificado: '/run/secrets/duble.crt.pem',
      arquivoDaChave: '/run/secrets/duble.key.pem',
      arquivoDaCaDosClientes: '/run/secrets/ca-a1.pem',
    });
  });

  for (const faltando of Object.keys(completo)) {
    it(`recusa subir sem ${faltando}`, () => {
      const env = { ...completo };
      delete env[faltando];

      assert.throws(() => lerConfiguracaoDoDuble(env), new RegExp(faltando, 'u'));
    });
  }

  it('recusa porta inválida', () => {
    assert.throws(() => lerConfiguracaoDoDuble({ ...completo, DUBLE_PORTA: 'abc' }), /DUBLE_PORTA/u);
    assert.throws(() => lerConfiguracaoDoDuble({ ...completo, DUBLE_PORTA: '70000' }), /DUBLE_PORTA/u);
  });
});
