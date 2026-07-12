import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { InflationService } from './inflation/inflation.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService, InflationService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
