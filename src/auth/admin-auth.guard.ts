import { ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN, SUPABASE_CLIENT } from '../supabase/supabase.module';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class AdminAuthGuard extends JwtAuthGuard {
  constructor(
    @Inject(SUPABASE_CLIENT) supabase: SupabaseClient,
    @Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient,
  ) {
    super(supabase);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // First run the JWT auth — throws 401 if missing/invalid, and sets req.user.
    await super.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    // is_admin lives in public.users (the source of truth). The JWT only carries it
    // as a hook-injected claim for RLS; getUser().app_metadata never has it.
    const { data, error } = await this.admin
      .from('users')
      .select('is_admin')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error || !data?.is_admin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
