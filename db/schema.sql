-- =====================================================================
--  Zakup.KG — схема базы данных (PostgreSQL 16)
--  B2B-заказы: магазины, поставщики, доставщики + админ-панель команды
--
--  Порядок запуска:  psql -f db/schema.sql  →  psql -f db/seed.sql
--  Время хранится в timestamptz (UTC), показывается в Asia/Bishkek.
--  Деньги — numeric(12,2) в сомах. Телефоны — 12 цифр: 996XXXXXXXXX.
--  Файлы (фото, логотипы, PDF накладных) лежат в хранилище, в базе — только путь.
--  Персональные данные граждан КР: сервер и резервные копии — в КР
--  (Цифровой кодекс, ст. 31 ч. 5, ст. 89), либо согласие на передачу за рубеж.
-- =====================================================================

BEGIN;

DROP SCHEMA IF EXISTS zakup CASCADE;
CREATE SCHEMA zakup;
SET search_path = zakup, public;

-- ---------------------------------------------------------------------
-- Справочные типы
-- ---------------------------------------------------------------------
CREATE TYPE company_type    AS ENUM ('shop', 'dist');                          -- магазин / поставщик
CREATE TYPE company_status  AS ENUM ('pending', 'ok', 'rejected', 'blocked');  -- заявка / работает / отклонена / заблокирована
CREATE TYPE user_role       AS ENUM ('owner', 'courier');                      -- владелец компании / доставщик поставщика
CREATE TYPE user_status     AS ENUM ('active', 'blocked', 'deleted');
CREATE TYPE pack_type       AS ENUM ('box', 'block', 'weight', 'piece');       -- коробка / блок / весовой / штучный
CREATE TYPE volume_unit     AS ENUM ('л', 'мл', 'г', 'кг', 'шт');
CREATE TYPE order_status    AS ENUM ('new', 'work', 'done', 'rejected');       -- новый / в работе / доставлен / отказ
CREATE TYPE delivery_method AS ENUM ('qr', 'manual');                          -- по QR / «Отметить доставленным»
CREATE TYPE staff_role      AS ENUM ('owner', 'support', 'moder', 'dev');
CREATE TYPE ticket_status   AS ENUM ('open', 'closed');
CREATE TYPE msg_author      AS ENUM ('user', 'staff');
CREATE TYPE request_status  AS ENUM ('new', 'done', 'rejected');
CREATE TYPE change_status   AS ENUM ('new', 'approved', 'rejected', 'cancelled');
CREATE TYPE push_audience   AS ENUM ('all', 'dist', 'shop');
CREATE TYPE app_lang        AS ENUM ('ru', 'ky');

CREATE DOMAIN phone_kg AS text CHECK (VALUE ~ '^996\d{9}$');
CREATE DOMAIN som      AS numeric(12,2) CHECK (VALUE >= 0);

-- Общая функция: updated_at = now()
CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Номер заказа для людей: № 0221 (с 10000 — без нулей)
CREATE FUNCTION order_no(n integer) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = zakup, public AS $$ SELECT CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END $$;

-- =====================================================================
-- 1. КОМАНДА ZAKUP.KG (админ-панель)
-- =====================================================================
CREATE TABLE staff (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text        NOT NULL,
  phone         phone_kg    NOT NULL UNIQUE,       -- логин в админку
  role          staff_role  NOT NULL,
  password_hash text        NOT NULL,             -- временный пароль от владельца, сменить при первом входе
  must_change_password boolean NOT NULL DEFAULT true,
  totp_secret   bytea,                         -- второй фактор (приложение-аутентификатор), зашифрован ключом сервера; NULL — ещё не настроен
  invited_by    bigint REFERENCES staff(id),
  is_active     boolean     NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE staff IS 'Сотрудники Zakup.KG. Вход в админку: номер телефона + пароль + код TOTP. SMS и почта не используются.';

-- =====================================================================
-- 2. КОМПАНИИ И ПОЛЬЗОВАТЕЛИ ПРИЛОЖЕНИЯ
-- =====================================================================
CREATE TABLE companies (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type          company_type   NOT NULL,
  name          text           NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  inn           char(14)       NOT NULL UNIQUE CHECK (inn ~ '^\d{14}$'),   -- ИНН / ПИН
  city          text           NOT NULL DEFAULT 'г. Бишкек',
  address       text           NOT NULL,     -- магазин: адрес доставки; поставщик: адрес склада
  district      text,                        -- «Свердловский р-н»
  phone         phone_kg       NOT NULL,     -- телефон из заявки, админ звонит по нему для подтверждения
  logo_path     text,
  status        company_status NOT NULL DEFAULT 'pending',
  status_reason text,                        -- причина отказа / блокировки, видна пользователю
  verified_by   bigint REFERENCES staff(id),
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('rejected', 'blocked') OR status_reason IS NOT NULL),
  CHECK (status <> 'ok' OR verified_at IS NOT NULL)
);
CREATE INDEX companies_status_idx ON companies (status) WHERE status = 'pending';
CREATE INDEX companies_name_idx   ON companies USING gin (to_tsvector('russian', name));
CREATE TRIGGER companies_touch BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION touch();
COMMENT ON TABLE companies IS 'Регистрация создаёт компанию в статусе pending. Вход открывается только после подтверждения в админке.';

CREATE TABLE users (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id           bigint      NOT NULL REFERENCES companies(id),
  role                 user_role   NOT NULL,
  full_name            text        NOT NULL,
  phone                phone_kg    NOT NULL,     -- логин
  password_hash        text        NOT NULL,     -- argon2id
  must_change_password boolean     NOT NULL DEFAULT false,  -- true после временного пароля от администратора
  status               user_status NOT NULL DEFAULT 'active',
  block_reason         text,
  lang                 app_lang    NOT NULL DEFAULT 'ru',
  created_by           bigint REFERENCES users(id),         -- поставщик, добавивший доставщика
  last_login_at        timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),                                   -- для составных ключей (доставщик ↔ поставщик)
  CHECK (status <> 'blocked' OR block_reason IS NOT NULL),
  CHECK (status <> 'deleted' OR deleted_at IS NOT NULL)
);
-- Один номер — один действующий аккаунт (удалённые номера освобождаются)
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE status <> 'deleted';
CREATE INDEX users_company_idx ON users (company_id, role);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch();

-- Доставщик бывает только у поставщика, у магазина — только владелец
CREATE FUNCTION users_role_check() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
DECLARE t company_type;
BEGIN
  SELECT type INTO t FROM companies WHERE id = NEW.company_id;
  IF NEW.role = 'courier' AND t <> 'dist' THEN
    RAISE EXCEPTION 'Доставщика можно добавить только поставщику';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_role_check BEFORE INSERT OR UPDATE OF role, company_id ON users
  FOR EACH ROW EXECUTE FUNCTION users_role_check();

-- Сеансы приложения. «Завершить сеансы» и сброс пароля = revoked_at у всех сеансов пользователя
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      bigint      NOT NULL REFERENCES users(id),
  token_hash   bytea       NOT NULL UNIQUE,      -- sha256 от refresh-токена; сам токен в базе не хранится
  device       text,                             -- «iPhone 13, iOS 18»
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '60 days',
  revoked_at   timestamptz,
  revoke_reason text,
  prev_token_hash bytea,                          -- предыдущий refresh: 30 с после обновления не считается кражей
  rotated_at   timestamptz                              -- 'admin_kick' | 'password_reset' | 'blocked' | 'logout'
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Заявки «Забыли пароль?». Пароль выдаёт администратор после звонка
CREATE TABLE password_reset_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone       phone_kg       NOT NULL,
  user_id     bigint REFERENCES users(id),    -- найден по номеру; NULL, если номер не зарегистрирован
  status      request_status NOT NULL DEFAULT 'new',
  handled_by  bigint REFERENCES staff(id),
  handled_at  timestamptz,
  note        text,                            -- «звонил, подтвердил владелец»
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'new' OR (handled_by IS NOT NULL AND handled_at IS NOT NULL))
);
CREATE INDEX pwreq_new_idx ON password_reset_requests (created_at) WHERE status = 'new';
-- Не больше одной открытой заявки на номер (защита от спама)
CREATE UNIQUE INDEX pwreq_one_open_uq ON password_reset_requests (phone) WHERE status = 'new';

