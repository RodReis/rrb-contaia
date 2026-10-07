/**
 * A injeção de dependências do módulo inteiro resolve (categoria Regras). Os specs de serviço
 * constroem o caso de uso à mão com dublês e não enxergam o contêiner do Nest: foi assim que um
 * parâmetro tipado como `Pick<...>` (emitido como `Object` pelo TypeScript) só falhou ao subir a
 * API de verdade. Aqui só se compila o módulo — nada escuta porta nem fala com serviço externo.
 */
import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from './app.module';
import { CertificadosService } from './certificados/certificados.service';
import { SignerService } from './signer/signer.service';

describe('AppModule', () => {
  // O pool do `pg` só conecta na primeira consulta: a URL precisa existir, o banco não.
  beforeEach(() => {
    process.env['DATABASE_URL'] = 'postgresql://ninguem:nada@127.0.0.1:1/inexistente';
    process.env['DATABASE_APP_URL'] = 'postgresql://ninguem:nada@127.0.0.1:1/inexistente';
  });

  afterEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['DATABASE_APP_URL'];
  });

  it('resolve todas as dependências, inclusive o Signer injetado no cofre de certificados', async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    try {
      expect(modulo.get(CertificadosService)).toBeInstanceOf(CertificadosService);
      expect(modulo.get(SignerService)).toBeInstanceOf(SignerService);
    } finally {
      await modulo.close();
    }
  });
});
