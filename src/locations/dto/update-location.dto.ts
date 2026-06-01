import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { imageMetaSchema } from './create-location.dto';

// Partial update: every field is optional (omitted = leave unchanged). Clearable
// columns also accept null (explicit null = set the column to NULL).
export const UpdateLocationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  placePosition: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  type: z.enum(['playground', 'event']).optional(),
  url: z.url().nullable().optional(),
  endDate: z.string().trim().min(1).nullable().optional(),
  // Accept a real array or a JSON-encoded string (same idiom as create); null clears it.
  tags: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }, z.array(z.string()).nullable().optional()),
  imgUrl: imageMetaSchema.nullable().optional(),
  previewImg: z.array(imageMetaSchema).nullable().optional(),
});

export class UpdateLocationDto extends createZodDto(UpdateLocationSchema) {}