-- Изменение данных компании из профиля приложения. Новые данные действуют после одобрения в админке
CREATE TABLE company_change_requests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   bigint        NOT NULL REFERENCES companies(id),
  requested_by bigint        NOT NULL REFERENCES users(id),
  new_name     text CHECK (length(new_name) BETWEEN 2 AND 120),
  new_inn      char(14) CHECK (new_inn ~ '^\d{14}$'),
  new_address  text,
  new_phone    phone_kg,
  old_values   jsonb         NOT NULL,      -- данные на момент заявки: {name, inn, address, phone}
  status       change_status NOT NULL DEFAULT 'new',
  reason       text,                         -- причина отказа, приходит пользователю
  decided_by   bigint REFERENCES staff(id),
  decided_at   timestamptz,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CHECK (COALESCE(new_name, new_inn, new_address, new_phone::text) IS NOT NULL),
  CHECK (status <> 'rejected' OR reason IS NOT NULL),
  CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
-- Одна открытая заявка на компанию: пока она на проверке, новую отправить нельзя (можно отменить)
CREATE UNIQUE INDEX change_one_open_uq ON company_change_requests (company_id) WHERE status = 'new';

-- Одобрить / отклонить: данные компании меняются одной транзакцией, пользователю приходит уведомление.
-- Заказы и накладные ссылаются на компанию по id, поэтому переименование их не ломает;
-- в уже выданных накладных остаются старые реквизиты (снимок).
CREATE FUNCTION admin_decide_change(p_staff bigint, p_req bigint, p_approve boolean, p_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path = zakup, public AS $$
DECLARE r company_change_requests; cname text;
BEGIN
  SELECT * INTO r FROM company_change_requests WHERE id = p_req AND status = 'new' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка уже рассмотрена или отменена'; END IF;
  IF p_approve THEN
    UPDATE companies SET name = COALESCE(r.new_name, name), inn = COALESCE(r.new_inn, inn),
                         address = COALESCE(r.new_address, address), phone = COALESCE(r.new_phone, phone)
     WHERE id = r.company_id;
  END IF;
  UPDATE company_change_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END::change_status,
         reason = p_reason, decided_by = p_staff, decided_at = now() WHERE id = p_req;
  INSERT INTO notifications (user_id, title, sender, icon) VALUES (r.requested_by,
    CASE WHEN p_approve THEN 'Изменения данных одобрены' ELSE 'Изменения данных отклонены: ' || p_reason END, 'Zakup.KG',
    CASE WHEN p_approve THEN 'i-check' ELSE 'i-x' END);
  SELECT name INTO cname FROM companies WHERE id = r.company_id;
  INSERT INTO audit_log (staff_id, action, object, object_ref, reason) VALUES (p_staff,
    CASE WHEN p_approve THEN 'Одобрил изменение данных' ELSE 'Отклонил изменение данных' END, cname, 'company:' || r.company_id, p_reason);
END $$;

-- =====================================================================
-- 3. КАТАЛОГ
-- =====================================================================
CREATE TABLE categories (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text     NOT NULL UNIQUE,
  sort       smallint NOT NULL DEFAULT 0,
  is_active  boolean  NOT NULL DEFAULT true    -- удалённая категория скрывается, товары остаются
);

CREATE TABLE products (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id   bigint      NOT NULL REFERENCES companies(id),
  category_id   smallint    NOT NULL REFERENCES categories(id),
  name          text        NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  volume_value  numeric(10,3) NOT NULL CHECK (volume_value > 0),   -- 1 / 400 / 0.5
  volume_unit   volume_unit NOT NULL,                              -- л / г
  pack_type     pack_type   NOT NULL,
  pack_qty      integer     NOT NULL DEFAULT 1 CHECK (pack_qty >= 1),   -- шт в коробке / блоке
  price         som       NOT NULL CHECK (price > 0),                 -- за коробку / блок / кг / шт
  barcode       varchar(14) CHECK (barcode ~ '^\d{8,14}$'),             -- EAN-8/13, ITF-14
  description   text        CHECK (length(description) <= 2000),
  returnable    boolean     NOT NULL DEFAULT true,     -- «Обмен и возврат: возможен»
  in_stock      boolean     NOT NULL DEFAULT true,     -- нет в наличии → только в поиске, не в каталоге
  is_draft      boolean     NOT NULL DEFAULT false,    -- загружен из Excel без фото: магазины не видят, пока не добавят 2 фото
  hidden_by     bigint REFERENCES staff(id),           -- скрыт модератором
  hidden_reason text,
  orders_count  integer     NOT NULL DEFAULT 0,        -- для сортировки «Популярные»
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, supplier_id),
  CHECK (pack_type IN ('box', 'block') OR pack_qty = 1),
  CHECK ((hidden_by IS NULL) = (hidden_reason IS NULL))
);
-- Один штрихкод — одна карточка у поставщика (у разных поставщиков может совпадать: сравнение цен)
CREATE UNIQUE INDEX products_barcode_uq ON products (supplier_id, barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;
CREATE INDEX products_supplier_idx ON products (supplier_id) WHERE deleted_at IS NULL;
CREATE INDEX products_barcode_idx  ON products (barcode)     WHERE deleted_at IS NULL;
CREATE INDEX products_search_idx   ON products USING gin (to_tsvector('russian', name));
CREATE TRIGGER products_touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch();

CREATE FUNCTION products_supplier_check() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  IF (SELECT type FROM companies WHERE id = NEW.supplier_id) <> 'dist' THEN
    RAISE EXCEPTION 'Товары добавляет только поставщик';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_supplier_check BEFORE INSERT OR UPDATE OF supplier_id ON products
  FOR EACH ROW EXECUTE FUNCTION products_supplier_check();

-- Фото товара: минимум 2, максимум 5 (5 слотов)
CREATE TABLE product_photos (
  product_id bigint   NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position   smallint NOT NULL CHECK (position BETWEEN 1 AND 5),   -- 1 — обложка
  path       text     NOT NULL,                                     -- products/123/1.webp
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, position)
);

-- Проверка «минимум 2 фото» в конце транзакции: товар и фото сохраняются одной транзакцией
CREATE FUNCTION product_min_photos() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
DECLARE pid bigint;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN pid := NEW.id; ELSE pid := OLD.product_id; END IF;
  IF EXISTS (SELECT 1 FROM products WHERE id = pid AND deleted_at IS NULL AND NOT is_draft)
     AND (SELECT count(*) FROM product_photos WHERE product_id = pid) < 2 THEN
    RAISE EXCEPTION 'У товара % должно быть минимум 2 фото', pid;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER products_min_photos AFTER INSERT OR UPDATE OF is_draft ON products
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_min_photos();
CREATE CONSTRAINT TRIGGER photos_min_photos AFTER DELETE ON product_photos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_min_photos();

