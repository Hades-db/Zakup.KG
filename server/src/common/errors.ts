import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

/**
 * Ошибки базы → понятные HTTP-ответы. Правила (статусы заказа, флаги, блокировки)
 * проверяет PostgreSQL и отвечает текстом на русском — его и отдаём клиенту.
 */
@Catch()
export class AllErrors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const body = e.getResponse() as any;
      const message = typeof body === 'string' ? body : Array.isArray(body.message) ? body.message.join('; ') : body.message;
      return res.status(e.getStatus()).json({ error: message });
    }
    const map: Record<string, [number, string]> = {
      P0001: [409, ''],                                   // RAISE EXCEPTION в триггерах: текст правила
      '23505': [409, 'Такая запись уже есть'],
      '23514': [422, 'Данные не прошли проверку'],
      '23503': [422, 'Ссылка на несуществующую запись'],
      '23502': [422, 'Не заполнено обязательное поле'],
      '22P02': [400, 'Неверный формат данных'],
      '22007': [400, 'Неверная дата'],
      '22008': [400, 'Неверная дата'],
      '42501': [403, 'Нет доступа'],
    };
    const m = e && e.code && map[e.code];
    if (m) return res.status(m[0]).json({ error: m[1] || e.message, code: e.code, constraint: e.constraint });
    console.error(e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}
