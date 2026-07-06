import { AnalyticsLimitQuerySchema, AnalyticsRangeQuerySchema } from './analytics-query.dto';

describe('AnalyticsRangeQuerySchema', () => {
  it('accepts YYYY-MM-DD bounds and an empty query', () => {
    expect(AnalyticsRangeQuerySchema.safeParse({ from: '2026-06-01', to: '2026-07-05' }).success).toBe(true);
    expect(AnalyticsRangeQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects non-date strings', () => {
    expect(AnalyticsRangeQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(AnalyticsRangeQuerySchema.safeParse({ to: '2026-7-5' }).success).toBe(false);
  });
});

describe('AnalyticsLimitQuerySchema — top-favorited / top-clicked / postcodes', () => {
  it('coerces the querystring limit to a number', () => {
    const result = AnalyticsLimitQuerySchema.safeParse({ limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(25);
  });

  it('is optional — the service applies per-endpoint defaults', () => {
    const result = AnalyticsLimitQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBeUndefined();
  });

  it('rejects out-of-range and non-integer limits', () => {
    expect(AnalyticsLimitQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(AnalyticsLimitQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
    expect(AnalyticsLimitQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false);
  });
});
