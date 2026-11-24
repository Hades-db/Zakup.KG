-- =====================================================================
--  Zakup.KG — демо-данные, как в макете (mvp.html + admin.html)
--  Телефоны вымышленные (996 700 000 0xx), пароль у всех демо-аккаунтов: demo1234
--  Хэш ниже — заглушка формата argon2id; на сервере хэш считает API.
-- =====================================================================
BEGIN;
SET search_path = zakup, public;
\set pw '''$argon2id$v=19$m=65536,t=3,p=4$ZGVtby1zYWx0$ZGVtby1oYXNoLWRvLW5vdC11c2U'''

-- ---------- Команда ----------
INSERT INTO staff (name, email, role, password_hash, last_login_at) VALUES
  ('Владелец',  'admin@zakup.kg',   'owner',   :pw, now()),
  ('Айбек Н.',  'support@zakup.kg', 'support', :pw, now() - interval '3 hours'),
  ('Динара К.', 'moder@zakup.kg',   'moder',   :pw, now() - interval '1 day'),
  ('Тимур Р.',  'dev@zakup.kg',     'dev',     :pw, now() - interval '5 hours');

-- ---------- Флаги, справочники, документы ----------
INSERT INTO feature_flags (key, enabled, title) VALUES
  ('orders_on',   true,  'Приём заказов'),
  ('urgent_on',   true,  'Срочные заказы'),
  ('qr_delivery', true,  'Доставка по QR'),
  ('new_catalog', false, 'Новый каталог (тест)');

INSERT INTO categories (name, sort) VALUES ('Молочка', 1), ('Хлеб', 2), ('Напитки', 3), ('Бакалея', 4), ('Сладости', 5);
INSERT INTO reject_reasons (text, sort) VALUES ('Нет в наличии', 1), ('Загруженность доставки', 2), ('Другое', 99);

INSERT INTO documents (code, title) VALUES
  ('oferta', 'Публичная оферта'),
  ('user_agreement_zakup_kg', 'Пользовательское соглашение'),
  ('privacy', 'Политика конфиденциальности');
INSERT INTO document_versions (doc_code, version, body_path, published_by, published_at) VALUES
  ('oferta',                  'v1.2', 'docs/oferta/v1.2.html',                  1, '2026-11-01 09:00+06'),
  ('user_agreement_zakup_kg', 'v1.1', 'docs/user_agreement_zakup_kg/v1.1.html', 1, '2026-11-01 09:00+06'),
  ('privacy',                 'v1.3', 'docs/privacy/v1.3.html',                 1, '2026-11-15 09:00+06');