-- Корзина магазина хранится на сервере (одна корзина на нескольких устройствах)
CREATE TABLE cart_items (
  user_id    bigint  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id bigint  NOT NULL REFERENCES products(id),
  qty        numeric(10,3) NOT NULL CHECK (qty > 0 AND qty <= 9999),   -- дробное — только у весовых (проверяет API)
  urgent     boolean NOT NULL DEFAULT false,      -- галочка «СРОЧНО» в карточке и в корзине
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- =====================================================================
-- 4. ЗАКАЗЫ
-- =====================================================================
-- Номер заказа сквозной по платформе, показывается как № 0221
CREATE SEQUENCE order_number_seq START 1;

CREATE TABLE orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number           integer      NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  shop_id          bigint       NOT NULL REFERENCES companies(id),
  created_by       bigint       NOT NULL REFERENCES users(id),
  supplier_id      bigint       NOT NULL REFERENCES companies(id),
  status           order_status NOT NULL DEFAULT 'new',
  urgent           boolean      NOT NULL DEFAULT false,   -- магазин выбирает только «Срочно»
  delivery_date    date,                                  -- дату ставит поставщик при принятии
  courier_id       bigint,                                -- обязателен для принятия
  -- снимок адреса доставки на момент заказа (адрес магазина может поменяться)
  ship_name        text         NOT NULL,
  ship_address     text         NOT NULL,
  ship_district    text,
  total            som        NOT NULL DEFAULT 0,       -- пересчитывается триггером по позициям
  items_count      smallint     NOT NULL DEFAULT 0,
  reject_reason    text,
  cancelled_by     bigint REFERENCES staff(id),           -- отменён командой Zakup.KG
  qr_token         uuid         NOT NULL UNIQUE DEFAULT gen_random_uuid(),  -- QR-подтверждение доставки
  accepted_at      timestamptz,
  delivered_at     timestamptz,
  delivered_by     bigint REFERENCES users(id),           -- «Доставил» в заказе и накладной
  delivered_method delivery_method,
  paid_at          timestamptz,                           -- поставщик отметил оплату; доставлен и не оплачен = долг
  paid_marked_by   bigint REFERENCES users(id),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  -- доставщик только из сотрудников этого поставщика
  FOREIGN KEY (courier_id, supplier_id) REFERENCES users(id, company_id),
  CHECK (shop_id <> supplier_id),
  CHECK (status IN ('new', 'rejected') OR (courier_id IS NOT NULL AND delivery_date IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK (status <> 'done' OR (delivered_at IS NOT NULL AND delivered_by IS NOT NULL AND delivered_method IS NOT NULL)),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
CREATE INDEX orders_supplier_idx ON orders (supplier_id, status, created_at DESC);
CREATE INDEX orders_shop_idx     ON orders (shop_id, created_at DESC);
CREATE INDEX orders_courier_idx  ON orders (courier_id, status) WHERE courier_id IS NOT NULL;
CREATE INDEX orders_waiting_idx  ON orders (created_at) WHERE status = 'new';   -- «без ответа больше 2 ч»
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch();

CREATE TABLE order_items (
  order_id    bigint   NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line        smallint NOT NULL,
  product_id  bigint   NOT NULL,
  supplier_id bigint   NOT NULL,
  -- снимок товара: цена и название в заказе не меняются, если поставщик изменит карточку
  name        text     NOT NULL,
  volume      text     NOT NULL,        -- «1 л», «400 г»
  unit        text     NOT NULL,        -- кор / бл / кг / шт
  pack_qty    integer  NOT NULL,
  photo_path  text,
  price       som    NOT NULL,
  qty         numeric(10,3) NOT NULL CHECK (qty > 0),
  is_out      boolean  NOT NULL DEFAULT false,   -- поставщик отказал по позиции при принятии
  amount      som    GENERATED ALWAYS AS (CASE WHEN is_out THEN 0 ELSE round(price * qty, 2) END) STORED,
  PRIMARY KEY (order_id, line),
  FOREIGN KEY (product_id, supplier_id) REFERENCES products(id, supplier_id)   -- все позиции — от поставщика заказа
);

-- Позиция, которую добавляет приложение: снимок товара делает база (цену не подменить), товар должен быть в каталоге
CREATE FUNCTION order_items_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
DECLARE p products; ok boolean;
BEGIN
  IF current_user <> 'zakup_api' THEN RETURN NEW; END IF;     -- демо-данные и админка заполняют сами
  SELECT * INTO p FROM products WHERE id = NEW.product_id;
  SELECT p.in_stock AND NOT p.is_draft AND p.hidden_by IS NULL AND p.deleted_at IS NULL AND c.status = 'ok' INTO ok FROM companies c WHERE c.id = p.supplier_id;
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'Нет в наличии: %', COALESCE(p.name, 'товар'); END IF;
  IF p.pack_type <> 'weight' AND NEW.qty <> trunc(NEW.qty) THEN RAISE EXCEPTION 'Количество — целое число'; END IF;
  NEW.supplier_id := p.supplier_id; NEW.name := p.name; NEW.price := p.price; NEW.pack_qty := p.pack_qty; NEW.is_out := false;
  NEW.volume := replace(rtrim(rtrim(p.volume_value::text, '0'), '.'), '.', ',') || ' ' || p.volume_unit;
  NEW.unit := CASE p.pack_type WHEN 'box' THEN 'кор' WHEN 'block' THEN 'бл' WHEN 'weight' THEN 'кг' ELSE 'шт' END;
  NEW.photo_path := (SELECT path FROM product_photos WHERE product_id = p.id ORDER BY position LIMIT 1);
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_snapshot BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION order_items_snapshot();

-- Корзина: дробное количество — только у весовых
CREATE FUNCTION cart_items_check() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  IF (SELECT pack_type FROM products WHERE id = NEW.product_id) <> 'weight' AND NEW.qty <> trunc(NEW.qty) THEN
    RAISE EXCEPTION 'Количество — целое число';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cart_items_check BEFORE INSERT OR UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION cart_items_check();

-- Позиции заказа: поставщик позиции = поставщик заказа; пересчёт суммы
CREATE FUNCTION order_items_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = zakup, public AS $$
DECLARE oid bigint := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.supplier_id <> (SELECT supplier_id FROM orders WHERE id = NEW.order_id) THEN
    RAISE EXCEPTION 'Позиция от другого поставщика: корзина делится на заказы по поставщикам';
  END IF;
  UPDATE orders SET total = COALESCE((SELECT sum(amount) FROM order_items WHERE order_id = oid), 0),
                    items_count = (SELECT count(*) FROM order_items WHERE order_id = oid AND NOT is_out)
   WHERE id = oid;
  RETURN NULL;
END $$;
CREATE TRIGGER order_items_sync AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION order_items_sync();

-- История статусов (лента «История» в заказе админки)
CREATE TABLE order_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     order_status NOT NULL,
  title      text         NOT NULL,          -- «Принят, поставка 25.11», «Доставлен по QR»
  by_user    bigint REFERENCES users(id),
  by_staff   bigint REFERENCES staff(id),
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, created_at);

-- Флаги функций (переключатели в «Технике»)
CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL,
  title       text    NOT NULL,
  updated_by  bigint REFERENCES staff(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION flag(k text) RETURNS boolean LANGUAGE sql STABLE SET search_path = zakup, public AS
  $$ SELECT COALESCE((SELECT enabled FROM feature_flags WHERE key = k), false) $$;

-- Правила заказа: создание
CREATE FUNCTION orders_before_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  IF NOT flag('orders_on') THEN RAISE EXCEPTION 'Приём заказов временно остановлен'; END IF;
  IF NEW.urgent AND NOT flag('urgent_on') THEN RAISE EXCEPTION 'Срочные заказы временно недоступны'; END IF;
  IF (SELECT type FROM companies WHERE id = NEW.shop_id) <> 'shop'
     OR (SELECT type FROM companies WHERE id = NEW.supplier_id) <> 'dist' THEN
    RAISE EXCEPTION 'Заказ оформляет магазин у поставщика';
  END IF;
  IF (SELECT status FROM companies WHERE id = NEW.shop_id) <> 'ok' THEN RAISE EXCEPTION 'Магазин не может оформлять заказы'; END IF;
  IF (SELECT status FROM companies WHERE id = NEW.supplier_id) <> 'ok' THEN RAISE EXCEPTION 'Поставщик сейчас не принимает заказы'; END IF;
  IF NEW.status <> 'new' THEN RAISE EXCEPTION 'Новый заказ создаётся в статусе new'; END IF;
  -- снимок адреса берём из карточки магазина, а не из запроса
  SELECT name, city || ', ' || address, district INTO NEW.ship_name, NEW.ship_address, NEW.ship_district FROM companies WHERE id = NEW.shop_id;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_before_insert BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION orders_before_insert();

-- Правила заказа: переходы статусов
--   new  → work      поставщик принял: дата + доставщик обязательны, магазин не заблокирован, доставщик активен
--   new  → rejected  поставщик отказал (причина) или админ отменил
--   work → done      доставщик: по QR или кнопкой, если qr_delivery выключен
--   work → rejected  только команда Zakup.KG (cancelled_by)
CREATE FUNCTION orders_before_update() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  -- доставщик через приложение может только закрыть доставку: не оплату, не дату, не передачу заказа
  IF current_user = 'zakup_api' AND app_role() = 'courier'
     AND (NEW.paid_at, NEW.paid_marked_by, NEW.courier_id, NEW.delivery_date, NEW.urgent, NEW.reject_reason)
         IS DISTINCT FROM (OLD.paid_at, OLD.paid_marked_by, OLD.courier_id, OLD.delivery_date, OLD.urgent, OLD.reject_reason) THEN
    RAISE EXCEPTION 'Доставщик отмечает только доставку';
  END IF;
  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('done', 'rejected') AND (NEW.courier_id, NEW.delivery_date, NEW.delivered_by, NEW.delivered_method, NEW.delivered_at, NEW.reject_reason, NEW.cancelled_by, NEW.urgent)
         IS DISTINCT FROM (OLD.courier_id, OLD.delivery_date, OLD.delivered_by, OLD.delivered_method, OLD.delivered_at, OLD.reject_reason, OLD.cancelled_by, OLD.urgent) THEN
      RAISE EXCEPTION 'Завершённый заказ менять нельзя';
    END IF;
    IF OLD.status = 'work' THEN
      IF NEW.courier_id IS DISTINCT FROM OLD.courier_id AND (SELECT status FROM users WHERE id = NEW.courier_id) IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Доставщик заблокирован';
      END IF;
      IF NEW.delivery_date IS DISTINCT FROM OLD.delivery_date AND NEW.delivery_date < (now() AT TIME ZONE 'Asia/Bishkek')::date THEN
        RAISE EXCEPTION 'Дата доставки в прошлом';
      END IF;
    END IF;
    IF OLD.status = 'new' AND (NEW.courier_id, NEW.delivery_date) IS DISTINCT FROM (OLD.courier_id, OLD.delivery_date) THEN
      RAISE EXCEPTION 'Доставщик и дата назначаются при принятии заказа';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'new'  AND NEW.status IN ('work', 'rejected'))
       OR (OLD.status = 'work' AND NEW.status IN ('done', 'rejected'))) THEN
    RAISE EXCEPTION 'Нельзя перевести заказ из % в %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'work' THEN
    IF (SELECT status FROM companies WHERE id = NEW.shop_id) <> 'ok' THEN
      RAISE EXCEPTION 'Магазин заблокирован, заказ принять нельзя';
    END IF;
    IF (SELECT status FROM users WHERE id = NEW.courier_id) <> 'active' THEN
      RAISE EXCEPTION 'Доставщик заблокирован';
    END IF;
    IF NEW.delivery_date < (now() AT TIME ZONE 'Asia/Bishkek')::date THEN
      RAISE EXCEPTION 'Дата доставки в прошлом';
    END IF;
    IF NEW.delivery_date > (now() AT TIME ZONE 'Asia/Bishkek')::date + 30 THEN
      RAISE EXCEPTION 'Дата поставки — не дальше 30 дней';
    END IF;
    IF NEW.urgent AND NEW.delivery_date <> (now() AT TIME ZONE 'Asia/Bishkek')::date THEN
      RAISE EXCEPTION 'Срочный заказ — поставка сегодня. Если магазин согласен на другой срок, снимите срочность';
    END IF;
    NEW.accepted_at := COALESCE(NEW.accepted_at, now());
  END IF;
  IF NEW.status = 'done' THEN
    IF NEW.delivered_by IS DISTINCT FROM NEW.courier_id THEN
      RAISE EXCEPTION 'Отметить доставку может только назначенный доставщик';
    END IF;
    IF NEW.delivered_method = 'manual' AND flag('qr_delivery') THEN
      RAISE EXCEPTION 'Включена доставка по QR: нужно отсканировать код магазина';
    END IF;
    NEW.delivered_at := COALESCE(NEW.delivered_at, now());
  END IF;
  IF NEW.status = 'rejected' AND OLD.status = 'work' AND NEW.cancelled_by IS NULL THEN
    RAISE EXCEPTION 'Принятый заказ отменяет только команда Zakup.KG';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_before_update BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_before_update();

-- После смены статуса: запись в историю, накладная, счётчик популярности
CREATE FUNCTION orders_after_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = zakup, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO order_events (order_id, status, title, by_user) VALUES (NEW.id, 'new', CASE WHEN NEW.urgent THEN 'Оформлен, срочно' ELSE 'Оформлен' END, NEW.created_by);
    RETURN NULL;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NULL; END IF;
  INSERT INTO order_events (order_id, status, title, by_user, by_staff) VALUES (
    NEW.id, NEW.status,
    CASE NEW.status
      WHEN 'work' THEN 'Принят, поставка ' || to_char(NEW.delivery_date, 'DD.MM')
      WHEN 'done' THEN CASE NEW.delivered_method WHEN 'qr' THEN 'Доставлен по QR' ELSE 'Доставлен' END
      ELSE CASE WHEN NEW.cancelled_by IS NOT NULL THEN 'Отменён Zakup.KG: ' ELSE 'Отказ: ' END || NEW.reject_reason
    END,
    CASE NEW.status WHEN 'done' THEN NEW.delivered_by ELSE NULL END,
    NEW.cancelled_by);
  IF NEW.status = 'work' THEN PERFORM create_invoice(NEW.id); END IF;
  IF NEW.status = 'done' THEN
    UPDATE invoices SET delivered_by_name = (SELECT full_name FROM users WHERE id = NEW.delivered_by) WHERE order_id = NEW.id;
    UPDATE products p SET orders_count = orders_count + 1 FROM order_items i WHERE i.order_id = NEW.id AND p.id = i.product_id;
  END IF;
  RETURN NULL;
END $$;

-- =====================================================================
-- 5. НАКЛАДНЫЕ
-- =====================================================================
-- Формируется при принятии заказа; реквизиты и позиции фиксируются снимком
CREATE TABLE invoices (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          bigint  NOT NULL UNIQUE REFERENCES orders(id),
  supplier_id       bigint  NOT NULL REFERENCES companies(id),
  year              smallint NOT NULL,
  seq               integer NOT NULL,            -- нумерация у каждого поставщика своя, с 1 января
  number            text    GENERATED ALWAYS AS (year || '-' || lpad(seq::text, 5, '0')) STORED,
  seller            jsonb   NOT NULL,            -- {name, inn, address, phone}
  buyer             jsonb   NOT NULL,
  items             jsonb   NOT NULL,            -- [{name, volume, unit, qty, price, amount}]
  total             som   NOT NULL,
  courier_name      text,                        -- «Доставщик»
  delivered_by_name text,                        -- «Доставил», заполняется при доставке
  pdf_path          text,                        -- invoices/2026/00042.pdf, PDF собирается фоновой задачей
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, year, seq)
);

