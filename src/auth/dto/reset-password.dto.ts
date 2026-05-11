import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ResetPasswordSchema = z.object({
  email: z.email(),
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) { }
