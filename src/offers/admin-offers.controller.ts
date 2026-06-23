import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OffersService } from './offers.service';
import type { OfferDto } from './offers.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get('offers')
  async listAll(): Promise<OfferDto[]> {
    return this.offers.listAllForAdmin();
  }

  @Get('offers/:id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<OfferDto> {
    return this.offers.findById(id);
  }

  @Post('create-offer')
  async create(@Body() body: CreateOfferDto): Promise<OfferDto> {
    return this.offers.createOffer(body);
  }

  @Patch('update-offer/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateOfferDto,
  ): Promise<OfferDto> {
    return this.offers.updateOffer(id, body);
  }
}
