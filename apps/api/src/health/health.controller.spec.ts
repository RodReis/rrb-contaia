import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = modulo.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('retorna a saúde da API em /health', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ service: 'api', status: 'ok' });
  });
});
