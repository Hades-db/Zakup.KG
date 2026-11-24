import { BadRequestException, Body, ConflictException, Controller, NotFoundException, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, Me, Roles } from '../auth/auth.guard';
import { DbService } from '../db/db.service';

class CartDto { @IsNumber() @Min(0.001) @Max(9999) qty: number; @IsOptional() @IsBoolean() urgent?: boolean }

/** Каталог, корзина, доставщики поставщика, уведомления — то, без чего не оформить и не принять заказ */
@Controller('v1')
export class CatalogController {
  constructor(private db: DbService) {}

  /** Каталог: только в наличии. С поиском — и товары «Нет в наличии» */
  @Get('catalog')
  catalog(@Me() me: AuthUser, @Query('q') qq?: any, @Query('category') cc?: any, @Query('supplier') ss?: any) {
    const one = (v: any) => (Array.isArray(v) ? v[0] : v) == null ? undefined : String(Array.isArray(v) ? v[0] : v);
    const q = one(qq)?.trim() || undefined, cat = one(cc), sup = one(ss);
    const view = q ? 'catalog_search' : 'catalog';
    return this.db.asUser(me.id, async c => (await c.query(
      `SELECT v.id, v.name, v.volume_value::float AS "volume", v.volume_unit AS unit, v.pack_type AS "packType", v.pack_qty AS "packQty", v.price::float AS price,
              v.barcode, v.in_stock AS "inStock", v.supplier_id AS "supplierId", v.supplier_name AS supplier, v.category, v.orders_count AS popularity,
              (SELECT path FROM product_photos WHERE product_id = v.id ORDER BY position LIMIT 1) AS photo
         FROM ${view} v
        WHERE ($1::text IS NULL OR v.name ILIKE '%' || $1 || '%' ESCAPE '\\' OR v.barcode = $4)
          AND ($2::text IS NULL OR v.category = $2) AND ($3::bigint IS NULL OR v.supplier_id = $3)
        ORDER BY v.in_stock DESC, v.orders_count DESC, v.name LIMIT 200`, [q ? q.trim().slice(0, 100).replace(/[\\%_]/g, m => '\\' + m) : null, cat || null, sup && /^\d+$/.test(sup) ? sup : null, q ? q.trim() : null])).rows);
  }

  @Roles('shop') @Get('cart')
  cart(@Me() me: AuthUser) {
    return this.db.asUser(me.id, async c => {
      const items = (await c.query(`SELECT p.id AS "productId", p.name, p.price::float AS price, ci.qty::float AS qty, ci.urgent, (p.price * ci.qty)::float AS amount,
                                           p.supplier_id AS "supplierId", s.name AS supplier, p.in_stock AS "inStock"
                                      FROM cart_items ci JOIN products p ON p.id = ci.product_id JOIN companies s ON s.id = p.supplier_id
                                     WHERE ci.user_id = $1 ORDER BY ci.added_at`, [me.id])).rows;
      return { items, total: items.reduce((a: number, i: any) => a + i.amount, 0) };
    });
  }

  @Roles('shop') @Put('cart/:productId')
  put(@Me() me: AuthUser, @Param('productId') pid: string, @Body() b: CartDto) {
    if (!/^\d{1,15}$/.test(pid)) throw new NotFoundException('Товар не найден');
    return this.db.asUser(me.id, async c => {
      // в корзину — только то, что магазин видит в каталоге (в наличии, не скрыто, поставщик работает)
      const p = (await c.query('SELECT pack_type FROM catalog WHERE id = $1', [pid])).rows[0];
      if (!p) throw new ConflictException('Товара нет в наличии');
      if (p.pack_type !== 'weight' && !Number.isInteger(b.qty)) throw new BadRequestException('Количество — целое число');
      if (b.urgent && !(await c.query("SELECT flag('urgent_on') AS on")).rows[0].on) throw new ConflictException('Срочные заказы временно недоступны');
      await c.query(`INSERT INTO cart_items (user_id, product_id, qty, urgent) VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, product_id) DO UPDATE SET qty = EXCLUDED.qty, urgent = EXCLUDED.urgent`, [me.id, pid, b.qty, !!b.urgent]);
    }).then(() => this.cart(me));
  }

  @Roles('shop') @Delete('cart/:productId')
  del(@Me() me: AuthUser, @Param('productId') pid: string) {
    return this.db.asUser(me.id, c => c.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [me.id, Number(pid) || 0])).then(() => this.cart(me));
  }

  @Roles('dist') @Get('couriers')
  couriers(@Me() me: AuthUser) {
    return this.db.asUser(me.id, async c => (await c.query(
      `SELECT u.id, u.full_name AS name, u.phone, u.status,
              (SELECT count(*)::int FROM orders o WHERE o.courier_id = u.id AND o.status = 'work') AS busy
         FROM users u WHERE u.company_id = $1 AND u.role = 'courier' AND u.status <> 'deleted' ORDER BY u.full_name`, [me.companyId])).rows);
  }

  @Get('notifications')
  notifications(@Me() me: AuthUser) {
    return this.db.asUser(me.id, async c => (await c.query(
      `SELECT id, title, sender, icon, order_id AS "orderId", created_at AS at, read_at IS NOT NULL AS read FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 100`, [me.id])).rows);
  }

  @Post('notifications/read-all') @HttpCode(200)
  readAll(@Me() me: AuthUser) {
    return this.db.asUser(me.id, c => c.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [me.id])).then(r => ({ updated: r.rowCount }));
  }
}
