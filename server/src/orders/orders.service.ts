import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService, Tx } from '../db/db.service';
import { AuthUser } from '../auth/auth.guard';

const LIST = `
  SELECT o.id, order_no(o.number) AS number, o.status, o.urgent, o.total::float AS total, o.items_count AS "itemsCount",
         o.delivery_date AS "deliveryDate", o.created_at AS "createdAt", o.accepted_at AS "acceptedAt", o.delivered_at AS "deliveredAt",
         o.paid_at AS "paidAt", (o.status = 'done' AND o.paid_at IS NULL) AS debt,
         o.shop_id AS "shopId", o.ship_name AS shop, o.ship_address AS "shipAddress", o.ship_district AS "shipDistrict",
         o.supplier_id AS "supplierId", su.name AS supplier, o.courier_id AS "courierId",
         COALESCE((SELECT full_name FROM users WHERE id = o.courier_id), i.courier_name) AS courier,
         o.reject_reason AS "rejectReason", (o.cancelled_by IS NOT NULL) AS "cancelledByZakup", r.stars AS rating
    FROM orders o
    JOIN companies su ON su.id = o.supplier_id
    LEFT JOIN invoices i ON i.order_id = o.id
    LEFT JOIN order_ratings r ON r.order_id = o.id`;

const unitOf: Record<string, string> = { box: 'кор', block: 'бл', weight: 'кг', piece: 'шт' };
const volText = (v: string, u: string) => String(Number(v)).replace('.', ',') + ' ' + u;
const ALREADY: Record<string, string> = { work: 'Заказ уже принят', done: 'Заказ уже доставлен', rejected: 'Заказ отклонён или отменён', new: 'Заказ ещё не принят' };
/** Действие допустимо только в этих статусах — иначе понятный ответ, а не тихая перезапись */
const need = (o: any, ...st: string[]) => { if (!st.includes(o.status)) throw new ConflictException(ALREADY[o.status]); };
const today = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);   // Asia/Bishkek, UTC+6 без перехода на летнее

@Injectable()
export class OrdersService {
  constructor(private db: DbService) {}

  /** lock — для действий, меняющих заказ: строка блокируется до конца транзакции, поэтому два одновременных
   *  «Принять» (или «Доставлено») не пройдут оба — второе увидит уже новый статус */
  private async find(c: Tx, number: string, lock = false) {
    if (!/^\d{1,9}$/.test(String(number))) throw new NotFoundException('Заказ не найден');
    const n = Number(number);
    const o = (await c.query('SELECT * FROM orders WHERE number = $1' + (lock ? ' FOR UPDATE' : ''), [n])).rows[0];   // RLS: чужой заказ не виден
    if (!o) throw new NotFoundException('Заказ не найден');
    return o;
  }

  list(me: AuthUser, status?: string, limit = 50, offset = 0) {
    if (status && !['new', 'work', 'done', 'rejected'].includes(status)) throw new BadRequestException('Неизвестный статус');
    limit = Math.min(Math.max(Number(limit) || 50, 1), 200); offset = Math.max(Number(offset) || 0, 0);
    return this.db.asUser(me.id, async c => (await c.query(LIST + ` WHERE ($1::order_status IS NULL OR o.status = $1) ORDER BY o.created_at DESC, o.id DESC LIMIT $2 OFFSET $3`, [status || null, limit, offset])).rows);
  }

