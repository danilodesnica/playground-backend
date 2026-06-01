import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { imageMetaSchema } from '../../locations/dto/create-location.dto';

// Images are uploaded to Supabase Storage by the frontend; the body carries the
// resulting metadata (same contract as create-location).
export const CreateOfferSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.enum(['deals', 'benefits']),
  url: z.url(),
  image: imageMetaSchema.optional(),
  previewImg: z.array(imageMetaSchema).optional(),
});

export class CreateOfferDto extends createZodDto(CreateOfferSchema) {}
