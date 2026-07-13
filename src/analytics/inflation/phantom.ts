/**
 * Phantom-user model for the Insights inflation overlay.
 *
 * A fixed pool of synthetic users with heterogeneous "intensity" is activated
 * per Sydney day, weighted by weekday seasonality and a gentle growth trend.
 * Each active phantom generates realistic sessions (log-normal length, screens
 * correlated with length). WAU/MAU/stickiness fall out of the day-to-day
 * overlap of the active sets, so they read like real retention rather than a
 * flat multiplier.
 *
 * Pure + deterministic: keyed only off the Sydney date string and the pool
 * index. Constants below were tuned (scratchpad/tune.mjs) so that at small
 * scale DAU lands ~14-27 with weekend peaks, steady-state stickiness ~0.29,
 * sessions ~= DAU x 1.3, and median session length ~130-190s.
 *
 * IMPORTANT: this never touches app_events. It is layered onto real aggregates
 * at read time in InflationService.
 */

import { gauss, rng } from './seeded-rng';

// ---- tuned constants (see scratchpad/tune.mjs) ----
const POOL = 240; // phantom pool size (must exceed steady-state MAU)
const GAMMA = 1.5; // intensity skew (higher = fewer regulars)
const GROWTH_PER_WEEK = 0.03; // gentle, visibly-cumulative week-over-week climb
const GROWTH_CAP = 2.0;
const RETENTION_MIX = 0.32; // weight on stable intensity vs daily noise
const SEASONALITY: Record<number, number> = {
  0: 1.28, // Sun
  1: 0.9, // Mon
  2: 0.9, // Tue
  3: 0.95, // Wed
  4: 1.02, // Thu
  5: 1.16, // Fri
  6: 1.42, // Sat
};
const LN_MEDIAN = 150; // session length lognormal median (secs)
const LN_SIGMA = 0.6;

export interface PhantomParams {
  baseMin: number; // low end of daily base active users (before seasonality/growth)
  baseMax: number;
  startDate: string; // Sydney YYYY-MM-DD; no phantoms before this day
}

export interface PhantomDay {
  dau: number;
  sessions: number;
  events: number;
  screenViews: number;
  medianSecs: number;
}

export interface PhantomEngagement {
  dau: number;
  wau: number;
  mau: number;
}

// ---- date helpers (integer day index off the Sydney date STRING) ----
const DAY_MS = 86400000;
export function dayIndex(ds: string): number {
  return Math.floor(Date.parse(ds + 'T00:00:00Z') / DAY_MS);
}
function weekday(ds: string): number {
  return new Date(ds + 'T00:00:00Z').getUTCDay();
}
export function addDays(ds: string, n: number): string {
  return new Date((dayIndex(ds) + n) * DAY_MS).toISOString().slice(0, 10);
}

// ---- pool ----
function intensity(u: number): number {
  return Math.pow(rng(`w:${u}`)(), GAMMA); // (0,1], skewed toward 0
}
function baseTarget(ds: string, p: PhantomParams): number {
  return p.baseMin + rng(`base:${ds}`)() * (p.baseMax - p.baseMin);
}
function growth(ds: string, p: PhantomParams): number {
  const weeks = (dayIndex(ds) - dayIndex(p.startDate)) / 7;
  return Math.min(1 + GROWTH_PER_WEEK * weeks, GROWTH_CAP);
}
function dailyActiveCount(ds: string, p: PhantomParams): number {
  return Math.round(baseTarget(ds, p) * SEASONALITY[weekday(ds)] * growth(ds, p));
}

