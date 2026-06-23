import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePasswordSchema = z.object({
  accessToken: z.string().min(20),
  newPassword: z.string().min(8),
});

export class UpdatePasswordDto extends createZodDto(UpdatePasswordSchema) {}