CREATE FUNCTION create_invoice(p_order bigint) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = zakup, public AS $$
DECLARE o orders; s companies; b companies; y smallint := extract(year FROM now() AT TIME ZONE 'Asia/Bishkek'); n integer; iid bigint;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order;
  SELECT * INTO s FROM companies WHERE id = o.supplier_id;
  SELECT * INTO b FROM companies WHERE id = o.shop_id;
  PERFORM pg_advisory_xact_lock(o.supplier_id::int, y::int);   -- без дыр и дублей в нумерации
  SELECT COALESCE(max(seq), 0) + 1 INTO n FROM invoices WHERE supplier_id = o.supplier_id AND year = y;
  INSERT INTO invoices (order_id, supplier_id, year, seq, seller, buyer, items, total, courier_name)
  VALUES (o.id, o.supplier_id, y, n,
    jsonb_build_object('name', s.name, 'inn', s.inn, 'address', s.city || ', ' || s.address, 'phone', s.phone),
    jsonb_build_object('name', o.ship_name, 'inn', b.inn, 'address', o.ship_address),
    (SELECT jsonb_agg(jsonb_build_object('name', name, 'volume', volume, 'unit', unit, 'qty', qty, 'price', price, 'amount', amount) ORDER BY line) FROM order_items WHERE order_id = o.id),
    o.total, (SELECT full_name FROM users WHERE id = o.courier_id))
  RETURNING id INTO iid;
  RETURN iid;
