import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { CatalogController } from './catalog/catalog.controller';
import { AllErrors } from './common/errors';
import { DbService } from './db/db.service';
import { HealthController } from './health.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [HealthController, AuthController, OrdersController, CatalogController],
  providers: [
    DbService, AuthService, OrdersService,
    { provide: APP_GUARD, useClass: AuthGuard },                     // всё закрыто, кроме @Public()
    { provide: APP_FILTER, useClass: AllErrors },
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
  ],
})
export class AppModule {}
