#!/usr/bin/env bash
# Пересоздать схему и демо-данные. Использует DATABASE_ADMIN_URL (суперпользователь), по умолчанию — локальный postgres.
set -euo pipefail
cd "$(dirname "$0")/../.."
URL="${DATABASE_ADMIN_URL:-postgres://postgres@localhost:5432/zakup}"
psql "$URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql
psql "$URL" -v ON_ERROR_STOP=1 -q -f db/seed.sql
echo "База пересоздана"