END $$;

CREATE TRIGGER orders_after_status AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_after_status();

-- Отказ по позиции: только пока заказ новый; хотя бы одна позиция должна остаться
CREATE FUNCTION order_items_out_check() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  IF NEW.is_out IS DISTINCT FROM OLD.is_out THEN
    IF (SELECT status FROM orders WHERE id = NEW.order_id) <> 'new' THEN RAISE EXCEPTION 'Позиции меняются только до принятия заказа'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_out_check BEFORE UPDATE OF is_out ON order_items FOR EACH ROW EXECUTE FUNCTION order_items_out_check();
CREATE FUNCTION orders_need_items() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  IF NEW.status = 'work' AND OLD.status = 'new' AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = NEW.id AND NOT is_out) THEN
    RAISE EXCEPTION 'Нет ни одной позиции: заказ нужно отклонить';
  END IF;
  IF NEW.paid_at IS NOT NULL AND NEW.status NOT IN ('work', 'done') THEN RAISE EXCEPTION 'Оплату отмечают у принятого заказа'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_need_items BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_need_items();

-- Оценка доставки: магазин, один раз, только у доставленного заказа
CREATE TABLE order_ratings (
  order_id   bigint   PRIMARY KEY REFERENCES orders(id),
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text     CHECK (length(comment) <= 200),
  created_by bigint   NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION rating_check() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  IF (SELECT status FROM orders WHERE id = NEW.order_id) <> 'done' THEN RAISE EXCEPTION 'Оценить можно только доставленный заказ'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rating_check BEFORE INSERT ON order_ratings FOR EACH ROW EXECUTE FUNCTION rating_check();

-- Чат магазина и поставщика по заказу
CREATE TABLE order_messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id  bigint NOT NULL REFERENCES users(id),
  body       text   NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  read_at    timestamptz,                       -- прочитано другой стороной
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_messages_idx ON order_messages (order_id, created_at);

-- Загрузки прайса из Excel: журнал для поставщика и поддержки
CREATE TABLE price_imports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint  NOT NULL REFERENCES companies(id),
  user_id     bigint  NOT NULL REFERENCES users(id),
  file_path   text    NOT NULL,          -- imports/2026/11/abc.xlsx
  updated     integer NOT NULL DEFAULT 0,
  added       integer NOT NULL DEFAULT 0,
  errors      jsonb   NOT NULL DEFAULT '[]',   -- [{"row": 6, "error": "нет цены"}]
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Долги: доставленные и не оплаченные заказы
CREATE VIEW debts AS
SELECT o.supplier_id, o.shop_id, count(*) AS orders, sum(o.total) AS amount, min(o.delivered_at) AS oldest
  FROM orders o WHERE o.status = 'done' AND o.paid_at IS NULL
 GROUP BY o.supplier_id, o.shop_id;

-- Отчёт поставщика по дням (выручка считается по дате доставки)
CREATE VIEW supplier_daily AS
SELECT o.supplier_id, (o.delivered_at AT TIME ZONE 'Asia/Bishkek')::date AS day, count(*) AS orders, sum(o.total) AS revenue,
       round(avg(r.stars), 1) AS rating
  FROM orders o LEFT JOIN order_ratings r ON r.order_id = o.id
 WHERE o.status = 'done'
 GROUP BY o.supplier_id, (o.delivered_at AT TIME ZONE 'Asia/Bishkek')::date;

-- =====================================================================
-- 6. УВЕДОМЛЕНИЯ И РАССЫЛКИ
-- =====================================================================
CREATE TABLE push_campaigns (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audience   push_audience NOT NULL,
  text       text   NOT NULL CHECK (length(text) BETWEEN 3 AND 160),   -- только служебные, без рекламы
  sent_by    bigint NOT NULL REFERENCES staff(id),
  recipients integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text    NOT NULL,                -- «Заказ № 0216 принят, поставка 25.11»
  sender      text    NOT NULL,                -- «ОсОО «Дистрибьютор»» / «Zakup.KG»
  icon        text    NOT NULL DEFAULT 'i-bell',
  order_id    bigint REFERENCES orders(id),
  campaign_id bigint REFERENCES push_campaigns(id),
  read_at     timestamptz,                     -- «Прочитать все» = read_at у всех непрочитанных
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- Уведомление владельцам компании (и, если задан, конкретному пользователю). Вызывается из триггеров
CREATE FUNCTION notify_company(p_company bigint, p_title text, p_sender text, p_icon text, p_order bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = zakup, public AS $$
  INSERT INTO notifications (user_id, title, sender, icon, order_id)
  SELECT id, p_title, p_sender, p_icon, p_order FROM users WHERE company_id = p_company AND role = 'owner' AND status = 'active'
$$;
CREATE FUNCTION notify_user(p_user bigint, p_title text, p_sender text, p_icon text, p_order bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = zakup, public AS $$
  INSERT INTO notifications (user_id, title, sender, icon, order_id) SELECT p_user, p_title, p_sender, p_icon, p_order WHERE p_user IS NOT NULL
$$;

CREATE FUNCTION orders_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = zakup, public AS $$
DECLARE shop text; sup text; outn int;
BEGIN
  SELECT name INTO shop FROM companies WHERE id = NEW.shop_id;
  SELECT name INTO sup FROM companies WHERE id = NEW.supplier_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_company(NEW.supplier_id, CASE WHEN NEW.urgent THEN 'Новый срочный заказ № ' ELSE 'Новый заказ № ' END || order_no(NEW.number), shop, CASE WHEN NEW.urgent THEN 'i-fire' ELSE 'i-doc' END, NEW.id);
    RETURN NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'work' THEN
      SELECT count(*) INTO outn FROM order_items WHERE order_id = NEW.id AND is_out;
      PERFORM notify_company(NEW.shop_id, 'Заказ № ' || order_no(NEW.number) || ' принят' || CASE WHEN outn > 0 THEN ' без ' || outn || ' поз.' ELSE '' END || ', поставка ' || to_char(NEW.delivery_date, 'DD.MM'), sup, 'i-check', NEW.id);
      PERFORM notify_user(NEW.courier_id, 'Вам назначен заказ № ' || order_no(NEW.number), sup, 'i-truck', NEW.id);
    ELSIF NEW.status = 'rejected' THEN
      PERFORM notify_company(NEW.shop_id, 'Заказ № ' || order_no(NEW.number) || CASE WHEN NEW.cancelled_by IS NOT NULL THEN ' отменён Zakup.KG: ' ELSE ' отклонён: ' END || NEW.reject_reason, CASE WHEN NEW.cancelled_by IS NOT NULL THEN 'Zakup.KG' ELSE sup END, 'i-x', NEW.id);
      IF NEW.cancelled_by IS NOT NULL THEN PERFORM notify_company(NEW.supplier_id, 'Заказ № ' || order_no(NEW.number) || ' отменён Zakup.KG: ' || NEW.reject_reason, 'Zakup.KG', 'i-x', NEW.id); END IF;
    ELSIF NEW.status = 'done' THEN
      PERFORM notify_company(NEW.shop_id, 'Заказ № ' || order_no(NEW.number) || ' доставлен', sup, 'i-truck', NEW.id);
      PERFORM notify_company(NEW.supplier_id, 'Заказ № ' || order_no(NEW.number) || ' доставлен', shop, 'i-truck', NEW.id);
    END IF;
  ELSIF NEW.status = 'work' AND NEW.courier_id IS DISTINCT FROM OLD.courier_id THEN
    PERFORM notify_user(NEW.courier_id, 'Вам назначен заказ № ' || order_no(NEW.number), sup, 'i-truck', NEW.id);
    UPDATE invoices SET courier_name = (SELECT full_name FROM users WHERE id = NEW.courier_id) WHERE order_id = NEW.id;
    INSERT INTO order_events (order_id, status, title, by_user)
    VALUES (NEW.id, 'work', 'Доставщик: ' || (SELECT full_name FROM users WHERE id = NEW.courier_id), NULLIF(current_setting('app.user_id', true), '')::bigint);
  END IF;
  IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
    PERFORM notify_company(NEW.shop_id, 'Оплата по заказу № ' || order_no(NEW.number) || ' получена', sup, 'i-check', NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER orders_notify AFTER INSERT OR UPDATE OF status, courier_id, paid_at ON orders FOR EACH ROW EXECUTE FUNCTION orders_notify();

CREATE FUNCTION messages_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = zakup, public AS $$
DECLARE o orders; me users; cname text;
BEGIN
  SELECT * INTO o FROM orders WHERE id = NEW.order_id; SELECT * INTO me FROM users WHERE id = NEW.author_id;
  SELECT name INTO cname FROM companies WHERE id = me.company_id;
  PERFORM notify_company(CASE WHEN me.company_id = o.shop_id THEN o.supplier_id ELSE o.shop_id END,
    'Сообщение по заказу № ' || order_no(o.number) || ': ' || left(NEW.body, 60), cname, 'i-chat', o.id);
  RETURN NULL;
END $$;
CREATE TRIGGER messages_notify AFTER INSERT ON order_messages FOR EACH ROW EXECUTE FUNCTION messages_notify();

CREATE FUNCTION rating_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = zakup, public AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE id = NEW.order_id;
  PERFORM notify_company(o.supplier_id, 'Оценка доставки № ' || order_no(o.number) || ': ' || NEW.stars || ' из 5', o.ship_name, 'i-check', o.id);
  RETURN NULL;
END $$;
CREATE TRIGGER rating_notify AFTER INSERT ON order_ratings FOR EACH ROW EXECUTE FUNCTION rating_notify();

-- Рассылка: строка в notifications каждому активному пользователю выбранной аудитории
CREATE FUNCTION send_push(p_audience push_audience, p_text text, p_staff bigint) RETURNS bigint LANGUAGE plpgsql SET search_path = zakup, public AS $$
DECLARE cid bigint; n integer;
BEGIN
  INSERT INTO push_campaigns (audience, text, sent_by) VALUES (p_audience, p_text, p_staff) RETURNING id INTO cid;
  INSERT INTO notifications (user_id, title, sender, icon, campaign_id)
  SELECT u.id, p_text, 'Zakup.KG', 'i-bell', cid
    FROM users u JOIN companies c ON c.id = u.company_id
   WHERE u.status = 'active' AND c.status = 'ok'
     AND (p_audience = 'all' OR c.type::text = p_audience::text);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE push_campaigns SET recipients = n WHERE id = cid;
  RETURN cid;
END $$;

-- =====================================================================
-- 7. ПОДДЕРЖКА
-- =====================================================================
CREATE TABLE support_tickets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint        NOT NULL REFERENCES users(id),
  company_id  bigint        NOT NULL REFERENCES companies(id),
  subject     text          NOT NULL,          -- первое сообщение, обрезанное до 80 символов
  status      ticket_status NOT NULL DEFAULT 'open',
  assigned_to bigint REFERENCES staff(id),
  order_id    bigint REFERENCES orders(id),
  closed_at   timestamptz,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
-- У пользователя одно открытое обращение; сообщение после закрытия открывает новое
CREATE UNIQUE INDEX tickets_one_open_uq ON support_tickets (user_id) WHERE status = 'open';
CREATE TRIGGER tickets_touch BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION touch();

CREATE TABLE ticket_messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id  bigint     NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author     msg_author NOT NULL,
  staff_id   bigint REFERENCES staff(id),
  body       text       NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((author = 'staff') = (staff_id IS NOT NULL))
);
CREATE INDEX ticket_messages_idx ON ticket_messages (ticket_id, created_at);

-- =====================================================================
-- 8. ДОКУМЕНТЫ И СОГЛАСИЯ
-- =====================================================================
CREATE TABLE documents (
  code  text PRIMARY KEY,                -- oferta / user_agreement_zakup_kg / privacy
  title text NOT NULL
);
CREATE TABLE document_versions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_code     text    NOT NULL REFERENCES documents(code),
  version      text    NOT NULL CHECK (version ~ '^v\d+\.\d+$'),
  body_path    text    NOT NULL,          -- docs/oferta/v1.3.html
  published_by bigint REFERENCES staff(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_code, version)
);
CREATE TABLE document_acceptances (
  user_id     bigint NOT NULL REFERENCES users(id),
  version_id  bigint NOT NULL REFERENCES document_versions(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  PRIMARY KEY (user_id, version_id)
);

-- Действующая версия каждого документа
CREATE VIEW current_documents AS
SELECT DISTINCT ON (doc_code) v.id, v.doc_code, d.title, v.version, v.published_at
  FROM document_versions v JOIN documents d ON d.code = v.doc_code
 ORDER BY doc_code, published_at DESC;

-- Кому показать окно «Обновлены правила»
CREATE VIEW users_need_reaccept AS
SELECT u.id AS user_id, cd.doc_code, cd.title, cd.version
  FROM users u CROSS JOIN current_documents cd
 WHERE u.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM document_acceptances a WHERE a.user_id = u.id AND a.version_id = cd.id);

-- =====================================================================
-- 9. СПРАВОЧНИКИ, ЖУРНАЛ
-- =====================================================================
CREATE TABLE reject_reasons (
  id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text      text     NOT NULL UNIQUE,
  sort      smallint NOT NULL DEFAULT 0,     -- «Другое» всегда последней
  is_active boolean  NOT NULL DEFAULT true
);

-- Журнал действий сотрудников: только добавление
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id   bigint NOT NULL REFERENCES staff(id),
  action     text   NOT NULL,         -- «Заблокировал компанию», «Открыл полный телефон», «Выдал новый пароль»
  object     text   NOT NULL,         -- «Киоск «Мээрим»», «Заказ № 0221»
  object_ref text,                    -- company:12 / user:5 / order:221
  reason     text,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
CREATE FUNCTION audit_readonly() RETURNS trigger LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN RAISE EXCEPTION 'Журнал действий нельзя изменить или удалить'; END $$;
CREATE TRIGGER audit_readonly BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_readonly();

-- =====================================================================
-- 10. ДЕЙСТВИЯ АДМИНИСТРАТОРА (вызываются из админ-панели одной транзакцией)
-- =====================================================================
-- Завершить сеансы (а также при сбросе пароля и блокировке)
CREATE FUNCTION kick_user(p_user bigint, p_reason text) RETURNS integer LANGUAGE sql SET search_path = zakup, public AS $$
  WITH r AS (UPDATE sessions SET revoked_at = now(), revoke_reason = p_reason
              WHERE user_id = p_user AND revoked_at IS NULL RETURNING 1)
  SELECT count(*)::int FROM r
$$;

-- Выдать временный пароль: хэш приходит из API (argon2id считается на сервере приложения)
CREATE FUNCTION admin_set_password(p_staff bigint, p_user bigint, p_hash text, p_request bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path = zakup, public AS $$
BEGIN
  UPDATE users SET password_hash = p_hash, must_change_password = true WHERE id = p_user;
  PERFORM kick_user(p_user, 'password_reset');
  IF p_request IS NOT NULL THEN
    UPDATE password_reset_requests SET status = 'done', user_id = p_user, handled_by = p_staff, handled_at = now() WHERE id = p_request;
  END IF;
  INSERT INTO audit_log (staff_id, action, object, object_ref, reason)
  SELECT p_staff, 'Выдал новый пароль', u.full_name || ', ' || c.name, 'user:' || u.id,
         CASE WHEN p_request IS NULL THEN 'Сброс из карточки пользователя' ELSE 'Заявка из приложения № ' || p_request END
    FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = p_user;
END $$;

-- Подтвердить / отклонить / заблокировать / разблокировать компанию
CREATE FUNCTION admin_set_company_status(p_staff bigint, p_company bigint, p_status company_status, p_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path = zakup, public AS $$
DECLARE c companies;
BEGIN
  UPDATE companies SET status = p_status,
         status_reason = CASE WHEN p_status IN ('rejected', 'blocked') THEN p_reason END,
         verified_by = CASE WHEN p_status = 'ok' AND verified_by IS NULL THEN p_staff ELSE verified_by END,
         verified_at = CASE WHEN p_status = 'ok' AND verified_at IS NULL THEN now() ELSE verified_at END
   WHERE id = p_company RETURNING * INTO c;
  IF p_status = 'blocked' THEN   -- кабинет сразу выходит на экран входа
    PERFORM kick_user(id, 'blocked') FROM users WHERE company_id = p_company;
  END IF;
  IF p_status = 'ok' THEN
    INSERT INTO notifications (user_id, title, sender, icon)
    SELECT id, 'Компания проверена, можно работать', 'Zakup.KG', 'i-check' FROM users WHERE company_id = p_company AND role = 'owner';
  END IF;
  INSERT INTO audit_log (staff_id, action, object, object_ref, reason) VALUES (p_staff,
    CASE p_status WHEN 'ok' THEN CASE WHEN c.verified_at > now() - interval '1 second' THEN 'Подтвердил компанию' ELSE 'Разблокировал компанию' END
                  WHEN 'rejected' THEN 'Отклонил заявку' WHEN 'blocked' THEN 'Заблокировал компанию' ELSE 'Изменил статус' END,
    c.name, 'company:' || c.id, p_reason);
END $$;

-- =====================================================================
-- 11. ПРЕДСТАВЛЕНИЯ ДЛЯ API
-- =====================================================================
-- Можно ли войти: компания подтверждена, пользователь активен
CREATE VIEW login_check AS
SELECT u.id AS user_id, u.phone, u.password_hash, u.role, c.type AS company_type, u.must_change_password,
       CASE
         WHEN u.status = 'deleted'  THEN 'Аккаунт удалён'
         WHEN u.status = 'blocked'  THEN 'Zakup.KG закрыл доступ. Причина: ' || u.block_reason
         WHEN c.status = 'pending'  THEN 'Заявка на проверке'
         WHEN c.status = 'rejected' THEN 'Zakup.KG отклонил заявку ' || c.name || '. Причина: ' || c.status_reason
         WHEN c.status = 'blocked'  THEN 'Zakup.KG закрыл доступ для ' || c.name || '. Причина: ' || c.status_reason
       END AS denied
  FROM users u JOIN companies c ON c.id = u.company_id;

-- Каталог магазина: только в наличии, не скрытые, поставщик работает
CREATE VIEW catalog AS
SELECT p.*, c.name AS supplier_name, cat.name AS category,
       (SELECT path FROM product_photos ph WHERE ph.product_id = p.id ORDER BY position LIMIT 1) AS cover
  FROM products p
  JOIN companies c    ON c.id = p.supplier_id AND c.status = 'ok'
  JOIN categories cat ON cat.id = p.category_id AND cat.is_active
 WHERE p.deleted_at IS NULL AND p.hidden_by IS NULL AND p.in_stock AND NOT p.is_draft;

-- Поиск: то же, но вместе с товарами «Нет в наличии»
CREATE VIEW catalog_search AS
SELECT p.*, c.name AS supplier_name, cat.name AS category
  FROM products p
  JOIN companies c    ON c.id = p.supplier_id AND c.status = 'ok'
  JOIN categories cat ON cat.id = p.category_id
 WHERE p.deleted_at IS NULL AND p.hidden_by IS NULL AND NOT p.is_draft;

-- Сравнение цен на один товар (одинаковый штрихкод у разных поставщиков)
CREATE VIEW price_compare AS
SELECT barcode, supplier_name, id AS product_id, name, price,
       rank() OVER (PARTITION BY barcode ORDER BY price) AS price_rank
  FROM catalog WHERE barcode IS NOT NULL;

-- Карточка заказа в списке поставщика: «3 позиции, 5 мин назад», сумма
CREATE VIEW supplier_order_cards AS
SELECT o.id, o.supplier_id, order_no(o.number) AS number, o.status, o.urgent,
       o.ship_name, o.ship_district, o.items_count, o.total, o.delivery_date,
       u.full_name AS courier_name, o.created_at,
       (o.status = 'new' AND o.created_at < now() - interval '2 hours') AS overdue
  FROM orders o LEFT JOIN users u ON u.id = o.courier_id;

-- Телефоны для поддержки скрыты: +996 500 •• •• 20. Полный номер — отдельный запрос с записью в журнал
CREATE FUNCTION mask_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = zakup, public AS
  $$ SELECT '+996 ' || substr(p, 4, 3) || ' •• •• ' || substr(p, 11, 2) $$;

CREATE VIEW admin_users AS
SELECT u.id, u.full_name, c.name AS company, c.id AS company_id,
       CASE u.role WHEN 'courier' THEN 'Доставщик' ELSE 'Владелец' END AS role,
       mask_phone(u.phone) AS phone_masked, u.last_login_at, u.status, u.block_reason
  FROM users u JOIN companies c ON c.id = u.company_id
 WHERE u.status <> 'deleted';

-- Цифры для главной админки
CREATE VIEW admin_dashboard AS
SELECT
  (SELECT count(*) FROM companies WHERE status = 'pending')                         AS companies_pending,
  (SELECT count(*) FROM company_change_requests WHERE status = 'new')               AS change_requests,
  (SELECT count(*) FROM password_reset_requests WHERE status = 'new')               AS password_requests,
  (SELECT count(*) FROM support_tickets WHERE status = 'open')                      AS tickets_open,
  (SELECT count(*) FROM orders WHERE status = 'new' AND created_at < now() - interval '2 hours') AS orders_overdue,
  (SELECT count(*) FROM orders WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bishkek') AT TIME ZONE 'Asia/Bishkek') AS orders_today,
  (SELECT COALESCE(sum(total), 0) FROM orders WHERE status = 'done' AND delivered_at >= now() - interval '30 days') AS gmv_30d;

-- =====================================================================
-- 12. ДОСТУП ПО СТРОКАМ (RLS)
--  API выполняет запросы под ролью zakup_api и в начале транзакции ставит
--  SET LOCAL app.user_id = '<id пользователя из токена>'.
--  Админка работает под ролью zakup_admin (RLS не применяется).
-- =====================================================================
CREATE FUNCTION app_user_id() RETURNS bigint LANGUAGE sql STABLE SET search_path = zakup, public AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::bigint $$;
CREATE FUNCTION app_company_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = zakup AS
  $$ SELECT company_id FROM users WHERE id = app_user_id() $$;
CREATE FUNCTION app_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = zakup AS
  $$ SELECT role FROM users WHERE id = app_user_id() $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zakup_api')   THEN CREATE ROLE zakup_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zakup_admin') THEN CREATE ROLE zakup_admin NOLOGIN BYPASSRLS; END IF;
  -- Роль, под которой подключается сервер (NestJS). Вход, регистрация и сброс пароля идут от её имени,
  -- запросы пользователя — через SET LOCAL ROLE zakup_api + app.user_id, админки — через SET LOCAL ROLE zakup_admin.
  -- На сервере: ALTER ROLE zakup_server LOGIN PASSWORD '...';
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zakup_server') THEN CREATE ROLE zakup_server NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT zakup_api, zakup_admin TO zakup_server;
GRANT USAGE ON SCHEMA zakup TO zakup_api, zakup_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA zakup TO zakup_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA zakup TO zakup_api, zakup_admin;
GRANT SELECT ON categories, reject_reasons, feature_flags, documents, document_versions, current_documents,
                catalog, catalog_search, price_compare, product_photos TO zakup_api;
-- Чужие компании: без телефона, ИНН и служебных полей (их видит только сам владелец — через сервер)
GRANT SELECT (id, type, name, city, address, district, logo_path, status, created_at) ON companies TO zakup_api;
-- Пользователи: без хэша пароля; менять можно только имя, телефон и язык (пароль, роль, статус — только сервер и админка)
GRANT SELECT (id, company_id, role, full_name, phone, status, lang, created_by, last_login_at, created_at) ON users TO zakup_api;
GRANT INSERT (company_id, role, full_name, phone, password_hash, created_by) ON users TO zakup_api;
GRANT UPDATE (full_name, phone, lang) ON users TO zakup_api;
-- Заказ: сумма, номер, адрес, QR и отметки Zakup.KG — не меняются приложением
GRANT SELECT ON orders TO zakup_api;
GRANT INSERT (shop_id, created_by, supplier_id, urgent, ship_name, ship_address, ship_district) ON orders TO zakup_api;
GRANT UPDATE (status, urgent, delivery_date, courier_id, reject_reason, delivered_by, delivered_method, paid_at, paid_marked_by) ON orders TO zakup_api;
GRANT SELECT, INSERT ON order_items TO zakup_api;
-- Товар: популярность, скрытие модератором и поставщик — не меняются приложением
GRANT SELECT ON products TO zakup_api;
GRANT INSERT (supplier_id, category_id, name, volume_value, volume_unit, pack_type, pack_qty, price, barcode, description, returnable, in_stock, is_draft) ON products TO zakup_api;
GRANT UPDATE (category_id, name, volume_value, volume_unit, pack_type, pack_qty, price, barcode, description, returnable, in_stock, is_draft, deleted_at) ON products TO zakup_api;
GRANT SELECT, INSERT, UPDATE ON cart_items TO zakup_api;
GRANT SELECT ON notifications TO zakup_api;
GRANT UPDATE (read_at) ON notifications TO zakup_api;
GRANT SELECT, INSERT ON support_tickets, ticket_messages, document_acceptances TO zakup_api;
GRANT DELETE ON cart_items, product_photos TO zakup_api;
GRANT INSERT ON product_photos, password_reset_requests TO zakup_api;
GRANT SELECT, INSERT, UPDATE (status) ON company_change_requests TO zakup_api;   -- отправить и отменить свою заявку
GRANT SELECT ON order_events, invoices, supplier_order_cards, debts, supplier_daily TO zakup_api;
GRANT SELECT, INSERT ON order_ratings, order_messages, price_imports TO zakup_api;
GRANT UPDATE (read_at) ON order_messages TO zakup_api;
GRANT UPDATE (is_out) ON order_items TO zakup_api;
-- audit_log, staff, sessions — недоступны API приложения

ALTER TABLE orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_messages_read ON order_messages FOR SELECT TO zakup_api USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (o.shop_id = app_company_id() OR (o.supplier_id = app_company_id() AND app_role() = 'owner'))));
CREATE POLICY order_messages_mark ON order_messages FOR UPDATE TO zakup_api USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (o.shop_id = app_company_id() OR (o.supplier_id = app_company_id() AND app_role() = 'owner')))) WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (o.shop_id = app_company_id() OR (o.supplier_id = app_company_id() AND app_role() = 'owner'))));
CREATE POLICY order_messages_send ON order_messages FOR INSERT TO zakup_api WITH CHECK (author_id = app_user_id() AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (o.shop_id = app_company_id() OR (o.supplier_id = app_company_id() AND app_role() = 'owner'))));
CREATE POLICY order_ratings_read ON order_ratings FOR SELECT TO zakup_api USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY order_ratings_shop ON order_ratings FOR INSERT TO zakup_api WITH CHECK (created_by = app_user_id() AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.shop_id = app_company_id()));
ALTER TABLE company_change_requests ENABLE ROW LEVEL SECURITY;

