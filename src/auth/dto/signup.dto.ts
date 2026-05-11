import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().trim().min(1),
  postCode: z.string().trim().min(1),
});

export class SignupDto extends createZodDto(SignupSchema) {}
