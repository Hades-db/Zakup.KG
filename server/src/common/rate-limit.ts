import { HttpException } from '@nestjs/common';

/**
 * Ограничение частоты (в памяти процесса). Защищает вход, регистрацию и «Забыли пароль?» от перебора.
 * Для одного сервера этого достаточно; при нескольких экземплярах API — перенести в Redis или PostgreSQL.
 */
const hits = new Map<string, number[]>();
let lastSweep = Date.now();

export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  if (now - lastSweep > 60_000) {          // чистим старые ключи раз в минуту, чтобы карта не росла
    lastSweep = now;
    for (const [k, arr] of hits) if (!arr.length || now - arr[arr.length - 1] > 3_600_000) hits.delete(k);
  }
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) {
    const wait = Math.ceil((windowMs - (now - arr[0])) / 60_000);
    hits.set(key, arr);
    throw new HttpException(`Слишком много попыток. Попробуйте через ${wait} мин`, 429);
  }
  arr.push(now); hits.set(key, arr);
}

/** Сброс счётчика (после успешного входа) */
export function clearLimit(key: string) { hits.delete(key); }
/** Только для тестов */
export function resetLimits() { hits.clear(); }