-- ---------- Компании ----------
-- Подтверждённые вставляем со статусом ok сразу (verified_*), заявки — pending
INSERT INTO companies (type, name, inn, address, district, phone, status, status_reason, verified_by, verified_at, created_at) VALUES
  ('dist', 'ОсОО «Дистрибьютор»',  '02305199010045', 'пр. Чуй, 154',          'Первомайский р-н',  '996700000001', 'ok', NULL, 3, '2026-09-12 12:00+06', '2026-09-12 10:00+06'),
  ('dist', 'ОсОО «Азия Трейд»',    '01811201610025', 'ул. Ахунбаева, 99',     'Октябрьский р-н',   '996700000002', 'ok', NULL, 3, '2026-09-20 12:00+06', '2026-09-20 10:00+06'),
  ('dist', 'ИП «Айгерим Опт»',     '21503199800318', 'рынок «Дордой»',        NULL,                '996700000003', 'ok', NULL, 3, '2026-10-02 12:00+06', '2026-10-02 10:00+06'),
  ('shop', 'Магазин «Айдана»',     '01204198700123', 'ул. Исанова, 61',       'Свердловский р-н',  '996700000011', 'ok', NULL, 3, '2026-09-14 12:00+06', '2026-09-14 10:00+06'),
  ('shop', 'Магазин «Достук»',     '10105199300456', 'ул. Московская, 203',   'Октябрьский р-н',   '996700000012', 'ok', NULL, 3, '2026-09-18 12:00+06', '2026-09-18 10:00+06'),
  ('shop', 'Минимаркет «Ала-Тоо»', '20907198600711', 'ул. Боконбаева, 17',    'Октябрьский р-н',   '996700000013', 'ok', NULL, 3, '2026-09-25 12:00+06', '2026-09-25 10:00+06'),
  ('shop', 'Продукты «Нур»',       '11502199100288', 'ул. Ахунбаева, 112',    'Первомайский р-н',  '996700000014', 'ok', NULL, 3, '2026-10-01 12:00+06', '2026-10-01 10:00+06'),
  ('shop', 'Магазин «Жибек»',      '12306198800945', 'ул. Фрунзе, 88',        'Ленинский р-н',     '996700000015', 'ok', NULL, 3, '2026-10-05 12:00+06', '2026-10-05 10:00+06'),
  ('shop', 'Магазин «Береке»',     '10811199500517', 'ул. Токтогула, 45',     'Ленинский р-н',     '996700000016', 'ok', NULL, 3, '2026-10-09 12:00+06', '2026-10-09 10:00+06'),
  ('shop', 'Магазин «Айгуль»',     '10312199700222', 'ул. Жибек Жолу, 310',   'Свердловский р-н',  '996700000017', 'ok', NULL, 3, '2026-10-12 12:00+06', '2026-10-12 10:00+06'),
  ('shop', 'Киоск «Мээрим»',       '12207199900612', 'Ошский рынок',          NULL,                '996700000018', 'blocked', 'ИНН не совпадает с данными налоговой', 3, '2026-10-30 12:00+06', '2026-10-30 10:00+06');
INSERT INTO companies (type, name, inn, city, address, phone, created_at) VALUES
  ('dist', 'ОсОО «Ысык-Көл Сүт»', '02008201910331', 'г. Каракол', 'ул. Торекулова, 12', '996700000004', '2026-11-22 11:00+06'),
  ('shop', 'Магазин «Нурлан»',     '20101199200134', 'г. Ош',      'ул. Ленина, 210',    '996700000019', '2026-11-21 16:00+06');

-- ---------- Пользователи ----------
INSERT INTO users (company_id, role, full_name, phone, password_hash, status, block_reason, last_login_at)
SELECT c.id, v.role::user_role, v.name, v.phone, :pw, v.st::user_status, v.why, now() - v.ago::interval
  FROM (VALUES
    ('ОсОО «Дистрибьютор»',  'owner',   'Азамат Т.',        '996700000101', 'active',  NULL, '3 hours'),
    ('ОсОО «Дистрибьютор»',  'courier', 'Эрлан Касымов',    '996700000102', 'active',  NULL, '1 hour'),
    ('ОсОО «Дистрибьютор»',  'courier', 'Бекзат Осмонов',   '996700000103', 'active',  NULL, '1 day'),
    ('ОсОО «Дистрибьютор»',  'courier', 'Улан Токтогулов',  '996700000104', 'active',  NULL, '2 days'),
    ('ОсОО «Азия Трейд»',    'owner',   'Самат О.',         '996700000105', 'active',  NULL, '3 days'),
    ('ИП «Айгерим Опт»',     'owner',   'Айгерим Б.',       '996700000106', 'active',  NULL, '5 hours'),
    ('Магазин «Айдана»',     'owner',   'Айдана М.',        '996700000111', 'active',  NULL, '2 hours'),
    ('Магазин «Достук»',     'owner',   'Гульнара А.',      '996700000112', 'active',  NULL, '4 hours'),
    ('Минимаркет «Ала-Тоо»', 'owner',   'Нурбек Ж.',        '996700000113', 'active',  NULL, '15 hours'),
    ('Продукты «Нур»',       'owner',   'Бакыт С.',         '996700000114', 'active',  NULL, '2 hours'),
    ('Магазин «Жибек»',      'owner',   'Жибек К.',         '996700000115', 'active',  NULL, '1 day'),
    ('Магазин «Береке»',     'owner',   'Берик А.',         '996700000116', 'active',  NULL, '1 day'),
    ('Магазин «Айгуль»',     'owner',   'Айгуль С.',        '996700000117', 'active',  NULL, '2 days'),
    ('Киоск «Мээрим»',       'owner',   'Мээрим Д.',        '996700000118', 'blocked', 'Компания заблокирована', '25 days'),
    ('ОсОО «Ысык-Көл Сүт»',  'owner',   'Владелец, ОсОО «Ысык-Көл Сүт»', '996700000107', 'active', NULL, '0'),
    ('Магазин «Нурлан»',     'owner',   'Нурлан Э.',        '996700000119', 'active',  NULL, '0')
  ) v(co, role, name, phone, st, why, ago)
  JOIN companies c ON c.name = v.co;
