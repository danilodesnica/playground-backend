import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';

/**
 * Keeps the Klaviyo "App users" list equal to the set of app accounts.
 *
 * Two paths feed it. Signup pushes the new account straight away, so the list
 * is current to the minute. A reconciler runs on boot and then on an interval,
 * reads the list back, and subscribes anyone the database has that Klaviyo
 * does not — which is the one-off backfill on first deploy and, forever after,
 * the safety net for a push that failed (Klaviyo down, deploy mid-request).
 *
 * Consent is recorded as SUBSCRIBED with `consented_at` set to the account's
 * creation time: that is the moment the person accepted the Terms. The list
 * must be single opt-in in Klaviyo, or every import triggers a confirmation
 * email.
 *
 * Without a private key the service is inert and says so once at boot, so a
 * local run never touches the real list.
 */

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  code: string | null;
  created_at: string;
}

interface KlaviyoProfileAttributes {
  email: string;
  first_name?: string;
  last_name?: string;
  properties: Record<string, string | null>;
}

const API = 'https://a.klaviyo.com/api';
const REVISION = '2024-10-15';
/** Klaviyo caps a subscription job at 1000 profiles; 100 keeps each request small. */
const SUBSCRIBE_BATCH = 100;
/** Bulk import accepts 10,000 profiles per job. */
const IMPORT_BATCH = 5000;
const DEFAULT_LIST_ID = 'RMcGnC';
const DEFAULT_INTERVAL_MINUTES = 30;
const BOOT_DELAY_MS = 20_000;

