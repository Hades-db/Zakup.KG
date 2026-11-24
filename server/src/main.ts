import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableCors({ origin: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');   // за nginx: реальный IP клиента
  return app;
}

if (require.main === module) {
  createApp().then(async app => { await app.listen(config.port); console.log('Zakup.KG API: http://localhost:' + config.port); });
}