UPDATE users SET last_login_at = NULL WHERE company_id IN (SELECT id FROM companies WHERE status = 'pending');
UPDATE users SET created_by = (SELECT id FROM users WHERE full_name = 'Азамат Т.') WHERE role = 'courier';

INSERT INTO sessions (user_id, token_hash, device, ip)
SELECT id, sha256(convert_to('demo-token-' || id, 'UTF8')), 'iPhone 13, iOS 18', ('212.42.100.' || (id % 200))::inet FROM users WHERE status = 'active' AND last_login_at IS NOT NULL;

INSERT INTO document_acceptances (user_id, version_id, accepted_at)
SELECT u.id, v.id, '2026-11-02 10:00+06' FROM users u CROSS JOIN document_versions v
 WHERE u.status = 'active' AND u.last_login_at IS NOT NULL AND NOT (v.doc_code = 'privacy' AND u.full_name IN ('Бакыт С.', 'Самат О.'));

-- ---------- Товары ----------
CREATE TEMP TABLE p_src (k text, sup text, name text, vv numeric, vu text, pt text, pq int, price numeric, cat text, code text, descr text, ret bool, stock bool, pop int);
INSERT INTO p_src VALUES
  ('milk',         'ОсОО «Дистрибьютор»', 'Молоко «Моё» 3,2%',     1,    'л', 'box',    12, 864,  'Молочка',  '4870001154691', 'Ультрапастеризованное, срок хранения 6 месяцев. В коробке 12 пакетов.', true, true, 40),
  ('kefir',        'ОсОО «Дистрибьютор»', 'Кефир 2,5%',            1,    'л', 'box',    12, 780,  'Молочка',  '4607053473780', 'Срок хранения 10 дней при +2…+6 °C.', true, true, 31),
  ('smetana',      'ОсОО «Дистрибьютор»', 'Сметана 20%',           400,  'г', 'piece',  1,  90,   'Молочка',  '4607807431837', NULL, true, true, 12),
  ('butter',       'ОсОО «Дистрибьютор»', 'Масло сливочное 82,5%', 180,  'г', 'block',  20, 2900, 'Молочка',  '4606419001995', 'Высший сорт, ГОСТ.', false, true, 9),
  ('ryazhenka',    'ОсОО «Дистрибьютор»', 'Ряженка 4%',            0.5,  'л', 'piece',  1,  68,   'Молочка',  '4870055000043', NULL, true, true, 4),
  ('tvorog',       'ОсОО «Дистрибьютор»', 'Творог 9%',             200,  'г', 'piece',  1,  120,  'Молочка',  '4700002062124', NULL, true, true, 7),
  ('juice',        'ОсОО «Дистрибьютор»', 'Сок яблочный',          1,    'л', 'box',    12, 1140, 'Напитки',  '4680019565262', 'Восстановленный, без добавления сахара.', true, true, 25),
  ('juice_orange', 'ОсОО «Дистрибьютор»', 'Сок апельсиновый',      1,    'л', 'box',    12, 1176, 'Напитки',  '4850089001407', NULL, true, true, 6),
  ('sugar',        'ОсОО «Дистрибьютор»', 'Сахар белый',           1,    'кг', 'weight', 1, 82,   'Бакалея',  '4610020700192', 'Цена за 1 кг, отгрузка мешками по 50 кг.', false, true, 18),
  ('flour',        'ОсОО «Дистрибьютор»', 'Мука пшеничная в/с',    2,    'кг', 'piece',  1, 130,  'Бакалея',  '4601780002565', NULL, false, false, 3),
  ('rice',         'ОсОО «Дистрибьютор»', 'Рис пропаренный',       900,  'г', 'piece',  1,  110,  'Бакалея',  '4605093001802', NULL, true, true, 5),
  ('cookie',       'ОсОО «Дистрибьютор»', 'Печенье овсяное',       300,  'г', 'block',  12, 816,  'Сладости', '4607015234398', NULL, false, true, 2),
  ('milk',         'ОсОО «Азия Трейд»',   'Молоко «Моё» 3,2%',     1,    'л', 'box',    12, 899,  'Молочка',  '4870001154691', NULL, true, true, 10),
  ('juice',        'ОсОО «Азия Трейд»',   'Сок яблочный',          1,    'л', 'box',    12, 1180, 'Напитки',  '4680019565262', NULL, true, true, 4),
  ('bread',        'ОсОО «Азия Трейд»',   'Хлеб «Экстра»',         500,  'г', 'piece',  1,  38,   'Хлеб',     '4601388000116', NULL, true, true, 50),
  ('baton',        'ОсОО «Азия Трейд»',   'Батон нарезной',        400,  'г', 'piece',  1,  35,   'Хлеб',     '4601347009273', NULL, true, true, 20),
  ('kefir',        'ИП «Айгерим Опт»',    'Кефир 2,5%',            1,    'л', 'box',    12, 820,  'Молочка',  '4607053473780', NULL, true, true, 3),
  ('sugar',        'ИП «Айгерим Опт»',    'Сахар белый',           1,    'кг', 'weight', 1, 85,   'Бакалея',  '4610020700192', NULL, false, true, 8),
  ('lemonade',     'ИП «Айгерим Опт»',    'Лимонад «Holiday»',     1,    'л', 'box',    12, 840,  'Напитки',  '4870071002113', NULL, true, true, 6),
  ('pryaniki',     'ИП «Айгерим Опт»',    'Пряники «Тульские»',    140,  'г', 'piece',  1,  75,   'Сладости', '4601713001702', NULL, true, true, 1);

