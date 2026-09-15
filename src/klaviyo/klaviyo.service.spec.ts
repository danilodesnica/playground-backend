import { chunks, consentedAt, normaliseEmail, splitName, toProfileAttributes } from './klaviyo.service';

describe('Klaviyo helpers', () => {
  it('normalises emails and rejects anything that is not one', () => {
    expect(normaliseEmail('  Kate@Example.COM ')).toBe('kate@example.com');
    expect(normaliseEmail('not-an-email')).toBe('');
    expect(normaliseEmail(null)).toBe('');
  });

  it('splits a single name field the way Klaviyo wants it', () => {
    expect(splitName('Kate')).toEqual({ first_name: 'Kate' });
    expect(splitName('Kate  Barany')).toEqual({ first_name: 'Kate', last_name: 'Barany' });
    expect(splitName('Mary Anne van der Berg')).toEqual({ first_name: 'Mary', last_name: 'Anne van der Berg' });
    expect(splitName('')).toEqual({});
    expect(splitName(null)).toEqual({});
  });

  it('shapes a profile with the app fields Klaviyo can segment on', () => {
    expect(
      toProfileAttributes({
        id: 'u1',
        email: 'Kate@Example.com',
        name: 'Kate Barany',
        code: '2000',
        created_at: '2026-09-07T01:00:00.000Z',
      }),
    ).toEqual({
      email: 'kate@example.com',
      first_name: 'Kate',
      last_name: 'Barany',
      properties: {
        app_user_id: 'u1',
        postcode: '2000',
        app_signed_up_at: '2026-09-07T01:00:00.000Z',
        source: 'Ask Andee app',
      },
    });
  });

  it('never stamps consent in the future, and survives a bad timestamp', () => {
    const past = '2026-01-01T00:00:00.000Z';
    expect(consentedAt(past)).toBe(past);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(Date.parse(consentedAt(future))).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(consentedAt('garbage'))).toBeLessThanOrEqual(Date.now());
  });

  it('chunks without dropping the remainder', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
