import { Injectable, Logger } from '@nestjs/common';
import { rng } from './seeded-rng';
import {
  addDays,
  dayProgress,
  phantomDay,
  phantomEngagement,
  phantomRangeTotals,
  phantomScreensRange,
  PhantomParams,
} from './phantom';

/**
 * Read-time Insights inflation overlay.
 *
 * Layers a deterministic phantom-user model on top of the REAL analytics
 * aggregates returned by the SQL RPCs, for engagement metrics only (DAU/WAU/MAU/
 * stickiness, sessions, session length, screens). Never touches app_events, and
 * never inflates signups, favorites, or reviews.
 *
 * Config is hardcoded in INFLATION_CONFIG below — no env / no Render needed.
 * To turn the overlay off, set `enabled: false` there and redeploy. To freeze
 * (keep already-inflated days, stop inflating new ones), set `endDate`.
 *
 * Because everything is recomputed deterministically from the date, turning it
 * off leaves the real data untouched, and turning it back on reproduces the
 * exact same historical inflated numbers.
 */
export interface InflationConfig {
  enabled: boolean;
  startDate: string; // Sydney YYYY-MM-DD; nothing before this is inflated
  endDate?: string; // optional freeze; days >= this stay real, earlier stay inflated
  factorMin: number; // multiplier band applied to the REAL numbers
  factorMax: number;
  baseMin: number; // added daily active users (before seasonality/growth)
  baseMax: number;
}

/**
 * Hardcoded config. Flip `enabled` to turn the overlay on/off in code.
 */
export const INFLATION_CONFIG: InflationConfig = {
  enabled: true, // <-- set to false to disable the Insights inflation overlay
  startDate: '2026-07-13', // from tomorrow onward only (today stays fully real)
  endDate: undefined, // set a 'YYYY-MM-DD' to freeze history and stop inflating newer days
  // Band applied to the REAL numbers. Bumped +20% (was 1.2-1.3) so the real
  // portion of each metric rises with the phantom overlay — see baseMin/baseMax.
  factorMin: 1.44,
  factorMax: 1.56,
  // Phantom daily-active band. Bumped +20% (was 14-20) to lift every inflated
  // metric — DAU, sessions, events, screens, geography — by ~20% across the board.
  baseMin: 17,
  baseMax: 24,
};

interface DailyRow {
  day: string;
  dau: number;
  new_users: number;
  sessions: number;
  events: number;
  avg_session_secs: number;
}
interface EngagementRow {
  dau_yesterday: number;
  wau: number;
  mau: number;
  stickiness: number;
}
export interface ScreenRow {
  screen: string;
  views: number;
  uniq_users: number;
  avg_secs: number;
  total_secs: number;
}
export interface DauVersionRow {
  day: string;
  app_version: string;
  dau: number;
}
export interface GeoRow {
  country: string;
  region: string;
  city: string;
  uniq_users: number;
  sessions: number;
}

@Injectable()
export class InflationService {
  private readonly logger = new Logger(InflationService.name);

  private enabled!: boolean;
  private startDate!: string;
  private endDate?: string;
  private factorMin!: number;
  private factorMax!: number;
  private params!: PhantomParams;

  constructor() {
    this.configure(INFLATION_CONFIG);
  }

  /** Test seam: build an instance with overridden config. */
  static withConfig(overrides: Partial<InflationConfig>): InflationService {
    const svc = new InflationService();
    svc.configure({ ...INFLATION_CONFIG, ...overrides });
    return svc;
  }

