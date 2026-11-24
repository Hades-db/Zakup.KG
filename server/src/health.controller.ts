import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard';
import { DbService } from './db/db.service';

@Controller()
export class HealthController {
  constructor(private db: DbService) {}
  @Public() @Get('health')
  async health() { await this.db.system(c => c.query('SELECT 1')); return { ok: true }; }
}
