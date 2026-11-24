/**
 * Второй аудит недели 1: защита на уровне базы (что будет при ошибке в сервере или прямом SQL под ролью приложения),
 * часовой пояс, гонки, снимки данных, эксплуатация. Отчёт — docs/AUDIT_WEEK1.md, раздел «Второй аудит».
 */
process.env.TZ = 'Asia/Bishkek';     // как на боевом сервере в КР: даты не должны «уезжать»
import { INestApplication } from '@nestjs/common';
import { execSync, spawnSync } from 'child_process';
import request from 'supertest';
import { resetLimits } from '../src/common/rate-limit';

const ADMIN = process.env.TEST_ADMIN_URL || 'postgres://postgres@/zk?host=/var/tmp&port=5499';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://zakup_server@/zk?host=/var/tmp&port=5499';
process.env.JWT_SECRET = 'audit2-secret-' + Date.now();

let app: INestApplication, http: any;
const sql = (q: string) => spawnSync('psql', [ADMIN, '-v', 'ON_ERROR_STOP=1', '-qtAc', q], { encoding: 'utf8' }).stdout.trim();   // без оболочки: «$» в хэшах не подставляется
/** SQL от имени пользователя приложения (роль zakup_api + app.user_id) — как если бы сервер ошибся */
function asApp(phone: string, q: string) {
  const r = spawnSync('psql', [ADMIN, '-qtA', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', input:
    `BEGIN;\nSET LOCAL search_path = zakup;\nSELECT set_config('app.user_id', (SELECT id::text FROM zakup.users WHERE phone = '996${phone}'), true) AS x \\gset\nSET LOCAL ROLE zakup_api;\n${q};\nROLLBACK;\n` });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
const login = async (phone: string, password = 'demo1234') => (await http.post('/v1/auth/login').send({ phone, password })).body;
const tok = async (phone: string) => (await login(phone)).accessToken as string;
const as = (t: string) => ({
  get: (u: string) => http.get(u).set('Authorization', 'Bearer ' + t),
  post: (u: string, b?: any) => http.post(u).set('Authorization', 'Bearer ' + t).send(b ?? {}),
  put: (u: string, b?: any) => http.put(u).set('Authorization', 'Bearer ' + t).send(b ?? {}),
  del: (u: string) => http.delete(u).set('Authorization', 'Bearer ' + t),
});
const bishkek = (d = 0) => new Date(Date.now() + 6 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
const pid = (name: string, sup = 'ОсОО «Дистрибьютор»') => Number(sql(`SELECT p.id FROM zakup.products p JOIN zakup.companies c ON c.id = p.supplier_id WHERE p.name = '${name}' AND c.name = '${sup}'`));
const uid = (name: string) => Number(sql(`SELECT id FROM zakup.users WHERE full_name = '${name}'`));
async function order(t: string, name = 'Сметана 20%', qty = 1) {
  for (const i of (await as(t).get('/v1/cart')).body.items) await as(t).del('/v1/cart/' + i.productId);
  await as(t).put('/v1/cart/' + pid(name), { qty });
  const r = await as(t).post('/v1/cart/checkout'); expect(r.status).toBe(201); return r.body.orders[0] as string;
}
const SHOP = '700000111', DIST = '700000101', COURIER = '700000102';

beforeAll(async () => {
  execSync('bash scripts/db-reset.sh', { env: { ...process.env, DATABASE_ADMIN_URL: ADMIN }, stdio: 'pipe' });
  sql("ALTER ROLE zakup_server LOGIN PASSWORD 'zakup_test'");
  const { createApp } = await import('../src/main');
  app = await createApp(); await app.init(); http = request(app.getHttpServer());
});
afterAll(async () => { await app?.close(); });
beforeEach(() => resetLimits());

describe('база защищает данные сама, даже при ошибке в сервере', () => {
  const denied = (r: { ok: boolean; out: string }, re: RegExp) => { expect(r.ok).toBe(false); expect(r.out).toMatch(re); };
  it('хэши паролей не читаются и не меняются ролью приложения', () => {
    denied(asApp(DIST, `SELECT password_hash FROM users WHERE role = 'courier'`), /permission denied/);
    denied(asApp(DIST, `UPDATE users SET password_hash = 'x' WHERE role = 'courier'`), /permission denied/);
    expect(asApp(DIST, `SELECT full_name FROM users WHERE role = 'courier' ORDER BY 1 LIMIT 1`).out).toBe('Бекзат Осмонов');
  });
  it('роль, компанию, статус и «сменить пароль» пользователь себе не меняет', () => {
    for (const set of [`role = 'owner'`, `company_id = 2`, `status = 'active'`, `must_change_password = false`])
      denied(asApp(COURIER, `UPDATE users SET ${set} WHERE phone = '996${COURIER}'`), /permission denied/);
  });
  it('телефоны и ИНН чужих компаний не читаются; названия — да', () => {
    denied(asApp(SHOP, `SELECT phone FROM companies`), /permission denied/);
    denied(asApp(SHOP, `SELECT inn FROM companies`), /permission denied/);
    expect(asApp(SHOP, `SELECT name FROM companies WHERE id = 1`).out).toBe('ОсОО «Дистрибьютор»');
  });
  it('сумма, номер, QR, адрес и отметки Zakup.KG в заказе не меняются', () => {
    for (const set of ['total = 1', 'number = 1', "qr_token = gen_random_uuid()", "ship_address = 'x'", 'cancelled_by = 1', 'shop_id = 5'])
      denied(asApp(DIST, `UPDATE orders SET ${set} WHERE number = 221`), /permission denied/);
  });
  it('цену и количество в позиции поставщик не меняет — только «нет в наличии»', () => {
    denied(asApp(DIST, `UPDATE order_items SET price = 1 WHERE order_id = (SELECT id FROM orders WHERE number = 221)`), /permission denied/);
    denied(asApp(DIST, `UPDATE order_items SET qty = 100 WHERE order_id = (SELECT id FROM orders WHERE number = 221)`), /permission denied/);
    expect(asApp(DIST, `UPDATE order_items SET is_out = true WHERE order_id = (SELECT id FROM orders WHERE number = 221) AND line = 1 RETURNING is_out`).out).toBe('t');
  });
  it('доставщик не отмечает оплату, не переносит дату и не передаёт заказ', () => {
    for (const set of ['paid_at = now()', 'delivery_date = delivery_date + 1', `courier_id = ${uid('Бекзат Осмонов')}`])
      denied(asApp(COURIER, `UPDATE orders SET ${set} WHERE number = 217`), /Доставщик отмечает только доставку/);
  });
  it('магазин не подставит свою цену и чужой адрес: снимок делает база', () => {
    const r = asApp(SHOP, `WITH o AS (INSERT INTO orders (shop_id, created_by, supplier_id, ship_name, ship_address) SELECT company_id, id, 1, 'Фейк', 'Фейк' FROM users WHERE phone = '996${SHOP}' RETURNING id, ship_name, ship_address)
      SELECT ship_name || ' | ' || ship_address FROM o`);
    expect(r.out).toBe('Магазин «Айдана» | г. Бишкек, ул. Исанова, 61');
    const newOrder = `INSERT INTO orders (shop_id, created_by, supplier_id, ship_name, ship_address) SELECT company_id, id, 1, '', '' FROM users WHERE phone = '996${SHOP}' RETURNING id AS oid \\gset\n`;
    const i = asApp(SHOP, newOrder + `INSERT INTO order_items (order_id, line, product_id, supplier_id, name, volume, unit, pack_qty, price, qty) VALUES (:oid, 1, ${pid('Молоко «Моё» 3,2%')}, 1, 'Дёшево', '?', '?', 1, 1, 2) RETURNING name || ' | ' || volume || ' | ' || unit || ' | ' || pack_qty || ' | ' || price`);
    expect(i.out).toBe('Молоко «Моё» 3,2% | 1 л | кор | 12 | 864.00');
    denied(asApp(SHOP, newOrder + `INSERT INTO order_items (order_id, line, product_id, supplier_id, name, volume, unit, pack_qty, price, qty) VALUES (:oid, 1, ${pid('Мука пшеничная в/с')}, 1, '', '', '', 1, 1, 1)`), /Нет в наличии: Мука/);
    denied(asApp(SHOP, newOrder + `INSERT INTO order_items (order_id, line, product_id, supplier_id, name, volume, unit, pack_qty, price, qty) VALUES (:oid, 1, ${pid('Молоко «Моё» 3,2%')}, 1, '', '', '', 1, 1, 1.5)`), /Количество — целое число/);
    denied(asApp(SHOP, `INSERT INTO orders (shop_id, created_by, supplier_id, ship_name, ship_address, total) SELECT company_id, id, 1, '', '', 1 FROM users WHERE phone = '996${SHOP}'`), /permission denied/);
  });
  it('популярность, скрытие модератором и владелец товара не меняются поставщиком', () => {
    for (const set of ['orders_count = 99999', 'hidden_by = NULL', 'supplier_id = 2'])
      denied(asApp(DIST, `UPDATE products SET ${set} WHERE id = 1`), /permission denied/);
    expect(asApp(DIST, `UPDATE products SET price = 870 WHERE id = 1 RETURNING price`).out).toBe('870.00');
  });
  it('уведомления: только отметка «прочитано»; дробные коробки в корзине — нет', () => {
    denied(asApp(SHOP, `UPDATE notifications SET title = 'подмена'`), /permission denied/);
    denied(asApp(SHOP, `INSERT INTO notifications (user_id, title, sender) VALUES (1, 'x', 'y')`), /permission denied/);
    denied(asApp(SHOP, `UPDATE cart_items SET qty = 0.5`), /Количество — целое число/);
    denied(asApp(SHOP, `SELECT * FROM sessions`), /permission denied/);
    denied(asApp(SHOP, `SELECT * FROM audit_log`), /permission denied/);
    denied(asApp(SHOP, `SELECT * FROM password_reset_requests`), /permission denied/);
  });
});

describe('даты, форматы и неожиданные запросы', () => {
  let shop: string, dist: string;
  beforeAll(async () => { shop = await tok(SHOP); dist = await tok(DIST); });

  it('дата поставки — ровно «ГГГГ-ММ-ДД», без сдвига в часовом поясе Бишкека', async () => {
    const n = await order(shop);
    const r = await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: uid('Эрлан Касымов') });
    expect(r.body.deliveryDate).toBe(bishkek(1));
    expect((await as(shop).get('/v1/orders/' + n)).body.deliveryDate).toBe(bishkek(1));
    expect(r.body.createdAt).toMatch(/Z$/);                       // моменты времени — в UTC с «Z»
  });

  it('повторяющиеся параметры и мусор в запросе — не 500', async () => {
    expect((await as(shop).get('/v1/catalog?q=молоко&q=кефир')).status).toBe(200);
    expect((await as(shop).get('/v1/catalog?q[]=x')).status).toBe(200);
    expect((await as(shop).get('/v1/catalog?category=a&category=b')).status).toBe(200);
    expect((await as(dist).get('/v1/orders?status=new&status=work')).status).toBe(200);
    expect((await as(dist).get('/v1/orders?limit=-5&offset=-1')).body.length).toBe(1);
    expect((await as(dist).get('/v1/orders?limit=abc')).status).toBe(200);
  });

  it('символ NUL и эмодзи в тексте', async () => {
    const n = await order(shop);
    const bad = await as(shop).post(`/v1/orders/${n}/messages`, { body: 'привет\u0000' });
    expect(bad.status).toBe(400); expect(bad.body.error).toBe('Недопустимые символы в тексте');
    expect((await as(shop).post(`/v1/orders/${n}/messages`, { body: 'Спасибо 👍 <b>жирный</b>' })).body.body).toBe('Спасибо 👍 <b>жирный</b>');
  });

  it('тело больше 100 КБ — 413 по-русски; JSON-массив вместо объекта — 400', async () => {
    const big = await http.post('/v1/auth/login').send({ phone: SHOP, password: 'x'.repeat(200_000) });
    expect(big.status).toBe(413); expect(big.body.error).toBe('Слишком большой запрос');
    expect((await http.post('/v1/auth/login').send([1, 2])).status).toBe(400);
  });

  it('в ответах об ошибках нет SQL, имён таблиц и стека', async () => {
    const n = await order(shop);
    const rs = [
      await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: '2026-02-30', courierId: uid('Эрлан Касымов') }),
      await as(dist).post(`/v1/orders/${n}/pay`, { paid: true }),
      await as(shop).put('/v1/cart/' + pid('Молоко «Моё» 3,2%'), { qty: 1.5 }),
      await http.post('/v1/auth/register').send({ type: 'shop', name: 'Тест', inn: '01204198700123', address: 'ул. Тест, 1', phone: '700777001', password: 'testtest', acceptedDocs: true }),
    ];
    for (const r of rs) { expect(r.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(r.body)).not.toMatch(/zakup\.|SELECT|constraint|_key|_fkey|at .*\.ts/); }
  });
});