-- Товар и его фото — в одной транзакции (минимум 2 фото проверяется при COMMIT)
WITH ins AS (
  INSERT INTO products (supplier_id, category_id, name, volume_value, volume_unit, pack_type, pack_qty, price, barcode, description, returnable, in_stock, orders_count)
  SELECT c.id, cat.id, s.name, s.vv, s.vu::volume_unit, s.pt::pack_type, s.pq, s.price, s.code, s.descr, s.ret, s.stock, s.pop
    FROM p_src s JOIN companies c ON c.name = s.sup JOIN categories cat ON cat.name = s.cat
  RETURNING id, barcode, supplier_id)
INSERT INTO product_photos (product_id, position, path)
SELECT ins.id, n, 'products/' || ins.id || '/' || n || '.webp' FROM ins CROSS JOIN generate_series(1, 2) n;

-- Скрытый модератором товар
UPDATE products SET hidden_by = 3, hidden_reason = 'Фото не соответствует товару'
 WHERE name = 'Пряники «Тульские»';

-- Корзина Айданы: два товара, один срочный
INSERT INTO cart_items (user_id, product_id, qty, urgent)
SELECT u.id, p.id, v.q, v.urg FROM (VALUES ('Сок яблочный', 2, false), ('Кефир 2,5%', 3, true)) v(nm, q, urg)
  JOIN products p ON p.name = v.nm AND p.supplier_id = (SELECT id FROM companies WHERE name = 'ОсОО «Дистрибьютор»')
  CROSS JOIN users u WHERE u.full_name = 'Айдана М.';

