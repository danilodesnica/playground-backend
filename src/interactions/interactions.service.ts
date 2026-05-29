import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';

export type InteractionType = 'click' | 'favorite';

@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) {}

  // Fire-and-forget. Caller MUST NOT await — a tracking failure should never affect
  // the user-facing response. We log failures so they show up in monitoring.
  track(userId: string, locationId: string, type: InteractionType): void {
    void this.admin
      .from('user_interaction')
      .insert({
        user_id: userId,
        location_id: locationId,
        interaction_type: type,
      })
      .then(({ error }) => {
        if (error) {
          this.logger.warn(
            `track(${type}) failed for user=${userId} location=${locationId}: ${error.message}`,
          );
        }
      });
  }
}
