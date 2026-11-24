# Zakup.KG API

NestJS + PostgreSQL 16. Схема и правила лежат в `../db`. Сервер проверяет вход и права, а правила заказа (статусы, флаги, блокировки, долги) держит сама база: триггеры и RLS.

## Запуск для разработки

```bash
cd server
npm install
docker compose up -d                       # PostgreSQL 16 на localhost:5432
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/zakup npm run db:reset
psql postgres://postgres:postgres@localhost:5432/zakup -c "ALTER ROLE zakup_server LOGIN PASSWORD 'dev'"
cp .env.example .env                       # DATABASE_URL=postgres://zakup_server:dev@localhost:5432/zakup, JWT_SECRET=...
set -a; . ./.env; set +a; npm run dev      # http://localhost:3000
```

Тесты пересоздают базу и проверяют все сценарии по HTTP:

```bash
TEST_ADMIN_URL=postgres://postgres:postgres@localhost:5432/zakup \
TEST_DATABASE_URL=postgres://zakup_server:zakup_test@localhost:5432/zakup npm test
```

На GitHub тесты запускаются сами при изменениях в `server/` и `db/` (`.github/workflows/server.yml`).

## Как устроен доступ

- Сервер подключается к базе под ролью `zakup_server`.
- Каждый запрос пользователя идёт в отдельной транзакции:
  1. `SET LOCAL ROLE zakup_api`;
  2. `app.user_id`;
  3. дальше работают политики RLS: магазин видит свои заказы, поставщик — заказы к нему, доставщик — назначенные ему. Ошибка в коде сервера не откроет чужие данные.
- Вход:
  - access-токен (JWT, 15 минут) и refresh-токен (60 дней, одноразовый);
  - в базе хранится только хэш refresh-токена;
  - повтор старого refresh-токена закрывает сеанс;
  - при каждом запросе проверяется, что сеанс не завершён администратором и пользователь или компания не заблокированы.
- Пароли хранятся как argon2id. Неверный номер и неверный пароль дают одинаковый ответ.

## Методы (v1)

Все методы, кроме помеченных «без входа», требуют `Authorization: Bearer <accessToken>`.

| Метод | Кто | Что делает |
|---|---|---|
| `POST /v1/auth/login` | без входа | `{phone, password}` → токены и профиль. Роль определяется по номеру |
| `POST /v1/auth/refresh` | без входа | `{refreshToken}` → новые токены |
| `POST /v1/auth/register` | без входа | компания «на проверке» и владелец |
| `POST /v1/auth/password-reset` | без входа | заявка «Забыли пароль?» в админку |
| `POST /v1/auth/logout` · `GET /v1/auth/me` · `POST /v1/auth/password` | все | выход, профиль, смена пароля (закрывает другие сеансы) |
| `GET /v1/catalog?q=&category=&supplier=` | все | каталог (с `q` — вместе с «нет в наличии») |
| `GET /v1/cart` · `PUT /v1/cart/:productId` · `DELETE /v1/cart/:productId` | магазин | корзина, `{qty, urgent}` |
| `POST /v1/cart/checkout` | магазин | корзина → заказы по поставщикам |
| `GET /v1/orders?status=` · `GET /v1/orders/:number` | все | свои заказы, детали (позиции, история, накладная, оценка, QR для магазина) |
| `POST /v1/orders/:n/accept` | поставщик | `{deliveryDate, courierId, outLines?}`: принять, отказ по позициям |
| `POST /v1/orders/:n/reject` | поставщик | `{reason}` |
| `POST /v1/orders/:n/courier` | поставщик | сменить доставщика у заказа в работе |
| `POST /v1/orders/:n/pay` | поставщик | `{paid}`: отметка оплаты |
| `POST /v1/orders/:n/deliver` | доставщик | `{qr}`, или без QR, если доставка по QR выключена |
| `POST /v1/orders/:n/rating` | магазин | `{stars, comment}`, один раз |
| `GET/POST /v1/orders/:n/messages` | магазин, поставщик | чат по заказу |
| `GET /v1/debts` | магазин, поставщик | долги |
| `GET /v1/couriers` | поставщик | свои доставщики и сколько у них заказов в работе |
| `GET /v1/notifications` · `POST /v1/notifications/read-all` | все | уведомления (их создают триггеры базы) |

Ошибки приходят в виде `{ "error": "текст для пользователя" }`. Нарушение правил заказа — `409` с текстом из базы, например «Нет ни одной позиции: заказ нужно отклонить».

## Демо-входы (после `db:reset`)

Пароль у всех `demo1234`.

| Роль | Номер |
|---|---|
| Магазин | 700000111 |
| Поставщик | 700000101 |
| Доставщик | 700000102 |
| Заявка на проверке | 700000107 |
| Заблокирован | 700000118 |