  private configure(c: InflationConfig): void {
    this.enabled = c.enabled;
    this.startDate = c.startDate;
    this.endDate = c.endDate;
    this.factorMin = c.factorMin;
    this.factorMax = c.factorMax;
    this.params = { baseMin: c.baseMin, baseMax: c.baseMax, startDate: c.startDate };

    if (this.enabled) {
      this.logger.warn(
        `Insights inflation ACTIVE from ${this.startDate}` +
          (this.endDate ? ` until ${this.endDate}` : '') +
          ` (x${this.factorMin}-${this.factorMax} + ${c.baseMin}-${c.baseMax} base)`,
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Current Sydney day (YYYY-MM-DD) — the newest day the overlay inflates. */
  private sydneyToday(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  }

  /** Current Sydney time as a fractional hour (0-24). */
  private sydneyFractionalHourNow(): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Australia/Sydney',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h + m / 60;
  }

  /** Fraction (0-1) of TODAY's activity that has happened by now (Sydney), for the intraday ramp. */
  private dayProgressNow(): number {
    return dayProgress(this.sydneyFractionalHourNow());
  }

  private inflatable(ds: string, cap: string): boolean {
    return (
      this.enabled &&
      ds >= this.startDate &&
      ds <= cap &&
      (!this.endDate || ds < this.endDate)
    );
  }

  /** Deterministic per-day multiplier in [factorMin, factorMax]. */
  private factor(seed: string): number {
    return this.factorMin + rng(`f:${seed}`)() * (this.factorMax - this.factorMin);
  }

  // ---- overview (per-day time series) ----
  applyOverview(daily: DailyRow[]): DailyRow[] {
    if (!this.enabled) return daily;
    const cap = this.sydneyToday();
    const progress = this.dayProgressNow();
    return daily.map((row) => {
      if (!this.inflatable(row.day, cap)) return row;
      // Today's (incomplete) row ramps by intraday progress; completed days are full.
      const w = row.day === cap ? progress : 1;
      const ph = phantomDay(row.day, this.params);
      const f = this.factor(row.day);
      const realSessions = Number(row.sessions) || 0;
      const realMedian = Number(row.avg_session_secs) || 0;
      const phSessions = ph.sessions * w;
      const totalSessions = realSessions + phSessions;
      return {
        ...row,
        dau: Math.round((Number(row.dau) || 0) * f + ph.dau * w),
        sessions: Math.round(realSessions * f + phSessions),
        events: Math.round((Number(row.events) || 0) * f + ph.events * w),
        // new_users (signups) intentionally left real
        avg_session_secs:
          totalSessions > 0
            ? Math.round((realMedian * realSessions + ph.medianSecs * phSessions) / totalSessions)
            : realMedian,
      };
    });
  }

  // ---- engagement (DAU/WAU/MAU/stickiness scalars) ----
  applyEngagement(row: EngagementRow, rangeTo: string): EngagementRow {
    // DAU is defined as "yesterday" — anchor on LEAST(p_to, Sydney yesterday),
    // even though the per-day charts and the live strip now inflate through today.
    const cap = addDays(this.sydneyToday(), -1);
    const anchor = rangeTo < cap ? rangeTo : cap;
    if (!this.inflatable(anchor, cap)) return row;
    const ph = phantomEngagement(anchor, this.params);
    const f = this.factor(anchor);
    const dau = Math.round((Number(row.dau_yesterday) || 0) * f + ph.dau);
    const wau = Math.round((Number(row.wau) || 0) * f + ph.wau);
    const mau = Math.round((Number(row.mau) || 0) * f + ph.mau);
    // keep stickiness in the RPC's 0-1 unit (the admin scales to %)
    const stickiness = mau > 0 ? Math.round((dau / mau) * 1000) / 1000 : 0;
    return { dau_yesterday: dau, wau, mau, stickiness };
  }

  // ---- today (live current-day counts) ----
  // No "yesterday" cap here — we inflate the CURRENT day, but ramp the phantom
  // contribution by the intraday progress (near 0 overnight, rising ~9am-6pm
  // Sydney) so the live "Today so far" number builds through the day instead of
  // showing the full total at midnight. By end of the Sydney day progress -> 1,
  // so it converges to exactly what this day becomes as "yesterday" tomorrow
  // (the phantom is deterministic per date). `progress` is injectable for tests.
  applyToday(
    counts: { active_users: number; sessions: number; events: number },
    date: string,
    progress: number = this.dayProgressNow(),
  ): { active_users: number; sessions: number; events: number } {
    if (!this.enabled || date < this.startDate || (this.endDate && date >= this.endDate)) {
      return counts;
    }
    const ph = phantomDay(date, this.params);
    const f = this.factor(date);
    return {
      active_users: Math.round((Number(counts.active_users) || 0) * f + ph.dau * progress),
      sessions: Math.round((Number(counts.sessions) || 0) * f + ph.sessions * progress),
      events: Math.round((Number(counts.events) || 0) * f + ph.events * progress),
    };
  }

  // ---- screens (per-screen totals over a range) ----
  applyScreens(rows: ScreenRow[], from: string, to: string): ScreenRow[] {
    if (!this.enabled || rows.length === 0) return rows;
    const cap = this.sydneyToday();
    const fromInfl = from > this.startDate ? from : this.startDate;
    const toInfl = to < cap ? to : cap;
    const toClamped = this.endDate && this.endDate <= toInfl ? addDays(this.endDate, -1) : toInfl;
    if (fromInfl > toClamped) return rows;

    const ph = phantomScreensRange(fromInfl, toClamped, this.params);
    const f = this.factor(`${from}:${to}`);
    const realTotalViews = rows.reduce((s, r) => s + (Number(r.views) || 0), 0);
    if (realTotalViews <= 0) return rows; // don't invent screen names

    return rows.map((r) => {
      const realViews = Number(r.views) || 0;
      const share = realViews / realTotalViews;
      const views = Math.round(realViews * f + ph.views * share);
      const avgSecs = Number(r.avg_secs) || 0;
      return {
        ...r,
        views,
        uniq_users: Math.round((Number(r.uniq_users) || 0) * f + ph.uniqUsers * share),
        // dwell per screen stays real; keep total consistent with inflated views
        total_secs: Math.round(views * avgSecs),
      };
    });
  }

  // ---- DAU by version (per-day, per-version) ----
  applyDauByVersion(rows: DauVersionRow[]): DauVersionRow[] {
    if (!this.enabled || rows.length === 0) return rows;
    const cap = this.sydneyToday();

    // group indices by day so we can add phantom DAU to the dominant version
    const byDay = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const arr = byDay.get(r.day);
      if (arr) arr.push(i);
      else byDay.set(r.day, [i]);
    });

    const out = rows.map((r) => ({ ...r, dau: Number(r.dau) || 0 }));
    for (const [day, idxs] of byDay) {
      if (!this.inflatable(day, cap)) continue;
      const f = this.factor(day);
      for (const i of idxs) out[i].dau = Math.round(out[i].dau * f);
      // add the phantom DAU to the newest real version bucket that day
      let target = idxs[0];
      for (const i of idxs) {
        const v = out[i].app_version;
        if (v !== 'unknown' && v > out[target].app_version) target = i;
      }
      out[target].dau += phantomDay(day, this.params).dau;
    }
    return out;
  }

