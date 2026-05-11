import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SavedOfferPayloadSchema = z.object({
  user_id: z.string().uuid(),
  offers_id: z.coerce.number().int().positive(),
});

export class SavedOfferPayloadDto extends createZodDto(SavedOfferPayloadSchema) {}
