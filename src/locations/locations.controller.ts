import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocationAllQueryDto } from './dto/location-all-query.dto';
import { LocationsFilterQueryDto } from './dto/locations-filter-query.dto';
import { LocationsService } from './locations.service';
import type { FeaturedLocations, LocationListItem, LocationListResponse } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) { }

  @Get()
  @UseGuards(JwtAuthGuard)
  async filter(@Query() query: LocationsFilterQueryDto): Promise<LocationListItem[]> {
    return this.locationsService.findFiltered(query);
  }

  @Get('featured')
  @UseGuards(JwtAuthGuard)
  async featured(@CurrentUser() user: User): Promise<FeaturedLocations> {
    return this.locationsService.featuredForUser(user.id);
  }

  // Public — anonymous random selection per rail. No auth, so no personalization.
  @Get('free')
  async free(): Promise<FeaturedLocations> {
    return this.locationsService.featured();
  }

  @Get('all')
  @UseGuards(JwtAuthGuard)
  async all(@Query() query: LocationAllQueryDto): Promise<LocationListResponse> {
    return this.locationsService.listByCategory(query.category, query.perPage, query.offset);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LocationListItem> {
    return this.locationsService.findById(id, user.id);
  }
}
