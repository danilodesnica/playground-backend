import { InflationService } from './inflation.service';

// A day comfortably between the start date and "today", so it is inflatable.
const DAY = '2020-06-15';
const dailyRow = () => ({
  day: DAY,
  dau: 3,
  new_users: 2,
  sessions: 4,
  events: 20,
  avg_session_secs: 90,
});

describe('InflationService', () => {
  it('is a no-op when disabled', () => {
    const svc = InflationService.withConfig({ enabled: false });
    const input = [dailyRow()];
    expect(svc.isEnabled).toBe(false);
    expect(svc.applyOverview(input)).toEqual(input);
    expect(svc.applyEngagement({ dau_yesterday: 3, wau: 8, mau: 20, stickiness: 0.15 }, DAY)).toEqual({
      dau_yesterday: 3,
      wau: 8,
      mau: 20,
      stickiness: 0.15,
    });
  });

  it('inflates DAU/sessions/length but never signups', () => {
    const svc = InflationService.withConfig({ startDate: '2020-01-01' });
    const [out] = svc.applyOverview([dailyRow()]);
    expect(out.dau).toBeGreaterThan(3);
    expect(out.sessions).toBeGreaterThan(4);
    expect(out.events).toBeGreaterThan(20);
    expect(out.avg_session_secs).toBeGreaterThan(0);
    expect(out.new_users).toBe(2); // signups untouched
    // small scale sanity: ~14-30 phantom DAU added, not hundreds
    expect(out.dau).toBeLessThan(40);
  });

  it('inflates engagement and keeps stickiness a 0-1 ratio', () => {
    const svc = InflationService.withConfig({ startDate: '2020-01-01' });
    const out = svc.applyEngagement({ dau_yesterday: 3, wau: 8, mau: 20, stickiness: 0.15 }, DAY);
    expect(out.dau_yesterday).toBeGreaterThan(3);
    expect(out.mau).toBeGreaterThan(20);
    expect(out.wau).toBeGreaterThan(8);
    expect(out.stickiness).toBeGreaterThan(0);
    expect(out.stickiness).toBeLessThanOrEqual(1);
    expect(out.dau_yesterday).toBeLessThanOrEqual(out.mau);
  });

  it('is deterministic — same input, same output', () => {
    const a = InflationService.withConfig({ startDate: '2020-01-01' }).applyOverview([dailyRow()]);
    const b = InflationService.withConfig({ startDate: '2020-01-01' }).applyOverview([dailyRow()]);
    expect(a).toEqual(b);
  });

  it('does not touch days before the start date', () => {
    const svc = InflationService.withConfig({ startDate: '2020-07-01' });
    const before = { ...dailyRow(), day: '2020-06-15' };
    expect(svc.applyOverview([before])).toEqual([before]);
  });

  it('freezes correctly: an endDate leaves later days real but keeps earlier ones inflated', () => {
    const svc = InflationService.withConfig({ startDate: '2020-01-01', endDate: '2020-06-10' });
    const earlier = { ...dailyRow(), day: '2020-05-01' };
    const later = { ...dailyRow(), day: '2020-06-15' };
    const [outEarlier, outLater] = svc.applyOverview([earlier, later]);
    expect(outEarlier.dau).toBeGreaterThan(3); // before endDate → inflated
    expect(outLater).toEqual(later); // on/after endDate → real
  });

  it('uses the hardcoded default config (enabled) out of the box', () => {
    const svc = new InflationService();
    expect(svc.isEnabled).toBe(true);
  });

  it('inflates live today counts (no yesterday cap) and is a no-op when disabled/pre-start', () => {
    const on = InflationService.withConfig({ startDate: '2020-01-01' });
    const out = on.applyToday({ active_users: 2, sessions: 3, events: 105 }, DAY);
    expect(out.active_users).toBeGreaterThan(2);
    expect(out.sessions).toBeGreaterThan(3);
    expect(out.events).toBeGreaterThan(105);

    expect(
      InflationService.withConfig({ enabled: false }).applyToday(
        { active_users: 2, sessions: 3, events: 105 },
        DAY,
      ),
    ).toEqual({ active_users: 2, sessions: 3, events: 105 });

    expect(
      InflationService.withConfig({ startDate: '2020-07-01' }).applyToday(
        { active_users: 2, sessions: 3, events: 105 },
        '2020-06-15',
      ),
    ).toEqual({ active_users: 2, sessions: 3, events: 105 });
  });

  it("today's inflated counts equal the same day's completed-day (overview) form", () => {
    const svc = InflationService.withConfig({ startDate: '2020-01-01' });
    const today = svc.applyToday({ active_users: 3, sessions: 4, events: 20 }, DAY);
    const [overview] = svc.applyOverview([
      { day: DAY, dau: 3, new_users: 0, sessions: 4, events: 20, avg_session_secs: 0 },
    ]);
    expect(today.active_users).toBe(overview.dau);
    expect(today.sessions).toBe(overview.sessions);
    expect(today.events).toBe(overview.events);
  });

  it('inflates geography with a Sydney-led spread, keeping real rows', () => {
    const svc = InflationService.withConfig({ startDate: '2020-01-01' });
    const real = [{ country: 'AU', region: 'NSW', city: '', uniq_users: 1, sessions: 2 }];
    const out = svc.applyGeo(real, '2020-05-01', '2020-06-01');
    expect(out.length).toBeGreaterThan(4); // many phantom cities added
    expect(out[0].city).toBe('Sydney'); // most-weighted, tops the sorted list
    expect(out.reduce((s, r) => s + r.uniq_users, 0)).toBeGreaterThan(15);
    // the real "" row is preserved (not overwritten by phantom cities)
    expect(out.some((r) => r.city === '' && r.uniq_users === 1)).toBe(true);
    // sessions >= users per row
    expect(out.every((r) => r.sessions >= r.uniq_users)).toBe(true);
  });

  it('does not inflate geo when disabled', () => {
    const real = [{ country: 'AU', region: 'NSW', city: 'Sydney', uniq_users: 3, sessions: 4 }];
    expect(InflationService.withConfig({ enabled: false }).applyGeo(real, '2020-05-01', '2020-06-01')).toEqual(
      real,
    );
  });
});
