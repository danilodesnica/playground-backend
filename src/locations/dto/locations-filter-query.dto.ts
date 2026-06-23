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
  // Viewport span (degrees). New mobile clients send these so the server can query
  // the actual visible map box instead of a fixed ±0.03° window. Older App Store
  // builds omit them and fall back to the legacy box (back-compat).
  longitudeDelta: z.coerce.number().positive().optional(),
  latitudeDelta: z.coerce.number().positive().optional(),
});

export class LocationsFilterQueryDto extends createZodDto(LocationsFilterQuerySchema) {}
