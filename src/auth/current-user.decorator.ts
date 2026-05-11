import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { AuthenticatedRequest } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);

export const AccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().accessToken;
  },
);
