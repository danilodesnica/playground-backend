import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { Request } from 'express';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface AuthenticatedRequest extends Request {
  user: User;
  accessToken: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) { }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header) {
      throw new UnauthorizedException('Missing Authorization header');
    }
    // Accept both "Bearer <token>" (HTTP spec) and a raw "<token>" (mobile clients sometimes omit the prefix).
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedException('Empty token');
    }

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedException(error?.message ?? 'Invalid or expired token');
    }

    req.user = data.user;
    req.accessToken = token;
    return true;
  }
}
