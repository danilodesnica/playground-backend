import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  // Min 8 to match the mobile client's signup/edit validation.
  password: z.string().min(8).optional(),
});

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