/** The set of phantom pool indices active on a given Sydney day. */
function activeSet(ds: string, p: PhantomParams): Set<number> {
  const k = dailyActiveCount(ds, p);
  const di = dayIndex(ds);
  const scored: Array<[number, number]> = [];
  for (let u = 0; u < POOL; u++) {
    const noise = rng(`act:${u}:${di}`)();
    scored.push([u, intensity(u) * (RETENTION_MIX + (1 - RETENTION_MIX) * noise)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const set = new Set<number>();
  for (let i = 0; i < k && i < POOL; i++) set.add(scored[i][0]);
  return set;
}

/** Distinct phantoms active across a trailing window ending on `ds` (inclusive). */
function windowUnion(ds: string, days: number, p: PhantomParams): Set<number> {
  const startIdx = dayIndex(p.startDate);
  const set = new Set<number>();
  for (let k = 0; k < days; k++) {
    const d2 = addDays(ds, -k);
    if (dayIndex(d2) < startIdx) continue; // no phantoms before start
    for (const u of activeSet(d2, p)) set.add(u);
  }
  return set;
}

/** Sessions for one active phantom on one day: length + screen counts. */
function userDaySessions(u: number, ds: string): Array<{ length: number; screens: number }> {
  const g = rng(`ud:${u}:${dayIndex(ds)}`);
  const r = g();
  const n = r < 0.75 ? 1 : r < 0.95 ? 2 : 3;
  const out: Array<{ length: number; screens: number }> = [];
  for (let i = 0; i < n; i++) {
    const length = Math.min(1800, Math.max(20, Math.round(Math.exp(Math.log(LN_MEDIAN) + gauss(g) * LN_SIGMA))));
    const screens = Math.max(1, Math.min(12, 1 + Math.round(length / 60 + (g() - 0.5) * 2)));
    out.push({ length, screens });
  }
  return out;
}

/** Phantom contribution for a single Sydney day. */
export function phantomDay(ds: string, p: PhantomParams): PhantomDay {
  const active = activeSet(ds, p);
  let sessions = 0;
  let events = 0;
  let screenViews = 0;
  const lengths: number[] = [];
  for (const u of active) {
    for (const s of userDaySessions(u, ds)) {
      sessions++;
      events += s.screens * 2 + 1; // ~screen_view + screen_time per screen, plus one action
      screenViews += s.screens;
      lengths.push(s.length);
    }
  }
  lengths.sort((a, b) => a - b);
  const medianSecs = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  return { dau: active.size, sessions, events, screenViews, medianSecs };
}

/** Phantom DAU/WAU/MAU anchored on a Sydney day. */
export function phantomEngagement(ds: string, p: PhantomParams): PhantomEngagement {
  return {
    dau: activeSet(ds, p).size,
    wau: windowUnion(ds, 7, p).size,
    mau: windowUnion(ds, 30, p).size,
  };
}

// Diurnal activity weights per Sydney hour (0-23). "Today so far" stays flat at
// zero overnight, then starts gently at 8am and creeps up through the day —
// spread across the whole day (not front-loaded) so the live numbers keep
// visibly climbing, peaking late afternoon with a soft evening tail. Cumulative
// progress lands ~15% by noon, ~54% by 4pm, ~77% by 6pm, ~93% by 8pm.
//        12a          6a   7   8a   9   10   11   12p  1p   2p   3p   4p   5p   6p   7p   8p   9p   10   11
const DIURNAL = [
  0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.9, 1.4, 1.9, 2.4, 2.8, 3.1, 3.3, 3.5, 3.3, 2.7, 1.9, 1.2, 0.6, 0.3, 0.1,
];
const DIURNAL_TOTAL = DIURNAL.reduce((a, b) => a + b, 0);

/** Fraction (0-1) of a day's activity that has occurred by Sydney fractional hour `fh`. */
export function dayProgress(fh: number): number {
  if (fh <= 0) return 0;
  if (fh >= 24) return 1;
  const h = Math.floor(fh);
  let acc = 0;
  for (let i = 0; i < h; i++) acc += DIURNAL[i];
  acc += DIURNAL[h] * (fh - h);
  return Math.min(1, acc / DIURNAL_TOTAL);
}

/** Distinct phantom users + total sessions across an inclusive Sydney-day range. */
export function phantomRangeTotals(
  fromDs: string,
  toDs: string,
  p: PhantomParams,
): { users: number; sessions: number } {
  const start = Math.max(dayIndex(fromDs), dayIndex(p.startDate));
  const end = dayIndex(toDs);
  const users = new Set<number>();
  let sessions = 0;
  for (let di = start; di <= end; di++) {
    const ds = new Date(di * DAY_MS).toISOString().slice(0, 10);
    for (const u of activeSet(ds, p)) {
      users.add(u);
      sessions += userDaySessions(u, ds).length;
    }
  }
  return { users: users.size, sessions };
}

/** Phantom screen views + distinct users across an inclusive Sydney-day range. */
export function phantomScreensRange(
  fromDs: string,
  toDs: string,
  p: PhantomParams,
): { views: number; uniqUsers: number } {
  const start = Math.max(dayIndex(fromDs), dayIndex(p.startDate));
  const end = dayIndex(toDs);
  let views = 0;
  const users = new Set<number>();
  for (let di = start; di <= end; di++) {
    const ds = new Date(di * DAY_MS).toISOString().slice(0, 10);
    const active = activeSet(ds, p);
    for (const u of active) {
      users.add(u);
      for (const s of userDaySessions(u, ds)) views += s.screens;
    }
  }
  return { views, uniqUsers: users.size };
}
