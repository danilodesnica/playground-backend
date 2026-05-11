import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';
export const SUPABASE_ADMIN = 'SUPABASE_ADMIN';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient => {
        const url = config.getOrThrow<string>('SUPABASE_URL');
        const anonKey = config.getOrThrow<string>('SUPABASE_ANON_KEY');
        return createClient(url, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      },
    },
    {
      provide: SUPABASE_ADMIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient => {
        const url = config.getOrThrow<string>('SUPABASE_URL');
        const serviceKey = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
        return createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      },
    },
  ],
  exports: [SUPABASE_CLIENT, SUPABASE_ADMIN],
})
export class SupabaseModule {}
