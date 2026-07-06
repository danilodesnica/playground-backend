import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { EventsBatchDto } from './dto/events-batch.dto';

// PUBLIC ingest endpoint — no guard. Guests must be able to send events, and a
// bad/expired token must never drop a batch (attribution is soft in the service).
@Controller('events')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async batch(@Body() body: EventsBatchDto, @Req() req: Request): Promise<{ accepted: number }> {
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = forwardedStr?.split(',')[0]?.trim() || req.ip;
    return this.service.ingest(body, req.headers.authorization, ip);
  }
}
