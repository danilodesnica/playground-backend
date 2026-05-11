import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';

@Injectable()
export class UserService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) {}

  async deleteById(jwtUser: User, targetId: string): Promise<{ success: true }> {
    const isAdmin = ((jwtUser.app_metadata as { is_admin?: boolean } | undefined)?.is_admin) ?? false;
    if (jwtUser.id !== targetId && !isAdmin) {
      throw new ForbiddenException("Cannot delete another user's profile");
    }

    // Dependent records — none of these have ON DELETE CASCADE on user_id, so wipe explicitly.
    const cleanups = await Promise.all([
      this.admin.from('saved_location').delete().eq('user_id', targetId),
      this.admin.from('saved_offers').delete().eq('user_id', targetId),
      this.admin.from('reviews').delete().eq('user_id', targetId),
    ]);

    for (const res of cleanups) {
      if (res.error) {
        throw new InternalServerErrorException(`Failed to clean dependents: ${res.error.message}`);
      }
    }

    // auth.users → cascades to public.users via users_id_auth_fkey ON DELETE CASCADE
    const { error } = await this.admin.auth.admin.deleteUser(targetId);
    if (error) {
      if (error.message.toLowerCase().includes('not found')) {
        throw new NotFoundException(`User ${targetId} not found`);
      }
      throw new InternalServerErrorException(`Failed to delete user: ${error.message}`);
    }

    return { success: true };
  }
}