@Injectable()
export class KlaviyoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(KlaviyoService.name);
  private readonly apiKey: string | undefined;
  private readonly listId: string;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private reconciling = false;
  /**
   * Emails Klaviyo refused to backdate — people who unsubscribed from an
   * earlier list. They are not on this list and must not be put back on it,
   * so they would otherwise show up as "missing" on every pass.
   */
  private readonly refused = new Map<string, string>();
  private lastRun: {
    at: string;
    users: number;
    inList: number;
    subscribed: number;
    refused: number;
    error?: string;
  } | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient,
  ) {
    this.apiKey = this.config.get<string>('KLAVIYO_PRIVATE_API_KEY') || undefined;
    this.listId = this.config.get<string>('KLAVIYO_LIST_ID') || DEFAULT_LIST_ID;
    const minutes = Number(this.config.get<string>('KLAVIYO_SYNC_INTERVAL_MINUTES')) || DEFAULT_INTERVAL_MINUTES;
    this.intervalMs = minutes * 60_000;
  }

  get enabled(): boolean {
    return !!this.apiKey;
  }

  get status() {
    return {
      enabled: this.enabled,
      listId: this.listId,
      intervalMinutes: this.intervalMs / 60_000,
      lastRun: this.lastRun,
      refused: Object.fromEntries(this.refused),
    };
  }

  onModuleInit() {
    if (!this.enabled) {
      this.log.warn('KLAVIYO_PRIVATE_API_KEY not set — Klaviyo sync is off');
      return;
    }
    // A short delay keeps the boot path quick and lets the first health check pass.
    this.bootTimer = setTimeout(() => void this.reconcile(), BOOT_DELAY_MS);
    this.timer = setInterval(() => void this.reconcile(), this.intervalMs);
    this.log.log(`Klaviyo sync on — list ${this.listId}, reconciling every ${this.intervalMs / 60_000} min`);
  }

  onModuleDestroy() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  // ── Single-user paths ─────────────────────────────────────────────────────

  /** Upsert the profile and subscribe it. Callers should not await this on a hot path. */
  async syncUser(user: AppUser): Promise<void> {
    if (!this.enabled) return;
    const email = normaliseEmail(user.email);
    if (!email) return;
    try {
      await this.post('/profile-import/', {
        data: { type: 'profile', attributes: toProfileAttributes(user) },
      });
      await this.subscribe([user], { historical: false });
      this.log.log(`synced ${email}`);
    } catch (err) {
      // The reconciler will pick this account up on its next pass.
      this.log.error(`sync failed for ${email}: ${(err as Error).message}`);
    }
  }

  /** Withdraw marketing consent and drop the profile from the list. */
  async removeUser(email: string): Promise<void> {
    if (!this.enabled) return;
    const clean = normaliseEmail(email);
    if (!clean) return;
    try {
      await this.post('/profile-subscription-bulk-delete-jobs/', {
        data: {
          type: 'profile-subscription-bulk-delete-job',
          attributes: {
            profiles: {
              data: [{ type: 'profile', attributes: { email: clean } }],
            },
          },
          relationships: { list: { data: { type: 'list', id: this.listId } } },
        },
      });
      this.log.log(`unsubscribed ${clean}`);
    } catch (err) {
      this.log.error(`unsubscribe failed for ${clean}: ${(err as Error).message}`);
    }
  }

  // ── Reconciler ────────────────────────────────────────────────────────────

  /**
   * Bring the list up to the database. Idempotent, safe to run any time; a
   * run that overlaps a running one is skipped rather than queued.
   */
  async reconcile(): Promise<void> {
    if (!this.enabled || this.reconciling) return;
    this.reconciling = true;
    const at = new Date().toISOString();
    try {
      const [users, inList] = await Promise.all([this.allUsers(), this.listEmails()]);
      const missing = users.filter((u) => {
        const e = normaliseEmail(u.email);
        return !inList.has(e) && !this.refused.has(e);
      });
      this.log.log(
        `reconcile: ${users.length} accounts, ${inList.size} in list, ${this.refused.size} refused earlier, ${missing.length} to add`,
      );

      let subscribed = 0;
      if (missing.length) {
        for (const chunk of chunks(missing, IMPORT_BATCH)) await this.bulkImport(chunk);
        for (const chunk of chunks(missing, SUBSCRIBE_BATCH)) {
          subscribed += await this.subscribeHistorical(chunk);
        }
      }
      if (this.refused.size) {
        this.log.warn(`${this.refused.size} account(s) not added: previously unsubscribed in Klaviyo`);
      }
      this.lastRun = { at, users: users.length, inList: inList.size, subscribed, refused: this.refused.size };
    } catch (err) {
      const message = (err as Error).message;
      this.log.error(`reconcile failed: ${message}`);
      this.lastRun = { at, users: 0, inList: 0, subscribed: 0, refused: this.refused.size, error: message };
    } finally {
      this.reconciling = false;
    }
  }

  private async allUsers(): Promise<AppUser[]> {
    const out: AppUser[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await this.admin
        .from('users')
        .select('id, email, name, code, created_at')
        .order('created_at', { ascending: true })
        .range(from, from + page - 1);
      if (error) throw new Error(`users query: ${error.message}`);
      out.push(...((data ?? []) as AppUser[]));
      if (!data || data.length < page) break;
    }
    return out.filter((u) => !!normaliseEmail(u.email));
  }

  private async listEmails(): Promise<Set<string>> {
    const emails = new Set<string>();
    let url: string | null = `${API}/lists/${this.listId}/profiles/?fields[profile]=email&page[size]=100`;
    while (url) {
      const body = (await this.request('GET', url)) as {
        data?: Array<{ attributes?: { email?: string } }>;
        links?: { next?: string | null };
      };
      for (const p of body.data ?? []) {
        const e = normaliseEmail(p.attributes?.email);
        if (e) emails.add(e);
      }
      url = body.links?.next ?? null;
    }
    return emails;
  }

  private async bulkImport(users: AppUser[]): Promise<void> {
    await this.post('/profile-bulk-import-jobs/', {
      data: {
        type: 'profile-bulk-import-job',
        attributes: {
          profiles: { data: users.map((u) => ({ type: 'profile', attributes: toProfileAttributes(u) })) },
        },
      },
    });
  }

  /**
   * A historical batch is all-or-nothing on Klaviyo's side: one profile it
   * refuses (consent older than a recorded unsubscribe) fails the whole
   * request, and the error names the offending index. Peel that profile
   * off, remember why, and send the rest again. Returns how many went in.
   */
  private async subscribeHistorical(batch: AppUser[]): Promise<number> {
    let pending = batch;
    while (pending.length) {
      try {
        await this.subscribe(pending, { historical: true });
        return pending.length;
      } catch (err) {
        const refusal = err instanceof KlaviyoError ? err.refusedIndex() : null;
        if (refusal === null) throw err;
        const { index, reason } = refusal;
        const user = pending[index];
        if (!user) throw err;
        this.refused.set(normaliseEmail(user.email), reason);
        pending = pending.filter((_, i) => i !== index);
      }
    }
    return 0;
  }

  /**
   * Klaviyo draws a line between the two kinds of subscribe. A historical
   * import MUST carry the past `consented_at` (the signup moment, when the
   * Terms were accepted); a live subscribe MUST NOT carry one — consent is
   * now. Sending a timestamp without the flag is a 400.
   */
  private async subscribe(users: AppUser[], { historical }: { historical: boolean }): Promise<void> {
    await this.post('/profile-subscription-bulk-create-jobs/', {
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          custom_source: 'Ask Andee app',
          historical_import: historical,
          profiles: {
            data: users.map((u) => ({
              type: 'profile',
              attributes: {
                email: normaliseEmail(u.email),
                subscriptions: {
                  email: {
                    marketing: historical
                      ? { consent: 'SUBSCRIBED', consented_at: consentedAt(u.created_at) }
                      : { consent: 'SUBSCRIBED' },
                  },
                },
              },
            })),
          },
        },
        relationships: { list: { data: { type: 'list', id: this.listId } } },
      },
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', `${API}${path}`, body);
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        revision: REVISION,
        accept: 'application/vnd.api+json',
        ...(body ? { 'content-type': 'application/vnd.api+json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      // One polite retry after the window Klaviyo asks for.
      const wait = Number(res.headers.get('retry-after') ?? '5') * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.request(method, url, body);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new KlaviyoError(method, url, res.status, text);
    }
    if (res.status === 202 || res.status === 204) return {};
    return res.json();
  }
}

