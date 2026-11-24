import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

/** Понятные тексты для нарушений уникальности и ограничений базы (имя ограничения → текст) */
const CONSTRAINT: Record<string, string> = {
  companies_inn_key: 'Компания с таким ИНН / ПИН уже зарегистрирована',
  users_phone_uq: 'Этот номер уже зарегистрирован',
  order_ratings_pkey: 'Заказ уже оценён',
  pwreq_one_open_uq: 'Заявка уже отправлена',
  orders_courier_id_supplier_id_fkey: 'Доставщик не найден',
  cart_items_product_id_fkey: 'Товар не найден',
};

/**
 * Все ошибки → { error: "текст для пользователя" }.
 * Правила заказа проверяет PostgreSQL (RAISE EXCEPTION) и отвечает текстом на русском — его и отдаём.
 * Имена таблиц, ограничений и стек наружу не уходят.
 */
@Catch()
export class AllErrors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const st = e.getStatus(), body = e.getResponse() as any;
      let message = typeof body === 'string' ? body : Array.isArray(body.message) ? body.message.join('; ') : body.message;
      if (st === 404 && /^Cannot (GET|POST|PUT|DELETE|PATCH)/.test(message)) message = 'Не найдено';
      if (st === 400 && /JSON|Unexpected token|Unexpected end/i.test(String(message))) message = 'Неверный формат данных';
      if (!/[а-яё]/i.test(String(message))) message = st === 400 ? 'Неверный запрос' : st === 404 ? 'Не найдено' : st === 401 ? 'Нужен вход' : st === 403 ? 'Нет доступа' : st === 413 ? 'Слишком большой запрос' : 'Ошибка запроса';
      return res.status(st).json({ error: message });
    }
    // ошибки разбора тела запроса (неверный JSON, слишком большой) приходят от express до Nest
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный формат данных' });
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    const map: Record<string, [number, string]> = {
      P0001: [409, ''],
      '23505': [409, 'Такая запись уже есть'],
      '23514': [422, 'Данные не прошли проверку'],
      '23503': [422, 'Ссылка на несуществующую запись'],
      '23502': [422, 'Не заполнено обязательное поле'],
      '22P02': [400, 'Неверный формат данных'],
      '22P05': [400, 'Недопустимые символы в тексте'],
      '22021': [400, 'Недопустимые символы в тексте'],
      '54000': [400, 'Слишком длинное значение'],
      '22003': [400, 'Число вне допустимого диапазона'],
      '22001': [400, 'Слишком длинное значение'],
      '22007': [400, 'Неверная дата'],
      '22008': [400, 'Неверная дата'],
      '42501': [403, 'Нет доступа'],
      '57014': [503, 'Сервер занят, попробуйте ещё раз'],
    };
    const m = e?.code && map[e.code];
    if (m) return res.status(m[0]).json({ error: (e.constraint && CONSTRAINT[e.constraint]) || m[1] || e.message });
    console.error(e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}
