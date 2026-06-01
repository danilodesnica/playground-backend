import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationsService } from './locations.service';
import type { LocationListItem } from './locations.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('locations')
  async listAll(): Promise<LocationListItem[]> {
    return this.locations.listAllForAdmin();
  }

  @Post('create-location')
  async create(@Body() body: CreateLocationDto): Promise<LocationListItem> {
    return this.locations.createLocation(body);
  }

  @Patch('update-location/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLocationDto,
  ): Promise<LocationListItem> {
    return this.locations.updateLocation(id, body);
  }
}