/** A non-2xx from Klaviyo, keeping the body so callers can read the JSON:API errors. */
export class KlaviyoError extends Error {
  constructor(
    method: string,
    url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${url} → ${status} ${body.slice(0, 300)}`);
  }

  /**
   * For a bulk job Klaviyo points at the profile it objects to:
   * `/data/attributes/profiles/data/<index>/...`. Returns that index and the
   * human reason, or null when the error is about something else.
   */
  refusedIndex(): { index: number; reason: string } | null {
    if (this.status !== 400) return null;
    try {
      const parsed = JSON.parse(this.body) as { errors?: Array<{ detail?: string; source?: { pointer?: string } }> };
      const first = parsed.errors?.[0];
      const m = first?.source?.pointer?.match(/\/profiles\/data\/(\d+)\//);
      if (!m) return null;
      return { index: Number(m[1]), reason: first?.detail ?? 'refused' };
    } catch {
      return null;
    }
  }
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

export function normaliseEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim().toLowerCase();
  return e.includes('@') ? e : '';
}

export function splitName(name: string | null | undefined): { first_name?: string; last_name?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function toProfileAttributes(user: AppUser): KlaviyoProfileAttributes {
  return {
    email: normaliseEmail(user.email),
    ...splitName(user.name),
    properties: {
      app_user_id: user.id,
      postcode: user.code || null,
      app_signed_up_at: user.created_at,
      source: 'Ask Andee app',
    },
  };
}

/**
 * Klaviyo refuses a consent timestamp in the future and treats a missing one
 * as "now"; an account row always predates the sync, so its creation time is
 * both accurate and safe.
 */
export function consentedAt(createdAt: string): string {
  const ms = Date.parse(createdAt);
  const safe = Number.isNaN(ms) ? Date.now() : Math.min(ms, Date.now());
  return new Date(safe).toISOString();
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
