import { Injectable, Logger } from '@nestjs/common';
import { rng } from './seeded-rng';
import {
  addDays,
  phantomDay,
  phantomEngagement,
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
  startDate: '2026-07-12', // from today onward only
  endDate: undefined, // set a 'YYYY-MM-DD' to freeze history and stop inflating newer days
  factorMin: 1.2,
  factorMax: 1.3,
  baseMin: 14,
  baseMax: 20,
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

  /** Last full Sydney day — the newest day we ever inflate (today is partial). */
  private sydneyYesterday(): string {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
    return addDays(today, -1);
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
    const cap = this.sydneyYesterday();
    return daily.map((row) => {
      if (!this.inflatable(row.day, cap)) return row;
      const ph = phantomDay(row.day, this.params);
      const f = this.factor(row.day);
      const realSessions = Number(row.sessions) || 0;
      const realMedian = Number(row.avg_session_secs) || 0;
      const totalSessions = realSessions + ph.sessions;
      return {
        ...row,
        dau: Math.round((Number(row.dau) || 0) * f + ph.dau),
        sessions: Math.round(realSessions * f + ph.sessions),
        events: Math.round((Number(row.events) || 0) * f + ph.events),
        // new_users (signups) intentionally left real
        avg_session_secs:
          totalSessions > 0
            ? Math.round((realMedian * realSessions + ph.medianSecs * ph.sessions) / totalSessions)
            : realMedian,
      };
    });
  }

  // ---- engagement (DAU/WAU/MAU/stickiness scalars) ----
  applyEngagement(row: EngagementRow, rangeTo: string): EngagementRow {
    const cap = this.sydneyYesterday();
    // The RPC anchors on LEAST(p_to, Sydney yesterday); match it here.
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

  // ---- screens (per-screen totals over a range) ----
  applyScreens(rows: ScreenRow[], from: string, to: string): ScreenRow[] {
    if (!this.enabled || rows.length === 0) return rows;
    const cap = this.sydneyYesterday();
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
    const cap = this.sydneyYesterday();

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
}
