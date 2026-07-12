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
});
