import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule, { forceCloseConnections: true });

  app.enableShutdownHooks();

  await app.listen(Number(process.env['API_PORT'] ?? 15101), '0.0.0.0');
};

void bootstrap();
