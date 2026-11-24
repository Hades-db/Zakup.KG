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
};
