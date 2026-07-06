import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { AnalyticsService } from './analytics.service';
import type { EngagementRow, LifetimeRow, OverviewResponse } from './analytics.service';
import {
  AnalyticsLimitQueryDto,
  AnalyticsRangeQueryDto,
  AnalyticsUsersQueryDto,
} from './dto/analytics-query.dto';

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

  // --- Insights v2: historical / database-wide endpoints (migration 0011) ---

  @Get('lifetime')
  async lifetime(): Promise<LifetimeRow> {
    return this.service.lifetime();
  }

  @Get('signups-monthly')
  async signupsMonthly(): Promise<unknown> {
    return this.service.signupsMonthly();
  }

  @Get('top-favorited')
  async topFavorited(@Query() query: AnalyticsLimitQueryDto): Promise<unknown> {
    return this.service.topFavorited(query.limit ?? 50);
  }

  @Get('top-clicked')
  async topClicked(@Query() query: AnalyticsLimitQueryDto): Promise<unknown> {
    return this.service.topClicked(query.limit ?? 50);
  }

  @Get('historical-actives')
  async historicalActives(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.historicalActives(query.from, query.to);
  }

  @Get('dead-inventory')
  async deadInventory(): Promise<unknown> {
    return this.service.deadInventory();
  }

  @Get('reviews-trend')
  async reviewsTrend(): Promise<unknown> {
    return this.service.reviewsTrend();
  }

  @Get('postcodes')
  async postcodes(@Query() query: AnalyticsLimitQueryDto): Promise<unknown> {
    return this.service.postcodes(query.limit ?? 30);
  }

  @Get('engagement')
  async engagement(@Query() query: AnalyticsRangeQueryDto): Promise<EngagementRow> {
    return this.service.engagement(query.from, query.to);
  }

  @Get('dau-by-version')
  async dauByVersion(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.dauByVersion(query.from, query.to);
  }

  // --- Deals analytics (migration 0012) ---

  @Get('top-offers')
  async topOffers(@Query() query: AnalyticsRangeQueryDto): Promise<unknown> {
    return this.service.topOffers(query.from, query.to);
  }

  @Get('top-saved-offers')
  async topSavedOffers(@Query() query: AnalyticsLimitQueryDto): Promise<unknown> {
    return this.service.topSavedOffers(query.limit ?? 50);
  }
}
