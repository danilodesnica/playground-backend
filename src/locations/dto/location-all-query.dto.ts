import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LocationAllQuerySchema = z.object({
  category: z.string().min(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export class LocationAllQueryDto extends createZodDto(LocationAllQuerySchema) {}
