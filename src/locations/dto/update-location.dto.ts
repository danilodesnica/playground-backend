import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { imageMetaSchema } from './create-location.dto';

// Partial update: every field is optional (omitted = leave unchanged). Clearable
// columns also accept null (explicit null = set the column to NULL).
// Treat an empty/whitespace string as "no value" for nullable columns — the admin
// form round-trips existing rows, and legacy rows legitimately hold '' (e.g. a
// location in no homepage rail has category ''). Rejecting those made EVERY save
// of an uncategorized location fail wholesale.
const emptyToNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? null : v;

export const UpdateLocationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  // '' allowed: legacy rows can hold an empty description (column is NOT NULL).
  description: z.string().trim().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  placePosition: z.string().trim().min(1).optional(),
  // '' allowed: uncategorized = not featured in any homepage rail.
  category: z.string().trim().optional(),
  type: z.enum(['playground', 'event']).optional(),
  url: z.preprocess(emptyToNull, z.url().nullable().optional()),
  endDate: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
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
  // Optional "nearest cafe" (all nullable; explicit null clears the column).
  cafeName: z.string().trim().min(1).nullable().optional(),
  cafeSubtitle: z.string().trim().min(1).nullable().optional(),
  cafeImageUrl: z.string().trim().min(1).nullable().optional(),
  cafeDirectionsUrl: z.string().trim().min(1).nullable().optional(),
});

export class UpdateLocationDto extends createZodDto(UpdateLocationSchema) {}
