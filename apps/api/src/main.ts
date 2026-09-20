import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { FiltroDeProblema } from './comum/problema';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule, { forceCloseConnections: true });

  // Erro de domínio sai como application/problem+json com código estável.
  app.useGlobalFilters(new FiltroDeProblema());
  app.enableCors({
    origin: process.env['WEB_ORIGIN'] ?? 'http://127.0.0.1:15100',
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(Number(process.env['API_PORT'] ?? 15101), '0.0.0.0');
};

void bootstrap();
