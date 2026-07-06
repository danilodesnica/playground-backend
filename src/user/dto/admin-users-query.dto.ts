import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Query for the admin member-directory list. search is an optional ILIKE term
// (name / email / postcode); limit/offset are coerced from the querystring and
// bounded. Defaults: limit 50 (max 200), offset 0.
export const AdminUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // Server-side sort over the FULL filtered set (not just the loaded page).
  sort: z
    .enum(['name', 'postcode', 'created_at', 'favorites', 'saved_deals', 'reviews', 'last_active'])
    .default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export class AdminUsersQueryDto extends createZodDto(AdminUsersQuerySchema) {}
