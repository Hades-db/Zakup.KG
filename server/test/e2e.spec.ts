/**
 * Сквозные тесты API на настоящей PostgreSQL: перед запуском база пересоздаётся из db/schema.sql + db/seed.sql.
 * Нужны переменные: TEST_ADMIN_URL (суперпользователь) и TEST_DATABASE_URL (роль zakup_server).
 * Пример (локально): см. server/README.md
 */
import { INestApplication } from '@nestjs/common';
import { execSync } from 'child_process';
import request from 'supertest';
import { resetLimits } from '../src/common/rate-limit';

const ADMIN = process.env.TEST_ADMIN_URL || 'postgres://postgres@/zk?host=/var/tmp&port=5499';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://zakup_server@/zk?host=/var/tmp&port=5499';
process.env.JWT_SECRET = 'test-secret-' + Date.now();

const PH = { shop: '700000111', shop2: '700000112', dist: '700000101', dist2: '700000105', courier: '700000102', courier2: '700000103', pending: '700000107', blocked: '700000118' };
let app: INestApplication, http: any;
const sql = (q: string) => execSync(`psql "${ADMIN}" -v ON_ERROR_STOP=1 -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const login = async (phone: string, password = 'demo1234') => (await http.post('/v1/auth/login').send({ phone, password })).body;
const as = (t: string) => ({ get: (u: string) => http.get(u).set('Authorization', 'Bearer ' + t), post: (u: string, b?: any) => http.post(u).set('Authorization', 'Bearer ' + t).send(b || {}), put: (u: string, b?: any) => http.put(u).set('Authorization', 'Bearer ' + t).send(b || {}) });
const tomorrow = () => { const d = new Date(Date.now() + 6 * 3600e3 + 86400e3); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  execSync('bash scripts/db-reset.sh', { env: { ...process.env, DATABASE_ADMIN_URL: ADMIN }, stdio: 'pipe' });
  sql("ALTER ROLE zakup_server LOGIN PASSWORD 'zakup_test'");
  const { createApp } = await import('../src/main');
  app = await createApp(); await app.init(); http = request(app.getHttpServer());
});
afterAll(async () => { await app?.close(); });
beforeEach(() => resetLimits());

describe('вход', () => {
  it('сервер жив', async () => { expect((await http.get('/health')).body).toEqual({ ok: true }); });

  it('неверный пароль и неизвестный номер — одинаковый ответ', async () => {
    const a = await http.post('/v1/auth/login').send({ phone: PH.shop, password: 'nope' });
    const b = await http.post('/v1/auth/login').send({ phone: '700999999', password: 'nope' });
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body.error).toBe(b.body.error);
  });

  it('магазин входит, роль определяется по номеру', async () => {
    const r = await login(PH.shop);
    expect(r.user).toMatchObject({ role: 'shop', name: 'Айдана М.', companyName: 'Магазин «Айдана»' });
    expect((await as(r.accessToken).get('/v1/auth/me')).body.role).toBe('shop');
    expect((await login(PH.dist)).user.role).toBe('dist');
    expect((await login(PH.courier)).user.role).toBe('courier');
  });

  it('заявка на проверке и блокировка — вход закрыт с понятной причиной', async () => {
    const p = await http.post('/v1/auth/login').send({ phone: PH.pending, password: 'demo1234' });
    expect(p.status).toBe(403); expect(p.body.error).toBe('Заявка на проверке');
    const b = await http.post('/v1/auth/login').send({ phone: PH.blocked, password: 'demo1234' });
    expect(b.status).toBe(403); expect(b.body.error).toMatch(/Компания заблокирована/);
  });

  it('без токена — 401', async () => { expect((await http.get('/v1/orders')).status).toBe(401); });

  it('refresh одноразовый: повтор сразу — просто отказ, повтор позже — сеанс закрыт', async () => {
    const r = await login(PH.shop);
    const n = await http.post('/v1/auth/refresh').send({ refreshToken: r.refreshToken });
    expect(n.status).toBe(200); expect(n.body.refreshToken).not.toBe(r.refreshToken);
    // две вкладки обновили токен одновременно: второй получает отказ, но сеанс жив
    expect((await http.post('/v1/auth/refresh').send({ refreshToken: r.refreshToken })).status).toBe(401);
    const n2 = await http.post('/v1/auth/refresh').send({ refreshToken: n.body.refreshToken });
    expect(n2.status).toBe(200);
    // старый токен спустя время — кража: сеанс закрывается
    sql(`UPDATE zakup.sessions SET rotated_at = now() - interval '1 minute' WHERE id = '${n2.body.refreshToken.split('.')[0]}'`);
    expect((await http.post('/v1/auth/refresh').send({ refreshToken: n.body.refreshToken })).status).toBe(401);
    expect((await http.post('/v1/auth/refresh').send({ refreshToken: n2.body.refreshToken })).status).toBe(401);
    expect((await as(n2.body.accessToken).get('/v1/orders')).status).toBe(401);
  });

  it('админ завершил сеансы — следующий запрос отклонён', async () => {
    const r = await login(PH.shop2);
    expect((await as(r.accessToken).get('/v1/orders')).status).toBe(200);
    sql(`SELECT zakup.kick_user((SELECT id FROM zakup.users WHERE phone = '996${PH.shop2}'), 'admin_kick')`);
    expect((await as(r.accessToken).get('/v1/orders')).status).toBe(401);
  });

  it('регистрация → вход после подтверждения в админке', async () => {
    const reg = await http.post('/v1/auth/register').send({ type: 'shop', name: 'Магазин «Сапат»', inn: '12345678901234', address: 'ул. Киевская, 5', phone: '700555001', password: 'sapat2026', acceptedDocs: true });
    expect(reg.status).toBe(201); expect(reg.body.status).toBe('pending');
    expect((await http.post('/v1/auth/login').send({ phone: '700555001', password: 'sapat2026' })).body.error).toBe('Заявка на проверке');
    sql(`SELECT zakup.admin_set_company_status(3, (SELECT id FROM zakup.companies WHERE inn = '12345678901234'), 'ok')`);
    expect((await login('700555001', 'sapat2026')).user.role).toBe('shop');
  });

  it('смена пароля: новый работает, старый нет, другие сеансы закрыты', async () => {
    const a = await login(PH.courier2), b = await login(PH.courier2);
    expect((await as(a.accessToken).post('/v1/auth/password', { oldPassword: 'demo1234', newPassword: 'bekzat-2026' })).status).toBe(200);
    expect((await as(b.accessToken).get('/v1/orders')).status).toBe(401);
    expect((await as(a.accessToken).get('/v1/orders')).status).toBe(200);
    expect((await http.post('/v1/auth/login').send({ phone: PH.courier2, password: 'demo1234' })).status).toBe(401);
    expect((await login(PH.courier2, 'bekzat-2026')).user.role).toBe('courier');
  });

  it('«Забыли пароль?» — заявка в админку, повтор не дублирует', async () => {
    expect((await http.post('/v1/auth/password-reset').send({ phone: PH.shop })).status).toBe(200);
    expect((await http.post('/v1/auth/password-reset').send({ phone: PH.shop })).status).toBe(200);
    expect(sql(`SELECT count(*) FROM zakup.password_reset_requests WHERE phone = '996${PH.shop}' AND status = 'new'`)).toBe('1');
  });
});

describe('заказ целиком: корзина → принятие → доставка → оплата → оценка', () => {
  let shop: string, dist: string, courier: string, other: string, dist2: string, courierId: number, num: string;
  beforeAll(async () => {
    shop = (await login(PH.shop)).accessToken; dist = (await login(PH.dist)).accessToken;
    courier = (await login(PH.courier)).accessToken; other = (await login(PH.shop2)).accessToken; dist2 = (await login(PH.dist2)).accessToken;
  });

  it('каталог: только в наличии и не скрытые; поиск находит и «нет в наличии»', async () => {
    const all = (await as(shop).get('/v1/catalog')).body;
    expect(all.some((p: any) => p.name === 'Мука пшеничная в/с')).toBe(false);
    expect(all.some((p: any) => p.name === 'Пряники «Тульские»')).toBe(false);
    const q = (await as(shop).get('/v1/catalog?q=Мука')).body;
    expect(q[0]).toMatchObject({ name: 'Мука пшеничная в/с', inStock: false });
  });

  it('корзина делится на заказы по поставщикам, срочность сохраняется', async () => {
    for (const i of (await as(shop).get('/v1/cart')).body.items) await http.delete('/v1/cart/' + i.productId).set('Authorization', 'Bearer ' + shop);
    const cat = (await as(shop).get('/v1/catalog')).body;
    const milk = cat.find((p: any) => p.name === 'Молоко «Моё» 3,2%' && p.supplier === 'ОсОО «Дистрибьютор»');
    const kefir = cat.find((p: any) => p.name === 'Кефир 2,5%' && p.supplier === 'ОсОО «Дистрибьютор»');
    const bread = cat.find((p: any) => p.name === 'Хлеб «Экстра»');
    await as(shop).put('/v1/cart/' + milk.id, { qty: 2 });
    await as(shop).put('/v1/cart/' + kefir.id, { qty: 3, urgent: true });
    const cart = (await as(shop).put('/v1/cart/' + bread.id, { qty: 30 })).body;
    expect(cart.items).toHaveLength(3); expect(cart.total).toBe(2 * 864 + 3 * 780 + 30 * 38);
    const r = await as(shop).post('/v1/cart/checkout');
    expect(r.status).toBe(201); expect(r.body.orders).toHaveLength(2);
    expect((await as(shop).get('/v1/cart')).body.items).toHaveLength(0);
    const mine = (await as(shop).get('/v1/orders?status=new')).body;
    const o = mine.find((x: any) => x.supplier === 'ОсОО «Дистрибьютор»' && r.body.orders.includes(x.number));
    expect(o).toMatchObject({ urgent: true, total: 4068, itemsCount: 2 }); num = o.number;
    const n = (await as(dist).get('/v1/notifications')).body;
    expect(n[0].title).toBe('Новый срочный заказ № ' + num);
  });

  it('чужие не видят заказ: другой магазин, другой поставщик, не назначенный доставщик', async () => {
    expect((await as(other).get('/v1/orders/' + num)).status).toBe(404);
    expect((await as(dist2).get('/v1/orders/' + num)).status).toBe(404);
    expect((await as(courier).get('/v1/orders/' + num)).status).toBe(404);
    expect((await as(shop).post('/v1/orders/' + num + '/accept', { deliveryDate: tomorrow(), courierId: 1 })).status).toBe(403);
  });

  it('принятие: нужен свой доставщик, нельзя убрать все позиции', async () => {
    const crs = (await as(dist).get('/v1/couriers')).body;
    courierId = crs.find((c: any) => c.name === 'Эрлан Касымов').id;
    const foreign = Number(sql(`SELECT id FROM zakup.users WHERE full_name = 'Тилек Абдыкадыров'`));
    expect((await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: tomorrow() })).status).toBe(400);
    expect((await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: tomorrow(), courierId: foreign })).status).toBe(422);
    const urg = await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: tomorrow(), courierId });
    expect(urg.status).toBe(409); expect(urg.body.error).toMatch(/Срочный заказ — поставка сегодня/);
    const all = await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: tomorrow(), courierId, outLines: [1, 2], agreedLater: true });
    expect(all.status).toBe(409); expect(all.body.error).toMatch(/Нет ни одной позиции/);
    expect((await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: '2020-01-01', courierId })).body.error).toMatch(/в прошлом/);
  });

  it('принятие без одной позиции: сумма, накладная, уведомления магазину и доставщику', async () => {
    const r = await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: tomorrow(), courierId, outLines: [2], agreedLater: true });
    expect(r.status).toBe(200); expect(r.body.urgent).toBe(false); expect(r.body.itemsCount).toBe(1);
    expect(r.body).toMatchObject({ status: 'work', total: 1728, courier: 'Эрлан Касымов' });
    expect(r.body.items[1]).toMatchObject({ out: true, amount: 0 });
    expect(r.body.invoice).toMatchObject({ total: 1728, courier: 'Эрлан Касымов' });
    expect((await as(shop).get('/v1/notifications')).body[0].title).toMatch(new RegExp('Заказ № ' + num + ' принят без 1 поз\\., поставка'));
    expect((await as(courier).get('/v1/notifications')).body[0].title).toBe('Вам назначен заказ № ' + num);
    expect((await as(dist).post(`/v1/orders/${num}/reject`, { reason: 'Передумали' })).body.error).toBe('Заказ уже принят');
    expect((await as(dist).post(`/v1/orders/${num}/accept`, { deliveryDate: tomorrow(), courierId })).body.error).toBe('Заказ уже принят');
  });

  it('доставка: при включённом QR кнопкой нельзя, чужой QR не подходит', async () => {
    expect((await as(courier).post(`/v1/orders/${num}/deliver`)).body.error).toMatch(/Включена доставка по QR/);
    expect((await as(courier).post(`/v1/orders/${num}/deliver`, { qr: 'ZAKUP:' + Number(num) + ':00000000-0000-0000-0000-000000000000' })).status).toBe(409);
    const qr = (await as(shop).get('/v1/orders/' + num)).body.qr;
    expect(qr).toMatch(/^ZAKUP:\d+:/);
    expect((await as(courier).get('/v1/orders/' + num)).body.qr).toBeUndefined();
    const r = await as(courier).post(`/v1/orders/${num}/deliver`, { qr });
    expect(r.status).toBe(200); expect(r.body.status).toBe('done'); expect(r.body.invoice.deliveredBy).toBe('Эрлан Касымов');
    expect((await as(shop).get('/v1/orders/' + num)).body.debt).toBe(true);
  });

  it('QR выключен в админке — доставщик отмечает кнопкой', async () => {
    const r = (await as(other).put('/v1/cart/' + (await as(other).get('/v1/catalog?q=Ряженка')).body[0].id, { qty: 12 }));
    expect(r.status).toBe(200);
    const n2 = (await as(other).post('/v1/cart/checkout')).body.orders[0];
    await as(dist).post(`/v1/orders/${n2}/accept`, { deliveryDate: tomorrow(), courierId });
    sql(`UPDATE zakup.feature_flags SET enabled = false WHERE key = 'qr_delivery'`);
    const d = await as(courier).post(`/v1/orders/${n2}/deliver`);
    sql(`UPDATE zakup.feature_flags SET enabled = true WHERE key = 'qr_delivery'`);
    expect(d.status).toBe(200); expect(d.body.status).toBe('done');
  });

  it('оплата закрывает долг и уведомляет магазин', async () => {
    const before = (await as(dist).get('/v1/debts')).body.find((d: any) => d.shop === 'Магазин «Айдана»').amount;
    expect((await as(dist).post(`/v1/orders/${num}/pay`, { paid: true })).body.debt).toBe(false);
    const after = (await as(dist).get('/v1/debts')).body.find((d: any) => d.shop === 'Магазин «Айдана»')?.amount || 0;
    expect(before - after).toBe(1728);
    expect((await as(shop).get('/v1/notifications')).body[0].title).toBe('Оплата по заказу № ' + num + ' получена');
  });

  it('оценка: только магазин, один раз', async () => {
    expect((await as(dist).post(`/v1/orders/${num}/rating`, { stars: 5 })).status).toBe(403);
    const r = await as(shop).post(`/v1/orders/${num}/rating`, { stars: 4, comment: 'Вовремя' });
    expect(r.status).toBe(201); expect(r.body.rating).toMatchObject({ stars: 4, comment: 'Вовремя' });
    expect((await as(shop).post(`/v1/orders/${num}/rating`, { stars: 5 })).status).toBe(409);
    expect((await as(dist).get('/v1/notifications')).body[0].title).toBe('Оценка доставки № ' + num + ': 4 из 5');
  });

  it('чат по заказу: магазин и поставщик, доставщику недоступен', async () => {
    expect((await as(shop).post(`/v1/orders/${num}/messages`, { body: 'Спасибо!' })).status).toBe(201);
    expect((await as(dist).get('/v1/orders/' + num)).body.unreadMessages).toBe(1);
    const m = (await as(dist).get(`/v1/orders/${num}/messages`)).body;
    expect(m[m.length - 1]).toMatchObject({ body: 'Спасибо!', mine: false });
    expect((await as(dist).get('/v1/orders/' + num)).body.unreadMessages).toBe(0);
    expect((await as(courier).get(`/v1/orders/${num}/messages`)).status).toBe(403);
    expect((await as(other).post(`/v1/orders/${num}/messages`, { body: 'чужой' })).status).toBe(404);
  });

  it('приём заказов выключен — оформить нельзя', async () => {
    const p = (await as(shop).get('/v1/catalog?q=Сметана')).body[0];
    await as(shop).put('/v1/cart/' + p.id, { qty: 1 });
    sql(`UPDATE zakup.feature_flags SET enabled = false WHERE key = 'orders_on'`);
    const r = await as(shop).post('/v1/cart/checkout');
    sql(`UPDATE zakup.feature_flags SET enabled = true WHERE key = 'orders_on'`);
    expect(r.status).toBe(409); expect(r.body.error).toBe('Приём заказов временно остановлен');
    expect((await as(shop).get('/v1/cart')).body.items).toHaveLength(1);   // корзина сохранилась
  });

  it('прочитать все уведомления', async () => {
    expect((await as(shop).post('/v1/notifications/read-all')).body.updated).toBeGreaterThan(0);
    expect((await as(shop).get('/v1/notifications')).body.every((n: any) => n.read)).toBe(true);
  });
});