  get(me: AuthUser, number: string) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number);
      const head = (await c.query(LIST + ' WHERE o.id = $1', [o.id])).rows[0];
      const items = (await c.query(`SELECT line, product_id AS "productId", name, volume, unit, pack_qty AS "packQty", photo_path AS photo, price::float AS price, qty::float AS qty, is_out AS "out", amount::float AS amount
                                    FROM order_items WHERE order_id = $1 ORDER BY line`, [o.id])).rows;
      const events = (await c.query(`SELECT status, title, created_at AS at FROM order_events WHERE order_id = $1 ORDER BY id`, [o.id])).rows;
      const invoice = (await c.query(`SELECT number, total::float AS total, courier_name AS courier, delivered_by_name AS "deliveredBy", pdf_path AS pdf, created_at AS "createdAt" FROM invoices WHERE order_id = $1`, [o.id])).rows[0] || null;
      const rating = (await c.query(`SELECT stars, comment, created_at AS at FROM order_ratings WHERE order_id = $1`, [o.id])).rows[0] || null;
      const unread = (await c.query(`SELECT count(*)::int AS n FROM order_messages m WHERE m.order_id = $1 AND m.author_id <> $2 AND m.read_at IS NULL`, [o.id, me.id])).rows[0].n;
      // QR показывает только магазин — его сканирует доставщик при получении
      return { ...head, items, events, invoice, rating, unreadMessages: unread, qr: me.role === 'shop' && o.status === 'work' ? 'ZAKUP:' + o.number + ':' + o.qr_token : undefined };
    });
  }

  /** Корзина → заказы: товары одного поставщика собираются в один заказ */
  checkout(me: AuthUser) {
    return this.db.asUser(me.id, async c => {
      const rows = (await c.query(`SELECT ci.qty, ci.urgent, p.id, p.supplier_id, p.name, p.volume_value, p.volume_unit, p.pack_type, p.pack_qty, p.price,
            (p.in_stock AND NOT p.is_draft AND p.hidden_by IS NULL AND p.deleted_at IS NULL AND s.status = 'ok') AS ok,
            (SELECT path FROM product_photos WHERE product_id = p.id ORDER BY position LIMIT 1) AS photo
          FROM cart_items ci JOIN products p ON p.id = ci.product_id JOIN companies s ON s.id = p.supplier_id
         WHERE ci.user_id = $1 ORDER BY ci.added_at FOR UPDATE OF ci`, [me.id])).rows;   // двойное нажатие «Оформить» ждёт первое и видит пустую корзину
      if (!rows.length) throw new BadRequestException('Корзина пуста');
      const bad = rows.filter(r => !r.ok);
      if (bad.length) throw new ConflictException('Нет в наличии: ' + bad.map(r => r.name).join(', '));
      const shop = (await c.query('SELECT name, city, address, district FROM companies WHERE id = $1', [me.companyId])).rows[0];
      const groups = new Map<number, any[]>();
      rows.forEach(r => { const k = Number(r.supplier_id); groups.set(k, [...(groups.get(k) || []), r]); });
      const created: any[] = [];
      for (const [sup, items] of groups) {
        const o = (await c.query(`INSERT INTO orders (shop_id, created_by, supplier_id, urgent, ship_name, ship_address, ship_district)
                                  VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, order_no(number) AS number`,
          [me.companyId, me.id, sup, items.some(i => i.urgent), shop.name, shop.city + ', ' + shop.address, shop.district])).rows[0];
        let line = 0;
        for (const i of items) {
          await c.query(`INSERT INTO order_items (order_id, line, product_id, supplier_id, name, volume, unit, pack_qty, photo_path, price, qty)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [o.id, ++line, i.id, sup, i.name, volText(i.volume_value, i.volume_unit), unitOf[i.pack_type], i.pack_qty, i.photo, i.price, i.qty]);
        }
        created.push(o.number);
      }
      await c.query('DELETE FROM cart_items WHERE user_id = $1', [me.id]);
      return { orders: created };
    });
  }

  /** Поставщик принимает: дата и доставщик обязательны; можно отказать по отдельным позициям */
  accept(me: AuthUser, number: string, b: { deliveryDate: string; courierId: number; outLines?: number[]; agreedLater?: boolean }) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number, true);
      if (o.supplier_id != me.companyId) throw new NotFoundException('Заказ не найден');
      need(o, 'new');
      // срочный — только сегодня; другой срок — если магазин согласился, тогда срочность снимается
      const dropUrgent = o.urgent && b.deliveryDate !== today() && !!b.agreedLater;
      const cr = (await c.query(`SELECT id FROM users WHERE id = $1 AND company_id = $2 AND role = 'courier'`, [b.courierId, me.companyId])).rows[0];
      if (!cr) throw new UnprocessableEntityException('Доставщик не найден');
      if (b.outLines?.length) await c.query('UPDATE order_items SET is_out = (line = ANY($2::smallint[])) WHERE order_id = $1', [o.id, b.outLines]);
      await c.query(`UPDATE orders SET status = 'work', delivery_date = $2, courier_id = $3, urgent = urgent AND NOT $4 WHERE id = $1`, [o.id, b.deliveryDate, b.courierId, dropUrgent]);
    }).then(() => this.get(me, number));
  }

  reject(me: AuthUser, number: string, reason: string) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number, true);
      if (o.supplier_id != me.companyId) throw new NotFoundException('Заказ не найден');
      need(o, 'new');
      await c.query(`UPDATE orders SET status = 'rejected', reject_reason = $2 WHERE id = $1`, [o.id, reason.trim()]);
    }).then(() => this.get(me, number));
  }

  setCourier(me: AuthUser, number: string, courierId: number) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number, true);
      if (o.supplier_id != me.companyId) throw new NotFoundException('Заказ не найден');
      need(o, 'work');
      if (Number(o.courier_id) === Number(courierId)) return;
      const cr = (await c.query(`SELECT id FROM users WHERE id = $1 AND company_id = $2 AND role = 'courier' AND status = 'active'`, [courierId, me.companyId])).rows[0];
      if (!cr) throw new UnprocessableEntityException('Доставщик не найден');
      await c.query('UPDATE orders SET courier_id = $2 WHERE id = $1', [o.id, courierId]);
    }).then(() => this.get(me, number));
  }

  /** Доставщик отмечает доставку: по QR магазина, либо кнопкой, если доставка по QR выключена */
  deliver(me: AuthUser, number: string, qr?: string) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number, true);
      if (o.courier_id != me.id) throw new NotFoundException('Заказ не найден');
      need(o, 'work');
      if (qr != null) {
        const [, n, token] = String(qr).split(':');
        if (Number(n) !== o.number || token !== o.qr_token) throw new ConflictException('QR-код от другого заказа');
      }
      await c.query(`UPDATE orders SET status = 'done', delivered_by = $2, delivered_method = $3 WHERE id = $1`, [o.id, me.id, qr != null ? 'qr' : 'manual']);
    }).then(() => this.get(me, number));
  }

  pay(me: AuthUser, number: string, paid: boolean) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number, true);
      if (o.supplier_id != me.companyId) throw new NotFoundException('Заказ не найден');
      need(o, 'work', 'done');
      await c.query(`UPDATE orders SET paid_at = CASE WHEN $2 THEN COALESCE(paid_at, now()) END, paid_marked_by = CASE WHEN $2 THEN $3::bigint END WHERE id = $1`, [o.id, paid, me.id]);
    }).then(() => this.get(me, number));
  }

  rate(me: AuthUser, number: string, stars: number, comment?: string) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number);
      if (o.shop_id != me.companyId) throw new NotFoundException('Заказ не найден');
      if (o.status !== 'done') throw new ConflictException('Оценить можно только доставленный заказ');
      await c.query('INSERT INTO order_ratings (order_id, stars, comment, created_by) VALUES ($1, $2, $3, $4)', [o.id, stars, comment?.trim() || null, me.id]);
    }).then(() => this.get(me, number));
  }

  messages(me: AuthUser, number: string) {
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number);
      if (me.role === 'courier') throw new NotFoundException('Заказ не найден');
      await c.query('UPDATE order_messages SET read_at = now() WHERE order_id = $1 AND author_id <> $2 AND read_at IS NULL', [o.id, me.id]);
      return (await c.query(`SELECT m.id, m.body, m.created_at AS at, (m.author_id = $2) AS mine FROM order_messages m WHERE m.order_id = $1 ORDER BY m.id`, [o.id, me.id])).rows;
    });
  }

  send(me: AuthUser, number: string, body: string) {
    body = String(body || '').trim();
    if (!body) throw new BadRequestException('Пустое сообщение');
    return this.db.asUser(me.id, async c => {
      const o = await this.find(c, number);
      if (me.role === 'courier') throw new NotFoundException('Заказ не найден');
      return (await c.query(`INSERT INTO order_messages (order_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at AS at, true AS mine`, [o.id, me.id, body])).rows[0];
    });
  }

  debts(me: AuthUser) {
    return this.db.asUser(me.id, async c => (await c.query(
      `SELECT d.supplier_id AS "supplierId", su.name AS supplier, d.shop_id AS "shopId", sh.name AS shop, d.orders::int AS orders, d.amount::float AS amount, d.oldest
         FROM debts d JOIN companies su ON su.id = d.supplier_id JOIN companies sh ON sh.id = d.shop_id
        WHERE $1 IN (d.supplier_id, d.shop_id) ORDER BY d.amount DESC`, [me.companyId])).rows);
  }
}