describe('гонки и снимки', () => {
  let shop: string, dist: string, courier: string, cr: number;
  beforeAll(async () => { [shop, dist, courier] = await Promise.all([SHOP, DIST, COURIER].map(tok)); cr = uid('Эрлан Касымов'); });

  it('два одновременных «Доставлено» — одно проходит', async () => {
    const n = await order(shop);
    await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(0), courierId: cr });
    const qr = (await as(shop).get('/v1/orders/' + n)).body.qr;
    const [a, b] = await Promise.all([1, 2].map(() => as(courier).post(`/v1/orders/${n}/deliver`, { qr })));
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(sql(`SELECT count(*) FROM zakup.order_events e JOIN zakup.orders o ON o.id = e.order_id WHERE o.number = ${Number(n)} AND e.status = 'done'`)).toBe('1');
  });

  it('одновременное обновление токена из двух вкладок не разлогинивает', async () => {
    const s = await login(SHOP);
    const [a, b] = await Promise.all([1, 2].map(() => http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken })));
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const ok = a.status === 200 ? a : b;
    expect((await as(ok.body.accessToken).get('/v1/orders')).status).toBe(200);
  });

  it('цена и адрес в заказе не меняются, если потом изменились товар или магазин', async () => {
    const n = await order(shop, 'Творог 9%', 10);
    sql(`UPDATE zakup.products SET price = 999 WHERE id = ${pid('Творог 9%')}`);
    sql(`UPDATE zakup.companies SET address = 'ул. Новая, 1' WHERE name = 'Магазин «Айдана»'`);
    const o = (await as(shop).get('/v1/orders/' + n)).body;
    sql(`UPDATE zakup.products SET price = 120 WHERE id = ${pid('Творог 9%')}`);
    sql(`UPDATE zakup.companies SET address = 'ул. Исанова, 61' WHERE name = 'Магазин «Айдана»'`);
    expect(o.total).toBe(1200); expect(o.items[0]).toMatchObject({ price: 120, volume: '200 г', unit: 'шт' });
    expect(o.shipAddress).toBe('г. Бишкек, ул. Исанова, 61');
  });

  it('смена доставщика: в накладной и истории — новый, магазин видит нового', async () => {
    const n = await order(shop);
    await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: cr });
    await as(dist).post(`/v1/orders/${n}/courier`, { courierId: uid('Бекзат Осмонов') });
    const o = (await as(shop).get('/v1/orders/' + n)).body;
    expect(o.courier).toBe('Бекзат Осмонов'); expect(o.invoice.courier).toBe('Бекзат Осмонов');
    expect(o.events.map((e: any) => e.title)).toContain('Доставщик: Бекзат Осмонов');
  });

  it('срочный заказ на сегодня принимается и остаётся срочным', async () => {
    for (const i of (await as(shop).get('/v1/cart')).body.items) await as(shop).del('/v1/cart/' + i.productId);
    await as(shop).put('/v1/cart/' + pid('Кефир 2,5%'), { qty: 1, urgent: true });
    const n = (await as(shop).post('/v1/cart/checkout')).body.orders[0];
    const r = await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(0), courierId: cr });
    expect(r.status).toBe(200); expect(r.body.urgent).toBe(true);
  });
});

