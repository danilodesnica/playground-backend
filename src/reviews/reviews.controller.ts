import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';
import type { ReviewRow, ReviewWithUser } from './reviews.service';

@Controller('review')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: User, @Body() body: CreateReviewDto): Promise<ReviewRow> {
    return this.service.create(user.id, body);
  }

  @Get('location/:locationId')
  async findByLocation(
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
  ): Promise<ReviewWithUser[]> {
    return this.service.findApprovedByLocation(locationId);
  }
}
