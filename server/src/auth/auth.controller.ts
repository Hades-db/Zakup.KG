import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuthService } from './auth.service';
import { AllowTempPassword, AuthUser, Me, Public } from './auth.guard';

class LoginDto {
  @IsString() @Length(9, 20) phone: string;
  @IsString() @Length(1, 200) password: string;
  @IsOptional() @IsString() @Length(0, 120) device?: string;
}
class RefreshDto { @IsString() @Length(1, 200) refreshToken: string }
class PasswordDto { @IsString() @Length(1, 200) oldPassword: string; @IsString() @Length(8, 200, { message: 'Новый пароль — не меньше 8 символов' }) newPassword: string }
class RegisterDto {
  @IsIn(['shop', 'dist']) type: 'shop' | 'dist';
  @IsString() @Length(2, 120) name: string;
  @Matches(/^\d{14}$/, { message: 'ИНН / ПИН — 14 цифр' }) inn: string;
  @IsString() @Length(5, 200) address: string;
  @IsString() @Length(9, 20) phone: string;
  @IsString() @Length(8, 200, { message: 'Пароль — не меньше 8 символов' }) password: string;
  @IsOptional() @IsString() @Length(2, 120) ownerName?: string;
  @IsBoolean() acceptedDocs: boolean;
}
class ResetDto { @IsString() @Length(9, 20) phone: string }

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login') @HttpCode(200)
  login(@Body() b: LoginDto, @Req() req: any) { return this.auth.login(b.phone, b.password, b.device, req.ip); }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Body() b: RefreshDto, @Req() req: any) { return this.auth.refresh(b.refreshToken, req.ip); }

  @AllowTempPassword() @Post('logout') @HttpCode(200)
  logout(@Me() me: AuthUser) { return this.auth.logout(me.sid); }

  @AllowTempPassword() @Get('me')
  me(@Me() me: AuthUser) { return this.auth.me(me.id); }

  @AllowTempPassword() @Post('password') @HttpCode(200)
  password(@Me() me: AuthUser, @Body() b: PasswordDto) { return this.auth.changePassword(me.id, me.sid, b.oldPassword, b.newPassword); }

  @Public() @Post('register')
  register(@Body() b: RegisterDto, @Req() req: any) { return this.auth.register(b, req.ip); }

  @Public() @Post('password-reset') @HttpCode(200)
  reset(@Body() b: ResetDto, @Req() req: any) { return this.auth.resetRequest(b.phone, req.ip); }
}