-- Заказ видят: магазин-заказчик, поставщик (владелец), назначенный доставщик
CREATE POLICY orders_read ON orders FOR SELECT TO zakup_api USING (
  shop_id = app_company_id()
  OR (supplier_id = app_company_id() AND app_role() = 'owner')
  OR courier_id = app_user_id());
CREATE POLICY orders_shop_create ON orders FOR INSERT TO zakup_api WITH CHECK (shop_id = app_company_id() AND created_by = app_user_id());
CREATE POLICY orders_supplier_update ON orders FOR UPDATE TO zakup_api USING (
  (supplier_id = app_company_id() AND app_role() = 'owner') OR courier_id = app_user_id());
CREATE POLICY order_items_read ON order_items FOR SELECT TO zakup_api USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY order_items_create ON order_items FOR INSERT TO zakup_api WITH CHECK (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.shop_id = app_company_id() AND o.status = 'new'));
CREATE POLICY order_items_out ON order_items FOR UPDATE TO zakup_api USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.supplier_id = app_company_id() AND app_role() = 'owner' AND o.status = 'new'));
CREATE POLICY invoices_read ON invoices FOR SELECT TO zakup_api USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY notifications_own ON notifications FOR ALL TO zakup_api USING (user_id = app_user_id());
CREATE POLICY cart_own ON cart_items FOR ALL TO zakup_api USING (user_id = app_user_id());
-- Товары: читают все (каталог), меняет только владелец-поставщик
CREATE POLICY products_read  ON products FOR SELECT TO zakup_api USING (true);
CREATE POLICY products_write ON products FOR INSERT TO zakup_api WITH CHECK (supplier_id = app_company_id() AND app_role() = 'owner');
CREATE POLICY products_edit  ON products FOR UPDATE TO zakup_api USING (supplier_id = app_company_id() AND app_role() = 'owner' AND hidden_by IS NULL);
-- Пользователи: себя и сотрудников своей компании (поставщик управляет доставщиками)
CREATE POLICY users_read ON users FOR SELECT TO zakup_api USING (id = app_user_id() OR company_id = app_company_id());
CREATE POLICY users_add_courier ON users FOR INSERT TO zakup_api WITH CHECK (company_id = app_company_id() AND role = 'courier' AND app_role() = 'owner');
CREATE POLICY users_edit ON users FOR UPDATE TO zakup_api USING (id = app_user_id() OR (company_id = app_company_id() AND role = 'courier' AND app_role() = 'owner'));
CREATE POLICY change_own ON company_change_requests FOR SELECT TO zakup_api USING (company_id = app_company_id());
CREATE POLICY change_create ON company_change_requests FOR INSERT TO zakup_api WITH CHECK (company_id = app_company_id() AND requested_by = app_user_id() AND app_role() = 'owner' AND status = 'new');
CREATE POLICY change_cancel ON company_change_requests FOR UPDATE TO zakup_api USING (company_id = app_company_id() AND status = 'new') WITH CHECK (status = 'cancelled');
CREATE POLICY tickets_own ON support_tickets FOR ALL TO zakup_api USING (user_id = app_user_id());

COMMIT;