-- ---------- Заказы ----------
-- Создаются как в приложении: заказ → позиции → принятие → доставка. Триггеры ведут историю и накладные.
SELECT setval('order_number_seq', 211) \g /dev/null
CREATE TEMP TABLE o_src (n int, shop text, sup text, urgent bool, ago interval, items text[][]);
INSERT INTO o_src VALUES
  (212, 'Магазин «Айдана»',     'ОсОО «Азия Трейд»',   false, '5 days',   ARRAY[['Хлеб «Экстра»','30'],['Батон нарезной','20']]),
  (213, 'Магазин «Айдана»',     'ОсОО «Дистрибьютор»', false, '4 days',   ARRAY[['Сахар белый','25'],['Сок яблочный','1']]),
  (214, 'Магазин «Айгуль»',     'ОсОО «Дистрибьютор»', false, '3 days',   ARRAY[['Печенье овсяное','1']]),
  (215, 'Магазин «Айгуль»',     'ОсОО «Дистрибьютор»', false, '2 days',   ARRAY[['Мука пшеничная в/с','20']]),
  (216, 'Магазин «Айдана»',     'ОсОО «Дистрибьютор»', false, '1 day',    ARRAY[['Молоко «Моё» 3,2%','2'],['Ряженка 4%','12']]),
  (217, 'Магазин «Береке»',     'ОсОО «Дистрибьютор»', true,  '1 day',    ARRAY[['Кефир 2,5%','2']]),
  (218, 'Магазин «Жибек»',      'ОсОО «Дистрибьютор»', false, '2 hours',  ARRAY[['Сахар белый','50'],['Рис пропаренный','10']]),
  (219, 'Продукты «Нур»',       'ОсОО «Дистрибьютор»', true,  '1 hour',   ARRAY[['Масло сливочное 82,5%','1'],['Творог 9%','10'],['Ряженка 4%','12']]),
  (220, 'Минимаркет «Ала-Тоо»', 'ОсОО «Дистрибьютор»', false, '25 min',   ARRAY[['Сок яблочный','2'],['Сок апельсиновый','1']]),
  (221, 'Магазин «Достук»',     'ОсОО «Дистрибьютор»', true,  '5 min',    ARRAY[['Молоко «Моё» 3,2%','3'],['Кефир 2,5%','2'],['Сметана 20%','12']]);

INSERT INTO orders (number, shop_id, created_by, supplier_id, urgent, ship_name, ship_address, ship_district, created_at)
SELECT s.n, sh.id, u.id, su.id, s.urgent, sh.name, sh.city || ', ' || sh.address, sh.district, now() - s.ago
  FROM o_src s JOIN companies sh ON sh.name = s.shop JOIN companies su ON su.name = s.sup
  JOIN users u ON u.company_id = sh.id AND u.role = 'owner';

INSERT INTO order_items (order_id, line, product_id, supplier_id, name, volume, unit, pack_qty, photo_path, price, qty)
SELECT o.id, it.line, p.id, p.supplier_id, p.name,
       replace(rtrim(to_char(p.volume_value, 'FM9999990.###'), '.'), '.', ',') || ' ' || p.volume_unit,
       CASE p.pack_type WHEN 'box' THEN 'кор' WHEN 'block' THEN 'бл' WHEN 'weight' THEN 'кг' ELSE 'шт' END,
       p.pack_qty, 'products/' || p.id || '/1.webp', p.price, it.q::numeric
  FROM o_src s JOIN orders o ON o.number = s.n
  CROSS JOIN LATERAL (SELECT row_number() OVER () AS line, s.items[i][1] AS nm, s.items[i][2] AS q FROM generate_subscripts(s.items, 1) i) it
  JOIN products p ON p.name = it.nm AND p.supplier_id = o.supplier_id;
