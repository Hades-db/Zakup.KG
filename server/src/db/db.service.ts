import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { config } from '../config';

// bigint и numeric — обычными числами в JSON (id и суммы далеко от 2^53)
types.setTypeParser(20, v => Number(v));
types.setTypeParser(1700, v => Number(v));

export type Tx = PoolClient;

/**
 * Доступ к PostgreSQL.
 * - system(): от имени роли сервера (вход, регистрация, проверка сеанса);
 * - asUser(): SET LOCAL ROLE zakup_api + app.user_id — работают политики RLS из db/schema.sql,
 *   пользователь видит и меняет только своё;
 * Всё внутри одной транзакции: либо всё применилось, либо ничего.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
  constructor() { this.pool.on('error', e => console.error('PostgreSQL:', e.message)); }   // обрыв простаивающего соединения не роняет сервер

  async onModuleDestroy() { await this.pool.end(); }

  private async tx<T>(prep: (c: Tx) => Promise<void>, fn: (c: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL search_path = zakup, public");
      await c.query("SET LOCAL statement_timeout = '10s'");      // зависший запрос не держит соединение
      await prep(c);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  system<T>(fn: (c: Tx) => Promise<T>) { return this.tx(async () => undefined, fn); }

  asUser<T>(userId: number, fn: (c: Tx) => Promise<T>) {
    return this.tx(async c => {
      await c.query('SET LOCAL ROLE zakup_api');
      await c.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
    }, fn);
  }
}
