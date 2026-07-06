import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Date-range query for the admin analytics endpoints. When omitted the service
// defaults to from = 28 days ago, to = today.
export const AnalyticsRangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export class AnalyticsRangeQueryDto extends createZodDto(AnalyticsRangeQuerySchema) {}

export const AnalyticsUsersQuerySchema = AnalyticsRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export class AnalyticsUsersQueryDto extends createZodDto(AnalyticsUsersQuerySchema) {}
