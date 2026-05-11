import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LocationsFilterQuerySchema = z.object({
  // 'all' is a sentinel from the mobile app meaning "no type filter"; only narrow when the value is a real type.
  type: z.enum(['playground', 'event', 'all']).optional(),
  filters: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }, z.array(z.string()).optional()),
  search: z.string().trim().min(1).optional(),
  longitude: z.coerce.number().optional(),
  latitude: z.coerce.number().optional(),
});

export class LocationsFilterQueryDto extends createZodDto(LocationsFilterQuerySchema) {}
