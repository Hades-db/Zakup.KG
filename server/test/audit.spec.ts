/**
 * Аудит недели 1: безопасность, гонки, неверные данные, пограничные случаи.
 * Каждый тест — конкретная проверка из отчёта docs/AUDIT_WEEK1.md.
 */
import { INestApplication } from '@nestjs/common';
import { execSync } from 'child_process';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { resetLimits } from '../src/common/rate-limit';

const ADMIN = process.env.TEST_ADMIN_URL || 'postgres://postgres@/zk?host=/var/tmp&port=5499';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://zakup_server@/zk?host=/var/tmp&port=5499';
const SECRET = process.env.JWT_SECRET = 'audit-secret-' + Date.now();

const PH = { shop: '700000111', shop2: '700000112', shop3: '700000113', dist: '700000101', dist2: '700000105', courier: '700000102', courier3: '700000104' };
let app: INestApplication, http: any;
const sql = (q: string) => execSync(`psql "${ADMIN}" -v ON_ERROR_STOP=1 -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const login = async (phone: string, password = 'demo1234') => (await http.post('/v1/auth/login').send({ phone, password })).body;
const tok = async (phone: string) => (await login(phone)).accessToken as string;
const as = (t: string) => ({
  get: (u: string) => http.get(u).set('Authorization', 'Bearer ' + t),
  post: (u: string, b?: any) => http.post(u).set('Authorization', 'Bearer ' + t).send(b || {}),
  put: (u: string, b?: any) => http.put(u).set('Authorization', 'Bearer ' + t).send(b || {}),
  del: (u: string) => http.delete(u).set('Authorization', 'Bearer ' + t),
});
const bishkek = (days = 0) => new Date(Date.now() + 6 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
const pid = (name: string, sup = 'ОсОО «Дистрибьютор»') => Number(sql(`SELECT p.id FROM zakup.products p JOIN zakup.companies c ON c.id = p.supplier_id WHERE p.name = '${name}' AND c.name = '${sup}'`));
const uid = (name: string) => Number(sql(`SELECT id FROM zakup.users WHERE full_name = '${name}'`));
async function clearCart(t: string) { for (const i of (await as(t).get('/v1/cart')).body.items) await as(t).del('/v1/cart/' + i.productId); }
async function order(t: string, name = 'Сметана 20%', qty = 1) {
  await clearCart(t);
  expect((await as(t).put('/v1/cart/' + pid(name), { qty })).status).toBe(200);
  const r = await as(t).post('/v1/cart/checkout'); expect(r.status).toBe(201);
  return r.body.orders[0] as string;
}

beforeAll(async () => {
  execSync('bash scripts/db-reset.sh', { env: { ...process.env, DATABASE_ADMIN_URL: ADMIN }, stdio: 'pipe' });
  sql("ALTER ROLE zakup_server LOGIN PASSWORD 'zakup_test'");
  const { createApp } = await import('../src/main');
  app = await createApp(); await app.init(); http = request(app.getHttpServer());
});
afterAll(async () => { await app?.close(); });
beforeEach(() => resetLimits());

describe('токены и сеансы', () => {
  it('подпись другим секретом, alg=none, истёкший токен, мусор в заголовке — 401 по-русски', async () => {
    const s = await login(PH.shop); const p: any = jwt.decode(s.accessToken);
    const bad = [
      jwt.sign({ sub: p.sub, sid: p.sid }, 'other-secret'),
      jwt.sign({ sub: p.sub, sid: p.sid }, '', { algorithm: 'none' as any }),
      jwt.sign({ sub: p.sub, sid: p.sid, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET),
      jwt.sign({ sub: p.sub, sid: 'not-a-uuid' }, SECRET),
      jwt.sign({ sub: String(Number(p.sub) + 1), sid: p.sid }, SECRET),    // чужой сеанс
      jwt.sign({ sub: p.sub, sid: p.sid }, SECRET, { algorithm: 'HS512' }),
      'garbage',
    ];
    for (const t of bad) { const r = await as(t).get('/v1/orders'); expect(r.status).toBe(401); expect(r.body.error).toMatch(/[а-я]/); }
    for (const h of ['', 'Bearer', 'Basic abc', 'bearer ' + s.accessToken]) {
      const r = await http.get('/v1/orders').set('Authorization', h); expect(r.status).toBe(401);
    }
  });

  it('выход: токен сразу недействителен, повторный выход и refresh — 401', async () => {
    const s = await login(PH.shop);
    expect((await as(s.accessToken).post('/v1/auth/logout')).status).toBe(200);
    expect((await as(s.accessToken).get('/v1/orders')).status).toBe(401);
    expect((await as(s.accessToken).post('/v1/auth/logout')).status).toBe(401);
    expect((await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
  });

  it('refresh: мусорные форматы — 401, а не 500', async () => {
    for (const t of ['x', 'a.b', '00000000-0000-0000-0000-000000000000.zzz', '.' , '"; DROP TABLE x;--']) {
      expect((await http.post('/v1/auth/refresh').send({ refreshToken: t })).status).toBe(401);
    }
    expect((await http.post('/v1/auth/refresh').send({})).status).toBe(400);
  });

  it('пользователя заблокировали посреди сеанса — запросы и refresh отклонены с причиной', async () => {
    const s = await login(PH.shop3);
    sql(`UPDATE zakup.users SET status = 'blocked', block_reason = 'Жалобы поставщиков' WHERE phone = '996${PH.shop3}'`);
    const r = await as(s.accessToken).get('/v1/orders'); expect(r.status).toBe(401); expect(r.body.error).toMatch(/Жалобы поставщиков/);
    const f = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }); expect(f.status).toBe(403);
    sql(`UPDATE zakup.users SET status = 'active', block_reason = NULL WHERE phone = '996${PH.shop3}'`);
  });

  it('компанию заблокировали — все её сотрудники отключены', async () => {
    const d = await tok(PH.dist2);
    sql(`UPDATE zakup.companies SET status = 'blocked', status_reason = 'Проверка документов' WHERE name = 'ОсОО «Азия Трейд»'`);
    expect((await as(d).get('/v1/orders')).body.error).toMatch(/Проверка документов/);
    sql(`UPDATE zakup.companies SET status = 'ok', status_reason = NULL WHERE name = 'ОсОО «Азия Трейд»'`);
  });

  it('временный пароль от администратора: всё закрыто, кроме смены пароля, профиля и выхода', async () => {
    const t = await tok(PH.shop2);
    sql(`UPDATE zakup.users SET must_change_password = true WHERE phone = '996${PH.shop2}'`);
    const r = await as(t).get('/v1/orders'); expect(r.status).toBe(403); expect(r.body.error).toBe('Смените временный пароль');
    expect((await as(t).get('/v1/auth/me')).body.mustChangePassword).toBe(true);
    expect((await as(t).post('/v1/auth/password', { oldPassword: 'demo1234', newPassword: 'demo1234' })).body.error).toBe('Новый пароль совпадает с текущим');
    expect((await as(t).post('/v1/auth/password', { oldPassword: 'demo1234', newPassword: 'dostuk-2026' })).status).toBe(200);
    expect((await as(t).get('/v1/orders')).status).toBe(200);
    sql(`UPDATE zakup.users SET password_hash = (SELECT password_hash FROM zakup.users WHERE phone = '996${PH.shop}') WHERE phone = '996${PH.shop2}'`);
  });
});

describe('вход, регистрация, сброс: перебор и проверка данных', () => {
  it('10 неверных паролей к номеру — 11-я попытка 429; другой номер не затронут', async () => {
    for (let i = 0; i < 10; i++) expect((await http.post('/v1/auth/login').send({ phone: PH.dist2, password: 'x' + i })).status).toBe(401);
    const r = await http.post('/v1/auth/login').send({ phone: PH.dist2, password: 'demo1234' });
    expect(r.status).toBe(429); expect(r.body.error).toMatch(/Слишком много попыток/);
    expect((await http.post('/v1/auth/login').send({ phone: PH.dist, password: 'demo1234' })).status).toBe(200);
  });

  it('успешный вход сбрасывает счётчик неудач', async () => {
    for (let i = 0; i < 9; i++) await http.post('/v1/auth/login').send({ phone: PH.dist, password: 'bad' });
    expect((await http.post('/v1/auth/login').send({ phone: PH.dist, password: 'demo1234' })).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await http.post('/v1/auth/login').send({ phone: PH.dist, password: 'bad' })).status).toBe(401);
  });

  it('время ответа для неизвестного номера сопоставимо с неверным паролем', async () => {
    const t = async (phone: string) => { const a = Date.now(); await http.post('/v1/auth/login').send({ phone, password: 'wrong-pass' }); return Date.now() - a; };
    let known = 0, unknown = 0;
    for (let i = 0; i < 3; i++) { known += await t(PH.shop); unknown += await t('709' + String(100000 + i)); }
    expect(unknown).toBeGreaterThan(known * 0.4);
  });

  it('номер в любом виде: +996, пробелы, скобки', async () => {
    for (const p of ['+996 700 000 111', '996700000111', '(700) 000-111', '700000111']) expect((await http.post('/v1/auth/login').send({ phone: p, password: 'demo1234' })).status).toBe(200);
    expect((await http.post('/v1/auth/login').send({ phone: '+7 700 000 1111', password: 'demo1234' })).status).toBe(400);
  });

  it('неверные данные — 400 с русским текстом, лишние поля запрещены', async () => {
    const a = await http.post('/v1/auth/login').send({ phone: PH.shop });
    expect(a.status).toBe(400); expect(a.body.error).toMatch(/^Проверьте: пароль/);
    const b = await http.post('/v1/auth/login').send({ phone: PH.shop, password: 'demo1234', role: 'admin' });
    expect(b.status).toBe(400); expect(b.body.error).toMatch(/лишнее поле «role»/);
    const c = await http.post('/v1/auth/login').set('Content-Type', 'application/json').send('{"phone":');
    expect(c.status).toBe(400); expect(c.body.error).toBe('Неверный формат данных');
  });

  it('регистрация: дубль ИНН и номера — понятный текст, без «осиротевших» компаний', async () => {
    const base = { type: 'shop', name: 'Магазин «Тест»', inn: '11111111111111', address: 'ул. Логвиненко, 1', phone: '700555100', password: 'test-pass-1', acceptedDocs: true };
    expect((await http.post('/v1/auth/register').send(base)).status).toBe(201);
    const d1 = await http.post('/v1/auth/register').send({ ...base, phone: '700555101' });
    expect(d1.status).toBe(409); expect(d1.body.error).toBe('Компания с таким ИНН / ПИН уже зарегистрирована');
    const d2 = await http.post('/v1/auth/register').send({ ...base, inn: '22222222222222' });
    expect(d2.status).toBe(409); expect(d2.body.error).toBe('Этот номер уже зарегистрирован');
    expect(sql(`SELECT count(*) FROM zakup.companies WHERE inn = '22222222222222'`)).toBe('0');
    expect((await http.post('/v1/auth/register').send({ ...base, inn: '123' })).body.error).toMatch(/ИНН \/ ПИН — 14 цифр/);
    expect((await http.post('/v1/auth/register').send({ ...base, inn: '33333333333333', phone: '700555102', name: '   ' })).status).toBe(400);
    expect((await http.post('/v1/auth/register').send({ ...base, inn: '44444444444444', phone: '700555103', acceptedDocs: false })).status).toBe(400);
    expect((await http.post('/v1/auth/register').send({ ...base, inn: '55555555555555', phone: '700555104', password: 'short' })).body.error).toMatch(/не меньше 8 символов/);
    const n = sql(`SELECT name || '|' || address FROM zakup.companies WHERE inn = '11111111111111'`);
    expect(n).toBe('Магазин «Тест»|ул. Логвиненко, 1');
  });

  it('регистрация принимает документы текущих версий', async () => {
    expect(sql(`SELECT count(*) FROM zakup.document_acceptances a JOIN zakup.users u ON u.id = a.user_id WHERE u.phone = '996700555100'`)).toBe('3');
  });

  it('«Забыли пароль?»: неверный номер — 400, перебор — 429', async () => {
    expect((await http.post('/v1/auth/password-reset').send({ phone: '12' })).status).toBe(400);
    for (let i = 0; i < 10; i++) await http.post('/v1/auth/password-reset').send({ phone: '7001000' + String(10 + i) });
    expect((await http.post('/v1/auth/password-reset').send({ phone: '700100099' })).status).toBe(429);
  });
});

describe('HTTP: заголовки, 404, инъекции', () => {
  it('заголовки безопасности, без X-Powered-By', async () => {
    const r = await http.get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('неизвестный адрес — 404 «Не найдено»', async () => {
    const t = await tok(PH.shop);
    expect((await as(t).get('/v1/nothing')).body.error).toBe('Не найдено');
    for (const n of ['1e3', '-1', '0222abc', '9999999999', '%27', '0']) expect((await as(t).get('/v1/orders/' + n)).status).toBe(404);
  });

  it('SQL-инъекции и шаблоны LIKE в поиске безопасны', async () => {
    const t = await tok(PH.shop);
    for (const q of ["' OR 1=1 --", "'; DROP TABLE zakup.orders; --", '_', '\\']) {
      const r = await as(t).get('/v1/catalog?q=' + encodeURIComponent(q)); expect(r.status).toBe(200); expect(r.body).toEqual([]);
    }
    // % ищется как обычный символ: находятся только названия с «%» (3,2%), а не весь каталог
    const pct = (await as(t).get('/v1/catalog?q=%25')).body;
    expect(pct.length).toBeGreaterThan(0); expect(pct.every((p: any) => p.name.includes('%'))).toBe(true);
    expect(Number(sql('SELECT count(*) FROM zakup.orders'))).toBeGreaterThan(0);
    expect((await as(t).get('/v1/catalog?q=молоко')).body.length).toBeGreaterThan(0);    // регистр не важен
    expect((await as(t).get('/v1/catalog?q=4870001154691')).body.length).toBe(2);       // по штрихкоду — у двух поставщиков
    expect((await as(t).get('/v1/catalog?supplier=abc')).status).toBe(200);
  });
});

describe('корзина', () => {
  let shop: string;
  beforeAll(async () => { shop = await tok(PH.shop); await clearCart(shop); });

  it('нельзя положить: нет в наличии, скрыт модератором, несуществующий товар', async () => {
    expect((await as(shop).put('/v1/cart/' + pid('Мука пшеничная в/с'), { qty: 1 })).body.error).toBe('Товара нет в наличии');
    expect((await as(shop).put('/v1/cart/' + pid('Пряники «Тульские»', 'ИП «Айгерим Опт»'), { qty: 1 })).status).toBe(409);
    expect((await as(shop).put('/v1/cart/999999', { qty: 1 })).status).toBe(409);
    expect((await as(shop).put('/v1/cart/abc', { qty: 1 })).status).toBe(404);
  });

  it('количество: целое для коробок и штук, дробное для весового, границы', async () => {
    expect((await as(shop).put('/v1/cart/' + pid('Молоко «Моё» 3,2%'), { qty: 1.5 })).body.error).toBe('Количество — целое число');
    expect((await as(shop).put('/v1/cart/' + pid('Сахар белый'), { qty: 2.5 })).status).toBe(200);
    expect((await as(shop).put('/v1/cart/' + pid('Сахар белый'), { qty: 0 })).status).toBe(400);
    expect((await as(shop).put('/v1/cart/' + pid('Сахар белый'), { qty: 10000 })).status).toBe(400);
    expect((await as(shop).put('/v1/cart/' + pid('Сахар белый'), { qty: '5' })).status).toBe(400);
    const c = (await as(shop).get('/v1/cart')).body; expect(c.items[0]).toMatchObject({ qty: 2.5, amount: 205 });
  });

  it('срочность при выключенных срочных заказах — 409', async () => {
    sql(`UPDATE zakup.feature_flags SET enabled = false WHERE key = 'urgent_on'`);
    const r = await as(shop).put('/v1/cart/' + pid('Кефир 2,5%'), { qty: 1, urgent: true });
    sql(`UPDATE zakup.feature_flags SET enabled = true WHERE key = 'urgent_on'`);
    expect(r.status).toBe(409); expect(r.body.error).toBe('Срочные заказы временно недоступны');
  });

  it('товар заблокированного поставщика: в корзину нельзя, оформить нельзя', async () => {
    await clearCart(shop);
    await as(shop).put('/v1/cart/' + pid('Хлеб «Экстра»', 'ОсОО «Азия Трейд»'), { qty: 5 });
    sql(`UPDATE zakup.companies SET status = 'blocked', status_reason = 'Тест' WHERE name = 'ОсОО «Азия Трейд»'`);
    const r = await as(shop).post('/v1/cart/checkout');
    const add = await as(shop).put('/v1/cart/' + pid('Батон нарезной', 'ОсОО «Азия Трейд»'), { qty: 1 });
    sql(`UPDATE zakup.companies SET status = 'ok', status_reason = NULL WHERE name = 'ОсОО «Азия Трейд»'`);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/Нет в наличии: Хлеб «Экстра»/);
    expect(add.status).toBe(409);
    await clearCart(shop);
  });

  it('корзину видит и меняет только магазин', async () => {
    const d = await tok(PH.dist);
    expect((await as(d).get('/v1/cart')).status).toBe(403);
    expect((await as(d).post('/v1/cart/checkout')).status).toBe(403);
  });

  it('двойное «Оформить» одновременно — один набор заказов', async () => {
    await as(shop).put('/v1/cart/' + pid('Сметана 20%'), { qty: 2 });
    const before = Number(sql('SELECT count(*) FROM zakup.orders'));
    const [a, b] = await Promise.all([as(shop).post('/v1/cart/checkout'), as(shop).post('/v1/cart/checkout')]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(Number(sql('SELECT count(*) FROM zakup.orders')) - before).toBe(1);
  });
});

describe('заказ: роли, статусы, гонки', () => {
  let shop: string, shop2: string, dist: string, dist2: string, courier: string, courier3: string, cr: number;
  beforeAll(async () => {
    [shop, shop2, dist, dist2, courier, courier3] = await Promise.all([PH.shop, PH.shop2, PH.dist, PH.dist2, PH.courier, PH.courier3].map(tok));
    cr = uid('Эрлан Касымов');
  });

  it('видимость: магазин и поставщик — только свои; списки и детали согласованы', async () => {
    const n = await order(shop);
    expect((await as(shop2).get('/v1/orders')).body.some((o: any) => o.number === n)).toBe(false);
    expect((await as(dist2).get('/v1/orders')).body.some((o: any) => o.number === n)).toBe(false);
    expect((await as(dist).get('/v1/orders?status=new')).body.some((o: any) => o.number === n)).toBe(true);
    expect((await as(courier).get('/v1/orders')).body.every((o: any) => o.courierId === cr)).toBe(true);
    expect((await as(dist2).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: cr })).status).toBe(404);
    expect((await as(shop2).post(`/v1/orders/${n}/messages`, { body: 'x' })).status).toBe(404);
  });

  it('RLS в самой базе: под ролью приложения магазин видит только свои заказы', async () => {
    const id = uid('Айдана М.');
    const mine = sql(`BEGIN; SET LOCAL ROLE zakup_api; SELECT set_config('app.user_id', '${id}', true); SELECT count(*) FROM zakup.orders; COMMIT;`).split('\n').pop();
    expect(mine).toBe(sql(`SELECT count(*) FROM zakup.orders o JOIN zakup.companies c ON c.id = o.shop_id WHERE c.name = 'Магазин «Айдана»'`));
    const nobody = sql(`BEGIN; SET LOCAL ROLE zakup_api; SELECT count(*) FROM zakup.orders; COMMIT;`).split('\n').pop();
    expect(nobody).toBe('0');   // без app.user_id — ничего
  });

  it('два одновременных «Принять» — одно проходит, второе 409', async () => {
    const n = await order(shop);
    const [a, b] = await Promise.all([1, 2].map(() => as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: cr })));
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(Number(sql(`SELECT count(*) FROM zakup.invoices i JOIN zakup.orders o ON o.id = i.order_id WHERE o.number = ${Number(n)}`))).toBe(1);
  });

  it('принятие: неверная дата, заблокированный доставщик, заблокированный магазин', async () => {
    const n = await order(shop);
    expect((await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: '2026-02-30', courierId: cr })).body.error).toBe('Неверная дата');
    expect((await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: '24.11.2026', courierId: cr })).body.error).toMatch(/ГГГГ-ММ-ДД/);
    expect((await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(31), courierId: cr })).body.error).toBe('Дата поставки — не дальше 30 дней');
    expect((await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(-1), courierId: cr })).body.error).toBe('Дата доставки в прошлом');
    sql(`UPDATE zakup.users SET status = 'blocked', block_reason = 'Тест' WHERE full_name = 'Улан Токтогулов'`);
    expect((await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: uid('Улан Токтогулов') })).body.error).toBe('Доставщик заблокирован');
    sql(`UPDATE zakup.users SET status = 'active', block_reason = NULL WHERE full_name = 'Улан Токтогулов'`);
    sql(`UPDATE zakup.companies SET status = 'blocked', status_reason = 'Тест' WHERE name = 'Магазин «Айдана»'`);
    const r = await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: cr });
    sql(`UPDATE zakup.companies SET status = 'ok', status_reason = NULL WHERE name = 'Магазин «Айдана»'`);
    expect(r.body.error).toBe('Магазин заблокирован, заказ принять нельзя');
    expect((await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(0), courierId: cr, outLines: [99] })).body.items[0].out).toBe(false);
  });

  it('смена доставщика: только в работе, только активный своей компании; на того же — без изменений', async () => {
    const n = await order(shop);
    expect((await as(dist).post(`/v1/orders/${n}/courier`, { courierId: cr })).body.error).toBe('Заказ ещё не принят');
    await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(1), courierId: cr });
    const nf = Number(sql(`SELECT count(*) FROM zakup.notifications WHERE user_id = ${cr}`));
    expect((await as(dist).post(`/v1/orders/${n}/courier`, { courierId: cr })).status).toBe(200);
    expect(Number(sql(`SELECT count(*) FROM zakup.notifications WHERE user_id = ${cr}`))).toBe(nf);
    expect((await as(dist).post(`/v1/orders/${n}/courier`, { courierId: uid('Тилек Абдыкадыров') })).status).toBe(422);
    const r = await as(dist).post(`/v1/orders/${n}/courier`, { courierId: uid('Улан Токтогулов') });
    expect(r.body.courier).toBe('Улан Токтогулов');
    expect((await as(courier3).get('/v1/notifications')).body[0].title).toBe('Вам назначен заказ № ' + n);
    expect((await as(courier).get('/v1/orders/' + n)).status).toBe(404);    // прежний доставщик больше не видит
  });

  it('доставка: не принятый — 409, повторная — «уже доставлен», чужой доставщик — 404', async () => {
    const n = await order(shop);
    expect((await as(courier).post(`/v1/orders/${n}/deliver`)).status).toBe(404);
    await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(0), courierId: cr });
    expect((await as(courier3).post(`/v1/orders/${n}/deliver`)).status).toBe(404);
    const qr = (await as(shop).get('/v1/orders/' + n)).body.qr;
    expect((await as(courier).post(`/v1/orders/${n}/deliver`, { qr })).status).toBe(200);
    expect((await as(courier).post(`/v1/orders/${n}/deliver`, { qr })).body.error).toBe('Заказ уже доставлен');
    expect((await as(shop).get('/v1/orders/' + n)).body.qr).toBeUndefined();     // после доставки QR не показываем
  });

  it('оплата: только у принятого или доставленного; снять отметку — снова долг', async () => {
    const n = await order(shop);
    expect((await as(dist).post(`/v1/orders/${n}/pay`, { paid: true })).body.error).toBe('Заказ ещё не принят');
    await as(dist).post(`/v1/orders/${n}/accept`, { deliveryDate: bishkek(0), courierId: cr });
    await as(courier).post(`/v1/orders/${n}/deliver`, { qr: (await as(shop).get('/v1/orders/' + n)).body.qr });
    expect((await as(dist).post(`/v1/orders/${n}/pay`, { paid: true })).body.debt).toBe(false);
    expect((await as(dist).post(`/v1/orders/${n}/pay`, { paid: false })).body.debt).toBe(true);
    expect((await as(shop).post(`/v1/orders/${n}/pay`, { paid: true })).status).toBe(403);
    expect((await as(courier).get('/v1/debts')).status).toBe(403);
  });

  it('отказ: причина обязательна и обрезается; повторный — 409', async () => {
    const n = await order(shop);
    expect((await as(dist).post(`/v1/orders/${n}/reject`, { reason: ' ' })).status).toBe(400);
    const r = await as(dist).post(`/v1/orders/${n}/reject`, { reason: '  Нет в наличии  ' });
    expect(r.body).toMatchObject({ status: 'rejected', rejectReason: 'Нет в наличии' });
    expect((await as(dist).post(`/v1/orders/${n}/reject`, { reason: 'Ещё раз' })).body.error).toBe('Заказ отклонён или отменён');
    expect((await as(shop).get('/v1/notifications')).body[0].title).toBe('Заказ № ' + n + ' отклонён: Нет в наличии');
  });

  it('оценка: границы и только доставленный', async () => {
    const n = await order(shop);
    expect((await as(shop).post(`/v1/orders/${n}/rating`, { stars: 5 })).body.error).toBe('Оценить можно только доставленный заказ');
    for (const s of [0, 6, 2.5, '5']) expect((await as(shop).post(`/v1/orders/${n}/rating`, { stars: s })).status).toBe(400);
  });

  it('чат: пустое и слишком длинное сообщение — 400', async () => {
    const n = await order(shop);
    expect((await as(shop).post(`/v1/orders/${n}/messages`, { body: '   ' })).body.error).toBe('Пустое сообщение');
    expect((await as(shop).post(`/v1/orders/${n}/messages`, { body: 'я'.repeat(1001) })).status).toBe(400);
    expect((await as(shop).post(`/v1/orders/${n}/messages`, { body: '  Привезите до обеда  ' })).body.body).toBe('Привезите до обеда');
  });

  it('список: фильтр, страницы, неверный статус', async () => {
    expect((await as(dist).get('/v1/orders?status=bad')).status).toBe(400);
    const p1 = (await as(dist).get('/v1/orders?limit=5')).body, p2 = (await as(dist).get('/v1/orders?limit=5&offset=5')).body;
    expect(p1).toHaveLength(5); expect(p2).toHaveLength(5);
    expect(p1.some((o: any) => p2.some((x: any) => x.number === o.number))).toBe(false);
    expect((await as(dist).get('/v1/orders?limit=100000')).body.length).toBeLessThanOrEqual(200);
  });

  it('номер заказа после 9999 не обрезается', async () => {
    sql(`SELECT setval('zakup.order_number_seq', 9999)`);
    const n = await order(shop);
    expect(n).toBe('10000');
    expect((await as(shop).get('/v1/orders/10000')).body.number).toBe('10000');
    expect((await as(dist).get('/v1/notifications')).body[0].title).toBe('Новый заказ № 10000');
  });

  it('уведомления: только свои; «прочитать все» не трогает чужие', async () => {
    const before = sql(`SELECT count(*) FROM zakup.notifications WHERE read_at IS NULL AND user_id = ${uid('Азамат Т.')}`);
    await as(shop).post('/v1/notifications/read-all');
    expect(sql(`SELECT count(*) FROM zakup.notifications WHERE read_at IS NULL AND user_id = ${uid('Азамат Т.')}`)).toBe(before);
    const mine = (await as(shop).get('/v1/notifications')).body;
    expect(Number(sql(`SELECT count(*) FROM zakup.notifications WHERE user_id = ${uid('Айдана М.')}`))).toBe(mine.length);
  });

  it('доставщики: только свои, без чужих компаний', async () => {
    const list = (await as(dist).get('/v1/couriers')).body;
    expect(list.map((c: any) => c.name).sort()).toEqual(['Бекзат Осмонов', 'Улан Токтогулов', 'Эрлан Касымов']);
    expect((await as(shop).get('/v1/couriers')).status).toBe(403);
  });
});
