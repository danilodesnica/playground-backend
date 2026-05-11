import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OffersService } from './offers.service';
import type { OfferDto } from './offers.service';

@Controller('offers')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(private readonly service: OffersService) {}

  @Get()
  async findAll(@CurrentUser() user: User): Promise<OfferDto[]> {
    return this.service.findAll(user.id);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<OfferDto> {
    return this.service.findById(id);
  }
}
