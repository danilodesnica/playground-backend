import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { KlaviyoService } from './klaviyo.service';

/** Admin-only window onto the sync: what the last pass did, and a way to run one now. */
@Controller('admin/klaviyo')
@UseGuards(AdminAuthGuard)
export class KlaviyoController {
  constructor(private readonly klaviyo: KlaviyoService) {}

  @Get('status')
  status() {
    return this.klaviyo.status;
  }

  @Post('reconcile')
  async reconcile() {
    await this.klaviyo.reconcile();
    return this.klaviyo.status;
  }
}
