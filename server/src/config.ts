function need(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. server/.env.example)`);
  return v;
}

export const config = {
  get databaseUrl() { return need('DATABASE_URL'); },
  get jwtSecret() { return need('JWT_SECRET'); },
  get accessTtl() { return Number(process.env.ACCESS_TTL ?? 900); },
  get refreshDays() { return 60; },
  get port() { return Number(process.env.PORT ?? 3000); },
  /** Проверка при старте: в продакшене слабый секрет — ошибка, а не тихая уязвимость */
  check() {
    void this.databaseUrl;
    if (process.env.NODE_ENV === 'production' && this.jwtSecret.length < 32) throw new Error('JWT_SECRET короче 32 символов');
    if (!(this.accessTtl >= 60 && this.accessTtl <= 3600)) throw new Error('ACCESS_TTL — от 60 до 3600 секунд');
  },
};