SELECT setval('order_number_seq', 221) \g /dev/null

-- Принятие: дата + доставщик (накладная создаётся триггером)
UPDATE orders o SET status = 'work', delivery_date = current_date + v.d, courier_id = u.id
  FROM (VALUES (213, 0, 'Эрлан Касымов'), (214, 0, 'Бекзат Осмонов'), (216, 1, 'Бекзат Осмонов'), (217, 0, 'Эрлан Касымов')) v(n, d, cr)
  JOIN users u ON u.full_name = v.cr
 WHERE o.number = v.n;
-- у «Азия Трейд» свой доставщик
INSERT INTO users (company_id, role, full_name, phone, password_hash) SELECT id, 'courier', 'Тилек Абдыкадыров', '996700000108', :pw FROM companies WHERE name = 'ОсОО «Азия Трейд»';
UPDATE orders SET status = 'work', delivery_date = current_date, courier_id = (SELECT id FROM users WHERE full_name = 'Тилек Абдыкадыров') WHERE number = 212;

-- Доставка: по QR
UPDATE orders SET status = 'done', delivered_by = courier_id, delivered_method = 'qr' WHERE number IN (212, 213, 214);

-- Отказ поставщика
UPDATE orders SET status = 'rejected', reject_reason = 'Нет в наличии' WHERE number = 215;

-- Исторические даты (как в макете: принят и доставлен в прошлые дни). Только для демо-данных
ALTER TABLE orders DISABLE TRIGGER orders_before_update;
UPDATE orders o SET delivery_date = current_date + v.dd, accepted_at = now() + v.acc + interval '20 min', delivered_at = CASE WHEN v.del IS NULL THEN NULL ELSE (date_trunc('day', (now() + v.acc + interval '1 day') AT TIME ZONE 'Asia/Bishkek') + v.del) AT TIME ZONE 'Asia/Bishkek' END
  FROM (VALUES (212, -4, interval '-5 days', interval '9 hours 20 min'), (213, -3, interval '-4 days', interval '15 hours 5 min'),
               (214, -2, interval '-3 days', interval '10 hours 42 min'), (216, 1, interval '-1 day', NULL), (217, 0, interval '-1 day', NULL)) v(n, dd, acc, del)
 WHERE o.number = v.n;
ALTER TABLE orders ENABLE TRIGGER orders_before_update;
UPDATE order_events e SET created_at = o.created_at FROM orders o WHERE e.order_id = o.id AND e.status = 'new';
UPDATE order_events e SET created_at = o.accepted_at, title = 'Принят, поставка ' || to_char(o.delivery_date, 'DD.MM') FROM orders o WHERE e.order_id = o.id AND e.status = 'work';
UPDATE order_events e SET created_at = o.delivered_at FROM orders o WHERE e.order_id = o.id AND e.status = 'done';

-- ---------- Уведомления ----------
INSERT INTO notifications (user_id, title, sender, icon, order_id, created_at, read_at)
SELECT u.id, v.t, v.s, v.ic, o.id, now() - v.ago::interval, CASE WHEN v.rd THEN now() END
  FROM (VALUES
    ('Айдана М.', 'Заказ № 0216 принят, поставка ' || to_char(current_date + 1, 'DD.MM'), 'ОсОО «Дистрибьютор»', 'i-check', 216, '1 day', false),
    ('Айдана М.', 'Заказ № 0213 доставлен',                                               'ОсОО «Дистрибьютор»', 'i-truck', 213, '3 days', true),
    ('Азамат Т.', 'Новый заказ № 0221 от Магазин «Достук», срочно',                       'Магазин «Достук»',    'i-bell',  221, '5 min', false),
    ('Эрлан Касымов', 'Вам назначен заказ № 0217',                                        'ОсОО «Дистрибьютор»', 'i-truck', 217, '1 day', false)
  ) v(who, t, s, ic, n, ago, rd)
  JOIN users u ON u.full_name = v.who JOIN orders o ON o.number = v.n;
