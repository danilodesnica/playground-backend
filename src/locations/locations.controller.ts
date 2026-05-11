import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
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
  async featured(): Promise<FeaturedLocations> {
    return this.locationsService.featured();
  }

  // Public — same payload as /locations/featured, no auth required.
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
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<LocationListItem> {
    return this.locationsService.findById(id);
  }
}
