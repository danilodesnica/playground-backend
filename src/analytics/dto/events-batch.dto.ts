import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EventsBatchSchema = z.object({
  anonId: z.string().trim().min(1).max(64),
  sessionId: z.string().trim().min(1).max(64),
  appVersion: z.string().max(32).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  osVersion: z.string().max(32).optional(),
  deviceModel: z.string().max(64).optional(),
  events: z
    .array(
      z.object({
        event: z.string().trim().min(1).max(64),
        screen: z.string().max(128).optional(),
        ts: z.number(),
        props: z.record(z.string(), z.any()).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export class EventsBatchDto extends createZodDto(EventsBatchSchema) {}
