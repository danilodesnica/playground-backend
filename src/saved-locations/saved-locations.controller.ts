import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SavedLocationBodyDto } from './dto/saved-location-body.dto';
import { SavedLocationCheckQueryDto } from './dto/saved-location-check-query.dto';
import { SavedLocationsService } from './saved-locations.service';
import type { SavedLocationRow, SavedLocationWithLocation } from './saved-locations.service';

@Controller('saved-locations')
@UseGuards(JwtAuthGuard)
export class SavedLocationsController {
  constructor(private readonly service: SavedLocationsService) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async save(@CurrentUser() user: User, @Body() body: SavedLocationBodyDto): Promise<SavedLocationRow> {
    return this.service.create(user.id, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async unsave(
    @CurrentUser() user: User,
    @Query() query: SavedLocationBodyDto,
  ): Promise<{ success: true; deleted: SavedLocationRow[] }> {
    return this.service.remove(user.id, query);
  }

  @Get(':userId/single')
  async findOne(
    @CurrentUser() user: User,
    @Param('userId', new ParseUUIDPipe()) pathUserId: string,
    @Query() query: SavedLocationCheckQueryDto,
  ): Promise<SavedLocationRow[]> {
    return this.service.findOne(user.id, pathUserId, query.location_id);
  }

  @Get(':userId')
  async findAllByUser(
    @CurrentUser() user: User,
    @Param('userId', new ParseUUIDPipe()) pathUserId: string,
  ): Promise<SavedLocationWithLocation[]> {
    return this.service.findAllByUser(user.id, pathUserId);
  }
}
