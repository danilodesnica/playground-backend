import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SavedLocationCheckQuerySchema = z.object({
  location_id: z.string().uuid(),
});

export class SavedLocationCheckQueryDto extends createZodDto(SavedLocationCheckQuerySchema) {}
