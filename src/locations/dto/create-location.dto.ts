import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Images are uploaded to Supabase Storage by the frontend; the body carries the
// resulting metadata. Shape matches what the migration writes: { path, name, size, mime, url }.
export const imageMetaSchema = z.looseObject({
  path: z.string().optional(),
  name: z.string().optional(),
  size: z.number().optional(),
  mime: z.string().optional(),
  url: z.url(),
});

export const CreateLocationSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  placePosition: z.string().trim().min(1),
  category: z.string().trim().min(1),
  type: z.enum(['playground', 'event']),
  url: z.url().optional(),
  // ISO date string (YYYY-MM-DD); maps to the nullable end_date column.
  endDate: z.string().trim().min(1).optional(),
  // Accept either a real array or a JSON-encoded string (same idiom as the filter query DTO).
  tags: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }, z.array(z.string()).optional()),
  imgUrl: imageMetaSchema.optional(),
  previewImg: z.array(imageMetaSchema).optional(),
  // Optional "nearest cafe" (all nullable; a non-empty string or null/omitted).
  cafeName: z.string().trim().min(1).nullable().optional(),
  cafeSubtitle: z.string().trim().min(1).nullable().optional(),
  cafeImageUrl: z.string().trim().min(1).nullable().optional(),
  cafeDirectionsUrl: z.string().trim().min(1).nullable().optional(),
});

export class CreateLocationDto extends createZodDto(CreateLocationSchema) {}
