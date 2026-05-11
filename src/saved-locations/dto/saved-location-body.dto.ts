import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SavedLocationBodySchema = z.object({
  user_id: z.string().uuid(),
  location_id: z.string().uuid(),
});

export class SavedLocationBodyDto extends createZodDto(SavedLocationBodySchema) {}
