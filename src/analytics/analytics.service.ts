import {
  BadRequestException,
  HttpException,
  HttpStatus,
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

/** Ingest rate limit: max batches per IP per fixed window. */
const INGEST_MAX_BATCHES_PER_WINDOW = 60;
const INGEST_WINDOW_MS = 60_000;
/** Above this many tracked IPs, expired windows are swept on the next hit. */
const INGEST_MAP_SWEEP_THRESHOLD = 10_000;

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

export interface LifetimeRow {
  total_users: number;
  total_favorites: number;
  total_reviews_approved: number;
  avg_rating: number;
  live_locations: number;
  pending_reviews: number;
}

export interface EngagementRow {
  dau_yesterday: number;
  wau: number;
  mau: number;
  stickiness: number;
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

  /** Fixed-window per-IP ingest counters (in-memory; per-instance by design). */
  private readonly ingestWindows = new Map<string, { count: number; windowStart: number }>();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient,
  ) {}

  /** Throws 429 when an IP exceeds INGEST_MAX_BATCHES_PER_WINDOW in the current window. */
  private checkIngestRateLimit(ip: string): void {
    const now = Date.now();

    // Opportunistic sweep so the map can't grow unbounded under IP churn.
    if (this.ingestWindows.size > INGEST_MAP_SWEEP_THRESHOLD) {
      for (const [key, w] of this.ingestWindows) {
        if (now - w.windowStart >= INGEST_WINDOW_MS) this.ingestWindows.delete(key);
      }
    }

    const window = this.ingestWindows.get(ip);
    if (!window || now - window.windowStart >= INGEST_WINDOW_MS) {
      this.ingestWindows.set(ip, { count: 1, windowStart: now });
      return;
    }

    window.count += 1;
    if (window.count > INGEST_MAX_BATCHES_PER_WINDOW) {
      throw new HttpException('Too many event batches, slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // ---------------------------------------------------------------------------
  // Ingest
  // ---------------------------------------------------------------------------

  async ingest(
    body: EventsBatchDto,
    authHeader: string | undefined,
    ip: string | undefined,
  ): Promise<{ accepted: number }> {
    this.checkIngestRateLimit(ip || 'unknown');

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
  // Admin analytics (RPC wrappers over the SQL functions in migrations 0010/0011)
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

  // --- Insights v2: historical / database-wide queries (migration 0011) -------

  /** All-time KPI row from the operational tables (not the pixel). */
  async lifetime(): Promise<LifetimeRow> {
    const rows = await this.rpc<LifetimeRow[]>('analytics_lifetime');
    return (
      rows[0] ?? {
        total_users: 0,
        total_favorites: 0,
        total_reviews_approved: 0,
        avg_rating: 0,
        live_locations: 0,
        pending_reviews: 0,
      }
    );
  }

  /** All-time monthly signups (Sydney months) from users.created_at. */
  async signupsMonthly(): Promise<unknown> {
    return this.rpc('analytics_signups_monthly');
  }

  /** All-time most favorited locations (saved_location). */
  async topFavorited(limit = 50): Promise<unknown> {
    return this.rpc('analytics_top_favorited', { p_limit: limit });
  }

  /** All-time most clicked locations (server-tracked user_interaction). */
  async topClicked(limit = 50): Promise<unknown> {
    return this.rpc('analytics_top_clicked', { p_limit: limit });
  }

  /** Daily distinct active users from user_interaction (server-tracked, pre-pixel history). */
  async historicalActives(from?: string, to?: string): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_historical_actives', { p_from: range.from, p_to: range.to });
  }

  /** Live locations with zero saves and zero interactions, oldest first. */
  async deadInventory(): Promise<unknown> {
    return this.rpc('analytics_dead_inventory');
  }

  /** All-time monthly review volume + average rating (avg over approved only). */
  async reviewsTrend(): Promise<unknown> {
    return this.rpc('analytics_reviews_trend');
  }

  /** Signup postcode distribution (users.code, suburb label from post_codes). */
  async postcodes(limit = 30): Promise<unknown> {
    return this.rpc('analytics_postcodes', { p_limit: limit });
  }

  /** DAU/WAU/MAU + stickiness from the pixel, anchored on the requested end date. */
  async engagement(from?: string, to?: string): Promise<EngagementRow> {
    const range = resolveRange(from, to);
    const rows = await this.rpc<EngagementRow[]>('analytics_engagement', {
      p_from: range.from,
      p_to: range.to,
    });
    return rows[0] ?? { dau_yesterday: 0, wau: 0, mau: 0, stickiness: 0 };
  }

  /** Per-day DAU split by app version (pixel). */
  async dauByVersion(from?: string, to?: string): Promise<unknown> {
    const range = resolveRange(from, to);
    return this.rpc('analytics_dau_by_version', { p_from: range.from, p_to: range.to });
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
