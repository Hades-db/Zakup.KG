import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { DbService } from '../db/db.service';

export type AppRole = 'shop' | 'dist' | 'courier';
export interface AuthUser { id: number; sid: string; role: AppRole; companyId: number; mustChangePassword: boolean }

export const Public = () => SetMetadata('public', true);
export const Roles = (...r: AppRole[]) => SetMetadata('roles', r);
export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/**
 * Каждый запрос: проверяем подпись access-токена и что сеанс жив — администратор мог
 * завершить сеансы, заблокировать пользователя или компанию (тогда вход закрывается сразу).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private db: DbService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new UnauthorizedException('Нужен вход');
    let p: any;
    try { p = jwt.verify(h.slice(7), config.jwtSecret); } catch { throw new UnauthorizedException('Сеанс истёк, войдите снова'); }
    const r = await this.db.system(c => c.query(
      `SELECT s.revoked_at, s.expires_at, l.denied, l.role, l.company_type, l.must_change_password, u.company_id
         FROM sessions s JOIN login_check l ON l.user_id = s.user_id JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2`, [p.sid, p.sub]));
    const s = r.rows[0];
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) throw new UnauthorizedException('Сеанс завершён, войдите снова');
    if (s.denied) throw new UnauthorizedException(s.denied);
    const user: AuthUser = { id: Number(p.sub), sid: p.sid, role: s.role === 'courier' ? 'courier' : s.company_type, companyId: Number(s.company_id), mustChangePassword: s.must_change_password };
    req.user = user;
    const roles = this.reflector.getAllAndOverride<AppRole[]>('roles', targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Действие недоступно для вашей роли');
    return true;
  }
}