  // ---- geography (IP-derived, over a range) ----
  applyGeo(rows: GeoRow[], from: string, to: string): GeoRow[] {
    if (!this.enabled) return rows;
    const cap = this.sydneyToday();
    const fromInfl = from > this.startDate ? from : this.startDate;
    const toInfl = to < cap ? to : cap;
    const toClamped = this.endDate && this.endDate <= toInfl ? addDays(this.endDate, -1) : toInfl;
    if (fromInfl > toClamped) return rows;

    const { users, sessions } = phantomRangeTotals(fromInfl, toClamped, this.params);
    if (users <= 0) return rows;

    const keyOf = (r: { country: string; region: string; city: string }) =>
      `${r.country}|${r.region}|${r.city}`;
    const merged = new Map<string, GeoRow>();
    for (const r of rows) {
      merged.set(keyOf(r), {
        country: r.country,
        region: r.region,
        city: r.city,
        uniq_users: Number(r.uniq_users) || 0,
        sessions: Number(r.sessions) || 0,
      });
    }
    for (const g of distributeGeo(users, sessions)) {
      const existing = merged.get(keyOf(g));
      if (existing) {
        existing.uniq_users += g.uniq_users;
        existing.sessions += g.sessions;
      } else {
        merged.set(keyOf(g), g);
      }
    }
    return [...merged.values()].sort((a, b) => b.uniq_users - a.uniq_users).slice(0, 100);
  }
}

/**
 * Weighted Sydney-area location spread for phantom users (family-outings app →
 * NSW/Sydney-metro heavy, with a light interstate tail). Country/region/city
 * mirror the shape real fast-geoip enrichment would produce (AU / NSW / city).
 */
const GEO_DIST: Array<{ country: string; region: string; city: string; weight: number }> = [
  { country: 'AU', region: 'NSW', city: 'Sydney', weight: 34 },
  { country: 'AU', region: 'NSW', city: 'Parramatta', weight: 10 },
  { country: 'AU', region: 'NSW', city: 'Penrith', weight: 7 },
  { country: 'AU', region: 'NSW', city: 'Liverpool', weight: 6 },
  { country: 'AU', region: 'NSW', city: 'Blacktown', weight: 6 },
  { country: 'AU', region: 'NSW', city: 'Sutherland', weight: 5 },
  { country: 'AU', region: 'NSW', city: 'Newcastle', weight: 4 },
  { country: 'AU', region: 'NSW', city: 'Hornsby', weight: 4 },
  { country: 'AU', region: 'NSW', city: 'Chatswood', weight: 4 },
  { country: 'AU', region: 'NSW', city: 'Manly', weight: 3 },
  { country: 'AU', region: 'NSW', city: 'Cronulla', weight: 3 },
  { country: 'AU', region: 'NSW', city: 'Bondi Junction', weight: 3 },
  { country: 'AU', region: 'NSW', city: 'Wollongong', weight: 3 },
  { country: 'AU', region: 'NSW', city: 'Gosford', weight: 2 },
  { country: 'AU', region: 'VIC', city: 'Melbourne', weight: 2 },
  { country: 'AU', region: 'QLD', city: 'Brisbane', weight: 2 },
];

/** Allocate `totalUsers` across GEO_DIST by weight (largest-remainder rounding). */
function distributeGeo(totalUsers: number, totalSessions: number): GeoRow[] {
  const sumW = GEO_DIST.reduce((s, g) => s + g.weight, 0);
  const rows = GEO_DIST.map((g) => {
    const exact = (totalUsers * g.weight) / sumW;
    const floor = Math.floor(exact);
    return { ...g, u: floor, rem: exact - floor };
  });
  let remaining = totalUsers - rows.reduce((s, r) => s + r.u, 0);
  rows.sort((a, b) => b.rem - a.rem);
  for (let i = 0; remaining > 0 && rows.length > 0; i++, remaining--) rows[i % rows.length].u += 1;
  const perUser = totalUsers > 0 ? totalSessions / totalUsers : 1.3;
  return rows
    .filter((r) => r.u > 0)
    .map((r) => ({
      country: r.country,
      region: r.region,
      city: r.city,
      uniq_users: r.u,
      sessions: Math.max(r.u, Math.round(r.u * perUser)),
    }));
}
