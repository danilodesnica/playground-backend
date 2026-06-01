import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { imageMetaSchema } from '../../locations/dto/create-location.dto';

// Partial update: every field optional (omitted = leave unchanged). Only the
// nullable columns (image, preview_img) accept null to clear them; name /
// description / category / url are NOT NULL so they can be changed but not cleared.
export const UpdateOfferSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  category: z.enum(['deals', 'benefits']).optional(),
  url: z.url().optional(),
  image: imageMetaSchema.nullable().optional(),
  previewImg: z.array(imageMetaSchema).nullable().optional(),
});

export class UpdateOfferDto extends createZodDto(UpdateOfferSchema) {}
