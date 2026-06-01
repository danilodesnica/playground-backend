import { Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { ReviewsService } from './reviews.service';
import type { ReviewRow, ReviewWithUser } from './reviews.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get('reviews')
  async listAll(): Promise<ReviewWithUser[]> {
    return this.service.listAllForAdmin();
  }

  @Patch('review/:id/approve')
  async approve(@Param('id', new ParseUUIDPipe()) id: string): Promise<ReviewRow> {
    return this.service.setStatus(id, 'approved');
  }

  @Patch('review/:id/reject')
  async reject(@Param('id', new ParseUUIDPipe()) id: string): Promise<ReviewRow> {
    return this.service.setStatus(id, 'rejected');
  }
}
