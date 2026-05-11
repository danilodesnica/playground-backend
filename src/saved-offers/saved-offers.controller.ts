import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SavedOfferPayloadDto } from './dto/saved-offer-payload.dto';
import { SavedOffersService } from './saved-offers.service';
import type { SavedOfferRow, SavedOfferWithOffer } from './saved-offers.service';

@Controller('saved-offers')
@UseGuards(JwtAuthGuard)
export class SavedOffersController {
  constructor(private readonly service: SavedOffersService) {}

  @Get()
  async findAllByMe(@CurrentUser() user: User): Promise<SavedOfferWithOffer[]> {
    return this.service.findAllByMe(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async save(@CurrentUser() user: User, @Body() body: SavedOfferPayloadDto): Promise<SavedOfferRow> {
    return this.service.create(user.id, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async unsave(
    @CurrentUser() user: User,
    @Query() query: SavedOfferPayloadDto,
  ): Promise<{ success: true; deleted: SavedOfferRow[] }> {
    return this.service.remove(user.id, query);
  }
}
