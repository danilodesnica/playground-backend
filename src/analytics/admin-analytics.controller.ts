import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { AnalyticsService } from './analytics.service';
import type { OverviewResponse } from './analytics.service';
import { AnalyticsRangeQueryDto, AnalyticsUsersQueryDto } from './dto/analytics-query.dto';

@Controller('admin/analytics')
@UseGuards(AdminAuthGuard)
export class AdminAnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('overview')
  async overview(@Query() query: AnalyticsRangeQueryDto): Promise<OverviewResponse> {
    return this.service.overview(query.from, query.to);
  }

  @Get('screens')
  async screens(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.screens(query.from, query.to);
  }

  @Get('geo')
  async geo(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.geo(query.from, query.to);
  }

  @Get('locations')
  async locations(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.topLocations(query.from, query.to);
  }

  @Get('searches')
  async searches(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.searches(query.from, query.to);
  }

  @Get('retention')
  async retention(): Promise<unknown> {
    return this.service.retention();
  }

  @Get('users')
  async users(@Query() query: AnalyticsUsersQueryDto): Promise<unknown> {
    return this.service.users(query.from, query.to, query.limit);
  }

  @Get('user/:ident')
  async userEvents(@Param('ident') ident: string): Promise<unknown> {
    return this.service.userEvents(ident);
  }
}
