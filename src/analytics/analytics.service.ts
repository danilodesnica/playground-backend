import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import geoip from 'fast-geoip';
import { SUPABASE_ADMIN, SUPABASE_CLIENT } from '../supabase/supabase.module';
import { EventsBatchDto } from './dto/events-batch.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Serialized props larger than this are dropped (replaced with {}) to keep rows bounded. */
const MAX_PROPS_JSON_LENGTH = 4000;

export interface DailyRow {
  day: string;
  dau: number;
  new_users: number;
  sessions: number;
  events: number;
  avg_session_secs: number;
}

export interface OverviewResponse {
  daily: DailyRow[];
  totals: {
    events: number;
    sessions: number;
    newUsers: number;
    avgSessionSecs: number;
  };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Defaults: from = 28 days ago, to = today (YYYY-MM-DD). */
function resolveRange(from?: string, to?: string): { from: string; to: string } {
  const now = new Date();
  return {
    from: from ?? toDateString(new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)),
    to: to ?? toDateString(now),
  };
}

/** A garbage client timestamp must not 500 the whole batch — fall back to null. */
function toClientTs(ts: number): string | null {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient,
  ) {}

  // ---------------------------------------------------------------------------
  // Ingest
  // ---------------------------------------------------------------------------

  async ingest(
    body: EventsBatchDto,
    authHeader: string | undefined,
    ip: string | undefined,
  ): Promise<{ accepted: number }> {
    // Soft user attribution — mirrors JwtAuthGuard token handling, but a bad or
    // expired token NEVER rejects the batch; we just fall back to anonymous.
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        try {
          const { data, error } = await this.supabase.auth.getUser(token);
          if (!error && data?.user) {
            userId = data.user.id;
          }
        } catch {
          // proceed as anonymous
        }
      }
    }

    // IP geo enrichment — one lookup per batch; any failure leaves geo null.
    let country: string | null = null;
    let region: string | null = null;
    let city: string | null = null;
    if (ip) {
      try {
        const geo = await geoip.lookup(ip);
        country = geo?.country || null;
        region = geo?.region || null;
        city = geo?.city || null;
      } catch {
        // leave geo fields null
      }
    }

    const rows = body.events.map((e) => {
      let props: Record<string, unknown> = e.props ?? {};
      try {
        if (JSON.stringify(props).length > MAX_PROPS_JSON_LENGTH) props = {};
      } catch {
        props = {}; // circular / non-serializable props
      }
      return {
        client_ts: toClientTs(e.ts),
        anon_id: body.anonId,
        user_id: userId,
        session_id: body.sessionId,
        event: e.event,
        screen: e.screen ?? null,
        props,
        app_version: body.appVersion ?? null,
        platform: body.platform ?? null,
        os_version: body.osVersion ?? null,
        device_model: body.deviceModel ?? null,
        country,
        region,
        city,
      };
    });

    const { error } = await this.admin.from('app_events').insert(rows);
    if (error) {
      this.logger.error(`Failed to insert analytics batch: ${error.message}`);
      throw new InternalServerErrorException(`Failed to record events: ${error.message}`);
    }

    return { accepted: body.events.length };
  }

  // ---------------------------------------------------------------------------
  // Admin analytics (RPC wrappers over the SQL functions in migration 0010)
  // ---------------------------------------------------------------------------

  private async rpc<T>(name: string, params?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.admin.rpc(name, params);
    if (error) {
      this.logger.error(`RPC ${name} failed: ${error.message}`);
      throw new InternalServerErrorException(`Analytics query failed: ${error.message}`);
    }
    return (data ?? []) as T;
  }

  async overview(from?: string, to?: string): Promise<OverviewResponse> {
    const range = resolveRange(from, to);
    const daily = await this.rpc<DailyRow[]>('analytics_daily', {
      p_from: range.from,
      p_to: range.to,
    });

    let events = 0;
    let sessions = 0;
    let newUsers = 0;
    let weightedSecs = 0;
    for (const d of daily) {
      const daySessions = Number(d.sessions) || 0;
      events += Number(d.events) || 0;
      sessions += daySessions;
      newUsers += Number(d.new_users) || 0;
      weightedSecs += (Number(d.avg_session_secs) || 0) * daySessions;
    }
    const avgSessionSecs = sessions > 0 ? Math.round(weightedSecs / sessions) : 0;

    return { daily, totals: { events, sessions, newUsers, avgSessionSecs } };
  }

  async screens(from?: string, to?: string): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_screens', { p_from: range.from, p_to: range.to });
  }

  async geo(from?: string, to?: string): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_geo', { p_from: range.from, p_to: range.to });
  }

  async topLocations(from?: string, to?: string): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_top_locations', { p_from: range.from, p_to: range.to });
  }

  async searches(from?: string, to?: string): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_searches', { p_from: range.from, p_to: range.to });
  }

  async retention(): Promise<unknown> {
    return this.rpc('analytics_retention');
  }

  async users(from?: string, to?: string, limit = 100): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_users', {
      p_from: range.from,
      p_to: range.to,
      p_limit: limit,
    });
  }

  /** Recent raw events for one identity — a user uuid or an anon install id. */
  async userEvents(ident: string): Promise<unknown> {
    const isUuid = UUID_RE.test(ident);
    if (!isUuid && !IDENT_RE.test(ident)) {
      throw new BadRequestException(
        'ident must be a uuid or a 1-64 char id of [A-Za-z0-9_-]',
      );
    }

    let query = this.admin
      .from('app_events')
      .select('received_at, event, screen, props, session_id, platform, app_version, city');

    // Comparing a non-uuid string against the uuid user_id column throws in
    // postgres, so only use the .or() when ident actually is a uuid.
    query = isUuid
      ? query.or(`user_id.eq.${ident},anon_id.eq.${ident}`)
      : query.eq('anon_id', ident);

    const { data, error } = await query
      .order('received_at', { ascending: false })
      .limit(300);

    if (error) {
      this.logger.error(`Failed to fetch events for ${ident}: ${error.message}`);
      throw new InternalServerErrorException(`Failed to fetch user events: ${error.message}`);
    }

    return data ?? [];
  }
}