SELECT send_push('all', 'Обновление приложения: новые фильтры заказов', 1) \g /dev/null
UPDATE push_campaigns SET created_at = '2026-11-18 12:00+06';

-- ---------- Поддержка ----------
WITH t AS (
  INSERT INTO support_tickets (user_id, company_id, subject, status, closed_at, created_at)
  SELECT u.id, u.company_id, v.subj, v.st::ticket_status, CASE WHEN v.st = 'closed' THEN now() - interval '3 days' END, now() - v.ago::interval
    FROM (VALUES ('Нурбек Ж.', 'Поставщик не отвечает по заказу', 'open', '18 hours'),
                 ('Гульнара А.', 'Ошибка в накладной', 'closed', '4 days')) v(who, subj, st, ago)
    JOIN users u ON u.full_name = v.who
  RETURNING id, subject, created_at)
INSERT INTO ticket_messages (ticket_id, author, staff_id, body, created_at)
SELECT t.id, m.a::msg_author, m.st, m.body, t.created_at + m.d::interval
  FROM t JOIN (VALUES
    ('Поставщик не отвечает по заказу', 'user',  NULL::bigint, 'Заказ 0220 висит без ответа, а нам нужно к обеду.', '0'),
    ('Ошибка в накладной',              'user',  NULL,         'В накладной неправильный адрес магазина.', '0'),
    ('Ошибка в накладной',              'staff', 2,            'Исправили реквизиты, новая накладная уже в заказе.', '40 min')
  ) m(subj, a, st, body, d) ON m.subj = t.subject;

-- ---------- Заявки на сброс пароля ----------
INSERT INTO password_reset_requests (phone, user_id, created_at)
SELECT phone, id, now() - interval '20 hours' FROM users WHERE full_name = 'Нурбек Ж.';
INSERT INTO password_reset_requests (phone, user_id, status, handled_by, handled_at, note, created_at)
SELECT phone, id, 'done', 2, '2026-11-22 10:15+06', 'Позвонил, подтвердила владелица', '2026-11-22 09:50+06' FROM users WHERE full_name = 'Гульнара А.';

-- ---------- Запросы по данным ----------
INSERT INTO data_requests (user_id, kind, source, status, handled_by, handled_at, created_at)
SELECT u.id, v.k::data_req_kind, v.src, v.st::request_status, CASE WHEN v.st = 'done' THEN 1 END, CASE WHEN v.st = 'done' THEN timestamptz '2026-11-16 12:00+06' END, v.dt::timestamptz
  FROM (VALUES ('Мээрим Д.', 'del', 'email', 'new', '2026-11-21 10:00+06'),
               ('Айгерим Б.', 'export', 'chat', 'new', '2026-11-20 15:00+06'),
               ('Самат О.', 'consent', 'phone', 'done', '2026-11-15 11:00+06')) v(who, k, src, st, dt)
  JOIN users u ON u.full_name = v.who;

-- ---------- Журнал ----------
INSERT INTO audit_log (staff_id, action, object, object_ref, reason, created_at) VALUES
  (2, 'Выдал новый пароль',    'Гульнара А., Магазин «Достук»', 'user:8',     'Заявка из приложения', '2026-11-22 10:15+06'),
  (3, 'Заблокировал компанию', 'Киоск «Мээрим»',                'company:11', 'ИНН не совпадает с данными налоговой', '2026-11-21 17:40+06');

COMMIT;
