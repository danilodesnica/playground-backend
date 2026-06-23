import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateReviewSchema = z.object({
  user_id: z.string().uuid(),
  location_id: z.string().uuid(),
  // Optional: the app allows rating-only reviews. Stored as '' when omitted.
  review: z.string().trim().optional(),
  rating: z.coerce.number().int().min(1).max(5),
});

export class CreateReviewDto extends createZodDto(CreateReviewSchema) {}