describe('администратор и эксплуатация', () => {
  it('сброс пароля администратором: сеансы закрыты, вход по временному, сначала сменить', async () => {
    const old = await tok('700000113');
    const h = sql(`SELECT password_hash FROM zakup.users WHERE phone = '996700000111'`);        // хэш demo1234 как «временный»
    sql(`SELECT zakup.admin_set_password(2, (SELECT id FROM zakup.users WHERE phone = '996700000113'), '${h}')`);
    expect((await as(old).get('/v1/orders')).status).toBe(401);
    const s = await login('700000113');
    expect(s.user.mustChangePassword).toBe(true);
    expect((await as(s.accessToken).get('/v1/orders')).body.error).toBe('Смените временный пароль');
    expect(sql(`SELECT action FROM zakup.audit_log ORDER BY id DESC LIMIT 1`)).toBe('Выдал новый пароль');
  });

  it('удалённый пользователь не входит; его номер можно зарегистрировать заново', async () => {
    sql(`UPDATE zakup.users SET status = 'deleted', deleted_at = now() WHERE phone = '996700000116'`);
    expect((await http.post('/v1/auth/login').send({ phone: '700000116', password: 'demo1234' })).status).toBe(401);
    const r = await http.post('/v1/auth/register').send({ type: 'shop', name: 'Магазин «Новый»', inn: '66666666666666', address: 'ул. Ибраимова, 40', phone: '700000116', password: 'newowner1', acceptedDocs: true });
    expect(r.status).toBe(201);
  });

  it('«Забыли пароль?» связывает заявку с пользователем; неизвестный номер — без пользователя', async () => {
    await http.post('/v1/auth/password-reset').send({ phone: '700000114' });
    await http.post('/v1/auth/password-reset').send({ phone: '700999123' });
    expect(sql(`SELECT user_id IS NOT NULL FROM zakup.password_reset_requests WHERE phone = '996700000114'`)).toBe('t');
    expect(sql(`SELECT user_id IS NULL FROM zakup.password_reset_requests WHERE phone = '996700999123'`)).toBe('t');
  });

  it('CORS: при заданных доменах чужой сайт не получает доступ', async () => {
    process.env.CORS_ORIGINS = 'https://zakup.kg,https://admin.zakup.kg';
    const { createApp } = await import('../src/main');
    const a2 = await createApp(); await a2.init(); const h2 = request(a2.getHttpServer());
    const good = await h2.get('/health').set('Origin', 'https://zakup.kg');
    const bad = await h2.get('/health').set('Origin', 'https://evil.example');
    delete process.env.CORS_ORIGINS; await a2.close();
    expect(good.headers['access-control-allow-origin']).toBe('https://zakup.kg');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('сброс базы отказывается работать в продакшене', () => {
    const r = spawnSync('bash', ['scripts/db-reset.sh'], { env: { ...process.env, NODE_ENV: 'production', DATABASE_ADMIN_URL: ADMIN }, encoding: 'utf8' });
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/удалит все данные/);
    expect(Number(sql('SELECT count(*) FROM zakup.orders'))).toBeGreaterThan(0);
  });

  it('слабый секрет в продакшене — сервер не стартует', async () => {
    const env = { ...process.env };
    process.env.NODE_ENV = 'production'; process.env.JWT_SECRET = 'short';
    const { createApp } = await import('../src/main');
    await expect(createApp()).rejects.toThrow(/JWT_SECRET/);
    process.env.NODE_ENV = env.NODE_ENV; process.env.JWT_SECRET = env.JWT_SECRET;
    if (env.NODE_ENV === undefined) delete process.env.NODE_ENV;
  });
});
