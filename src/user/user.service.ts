import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';
import type { UserProfile } from '../auth/auth.service';
import { UpdateUserDto } from './dto/update-user.dto';

const PROFILE_COLUMNS = 'id, email, name, code, is_admin, created_at';

@Injectable()
export class UserService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) {}

  // is_admin lives in public.users (the source of truth). getUser().app_metadata
  // does NOT carry it, so authorize against the table — matching AdminAuthGuard.
  private async isAdmin(userId: string): Promise<boolean> {
    const { data } = await this.admin
      .from('users')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();
    return data?.is_admin === true;
  }

  private async getProfile(id: string): Promise<UserProfile> {
    const { data, error } = await this.admin
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      code: data.code,
      isAdmin: data.is_admin,
      createdAt: data.created_at,
    };
  }

  async updateById(jwtUser: User, targetId: string, input: UpdateUserDto): Promise<UserProfile> {
    if (jwtUser.id !== targetId && !(await this.isAdmin(jwtUser.id))) {
      throw new ForbiddenException("Cannot update another user's profile");
    }

    // Password change goes through the Auth admin API.
    if (input.password) {
      const { error } = await this.admin.auth.admin.updateUserById(targetId, {
        password: input.password,
      });
      if (error) {
        throw new InternalServerErrorException(`Failed to update password: ${error.message}`);
      }
    }

    // Name change: keep public.users and auth user_metadata in sync.
    if (input.name !== undefined) {
      const { error: profileErr } = await this.admin
        .from('users')
        .update({ name: input.name })
        .eq('id', targetId);
      if (profileErr) {
        throw new InternalServerErrorException(`Failed to update profile: ${profileErr.message}`);
      }

      const { error: metaErr } = await this.admin.auth.admin.updateUserById(targetId, {
        user_metadata: { name: input.name },
      });
      if (metaErr) {
        throw new InternalServerErrorException(`Failed to update auth metadata: ${metaErr.message}`);
      }
    }

    return this.getProfile(targetId);
  }

  async deleteById(jwtUser: User, targetId: string): Promise<{ success: true }> {
    if (jwtUser.id !== targetId && !(await this.isAdmin(jwtUser.id))) {
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
