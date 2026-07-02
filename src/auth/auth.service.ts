import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import sgMail from '@sendgrid/mail';
import { SUPABASE_ADMIN, SUPABASE_CLIENT } from '../supabase/supabase.module';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  code: string | null;
  isAdmin: boolean;
  createdAt: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient,
    private readonly config: ConfigService,
  ) { }

  async login({ email, password }: LoginDto): Promise<{ authToken: string; refreshToken: string }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session?.access_token) {
      throw new UnauthorizedException(error?.message ?? 'Invalid email or password');
    }

    return {
      authToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  // Exchange a Supabase refresh token for a fresh access token so the mobile app
  // keeps the session alive instead of logging the user out the moment the
  // (short-lived) access token expires.
  async refresh({ refreshToken }: { refreshToken: string }): Promise<{ authToken: string; refreshToken: string }> {
    const { data, error } = await this.supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    return {
      authToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  async signup({ email, password, name, postCode }: SignupDto): Promise<{ authToken: string; refreshToken: string; browse: boolean }> {
    const { error: createErr } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createErr) {
      const msg = createErr.message.toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        throw new ConflictException('A user with this email already exists');
      }
      throw new BadRequestException(createErr.message);
    }

    const { data: signInData, error: signInErr } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signInData?.session?.access_token) {
      throw new InternalServerErrorException('Account created but sign-in failed');
    }

    const { data: match, error: pcErr } = await this.supabase
      .from('post_codes')
      .select('code')
      .eq('code', postCode)
      .limit(1);
    if (pcErr) {
      throw new InternalServerErrorException(`Postcode lookup failed: ${pcErr.message}`);
    }

    return {
      authToken: signInData.session.access_token,
      refreshToken: signInData.session.refresh_token,
      browse: (match?.length ?? 0) > 0,
    };
  }

  async sendResetPasswordEmail({ email }: ResetPasswordDto): Promise<{ success: true }> {
    // Intentionally don't surface whether the email exists or whether SendGrid failed —
    // prevents enumeration attacks. Always return success; log failures server-side.
    try {
      const publicAppUrl = this.config.get<string>('PUBLIC_APP_URL');
      if (!publicAppUrl) {
        console.error('[auth.sendResetPasswordEmail] PUBLIC_APP_URL is not configured');
        return { success: true };
      }
      const { data, error } = await this.admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${publicAppUrl}/reset-password` },
      });

      if (error || !data?.properties?.action_link) {
        console.error('[auth.generateLink]', email, error?.message ?? 'no action_link');
        return { success: true };
      }

      const apiKey = this.config.get<string>('SENDGRID_API_KEY');
      const fromEmail = this.config.get<string>('SENDGRID_FROM_EMAIL');
      const fromName = this.config.get<string>('SENDGRID_FROM_NAME');
      const templateId = this.config.get<string>('SENDGRID_RESET_PASSWORD_TEMPLATE_ID');

      if (!apiKey || !fromEmail || !templateId) {
        console.error('[sendgrid.debug] missing env var(s)');
        return { success: true };
      }

      sgMail.setApiKey(apiKey);
      await sgMail.send({
        to: email,
        from: { email: fromEmail, name: fromName ?? 'Playtime' },
        templateId,
        dynamicTemplateData: { resetPasswordLink: data.properties.action_link },
      });
    } catch (err) {
      const e = err as { code?: number; message?: string; response?: { body?: unknown; headers?: unknown } };
      console.error('[auth.sendResetPasswordEmail]', email, {
        message: e.message,
        code: e.code,
        responseBody: e.response?.body,
      });
    }
    return { success: true };
  }

  async updatePassword({ accessToken, newPassword }: UpdatePasswordDto): Promise<{ success: true }> {
    // The Supabase JS SDK's updateUser() requires an active client session, which we don't have
    // (recovery URL only gives us an access_token, not a refresh_token via the fragment).
    // Call the REST API directly with the user's access token as Bearer auth.
    const supabaseUrl = this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { msg?: string; message?: string; error_description?: string };
      const message = body.msg ?? body.message ?? body.error_description ?? `Failed to update password (HTTP ${res.status})`;
      throw new BadRequestException(message);
    }

    return { success: true };
  }

  async me(userId: string): Promise<UserProfile> {
    const { data, error } = await this.admin
      .from('users')
      .select('id, email, name, code, is_admin, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Profile not found');
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
}
