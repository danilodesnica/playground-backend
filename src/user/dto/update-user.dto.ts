import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  // Min 8 to match the mobile client's signup/edit validation.
  password: z.string().min(8).optional(),
  // Home postcode, stored on users.code. Same shape signup accepts. Members
  // could set this when they registered but never change it afterwards, which
  // meant a house move needed a support request.
  postCode: z.string().trim().min(1).optional(),
});

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
