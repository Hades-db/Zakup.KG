import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AuthUser, Me, Roles } from '../auth/auth.guard';
import { OrdersService } from './orders.service';

class AcceptDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата поставки в формате ГГГГ-ММ-ДД' }) deliveryDate: string;
  @IsInt() courierId: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) outLines?: number[];
}
class ReasonDto { @IsString() @Length(2, 300) reason: string }
class CourierDto { @IsInt() courierId: number }
class DeliverDto { @IsOptional() @IsString() @Length(1, 200) qr?: string }
class PayDto { @IsBoolean() paid: boolean }
class RateDto { @IsInt() @Min(1) @Max(5) stars: number; @IsOptional() @IsString() @Length(0, 200) comment?: string }
class MessageDto { @IsString() @Length(1, 1000) body: string }

@Controller('v1')
export class OrdersController {
  constructor(private s: OrdersService) {}

  @Get('orders') list(@Me() me: AuthUser, @Query('status') st?: string) { return this.s.list(me, st); }
  @Get('orders/:n') get(@Me() me: AuthUser, @Param('n') n: string) { return this.s.get(me, n); }

  @Roles('shop') @Post('cart/checkout') checkout(@Me() me: AuthUser) { return this.s.checkout(me); }

  @Roles('dist') @Post('orders/:n/accept') @HttpCode(200)
  accept(@Me() me: AuthUser, @Param('n') n: string, @Body() b: AcceptDto) { return this.s.accept(me, n, b); }
  @Roles('dist') @Post('orders/:n/reject') @HttpCode(200)
  reject(@Me() me: AuthUser, @Param('n') n: string, @Body() b: ReasonDto) { return this.s.reject(me, n, b.reason); }
  @Roles('dist') @Post('orders/:n/courier') @HttpCode(200)
  courier(@Me() me: AuthUser, @Param('n') n: string, @Body() b: CourierDto) { return this.s.setCourier(me, n, b.courierId); }
  @Roles('dist') @Post('orders/:n/pay') @HttpCode(200)
  pay(@Me() me: AuthUser, @Param('n') n: string, @Body() b: PayDto) { return this.s.pay(me, n, b.paid); }

  @Roles('courier') @Post('orders/:n/deliver') @HttpCode(200)
  deliver(@Me() me: AuthUser, @Param('n') n: string, @Body() b: DeliverDto) { return this.s.deliver(me, n, b.qr); }

  @Roles('shop') @Post('orders/:n/rating')
  rate(@Me() me: AuthUser, @Param('n') n: string, @Body() b: RateDto) { return this.s.rate(me, n, b.stars, b.comment); }

  @Roles('shop', 'dist') @Get('orders/:n/messages') messages(@Me() me: AuthUser, @Param('n') n: string) { return this.s.messages(me, n); }
  @Roles('shop', 'dist') @Post('orders/:n/messages') send(@Me() me: AuthUser, @Param('n') n: string, @Body() b: MessageDto) { return this.s.send(me, n, b.body); }

  @Roles('shop', 'dist') @Get('debts') debts(@Me() me: AuthUser) { return this.s.debts(me); }
}
