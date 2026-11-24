import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp() {
  config.check();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  // CORS: в продакшене — только свои домены (CORS_ORIGINS=https://zakup.kg,https://admin.zakup.kg)
  const origins = (process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, maxAge: 600 });
  // базовые заголовки безопасности для API
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.removeHeader('X-Powered-By');
    next();
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');   // за nginx: реальный IP клиента
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  createApp().then(async app => { await app.listen(config.port); console.log('Zakup.KG API: http://localhost:' + config.port); });
}
