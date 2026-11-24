import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { createHash, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { clearLimit, limit } from '../common/rate-limit';

const sha = (t: string) => createHash('sha256').update(t).digest();
const phone12 = (p: string) => { const d = String(p || '').replace(/\D/g, ''); const n = d.length === 9 ? '996' + d : d; if (!/^996\d{9}$/.test(n)) throw new BadRequestException('Номер телефона: 9 цифр после +996'); return n; };
export const hashPassword = (pw: string) => hash(pw, { algorithm: Algorithm.Argon2id });
// для ровного времени ответа, когда номера нет: проверяем пароль против этого хэша
const DUMMY = hash('zakup-dummy-password', { algorithm: Algorithm.Argon2id });
const clean = (v: string) => String(v || '').trim().replace(/\s+/g, ' ');

@Injectable()
export class AuthService {
  constructor(private db: DbService) {}

  private async issue(c: any, userId: number, device?: string, ip?: string, sid?: string) {
    const refresh = randomBytes(32).toString('base64url');
    if (sid) {
      await c.query(`UPDATE sessions SET token_hash = $1, last_seen_at = now(), expires_at = now() + ($2 || ' days')::interval WHERE id = $3`, [sha(refresh), String(config.refreshDays), sid]);
    } else {
      sid = (await c.query(`INSERT INTO sessions (user_id, token_hash, device, ip, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval) RETURNING id`,
        [userId, sha(refresh), device || null, ip || null, String(config.refreshDays)])).rows[0].id;
    }
    const accessToken = jwt.sign({ sub: String(userId), sid }, config.jwtSecret, { expiresIn: config.accessTtl });
    return { accessToken, refreshToken: sid + '.' + refresh, expiresIn: config.accessTtl };
  }

  private profile(c: any, userId: number) {
    return c.query(`SELECT u.id, u.full_name AS name, u.phone, u.lang, u.must_change_password AS "mustChangePassword",
        CASE WHEN u.role = 'courier' THEN 'courier' ELSE c.type::text END AS role, c.id AS "companyId", c.name AS "companyName"
      FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1`, [userId]).then((r: any) => r.rows[0]);
  }

  /** Вход по номеру и паролю. Регистрация на проверке, блокировка — понятный текст вместо входа */
  login(phone: string, password: string, device?: string, ip?: string) {
    const p = phone12(phone);
    limit('login:ip:' + ip, 50, 15 * 60_000);     // перебор номеров с одного адреса
    limit('login:ph:' + p, 10, 15 * 60_000);      // перебор паролей к одному номеру
    return this.db.system(async c => {
      const u = (await c.query(`SELECT user_id, password_hash, denied FROM login_check WHERE phone = $1 AND denied IS DISTINCT FROM 'Аккаунт удалён'`, [p])).rows[0];
      // одинаковый ответ и время для «нет номера» и «неверный пароль» — не подсказываем, какие номера зарегистрированы
      const ok = await verify(u ? u.password_hash : await DUMMY, password).catch(() => false);
      if (!u || !ok) throw new UnauthorizedException('Неверный номер или пароль');
      clearLimit('login:ph:' + p);
      if (u.denied) throw new ForbiddenException(u.denied);
      await c.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.user_id]);
      return { ...(await this.issue(c, u.user_id, device, ip)), user: await this.profile(c, u.user_id) };
    });
  }

  /** Обновление токенов: refresh одноразовый, при каждом обновлении выдаём новый */
  refresh(token: string, ip?: string) {
    limit('refresh:ip:' + ip, 300, 15 * 60_000);
    const [sid, raw] = String(token || '').split('.');
    if (!sid || !raw || !/^[0-9a-f-]{36}$/.test(sid)) throw new UnauthorizedException('Сеанс завершён, войдите снова');
    return this.db.system(async c => {
      const s = (await c.query(`SELECT s.user_id, s.token_hash, s.revoked_at, s.expires_at, l.denied FROM sessions s JOIN login_check l ON l.user_id = s.user_id WHERE s.id = $1 FOR UPDATE OF s`, [sid])).rows[0];
      if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) return null;
      // повторное использование старого refresh — признак кражи: закрываем сеанс (фиксируем, а не откатываем)
      if (!sha(raw).equals(s.token_hash)) { await c.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'reuse' WHERE id = $1`, [sid]); return null; }
      if (s.denied) return { denied: s.denied };
      return this.issue(c, s.user_id, undefined, undefined, sid);
    }).then((r: any) => {
      if (!r) throw new UnauthorizedException('Сеанс завершён, войдите снова');
      if (r.denied) throw new ForbiddenException(r.denied);
      return r;
    });
  }

  logout(sid: string) {
    return this.db.system(c => c.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL`, [sid])).then(() => ({ ok: true }));
  }

  me(userId: number) { return this.db.system(c => this.profile(c, userId)); }

  /** Смена своего пароля: остальные сеансы закрываются */
  changePassword(userId: number, sid: string, oldPw: string, newPw: string) {
    if (!newPw || newPw.length < 8) throw new BadRequestException('Новый пароль — не меньше 8 символов');
    if (newPw === oldPw) throw new BadRequestException('Новый пароль совпадает с текущим');
    limit('pw:' + userId, 10, 15 * 60_000);
    return this.db.system(async c => {
      const u = (await c.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0];
      if (!(await verify(u.password_hash, oldPw).catch(() => false))) throw new BadRequestException('Неверный текущий пароль');
      await c.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [await hashPassword(newPw), userId]);
      await c.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_change' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [userId, sid]);
      return { ok: true };
    });
  }

  /** Регистрация: компания «на проверке» + владелец. Войти можно после подтверждения в админке */
  register(b: { type: 'shop' | 'dist'; name: string; inn: string; address: string; phone: string; password: string; ownerName?: string; acceptedDocs?: boolean }, ip?: string) {
    limit('reg:ip:' + ip, 10, 60 * 60_000);
    b = { ...b, name: clean(b.name), address: clean(b.address), ownerName: b.ownerName ? clean(b.ownerName) : undefined };
    if (b.name.length < 2) throw new BadRequestException('Проверьте: название');
    if (b.address.length < 5) throw new BadRequestException('Проверьте: адрес');
    if (!b.acceptedDocs) throw new BadRequestException('Нужно согласие с условиями, офертой и политикой');
    if (!b.password || b.password.length < 8) throw new BadRequestException('Пароль — не меньше 8 символов');
    const p = phone12(b.phone);
    return this.db.system(async c => {
      const co = (await c.query(`INSERT INTO companies (type, name, inn, address, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [b.type, b.name, b.inn, b.address, p])).rows[0].id;
      const uid = (await c.query(`INSERT INTO users (company_id, role, full_name, phone, password_hash) VALUES ($1, 'owner', $2, $3, $4) RETURNING id`,
        [co, b.ownerName || 'Владелец, ' + b.name, p, await hashPassword(b.password)])).rows[0].id;
      await c.query(`INSERT INTO document_acceptances (user_id, version_id) SELECT $1, id FROM current_documents`, [uid]);
      return { status: 'pending', message: 'Заявка отправлена. Вход откроется после проверки' };
    });
  }

  /** «Забыли пароль?»: заявка администратору. Ответ одинаковый, есть номер в базе или нет */
  resetRequest(phone: string, ip?: string) {
    const p = phone12(phone);
    limit('reset:ip:' + ip, 10, 60 * 60_000);
    return this.db.system(async c => {
      await c.query(`INSERT INTO password_reset_requests (phone, user_id, ip)
        SELECT $1::text, (SELECT id FROM users WHERE phone = $1::text AND status <> 'deleted'), $2::inet
        ON CONFLICT (phone) WHERE status = 'new' DO NOTHING`, [p, ip || null]);
      return { ok: true, message: 'Заявка отправлена, администратор свяжется с вами' };
    });
  }
}
